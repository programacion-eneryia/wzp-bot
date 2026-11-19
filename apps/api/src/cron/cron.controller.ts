import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { CryptoService } from '../common/crypto.service';
import { MessagingService } from '../messaging/messaging.service';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { ChannelsService } from '../channels/channels.service';

/** Cada cuántos minutos se comprueba contra el proveedor el estado real de los canales. */
const CHANNEL_RECONCILE_EVERY_MIN = 5;

/**
 * Cron de procesamiento asíncrono. En Vercel se configura en `vercel.json`
 * (`crons: [{ path: "/api/cron/tick", schedule: "* * * * *" }]`) y Vercel lo
 * invoca cada minuto con `Authorization: Bearer <CRON_SECRET>`. Drena:
 *   - las conversaciones cuyo debounce venció (genera y envía respuestas), y
 *   - el outbox de mensajes proactivos vencidos.
 * Es idempotente: los locks en BD evitan procesar dos veces lo mismo.
 */
@Controller('cron')
@SkipThrottle()
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly messaging: MessagingService,
    private readonly workflows: WorkflowEngineService,
    private readonly channels: ChannelsService,
  ) {}

  @Get('tick')
  async tickGet(
    @Headers('authorization') auth: string,
    @Query('secret') secret: string,
  ) {
    return this.run(auth, secret);
  }

  @Post('tick')
  async tickPost(
    @Headers('authorization') auth: string,
    @Query('secret') secret: string,
  ) {
    return this.run(auth, secret);
  }

  private async run(auth: string | undefined, secret: string | undefined) {
    const expected = this.config.get<string>('CRON_SECRET') ?? '';
    if (!expected) {
      // Sin secreto configurado no exponemos el endpoint (evita disparos anónimos).
      throw new ForbiddenException('CRON_SECRET no configurado');
    }
    const provided = (auth?.replace(/^Bearer\s+/i, '') || secret || '').trim();
    if (!this.crypto.safeEqual(provided, expected)) {
      throw new ForbiddenException('Secreto de cron inválido');
    }

    // Los workflows corren PRIMERO: pueden encolar mensajes al outbox, que se
    // drena en la misma pasada.
    const workflows = await this.workflows.processDueRuns();
    const [responses, proactive, followups] = await Promise.all([
      this.messaging.processDueResponses(),
      this.messaging.processDueOutbox(),
      this.messaging.processDueFollowUps(),
    ]);
    if (responses || proactive || workflows || followups) {
      this.logger.log(
        `Cron tick: ${responses} respuestas, ${proactive} proactivos, ${followups} seguimientos, ${workflows} workflows`,
      );
    }

    // Estado real de los canales según el proveedor (por si se perdió algún
    // webhook de estado): así la alerta de "canal desconectado" aparece y
    // desaparece sola en pocos minutos.
    let channelsChanged = 0;
    if (new Date().getMinutes() % CHANNEL_RECONCILE_EVERY_MIN === 0) {
      try {
        const r = await this.channels.reconcileAll();
        channelsChanged = r.changed;
        if (r.changed) this.logger.log(`Canales reconciliados con el proveedor: ${r.changed} de ${r.checked} corregidos`);
      } catch (err) {
        this.logger.warn(`No se pudo comprobar el estado de los canales: ${String(err)}`);
      }
    }
    return { ok: true, responses, proactive, followups, workflows, channelsChanged };
  }
}
