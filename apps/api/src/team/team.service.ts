import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersAdminService } from '../admin/users-admin.service';
import { AuditService } from '../admin/audit.service';
import type { AuthContext } from '../auth/auth.types';

type Role = 'admin' | 'closer';

/**
 * Gestión de usuarios DENTRO de una organización, para el admin de esa org.
 * Todo queda acotado a `ctx.organizationId` y respeta el límite de plazas (seats).
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersAdminService,
    private readonly audit: AuditService,
  ) {}

  async listMembers(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('user_id, role, created_at, profiles(email, full_name)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((m) => {
      const p = m.profiles as unknown as { email?: string; full_name?: string } | null;
      return {
        user_id: m.user_id as string,
        role: m.role as string,
        email: p?.email ?? null,
        full_name: p?.full_name ?? null,
        created_at: m.created_at as string,
      };
    });
  }

  async createMember(
    ctx: AuthContext,
    dto: { email: string; password: string; fullName?: string; role?: Role },
  ) {
    this.assertAdmin(ctx);
    await this.assertSeatsAvailable(ctx.organizationId);

    const email = dto.email.toLowerCase();
    const existing = await this.users.findByEmail(email);
    const userId = existing
      ? existing.id
      : await this.users.createAuthUser({ email, password: dto.password, fullName: dto.fullName });

    const { error } = await this.supabase.admin
      .from('memberships')
      .upsert(
        { user_id: userId, organization_id: ctx.organizationId, role: dto.role ?? 'closer' },
        { onConflict: 'organization_id,user_id' },
      );
    if (error) throw new BadRequestException(error.message);

    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'team.user.create',
      targetType: 'user',
      targetId: userId,
      organizationId: ctx.organizationId,
      metadata: { email, role: dto.role ?? 'closer' },
    });
    return { id: userId, email };
  }

  async updateRole(ctx: AuthContext, userId: string, role: Role) {
    this.assertAdmin(ctx);
    await this.assertMember(ctx.organizationId, userId);
    const { error } = await this.supabase.admin
      .from('memberships')
      .update({ role })
      .eq('user_id', userId)
      .eq('organization_id', ctx.organizationId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'team.user.role',
      targetType: 'user',
      targetId: userId,
      organizationId: ctx.organizationId,
      metadata: { role },
    });
    return { ok: true };
  }

  async removeMember(ctx: AuthContext, userId: string) {
    this.assertAdmin(ctx);
    if (userId === ctx.userId) throw new BadRequestException('No puedes quitarte a ti mismo');
    await this.assertMember(ctx.organizationId, userId);
    const { error } = await this.supabase.admin
      .from('memberships')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', ctx.organizationId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'team.user.remove',
      targetType: 'user',
      targetId: userId,
      organizationId: ctx.organizationId,
    });
    return { ok: true };
  }

  async resetPassword(ctx: AuthContext, userId: string, password: string) {
    this.assertAdmin(ctx);
    await this.assertMember(ctx.organizationId, userId);
    await this.users.setPassword(userId, password);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'team.user.reset_password',
      targetType: 'user',
      targetId: userId,
      organizationId: ctx.organizationId,
    });
    return { ok: true };
  }

  private assertAdmin(ctx: AuthContext) {
    if (ctx.role !== 'admin' && !ctx.isPlatformAdmin) {
      throw new ForbiddenException('Solo un administrador puede gestionar el equipo');
    }
  }

  private async assertMember(orgId: string, userId: string) {
    const { data } = await this.supabase.admin
      .from('memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Ese usuario no pertenece a tu organización');
  }

  private async assertSeatsAvailable(orgId: string) {
    const { data: org } = await this.supabase.admin
      .from('organizations')
      .select('seats')
      .eq('id', orgId)
      .maybeSingle();
    const seats = org?.seats as number | null | undefined;
    if (seats == null) return; // sin límite
    const { count } = await this.supabase.admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    if ((count ?? 0) >= seats) {
      throw new ForbiddenException(`Has alcanzado el límite de plazas de tu plan (${seats}).`);
    }
  }
}
