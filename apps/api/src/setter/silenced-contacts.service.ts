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

  /**
   * Importa desde CSV/texto: un identificador por línea (teléfono o usuario de
   * Instagram). Si hay varias columnas se usa la primera. Ignora cabeceras
   * típicas ("telefono", "phone", "contacto", "usuario"…), vacíos y duplicados.
   */
  async importCsv(
    orgId: string,
    text: string,
  ): Promise<{ total: number; imported: number; skipped: number }> {
    const lines = text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const HEADER = /^(tel[eé]fono|telefono|phone|whatsapp|contacto|contact|usuario|user|instagram|ig|handle|identifier|identificador|n[uú]mero|numero)s?$/i;
    const ids = new Set<string>();
    let total = 0;
    for (const line of lines) {
      const first = line.split(/[;,\t]/)[0]?.trim().replace(/^"|"$/g, '') ?? '';
      if (!first) continue;
      if (HEADER.test(first)) continue;
      total++;
      const id = first.slice(0, 120);
      if (normalizeIdentifier(id).length < 3) continue;
      ids.add(id);
    }
    if (ids.size === 0) return { total, imported: 0, skipped: total };

    const { data: existing } = await this.supabase.admin
      .from('silenced_contacts')
      .select('identifier')
      .eq('organization_id', orgId);
    const have = new Set((existing ?? []).map((r) => normalizeIdentifier(String(r.identifier))));

    const rows = [...ids]
      .filter((id) => !have.has(normalizeIdentifier(id)))
      .map((identifier) => ({ organization_id: orgId, identifier }));
    if (rows.length > 0) {
      const { error } = await this.supabase.admin
        .from('silenced_contacts')
        .upsert(rows, { onConflict: 'organization_id,identifier', ignoreDuplicates: true });
      if (error) throw error;
    }
    return { total, imported: rows.length, skipped: total - rows.length };
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

  /**
   * ¿Alguno de los identificadores del contacto está silenciado?
   *
   * La lista guarda lo que escribió el usuario ("+34 607 19 64 57", "@usuario"…)
   * mientras que la conversación trae ids crudos del proveedor (chat id de
   * Unipile, "34607196457@s.whatsapp.net", "+34607196457"…). Comparar por
   * igualdad exacta no coincidía nunca, así que normalizamos ambos lados.
   */
  async isAnySilenced(orgId: string, candidates: string[]): Promise<boolean> {
    const cands = candidates.map(normalizeIdentifier).filter(Boolean);
    if (cands.length === 0) return false;

    const { data } = await this.supabase.admin
      .from('silenced_contacts')
      .select('identifier')
      .eq('organization_id', orgId);
    const silenced = (data ?? [])
      .map((r) => normalizeIdentifier(String(r.identifier ?? '')))
      .filter(Boolean);
    if (silenced.length === 0) return false;

    return silenced.some((s) => cands.some((c) => identifiersMatch(s, c)));
  }

  async isSilenced(orgId: string, identifier: string): Promise<boolean> {
    return this.isAnySilenced(orgId, [identifier]);
  }
}

/**
 * Normaliza un identificador para comparar: quita sufijos de WhatsApp
 * (`@s.whatsapp.net`, `@c.us`), el `@` inicial de usuarios de IG, y si es un
 * teléfono lo reduce a solo dígitos (da igual `+`, espacios o guiones).
 */
export function normalizeIdentifier(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '');
  if (s.startsWith('@')) s = s.slice(1);
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length >= 6 && digits.length / s.length > 0.5) return digits;
  return s;
}

/**
 * Dos identificadores normalizados coinciden si son iguales o, en el caso de
 * teléfonos, si uno termina en el otro (cubre "607196457" vs "34607196457",
 * con o sin prefijo de país). Mínimo 8 dígitos para evitar falsos positivos.
 */
function identifiersMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.endsWith(short);
}
