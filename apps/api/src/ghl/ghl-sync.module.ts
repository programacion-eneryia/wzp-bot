import { Module } from '@nestjs/common';
import { GhlSyncService } from './ghl-sync.service';

/**
 * Salida hacia GHL (webhook "lead registrado" y alta/actualización de
 * contactos por API). Solo depende de módulos globales, así que mensajería e
 * intake pueden importarlo sin ciclos.
 */
@Module({
  providers: [GhlSyncService],
  exports: [GhlSyncService],
})
export class GhlSyncModule {}
