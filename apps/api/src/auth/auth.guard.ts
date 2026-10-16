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

    const requested = (req.headers['x-org-id'] as string | undefined)?.trim();
    const cacheKey = `${token}|${requested ?? ''}`;
    const cached = authCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      req.auth = { ...cached.auth, memberships: [...cached.auth.memberships] };
      return true;
    }

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // Perfil (para saber si es super admin de plataforma) y todas las
    // organizaciones del usuario.
    const [{ data: profile }, { data: rows }] = await Promise.all([
      this.supabase.admin
        .from('profiles')
        .select('is_platform_admin')
        .eq('id', data.user.id)
        .maybeSingle(),
      this.supabase.admin
        .from('memberships')
        .select('organization_id, role, organizations(name, status)')
        .eq('user_id', data.user.id),
    ]);
    const isPlatformAdmin = Boolean(profile?.is_platform_admin);

    const statusByOrg = new Map<string, string | undefined>();
    const memberships: OrgMembership[] = (rows ?? []).map((r) => {
      const org = r.organizations as unknown as { name?: string; status?: string } | null;
      statusByOrg.set(r.organization_id as string, org?.status);
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
    let active = memberships.find((m) => m.organizationId === requested) ?? memberships[0];

    // Un super admin puede operar sobre cualquier org que indique en la cabecera,
    // aunque no sea miembro (necesario para el panel de plataforma).
    if (isPlatformAdmin && requested && (!active || active.organizationId !== requested)) {
      active = { organizationId: requested, role: 'admin' };
    }

    // Bloqueo si la org activa está suspendida (salvo super admin de plataforma).
    if (active && !isPlatformAdmin && statusByOrg.get(active.organizationId) === 'suspended') {
      throw new ForbiddenException('Esta organización está suspendida. Contacta con soporte.');
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

    if (authCache.size >= AUTH_CACHE_MAX) authCache.clear();
    authCache.set(cacheKey, {
      auth: { ...auth, memberships: [...memberships] },
      expires: Date.now() + AUTH_CACHE_MS,
    });

    return true;
  }
}

/**
 * Caché corta por token (en la instancia caliente): evita repetir 3 consultas a
 * Supabase en cada petición. Un cambio de rol o suspensión tarda como mucho
 * AUTH_CACHE_MS en aplicarse.
 */
const AUTH_CACHE_MS = 60_000;
const AUTH_CACHE_MAX = 500;
const authCache = new Map<string, { auth: AuthContext; expires: number }>();
