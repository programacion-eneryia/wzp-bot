import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SetterConfigService } from '../setter/setter-config.service';
import { StagesService } from '../stages/stages.service';
import { AgentsService } from '../agents/agents.service';

export type ConversationAnalysis = {
  summary: string;
  qualification: 'cualificado' | 'en_proceso' | 'no_cualifica' | 'desconocido';
  interest_level: 'alto' | 'medio' | 'bajo';
  sentiment: 'positivo' | 'neutral' | 'negativo';
  /** Key de una etapa del pipeline de la organización. */
  suggested_stage: string;
  next_step: string;
  key_points: string[];
  objections: string[];
  reasoning: string;
};

type StoredMessage = {
  role: 'contact' | 'assistant' | 'agent' | 'system';
  content: string;
};

@Injectable()
export class ConversationAnalysisService {
  private readonly logger = new Logger(ConversationAnalysisService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openrouter: OpenRouterService,
    private readonly setterConfig: SetterConfigService,
    private readonly config: ConfigService,
    private readonly stages: StagesService,
    private readonly agents: AgentsService,
  ) {}

  /**
   * Genera (o regenera) un análisis IA de la conversación y lo cachea en la
   * tabla `conversations` (ai_analysis + ai_analysis_at).
   */
  async analyze(orgId: string, conversationId: string): Promise<ConversationAnalysis> {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, contact_name, agent_id, channel_id, mode')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    const { data: history } = await this.supabase.admin
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const messages = (history ?? []) as StoredMessage[];
    if (messages.length === 0) {
      throw new NotFoundException('La conversación no tiene mensajes que analizar');
    }

    const cfg = await this.setterConfig.getOrCreate(orgId);
    const agent = await this.agents.resolveForConversation(orgId, {
      agent_id: conv.agent_id as string | null,
      channel_id: conv.channel_id as string | null,
      mode: conv.mode as string | null,
    });
    const stageList = await this.stages.list(orgId);
    const stageKeys = stageList.map((s) => s.key);
    const stageHelp = stageList.map((s) => `${s.key} = ${s.name}`).join(', ');

    const transcript = messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'contact' ? 'LEAD' : 'NOSOTROS'}: ${m.content}`)
      .join('\n');

    const system = [
      'Eres un analista de ventas experto. Analizas una conversación de un setter',
      'con un lead y devuelves un diagnóstico accionable para el equipo comercial.',
      '',
      'CONTEXTO DEL NEGOCIO:',
      cfg.offer ? `Oferta: ${cfg.offer}` : '',
      agent?.qualification_criteria
        ? `Criterios de cualificación: ${agent.qualification_criteria}`
        : '',
      agent?.objective ? `Objetivo del agente: ${agent.objective}` : '',
      `Etapas del pipeline (usa la key): ${stageHelp}`,
      '',
      'Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin texto extra)',
      'con esta forma exacta:',
      '{',
      '  "summary": "resumen breve (1-2 frases) del estado de la conversación",',
      '  "qualification": "cualificado | en_proceso | no_cualifica | desconocido",',
      '  "interest_level": "alto | medio | bajo",',
      '  "sentiment": "positivo | neutral | negativo",',
      `  "suggested_stage": "${stageKeys.join(' | ')}",`,
      '  "next_step": "la siguiente acción concreta recomendada",',
      '  "key_points": ["datos clave que ha dado el lead"],',
      '  "objections": ["dudas u objeciones detectadas"],',
      '  "reasoning": "explicación corta del porqué de la cualificación"',
      '}',
      'Responde en español. Sé concreto y honesto; si faltan datos, usa "desconocido".',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await this.openrouter.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `CONVERSACIÓN CON ${conv.contact_name ?? 'el lead'}:\n\n${transcript}` },
      ],
      {
        model: this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
        temperature: 0.3,
        maxTokens: 1200,
        orgId,
        conversationId,
        purpose: 'analyze',
      },
    );

    const analysis = this.parse(raw);
    if (!stageKeys.includes(analysis.suggested_stage)) analysis.suggested_stage = 'new';

    await this.supabase.admin
      .from('conversations')
      .update({ ai_analysis: analysis, ai_analysis_at: new Date().toISOString() })
      .eq('id', conversationId);

    return analysis;
  }

  private parse(raw: string): ConversationAnalysis {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    try {
      const obj = JSON.parse(json) as Partial<ConversationAnalysis>;
      return {
        summary: String(obj.summary ?? 'Sin datos suficientes.'),
        qualification: (obj.qualification ?? 'desconocido') as ConversationAnalysis['qualification'],
        interest_level: (obj.interest_level ?? 'medio') as ConversationAnalysis['interest_level'],
        sentiment: (obj.sentiment ?? 'neutral') as ConversationAnalysis['sentiment'],
        suggested_stage: String(obj.suggested_stage ?? 'new'),
        next_step: String(obj.next_step ?? ''),
        key_points: Array.isArray(obj.key_points) ? obj.key_points.map(String) : [],
        objections: Array.isArray(obj.objections) ? obj.objections.map(String) : [],
        reasoning: String(obj.reasoning ?? ''),
      };
    } catch (err) {
      this.logger.error(`Análisis IA no es JSON válido: ${String(err)}. Respuesta: ${raw.slice(0, 400)}`);
      throw new Error('El modelo no devolvió un análisis válido');
    }
  }
}
