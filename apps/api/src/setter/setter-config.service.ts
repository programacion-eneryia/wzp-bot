import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { SetterConfig } from './setter-config.types';

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
