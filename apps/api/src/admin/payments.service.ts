import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from './audit.service';
import type { AuthContext } from '../auth/auth.types';

export type PaymentRow = {
  id: string;
  organization_id: string;
  amount_usd: number;
  currency: string;
  method: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Facturación de subcuentas para el panel admin. De momento el cobro es MANUAL
 * (el super-admin registra los pagos), pero la estructura está lista para Stripe
 * (columnas stripe_* en `organizations` e `external_id` en `payments`).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Resumen de facturación por organización + total pagado. */
  async billing() {
    const { data: orgs } = await this.supabase.admin
      .from('organizations')
      .select(
        'id, name, slug, plan, status, subscription_status, monthly_price_usd, next_charge_at',
      )
      .order('created_at', { ascending: false });

    const { data: payments } = await this.supabase.admin
      .from('payments')
      .select('organization_id, amount_usd, status');

    const paidByOrg = new Map<string, number>();
    for (const p of payments ?? []) {
      if (p.status !== 'paid') continue;
      const id = p.organization_id as string;
      paidByOrg.set(id, (paidByOrg.get(id) ?? 0) + Number(p.amount_usd ?? 0));
    }

    const rows = (orgs ?? []).map((o) => ({
      organization_id: o.id as string,
      name: o.name as string,
      slug: o.slug as string,
      plan: o.plan as string,
      status: o.status as string,
      subscription_status: (o.subscription_status as string | null) ?? null,
      monthly_price_usd: o.monthly_price_usd == null ? null : Number(o.monthly_price_usd),
      next_charge_at: (o.next_charge_at as string | null) ?? null,
      total_paid_usd: Number((paidByOrg.get(o.id as string) ?? 0).toFixed(2)),
    }));

    const totalPaid = rows.reduce((acc, r) => acc + r.total_paid_usd, 0);
    const mrr = rows.reduce(
      (acc, r) =>
        acc + (r.subscription_status === 'active' && r.monthly_price_usd ? r.monthly_price_usd : 0),
      0,
    );

    return {
      rows,
      totals: {
        total_paid_usd: Number(totalPaid.toFixed(2)),
        mrr_usd: Number(mrr.toFixed(2)),
      },
    };
  }

  /** Últimos pagos registrados (opcionalmente de una organización). */
  async listPayments(organizationId?: string): Promise<PaymentRow[]> {
    let q = this.supabase.admin
      .from('payments')
      .select(
        'id, organization_id, amount_usd, currency, method, status, period_start, period_end, note, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (organizationId) q = q.eq('organization_id', organizationId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((p) => ({
      ...p,
      amount_usd: Number(p.amount_usd),
    })) as PaymentRow[];
  }

  /** Actualiza el precio mensual, estado de suscripción y próximo cobro. */
  async updateBilling(
    ctx: AuthContext,
    orgId: string,
    patch: {
      monthly_price_usd?: number | null;
      subscription_status?: string;
      next_charge_at?: string | null;
    },
  ) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.monthly_price_usd !== undefined) update.monthly_price_usd = patch.monthly_price_usd;
    if (patch.subscription_status !== undefined)
      update.subscription_status = patch.subscription_status;
    if (patch.next_charge_at !== undefined) update.next_charge_at = patch.next_charge_at;

    const { data, error } = await this.supabase.admin
      .from('organizations')
      .update(update)
      .eq('id', orgId)
      .select('id, monthly_price_usd, subscription_status, next_charge_at')
      .single();
    if (error) throw error;

    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'billing.update',
      targetType: 'organization',
      targetId: orgId,
      organizationId: orgId,
      metadata: patch as Record<string, unknown>,
    });
    return data;
  }

  /** Registra un pago manual para una organización. */
  async recordPayment(
    ctx: AuthContext,
    orgId: string,
    dto: {
      amount_usd: number;
      currency?: string;
      status?: string;
      period_start?: string;
      period_end?: string;
      note?: string;
    },
  ) {
    const { data, error } = await this.supabase.admin
      .from('payments')
      .insert({
        organization_id: orgId,
        amount_usd: dto.amount_usd,
        currency: dto.currency ?? 'USD',
        method: 'manual',
        status: dto.status ?? 'paid',
        period_start: dto.period_start ?? null,
        period_end: dto.period_end ?? null,
        note: dto.note ?? null,
        created_by: ctx.userId,
      })
      .select('*')
      .single();
    if (error) throw error;

    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'payment.record',
      targetType: 'organization',
      targetId: orgId,
      organizationId: orgId,
      metadata: { amount_usd: dto.amount_usd, status: dto.status ?? 'paid' },
    });
    return data;
  }

  async deletePayment(ctx: AuthContext, id: string) {
    const { error } = await this.supabase.admin.from('payments').delete().eq('id', id);
    if (error) throw error;
    await this.audit.log({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'payment.delete',
      targetType: 'payment',
      targetId: id,
    });
    return { ok: true };
  }
}
