import { Injectable, Logger } from '@nestjs/common';
import { UnipileService } from '../unipile/unipile.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { WhatsAppCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';

/**
 * Tubería por la que viaja un mensaje. La lógica del bot es agnóstica al
 * transporte: el núcleo decide QUÉ decir, el TransportService decide POR DÓNDE
 * se envía. Añadir un canal nuevo es añadir un `case` aquí, sin tocar el
 * pipeline de IA.
 */
export type Transport = 'unipile' | 'whatsapp_cloud' | 'manychat' | 'ghl';

export const DEFAULT_TRANSPORT: Transport = 'unipile';

export function asTransport(value: unknown): Transport {
  const v = String(value ?? '').toLowerCase();
  if (v === 'whatsapp_cloud' || v === 'manychat' || v === 'ghl') return v;
  return 'unipile';
}

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    private readonly unipile: UnipileService,
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly cloud: WhatsAppCloudService,
  ) {}

  /**
   * Envía texto a una conversación EXISTENTE por su transporte.
   *  - unipile: usa `chatId` (chat de Unipile).
   *  - whatsapp_cloud: usa las credenciales del canal (`channelId`) + `to` (teléfono).
   */
  async sendText(params: {
    transport?: Transport | string | null;
    chatId?: string | null;
    text: string;
    channelId?: string | null;
    to?: string | null;
  }): Promise<void> {
    const transport = asTransport(params.transport);
    switch (transport) {
      case 'unipile': {
        if (!params.chatId) throw new Error('Falta chatId para enviar por Unipile');
        await this.unipile.sendMessageToChat(params.chatId, params.text);
        return;
      }
      case 'whatsapp_cloud': {
        const { phoneNumberId, token } = await this.resolveCloud(params.channelId);
        const to = digits(params.to);
        if (!to) throw new Error('Falta el teléfono del destinatario (Cloud API)');
        await this.cloud.sendText(phoneNumberId, token, to, params.text);
        return;
      }
      case 'manychat':
      case 'ghl':
        throw new Error(`Transporte de envío "${transport}" aún no implementado`);
      default:
        throw new Error(`Transporte de envío desconocido: ${String(params.transport)}`);
    }
  }

  /**
   * Abre una conversación NUEVA (primer mensaje proactivo) por su transporte.
   * Devuelve el id de chat creado, si el proveedor lo expone.
   */
  async startChat(params: {
    transport?: Transport | string | null;
    accountId: string;
    recipientId: string;
    text: string;
    channelId?: string | null;
  }): Promise<{ chatId: string | null }> {
    const transport = asTransport(params.transport);
    switch (transport) {
      case 'unipile': {
        const res = await this.unipile.startNewChat(params.accountId, params.recipientId, params.text);
        return { chatId: res.chat_id ?? null };
      }
      case 'whatsapp_cloud':
        // El primer toque fuera de la ventana de 24h DEBE ser una plantilla
        // aprobada por Meta. Eso requiere configurar el nombre de plantilla del
        // canal (siguiente sub-fase). Hasta entonces, no abrimos en frío.
        throw new Error(
          'Proactivo por Cloud API requiere plantilla aprobada (configurar template del canal)',
        );
      case 'manychat':
      case 'ghl':
        throw new Error(`Transporte de inicio "${transport}" aún no implementado`);
      default:
        throw new Error(`Transporte de inicio desconocido: ${String(params.transport)}`);
    }
  }

  /** Carga y descifra las credenciales de Cloud API de un canal. */
  private async resolveCloud(channelId?: string | null): Promise<{ phoneNumberId: string; token: string }> {
    if (!channelId) throw new Error('Falta channelId para Cloud API');
    const { data } = await this.supabase.admin
      .from('channels')
      .select('cloud_phone_number_id, cloud_token_enc')
      .eq('id', channelId)
      .maybeSingle();
    const phoneNumberId = data?.cloud_phone_number_id as string | undefined;
    const token = this.crypto.decrypt(data?.cloud_token_enc as string | undefined);
    if (!phoneNumberId || !token) {
      throw new Error('El canal no tiene credenciales de WhatsApp Cloud API');
    }
    return { phoneNumberId, token };
  }
}

function digits(v?: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/[^\d]/g, '');
  return d.length >= 7 ? d : null;
}
