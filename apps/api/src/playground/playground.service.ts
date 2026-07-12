import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SetterService, type Bubble } from '../setter/setter.service';

type Provider = 'whatsapp' | 'instagram' | 'messenger';

@Injectable()
export class PlaygroundService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly setter: SetterService,
  ) {}

  async listConversations(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('conversations')
      .select('id, provider, contact_name, stage, last_message_at, created_at')
      .eq('organization_id', orgId)
      .eq('is_test', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async createConversation(orgId: string, provider: Provider, contactName: string) {
    const { data, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        provider,
        contact_name: contactName || 'Lead de prueba',
        is_test: true,
        stage: 'new',
      })
      .select('id, provider, contact_name, stage, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async getConversation(orgId: string, id: string) {
    const conv = await this.assertOwned(orgId, id);
    const { data: messages } = await this.supabase.admin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    return { conversation: conv, messages: messages ?? [] };
  }

  async deleteConversation(orgId: string, id: string) {
    await this.assertOwned(orgId, id);
    const { error } = await this.supabase.admin
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    return { ok: true };
  }

  /**
   * Guarda un mensaje del "lead". Si `reply` es true (por defecto) genera además
   * la respuesta del setter. Si es false, solo lo guarda: el frontend agrupará
   * varios mensajes y pedirá la respuesta con `generateReply` (imita WhatsApp).
   */
  async sendMessage(
    orgId: string,
    id: string,
    content: string,
    reply = true,
  ): Promise<{ reply: Bubble[] }> {
    await this.assertOwned(orgId, id);

    const { error } = await this.supabase.admin.from('messages').insert({
      conversation_id: id,
      organization_id: orgId,
      role: 'contact',
      content,
    });
    if (error) throw error;

    if (!reply) return { reply: [] };
    const bubbles = await this.setter.respond(orgId, id);
    return { reply: bubbles };
  }

  /**
   * Genera la respuesta del setter para el estado ACTUAL de la conversación (con
   * todos los mensajes ya acumulados). No inserta ningún mensaje del lead. Solo
   * responde si el último mensaje es del contacto (igual que en producción).
   */
  async generateReply(orgId: string, id: string): Promise<{ reply: Bubble[] }> {
    await this.assertOwned(orgId, id);

    const { data: last } = await this.supabase.admin
      .from('messages')
      .select('role')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.role !== 'contact') return { reply: [] };

    const bubbles = await this.setter.respond(orgId, id);
    return { reply: bubbles };
  }

  private async assertOwned(orgId: string, id: string) {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select('id, provider, contact_name, stage, is_test, created_at')
      .eq('id', id)
      .eq('organization_id', orgId)
      .eq('is_test', true)
      .maybeSingle();
    if (!data) throw new NotFoundException('Conversación de prueba no encontrada');
    return data;
  }
}
