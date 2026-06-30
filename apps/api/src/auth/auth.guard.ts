import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthContext, OrgMembership } from './auth.types';

/**
 * Protege endpoints exigiendo un JWT válido de Supabase en el header
 * `Authorization: Bearer <token>`.
 *
 * Tras validar el token:
 *   1. Verifica el usuario contra Supabase Auth.
 *   2. Resuelve su organización + rol (membership).
 *   3. Adjunta todo en `req.auth` para los controladores.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      throw new UnauthorizedException('Falta el token de autenticación');
    }

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // Perfil (para saber si es super admin de plataforma).
    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', data.user.id)
      .maybeSingle();
    const isPlatformAdmin = Boolean(profile?.is_platform_admin);

    // Todas las organizaciones del usuario.
    const { data: rows } = await this.supabase.admin
      .from('memberships')
      .select('organization_id, role, organizations(name, status)')
      .eq('user_id', data.user.id);

    const memberships: OrgMembership[] = (rows ?? []).map((r) => {
      const org = r.organizations as unknown as { name?: string; status?: string } | null;
      return {
        organizationId: r.organization_id as string,
        role: r.role as 'admin' | 'closer',
        organizationName: org?.name ?? null,
      };
    });

    if (memberships.length === 0 && !isPlatformAdmin) {
      throw new UnauthorizedException('El usuario no pertenece a ninguna organización');
    }

    // Organización activa: cabecera X-Org-Id si el usuario es miembro; si no, la primera.
    const requested = (req.headers['x-org-id'] as string | undefined)?.trim();
    let active = memberships.find((m) => m.organizationId === requested) ?? memberships[0];

    // Un super admin puede operar sobre cualquier org que indique en la cabecera,
    // aunque no sea miembro (necesario para el panel de plataforma).
    if (isPlatformAdmin && requested && (!active || active.organizationId !== requested)) {
      active = { organizationId: requested, role: 'admin' };
    }

    // Bloqueo si la org activa está suspendida (salvo super admin de plataforma).
    if (active && !isPlatformAdmin) {
      const orgInfo = memberships.find((m) => m.organizationId === active!.organizationId);
      void orgInfo;
      const { data: org } = await this.supabase.admin
        .from('organizations')
        .select('status')
        .eq('id', active.organizationId)
        .maybeSingle();
      if (org?.status === 'suspended') {
        throw new ForbiddenException('Esta organización está suspendida. Contacta con soporte.');
      }
    }

    const auth: AuthContext = {
      userId: data.user.id,
      email: data.user.email ?? null,
      accessToken: token,
      organizationId: active?.organizationId ?? '',
      role: active?.role ?? 'closer',
      isPlatformAdmin,
      memberships,
    };
    req.auth = auth;

    return true;
  }
}
