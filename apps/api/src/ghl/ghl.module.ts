import { Module } from '@nestjs/common';
import { GhlService } from './ghl.service';
import { GhlWebhookController } from './ghl-webhook.controller';

/**
 * Sincronización con GoHighLevel: webhook de salida "lead registrado" (paso 2) y
 * webhook de entrada de citas agendadas/canceladas (paso 4). Depende solo de los
 * módulos globales (Supabase), por lo que puede exportar `GhlService` para que el
 * intake de leads dispare la salida sin ciclos de dependencias.
 */
@Module({
  controllers: [GhlWebhookController],
  providers: [GhlService],
  exports: [GhlService],
})
export class GhlModule {}
