import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { UnipileService } from '../unipile/unipile.service';
import type { AuthContext } from '../auth/auth.types';

type CalProvider = 'google' | 'outlook';

type AvailabilityRules = {
  tz?: string;
  days?: number[]; // 0=domingo ... 6=sábado
  start?: string; // "09:00"
  end?: string; // "18:00"
  slot_min?: number;
  buffer_min?: number;
  max_per_day?: number;
};

const DEFAULT_RULES: Required<Omit<AvailabilityRules, 'tz'>> & { tz: string } = {
  tz: 'Europe/Madrid',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '18:00',
  slot_min: 30,
  buffer_min: 15,
  max_per_day: 4,
};

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly unipile: UnipileService,
    private readonly config: ConfigService,
  ) {}

  async list(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('calendars')
      .select('id, provider, name, status, is_default, availability_rules, last_error, connected_at, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  /** Inicia la conexión de un calendario (Google/Outlook) vía hosted auth. */
  async connect(ctx: AuthContext, provider: CalProvider) {
    this.assertAdmin(ctx);

    const { data: cal, error } = await this.supabase.admin
      .from('calendars')
      .insert({ organization_id: ctx.organizationId, provider, status: 'pending', created_by: ctx.userId })
      .select('id')
      .single();
    if (error) throw error;

    const base = this.config.get<string>('WEBHOOK_BASE_URL') ?? this.config.get<string>('API_URL');
    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    const secret = this.config.getOrThrow<string>('UNIPILE_WEBHOOK_SECRET');

    const { url } = await this.unipile.createCalendarHostedAuthLink({
      name: cal.id as string,
      providers: [provider === 'outlook' ? 'OUTLOOK' : 'GOOGLE'],
      notify_url: `${base}/api/webhooks/unipile/calendar-account?secret=${encodeURIComponent(secret)}`,
      success_redirect_url: `${webUrl}/dashboard/calendar?connected=1`,
      failure_redirect_url: `${webUrl}/dashboard/calendar?error=1`,
    });

    return { calendarId: cal.id as string, url };
  }

  async disconnect(ctx: AuthContext, calendarId: string) {
    this.assertAdmin(ctx);
    const { data: cal } = await this.supabase.admin
      .from('calendars')
      .select('id, unipile_account_id')
      .eq('id', calendarId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (!cal) throw new NotFoundException('Calendario no encontrado');

    if (cal.unipile_account_id) {
      try {
        await this.unipile.deleteAccount(cal.unipile_account_id as string);
      } catch (err) {
        this.logger.warn(`No se pudo eliminar la cuenta de calendario en Unipile: ${String(err)}`);
      }
    }
    await this.supabase.admin
      .from('calendars')
      .update({ status: 'disconnected', unipile_account_id: null, unipile_calendar_id: null })
      .eq('id', calendarId)
      .eq('organization_id', ctx.organizationId);
    return { ok: true };
  }

  /** Actualiza las reglas de disponibilidad / modo por defecto. */
  async update(ctx: AuthContext, calendarId: string, patch: { availability_rules?: AvailabilityRules; is_default?: boolean }) {
    this.assertAdmin(ctx);
    const update: Record<string, unknown> = {};
    if (patch.availability_rules) update.availability_rules = patch.availability_rules;
    if (typeof patch.is_default === 'boolean') update.is_default = patch.is_default;

    const { data, error } = await this.supabase.admin
      .from('calendars')
      .update(update)
      .eq('id', calendarId)
      .eq('organization_id', ctx.organizationId)
      .select('id, availability_rules, is_default')
      .single();
    if (error) throw error;
    return data;
  }

  /** Webhook de Unipile cuando un calendario termina de conectarse. */
  async handleAccountWebhook(payload: { status?: string; account_id?: string; name?: string }) {
    const calendarId = payload.name;
    if (!calendarId) return;
    const ok = payload.status === 'CREATION_SUCCESS' || payload.status === 'RECONNECTED';
    if (!ok || !payload.account_id) {
      await this.supabase.admin
        .from('calendars')
        .update({ status: 'error', last_error: `Conexión fallida: ${payload.status ?? 'desconocido'}` })
        .eq('id', calendarId);
      return;
    }

    let unipileCalendarId: string | null = null;
    let name: string | null = null;
    try {
      const cals = await this.unipile.listCalendars(payload.account_id);
      const primary = cals.find((c) => c.is_primary) ?? cals[0];
      unipileCalendarId = primary?.id ?? null;
      name = primary?.name ?? null;
    } catch (err) {
      this.logger.warn(`No se pudieron listar calendarios: ${String(err)}`);
    }

    await this.supabase.admin
      .from('calendars')
      .update({
        status: 'connected',
        unipile_account_id: payload.account_id,
        unipile_calendar_id: unipileCalendarId,
        name: name ?? undefined,
        connected_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', calendarId);
  }

  /**
   * Texto con huecos libres reales para inyectar en el prompt (modo "slots").
   * Degrada con gracia: si algo falla, devuelve null y el bot ofrece horarios
   * razonables por su cuenta.
   */
  async getAvailabilityText(orgId: string, calendarId: string, durationMin: number): Promise<string | null> {
    try {
      const { data: cal } = await this.supabase.admin
        .from('calendars')
        .select('unipile_account_id, unipile_calendar_id, availability_rules, status')
        .eq('id', calendarId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!cal || cal.status !== 'connected' || !cal.unipile_calendar_id) return null;

      const rules = { ...DEFAULT_RULES, ...((cal.availability_rules as AvailabilityRules) ?? {}) };
      const now = new Date();
      const horizon = new Date(now.getTime() + 8 * 24 * 3600 * 1000);

      let busy: { start: number; end: number }[] = [];
      try {
        const events = await this.unipile.listCalendarEvents(
          cal.unipile_calendar_id as string,
          now.toISOString(),
          horizon.toISOString(),
        );
        busy = events
          .map((e) => ({ start: ms(e.start), end: ms(e.end) }))
          .filter((e) => e.start > 0 && e.end > 0);
      } catch {
        // sin acceso a ocupados: ofrecemos según reglas igualmente
      }

      const slots = computeFreeSlots(now, horizon, rules, durationMin, busy);
      if (slots.length === 0) return null;
      return formatSlots(slots, rules.tz);
    } catch (err) {
      this.logger.warn(`getAvailabilityText falló: ${String(err)}`);
      return null;
    }
  }

  private assertAdmin(ctx: AuthContext) {
    if (ctx.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede gestionar calendarios');
    }
  }
}

function ms(v?: string): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Calcula huecos libres en los próximos días según reglas, evitando solapamiento
 * con eventos ocupados. Simplificado: interpreta start/end de las reglas como
 * hora local del servidor (suficiente para el MVP; el closer confirma el evento).
 */
function computeFreeSlots(
  from: Date,
  to: Date,
  rules: AvailabilityRules,
  durationMin: number,
  busy: { start: number; end: number }[],
): Date[] {
  const days = rules.days ?? DEFAULT_RULES.days;
  const [sh, sm] = (rules.start ?? DEFAULT_RULES.start).split(':').map(Number);
  const [eh, em] = (rules.end ?? DEFAULT_RULES.end).split(':').map(Number);
  const slotMin = rules.slot_min ?? DEFAULT_RULES.slot_min;
  const maxPerDay = rules.max_per_day ?? DEFAULT_RULES.max_per_day;
  const durMs = durationMin * 60 * 1000;

  const out: Date[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  for (let d = 0; d < 8 && cursor <= to; d++) {
    const day = new Date(cursor.getTime() + d * 24 * 3600 * 1000);
    if (!days.includes(day.getDay())) continue;

    let perDay = 0;
    const dayStart = new Date(day);
    dayStart.setHours(sh, sm, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(eh, em, 0, 0);

    for (let t = new Date(dayStart); t.getTime() + durMs <= dayEnd.getTime(); t = new Date(t.getTime() + slotMin * 60000)) {
      if (perDay >= maxPerDay) break;
      const startMs = t.getTime();
      if (startMs < from.getTime() + 2 * 3600 * 1000) continue; // mínimo 2h de antelación
      const endMs = startMs + durMs;
      const overlaps = busy.some((b) => startMs < b.end && endMs > b.start);
      if (overlaps) continue;
      out.push(new Date(startMs));
      perDay++;
    }
    if (out.length >= 8) break;
  }
  return out;
}

function formatSlots(slots: Date[], tz: string): string {
  const byDay = new Map<string, string[]>();
  const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: tz });
  const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  for (const s of slots) {
    const day = dayFmt.format(s);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(timeFmt.format(s));
  }
  return [...byDay.entries()].map(([day, times]) => `- ${day}: ${times.join(', ')}`).join('\n');
}
