import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Para el control de costes: si se pasa orgId, registramos el consumo.
  orgId?: string;
  conversationId?: string | null;
  purpose?: string;
};

/**
 * Cliente para OpenRouter (gateway OpenAI-compatible a múltiples LLMs).
 * Centraliza la API key, la selección de modelo y el REGISTRO DE CONSUMO
 * (tokens + coste) de cada llamada, para el control de costes por organización.
 */
@Injectable()
export class OpenRouterService implements OnModuleInit {
  private readonly logger = new Logger(OpenRouterService.name);
  private apiKey!: string;
  private defaultModel!: string;
  private referer!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit() {
    this.apiKey = this.config.getOrThrow<string>('OPENROUTER_API_KEY');
    this.defaultModel =
      this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? 'anthropic/claude-sonnet-4.6';
    this.referer = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.referer,
        'X-Title': 'WZP Setter',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 600,
        // Pide a OpenRouter que incluya el coste real de la generación.
        usage: { include: true },
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`OpenRouter ${res.status}: ${text}`);
      throw new HttpException(`Error del modelo (${res.status})`, 502);
    }

    const data = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
    };

    // Registro de consumo (no bloquea ni rompe la respuesta si falla).
    if (options.orgId && data.usage) {
      void this.recordUsage(options, model, data.usage);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new HttpException('El modelo no devolvió respuesta', 502);
    }
    return content;
  }

  private async recordUsage(
    options: ChatOptions,
    model: string,
    usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    },
  ) {
    try {
      const prompt = usage.prompt_tokens ?? 0;
      const completion = usage.completion_tokens ?? 0;
      const total = usage.total_tokens ?? prompt + completion;
      await this.supabase.admin.from('ai_usage').insert({
        organization_id: options.orgId,
        conversation_id: options.conversationId ?? null,
        model,
        purpose: options.purpose ?? 'chat',
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        cost_usd: usage.cost ?? 0,
      });
    } catch (err) {
      this.logger.warn(`No se pudo registrar el consumo de IA: ${String(err)}`);
    }
  }

  /** Total de tokens consumidos por una organización HOY (UTC). Para límites. */
  async tokensUsedToday(orgId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data } = await this.supabase.admin
      .from('ai_usage')
      .select('total_tokens')
      .eq('organization_id', orgId)
      .gte('created_at', startOfDay.toISOString());
    return (data ?? []).reduce((sum, r) => sum + ((r.total_tokens as number) ?? 0), 0);
  }
}
