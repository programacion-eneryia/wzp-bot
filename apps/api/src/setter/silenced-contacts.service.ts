import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SilencedContactsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('silenced_contacts')
      .select('id, identifier, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async add(orgId: string, identifier: string) {
    const { data, error } = await this.supabase.admin
      .from('silenced_contacts')
      .upsert(
        { organization_id: orgId, identifier: identifier.trim() },
        { onConflict: 'organization_id,identifier' },
      )
      .select('id, identifier, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async remove(orgId: string, id: string) {
    const { error } = await this.supabase.admin
      .from('silenced_contacts')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    return { ok: true };
  }

  async isSilenced(orgId: string, identifier: string): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('silenced_contacts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('identifier', identifier)
      .maybeSingle();
    return Boolean(data);
  }
}
