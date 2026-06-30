import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { MessagingService } from '../messaging/messaging.service';
import { WhatsAppCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';

/**
 * Webhook PÚBLICO de Meta para WhatsApp Cloud API.
 *   - GET  : handshake de verificación (hub.challenge).
 *   - POST : mensajes entrantes. Verificamos la firma X-Hub-Signature-256 con el
 *            App Secret antes de procesar nada (anti-suplantación).
 */
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
    private readonly cloud: WhatsAppCloudService,
  ) {}

  /** Handshake de verificación del webhook (lo llama Meta al configurarlo). */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected) {
      return challenge;
    }
    throw new ForbiddenException('Verificación de webhook fallida');
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  async incoming(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: MetaWebhookBody,
  ) {
    const appSecret = this.config.get<string>('META_APP_SECRET');
    if (!appSecret) {
      this.logger.error('META_APP_SECRET no configurado; rechazando webhook');
      throw new ForbiddenException('Webhook no configurado');
    }
    if (!this.cloud.verifySignature(appSecret, req.rawBody, signature)) {
      throw new ForbiddenException('Firma inválida');
    }
    if (!body || body.object !== 'whatsapp_business_account') {
      throw new BadRequestException('Payload no soportado');
    }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const profileName = value.contacts?.[0]?.profile?.name;
        for (const msg of value.messages) {
          const text = extractText(msg);
          if (!text) continue;
          await this.messaging.handleCloudInbound({
            phoneNumberId,
            from: msg.from,
            text,
            messageId: msg.id,
            name: profileName,
            referral: msg.referral ?? null,
          });
        }
      }
    }
    return { ok: true };
  }
}

function extractText(msg: MetaMessage): string {
  if (msg.type === 'text' && msg.text?.body) return msg.text.body.trim();
  if (msg.button?.text) return msg.button.text.trim();
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title.trim();
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title.trim();
  return '';
}

// --- Tipos del payload de Meta (parcial, lo que usamos) ---
type MetaWebhookBody = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: MetaMessage[];
      };
    }[];
  }[];
};

type MetaMessage = {
  from: string;
  id: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  referral?: Record<string, unknown>;
};
