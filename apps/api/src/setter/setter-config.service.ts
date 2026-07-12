import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { SetterConfig } from './setter-config.types';
import { isAllowedModel, isValidTimezone } from './model-options';

@Injectable()
export class SetterConfigService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Devuelve la config del setter de la org; la crea con valores por defecto si no existe. */
  async getOrCreate(orgId: string): Promise<SetterConfig> {
    const { data } = await this.supabase.admin
      .from('setter_configs')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (data) return data as SetterConfig;

    const { data: created, error } = await this.supabase.admin
      .from('setter_configs')
      .insert({ organization_id: orgId })
      .select('*')
      .single();

    if (error) throw error;
    return created as SetterConfig;
  }

  async update(orgId: string, patch: Partial<SetterConfig>): Promise<SetterConfig> {
    // Aseguramos que exista antes de actualizar.
    await this.getOrCreate(orgId);

    const { organization_id: _omit, updated_at: _omit2, ...clean } = patch;
    void _omit;
    void _omit2;

    // Saneamos campos "peligrosos" que, con un valor inválido, dejarían al bot
    // sin responder o con horarios erróneos:
    //  - model: si no es de la lista permitida, usamos el modelo por defecto (null).
    //  - timezone: si no es una zona IANA válida, no la guardamos (evita horarios rotos).
    if ('model' in clean) {
      const m = (clean.model ?? '').toString().trim();
      clean.model = m && isAllowedModel(m) ? m : null;
    }
    if ('timezone' in clean) {
      const tz = (clean.timezone ?? '').toString().trim();
      if (!isValidTimezone(tz)) delete clean.timezone;
    }

    const { data, error } = await this.supabase.admin
      .from('setter_configs')
      .update(clean)
      .eq('organization_id', orgId)
      .select('*')
      .single();

    if (error) throw error;
    return data as SetterConfig;
  }
}
