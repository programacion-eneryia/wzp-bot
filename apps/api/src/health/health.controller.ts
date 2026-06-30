import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@wzp/shared';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('health')
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  /** Verifica que la API puede hablar con la base de datos (tabla organizations). */
  @Get('db')
  async checkDb() {
    const { error } = await this.supabase.admin
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    return {
      database: error ? 'error' : 'ok',
      detail: error?.message ?? 'conexión y tabla organizations OK',
      timestamp: new Date().toISOString(),
    };
  }
}
