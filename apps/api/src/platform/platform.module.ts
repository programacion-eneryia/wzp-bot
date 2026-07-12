import { Global, Module } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorLogService } from './error-log.service';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Servicios transversales de plataforma (ajustes globales, log de errores y el
 * filtro de excepciones). Global para que el setter y el panel admin puedan
 * usarlos sin reimportar.
 */
@Global()
@Module({
  providers: [PlatformSettingsService, ErrorLogService, AllExceptionsFilter],
  exports: [PlatformSettingsService, ErrorLogService, AllExceptionsFilter],
})
export class PlatformModule {}
