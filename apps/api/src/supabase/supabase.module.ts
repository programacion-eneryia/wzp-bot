import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * Módulo global: SupabaseService queda disponible en toda la app sin reimportar.
 */
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
