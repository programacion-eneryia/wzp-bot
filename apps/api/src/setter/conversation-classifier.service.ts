import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { UnipileService } from '../unipile/unipile.service';
import { SetterConfigService } from './setter-config.service';

export type ChatMode = 'setter' | 'support' | 'ignored';

@Injectable()
export class ConversationClassifierService {
  private readonly logger = new Logger(ConversationClassifierService.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly unipile: UnipileService,
    private readonly setterConfig: SetterConfigService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Decide cómo debe actuar el bot en una conversación:
   *  - setter:  lead nuevo / interesado → cualificar y agendar.
   *  - support: relación existente con dudas → dar soporte.
   *  - ignored: chat personal / no comercial → no responder.
   *
   * Regla de origen: lo que NO es WhatsApp (Instagram/Messenger) se asume lead
   * de campaña → setter. En WhatsApp, donde el origen es ambiguo, analizamos el
   * historial con el modelo.
   */
  async classify(
    orgId: string,
    chatId: string,
    provider: string | null,
  ): Promise<ChatMode> {
    if ((provider ?? '').toLowerCase() !== 'whatsapp') return 'setter';

    let transcript = '';
    try {
      const msgs = await this.unipile.listChatMessages(chatId, 15);
      const sorted = [...msgs].sort((a, b) => time(a) - time(b));
      // Sin apenas historial = contacto nuevo escribiendo → lead.
      if (sorted.length <= 1) return 'setter';
      transcript = sorted
        .map((m) => `${isFromUs(m) ? 'NOSOTROS' : 'CONTACTO'}: ${(m.text ?? '').trim()}`)
        .filter((l) => l.length > 12)
        .slice(-15)
        .join('\n');
    } catch (err) {
      this.logger.warn(`Clasificador: no pude leer historial: ${String(err)}`);
      return 'setter';
    }

    if (!transcript) return 'setter';

    const cfg = await this.setterConfig.getOrCreate(orgId);
    const system = [
      'Clasificas conversaciones de WhatsApp de un negocio para decidir cómo debe actuar un bot.',
      cfg.offer ? `El negocio ofrece: ${cfg.offer}` : '',
      cfg.company_name ? `Empresa: ${cfg.company_name}` : '',
      '',
      'Devuelve EXCLUSIVAMENTE una de estas tres palabras, en mayúsculas, sin nada más:',
      '- SETTER  → es un lead/cliente potencial interesado en el producto o servicio (hay que cualificar y agendar).',
      '- SUPPORT → es alguien con una relación/contrato existente que pregunta dudas o pide ayuda (dar soporte).',
      '- IGNORE  → es un chat personal, de amigos/familia, spam o sin relación con el negocio (no responder).',
      '',
      'Ante la duda entre SETTER y SUPPORT, elige SETTER. Solo IGNORE si está claro que es personal/no comercial.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const raw = await this.openrouter.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: `CONVERSACIÓN:\n${transcript}\n\nClasifica:` },
        ],
        {
          model: this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
          temperature: 0,
          maxTokens: 8,
          orgId,
          purpose: 'classify',
        },
      );
      const word = raw.toUpperCase();
      if (word.includes('IGNORE')) return 'ignored';
      if (word.includes('SUPPORT')) return 'support';
      return 'setter';
    } catch (err) {
      this.logger.warn(`Clasificador: fallo del modelo: ${String(err)}`);
      return 'setter';
    }
  }
}

function isFromUs(m: { is_sender?: number | boolean }): boolean {
  return m.is_sender === 1 || m.is_sender === true;
}

function time(m: { timestamp?: string; date?: string }): number {
  const raw = m.timestamp ?? m.date;
  const t = raw ? new Date(raw).getTime() : 0;
  return isNaN(t) ? 0 : t;
}
