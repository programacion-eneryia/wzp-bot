import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersAdminService } from './users-admin.service';
import { AuditService } from './audit.service';
import type { AuthContext } from '../auth/auth.types';

type Role = 'admin' | 'closer';

@Injectable()
export class AdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersAdminService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // ORGANIZACIONES
  // ===========================================================================

  async listOrganizations() {
    const { data: orgs, error } = await this.supabase.admin
      .from('organizations')
      .select('id, name, slug, plan, status, seats, subscription_status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const { data: members } = await this.supabase.admin
      .from('memberships')
      .select('organization_id');
    const memberCount = new Map<string, number>();
    for (const m of members ?? []) {
      const id = m.organization_id as string;
      memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
    }

    return (orgs ?? []).map((o) => ({ ...o, member_count: memberCount.get(o.id as string) ?? 0 }));
  }

  // ===========================================================================
  // COSTES (consumo de IA + cuentas de Unipile conectadas)
  // ===========================================================================

  /**
   * Resumen de costes por organización desde el inicio del mes (UTC):
   *  - Consumo de IA: tokens + coste real (de OpenRouter).
   *  - Cuentas conectadas (Unipile) × precio por cuenta (env UNIPILE_USD_PER_ACCOUNT).
   */
  async costs() {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const unipilePerAccount = Number(process.env.UNIPILE_USD_PER_ACCOUNT) || 5;

    const { data: orgs } = await this.supabase.admin
      .from('organizations')
      .select('id, name, slug, plan')
      .order('created_at', { ascending: false });

    const { data: usage } = await this.supabase.admin
      .from('ai_usage')
      .select('organization_id, total_tokens, cost_usd')
      .gte('created_at', startOfMonth.toISOString());

    const { data: channels } = await this.supabase.admin
      .from('channels')
      .select('organization_id, status');

    const aiByOrg = new Map<string, { tokens: number; cost: number }>();
    for (const u of usage ?? []) {
      const id = u.organization_id as string;
      const prev = aiByOrg.get(id) ?? { tokens: 0, cost: 0 };
      prev.tokens += (u.total_tokens as number) ?? 0;
      prev.cost += Number(u.cost_usd ?? 0);
      aiByOrg.set(id, prev);
    }

    const channelsByOrg = new Map<string, number>();
    for (const c of channels ?? []) {
      if (c.status === 'disconnected') continue;
      const id = c.organization_id as string;
      channelsByOrg.set(id, (channelsByOrg.get(id) ?? 0) + 1);
    }

    const rows = (orgs ?? []).map((o) => {
      const id = o.id as string;
      const ai = aiByOrg.get(id) ?? { tokens: 0, cost: 0 };
      const channelCount = channelsByOrg.get(id) ?? 0;
      const unipileCost = channelCount * unipilePerAccount;
      return {
        organization_id: id,
        name: o.name as string,
        slug: o.slug as string,
        plan: o.plan as string,
        ai_tokens: ai.tokens,
        ai_cost_usd: Number(ai.cost.toFixed(4)),
        channels: channelCount,
        unipile_cost_usd: Number(unipileCost.toFixed(2)),
        total_cost_usd: Number((ai.cost + unipileCost).toFixed(2)),
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.ai_tokens += r.ai_tokens;
        acc.ai_cost_usd += r.ai_cost_usd;
        acc.channels += r.channels;
        acc.unipile_cost_usd += r.unipile_cost_usd;
        acc.total_cost_usd += r.total_cost_usd;
        return acc;
      },
      { ai_tokens: 0, ai_cost_usd: 0, channels: 0, unipile_cost_usd: 0, total_cost_usd: 0 },
    );
    totals.ai_cost_usd = Number(totals.ai_cost_usd.toFixed(4));
    totals.unipile_cost_usd = Number(totals.unipile_cost_usd.toFixed(2));
    totals.total_cost_usd = Number(totals.total_cost_usd.toFixed(2));

    return {
      period_start: startOfMonth.toISOString(),
      unipile_usd_per_account: unipilePerAccount,
      rows,
      totals,
    };
  }

  async createOrganization(
    ctx: AuthContext,
    dto: { name: string; slug: string; plan?: string; seats?: number },
  ) {
    const slug = normalizeSlug(dto.slug);
    const { data, error } = await this.supabase.admin
      .from('organizations')
      .insert({
        name: dto.name,
        slug,
        plan: dto.plan ?? 'free',
        seats: dto.seats ?? null,
        created_by: ctx.userId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('Ese slug ya existe');
      throw error;
    }
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'organization.create',
      targetType: 'organization',
      targetId: data.id as string,
      organizationId: data.id as string,
      metadata: { name: dto.name, slug },
    });
    return data;
  }

  async updateOrganization(
    ctx: AuthContext,
    orgId: string,
    patch: { name?: string; plan?: string; seats?: number | null; status?: string },
  ) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.plan !== undefined) update.plan = patch.plan;
    if (patch.seats !== undefined) update.seats = patch.seats;
    if (patch.status !== undefined) update.status = patch.status;

    const { data, error } = await this.supabase.admin
      .from('organizations')
      .update(update)
      .eq('id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'organization.update',
      targetType: 'organization',
      targetId: orgId,
      organizationId: orgId,
      metadata: patch as Record<string, unknown>,
    });
    return data;
  }

  async suspendOrganization(ctx: AuthContext, orgId: string, suspended: boolean) {
    return this.updateOrganization(ctx, orgId, { status: suspended ? 'suspended' : 'active' });
  }

  async deleteOrganization(ctx: AuthContext, orgId: string) {
    const { error } = await this.supabase.admin.from('organizations').delete().eq('id', orgId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'organization.delete',
      targetType: 'organization',
      targetId: orgId,
      organizationId: orgId,
    });
    return { ok: true };
  }

  async orgMetrics(orgId: string) {
    const count = async (table: string) => {
      const { count } = await this.supabase.admin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);
      return count ?? 0;
    };
    const [members, channels, conversations, appointments] = await Promise.all([
      count('memberships'),
      count('channels'),
      count('conversations'),
      count('appointments'),
    ]);
    return { members, channels, conversations, appointments };
  }

  // ===========================================================================
  // USUARIOS
  // ===========================================================================

  async listUsers(params: { search?: string; organizationId?: string } = {}) {
    let pq = this.supabase.admin
      .from('profiles')
      .select('id, email, full_name, is_platform_admin, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (params.search) pq = pq.ilike('email', `%${params.search}%`);
    const { data: profiles, error } = await pq;
    if (error) throw error;

    const { data: memberships } = await this.supabase.admin
      .from('memberships')
      .select('user_id, organization_id, role, organizations(name, slug)');

    const byUser = new Map<string, { organizationId: string; role: string; organizationName: string }[]>();
    for (const m of memberships ?? []) {
      const org = m.organizations as unknown as { name?: string } | null;
      const list = byUser.get(m.user_id as string) ?? [];
      list.push({
        organizationId: m.organization_id as string,
        role: m.role as string,
        organizationName: org?.name ?? '',
      });
      byUser.set(m.user_id as string, list);
    }

    let result = (profiles ?? []).map((p) => ({
      ...p,
      memberships: byUser.get(p.id as string) ?? [],
    }));
    if (params.organizationId) {
      result = result.filter((u) => u.memberships.some((m) => m.organizationId === params.organizationId));
    }
    return result;
  }

  async createUser(
    ctx: AuthContext,
    dto: { email: string; password: string; fullName?: string; organizationId: string; role?: Role },
  ) {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findByEmail(email);
    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      userId = await this.users.createAuthUser({ email, password: dto.password, fullName: dto.fullName });
    }
    await this.addMembership(ctx, userId, dto.organizationId, dto.role ?? 'closer');

    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.create',
      targetType: 'user',
      targetId: userId,
      organizationId: dto.organizationId,
      metadata: { email, reused: Boolean(existing) },
    });
    return { id: userId, email };
  }

  async addMembership(ctx: AuthContext, userId: string, orgId: string, role: Role) {
    const { error } = await this.supabase.admin
      .from('memberships')
      .upsert({ user_id: userId, organization_id: orgId, role }, { onConflict: 'organization_id,user_id' });
    if (error) throw new BadRequestException(error.message);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'membership.add',
      targetType: 'user',
      targetId: userId,
      organizationId: orgId,
      metadata: { role },
    });
    return { ok: true };
  }

  async removeMembership(ctx: AuthContext, userId: string, orgId: string) {
    const { error } = await this.supabase.admin
      .from('memberships')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', orgId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'membership.remove',
      targetType: 'user',
      targetId: userId,
      organizationId: orgId,
    });
    return { ok: true };
  }

  async updateRole(ctx: AuthContext, userId: string, orgId: string, role: Role) {
    const { error } = await this.supabase.admin
      .from('memberships')
      .update({ role })
      .eq('user_id', userId)
      .eq('organization_id', orgId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.role',
      targetType: 'user',
      targetId: userId,
      organizationId: orgId,
      metadata: { role },
    });
    return { ok: true };
  }

  /** Mueve a un usuario de una organización a otra (add destino + remove origen). */
  async moveUser(ctx: AuthContext, userId: string, fromOrgId: string, toOrgId: string, role: Role) {
    await this.addMembership(ctx, userId, toOrgId, role);
    if (fromOrgId && fromOrgId !== toOrgId) {
      await this.removeMembership(ctx, userId, fromOrgId);
    }
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.move',
      targetType: 'user',
      targetId: userId,
      organizationId: toOrgId,
      metadata: { fromOrgId, toOrgId, role },
    });
    return { ok: true };
  }

  async resetPassword(ctx: AuthContext, userId: string, password: string) {
    await this.users.setPassword(userId, password);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.reset_password',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  }

  async setBanned(ctx: AuthContext, userId: string, banned: boolean) {
    await this.users.setBanned(userId, banned);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: banned ? 'user.ban' : 'user.unban',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  }

  async deleteUser(ctx: AuthContext, userId: string) {
    if (userId === ctx.userId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta');
    }
    await this.users.deleteAuthUser(userId);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  }

  async setPlatformAdmin(ctx: AuthContext, userId: string, value: boolean) {
    const { error } = await this.supabase.admin
      .from('profiles')
      .update({ is_platform_admin: value })
      .eq('id', userId);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.set_platform_admin',
      targetType: 'user',
      targetId: userId,
      metadata: { value },
    });
    return { ok: true };
  }

  // ===========================================================================
  // IMPERSONACIÓN
  // ===========================================================================

  async impersonate(ctx: AuthContext, userId: string) {
    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.email) throw new NotFoundException('Usuario no encontrado');
    if (userId === ctx.userId) throw new BadRequestException('No puedes impersonarte a ti mismo');

    const tokenHash = await this.users.generateImpersonationToken(profile.email as string);
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.impersonate',
      targetType: 'user',
      targetId: userId,
      metadata: { email: profile.email },
    });
    return { token_hash: tokenHash, email: profile.email as string };
  }
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
