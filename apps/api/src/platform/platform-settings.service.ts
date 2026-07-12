import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type PlatformSettings = {
  base_setter_prompt: string | null;
  updated_at: string | null;
};

/**
 * Ajustes globales de la plataforma (fila única en `platform_settings`).
 *
 * El principal es el "entrenamiento base" del setter: un prompt que se antepone
 * al de CADA subcuenta, de modo que todas heredan una base común (estilo, reglas
 * generales, etc.) que el super-admin controla desde el panel.
 *
 * Cacheamos el prompt base en memoria unos segundos: el setter lo lee en cada
 * respuesta y no queremos una consulta extra por mensaje.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cache: { value: string | null; at: number } | null = null;
  private readonly ttlMs = 30_000;

  constructor(private readonly supabase: SupabaseService) {}

  /** Prompt base a anteponer al de la subcuenta (o null). Cacheado. */
  async getBasePrompt(): Promise<string | null> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) {
      return this.cache.value;
    }
    try {
      const { data } = await this.supabase.admin
        .from('platform_settings')
        .select('base_setter_prompt')
        .eq('id', true)
        .maybeSingle();
      const value = ((data?.base_setter_prompt as string | null) ?? null) || null;
      this.cache = { value, at: Date.now() };
      return value;
    } catch (err) {
      this.logger.warn(`No se pudo leer platform_settings: ${String(err)}`);
      return this.cache?.value ?? null;
    }
  }

  async get(): Promise<PlatformSettings> {
    const { data } = await this.supabase.admin
      .from('platform_settings')
      .select('base_setter_prompt, updated_at')
      .eq('id', true)
      .maybeSingle();
    return {
      base_setter_prompt: (data?.base_setter_prompt as string | null) ?? null,
      updated_at: (data?.updated_at as string | null) ?? null,
    };
  }

  async update(
    updatedBy: string,
    patch: { base_setter_prompt?: string | null },
  ): Promise<PlatformSettings> {
    const row: Record<string, unknown> = {
      id: true,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    };
    if (patch.base_setter_prompt !== undefined) {
      row.base_setter_prompt = patch.base_setter_prompt?.trim() || null;
    }
    const { data, error } = await this.supabase.admin
      .from('platform_settings')
      .upsert(row, { onConflict: 'id' })
      .select('base_setter_prompt, updated_at')
      .single();
    if (error) throw error;
    this.cache = null; // invalida caché
    return {
      base_setter_prompt: (data.base_setter_prompt as string | null) ?? null,
      updated_at: (data.updated_at as string | null) ?? null,
    };
  }
}
