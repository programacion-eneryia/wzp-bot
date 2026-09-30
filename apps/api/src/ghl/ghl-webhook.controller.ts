import { Body, Controller, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GhlService } from './ghl.service';

/**
 * Endpoint PÚBLICO (sin JWT) que recibe GoHighLevel cuando un lead AGENDA o
 * CANCELA una cita. La autenticidad se valida con el `intake_token` de la org
 * (por query ?token=...). Configúralo en GHL: Workflow con trigger de cita
 * (Appointment) → acción "Webhook (Outbound)" (POST) a esta URL.
 *
 * Al recibirlo, registramos la cita y pausamos los seguimientos del setter para
 * ese lead (o los reanudamos si la cita se cancela).
 */
@Controller('webhooks/ghl')
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class GhlWebhookController {
  private readonly logger = new Logger(GhlWebhookController.name);

  constructor(private readonly ghl: GhlService) {}

  @Post('appointment')
  @HttpCode(200)
  async appointment(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    const orgId = await this.ghl.resolveOrgByToken(token);
    return this.ghl.handleAppointmentWebhook(orgId, body);
  }

  /** Pausar/reactivar el bot de un lead desde un workflow de GHL. */
  @Post('bot')
  @HttpCode(200)
  async bot(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    const orgId = await this.ghl.resolveOrgByToken(token);
    return this.ghl.handleBotControlWebhook(orgId, body);
  }

  /** Enviar un mensaje al lead (por el canal del bot) desde un flow de GHL. */
  @Post('send')
  @HttpCode(200)
  async send(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    const orgId = await this.ghl.resolveOrgByToken(token);
    return this.ghl.handleSendMessageWebhook(orgId, body);
  }
}
