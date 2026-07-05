import { Body, Controller, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LeadIntakeService, type IntakeInput } from './lead-intake.service';

/**
 * Endpoints PÚBLICOS de entrada de leads (sin JWT). La autenticidad se valida
 * con el `intake_token` de la organización (por query ?token=...).
 *
 *   - /api/leads/intake → formato genérico (Zapier, Make, tu propio form…).
 *   - /api/leads/ghl    → payload de un webhook de GoHighLevel (Meta Lead Ads).
 */
@Controller('leads')
// Endpoints públicos protegidos por token de org: límite estricto por IP para
// frenar el descubrimiento del token por fuerza bruta.
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(private readonly intake: LeadIntakeService) {}

  @Post('intake')
  @HttpCode(200)
  async generic(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.intake.intake({
      ...(body as Partial<IntakeInput>),
      token,
      raw: body,
    } as IntakeInput);
  }

  @Post('ghl')
  @HttpCode(200)
  async ghl(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.intake.intake(mapGhl(body, token));
  }
}

/**
 * Mapea un payload típico de GoHighLevel (Workflow → Webhook saliente con el
 * trigger "Facebook Lead Form Submitted") a nuestro formato de intake.
 * GHL manda los campos del contacto en la raíz del JSON.
 */
function mapGhl(body: Record<string, unknown>, token: string): IntakeInput {
  const get = (k: string): string | undefined => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const name =
    get('full_name') ??
    get('name') ??
    ([get('first_name'), get('last_name')].filter(Boolean).join(' ') || undefined);

  return {
    token,
    name,
    phone: get('phone') ?? get('phone_number'),
    email: get('email'),
    channel: 'whatsapp',
    source: 'ghl',
    source_detail: get('source') ?? get('form_name') ?? get('page_name'),
    campaign: get('campaign') ?? get('utm_campaign') ?? get('ad_id'),
    proactive: true,
    raw: body,
  };
}
