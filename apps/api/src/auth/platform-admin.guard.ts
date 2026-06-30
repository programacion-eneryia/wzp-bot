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
 * Protege endpoints exclusivos del SUPER ADMIN de plataforma (dueño del SaaS).
 * Valida el JWT y exige `profiles.is_platform_admin = true`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Falta el token de autenticación');

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', data.user.id)
      .maybeSingle();

    if (!profile?.is_platform_admin) {
      throw new ForbiddenException('Acceso restringido al administrador de la plataforma');
    }

    const auth: AuthContext = {
      userId: data.user.id,
      email: data.user.email ?? null,
      accessToken: token,
      organizationId: '',
      role: 'admin',
      isPlatformAdmin: true,
      memberships: [] as OrgMembership[],
    };
    req.auth = auth;
    return true;
  }
}