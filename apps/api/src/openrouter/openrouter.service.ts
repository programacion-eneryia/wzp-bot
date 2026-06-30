import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Cliente para OpenRouter (gateway OpenAI-compatible a múltiples LLMs).
 * Centraliza la API key y la selección de modelo.
 */
@Injectable()
export class OpenRouterService implements OnModuleInit {
  private readonly logger = new Logger(OpenRouterService.name);
  private apiKey!: string;
  private defaultModel!: string;
  private referer!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.apiKey = this.config.getOrThrow<string>('OPENROUTER_API_KEY');
    this.defaultModel =
      this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? 'anthropic/claude-sonnet-4.6';
    this.referer = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.referer,
        'X-Title': 'WZP Setter',
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 600,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`OpenRouter ${res.status}: ${text}`);
      throw new HttpException(`Error del modelo (${res.status})`, 502);
    }

    const data = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new HttpException('El modelo no devolvió respuesta', 502);
    }
    return content;
  }
}
