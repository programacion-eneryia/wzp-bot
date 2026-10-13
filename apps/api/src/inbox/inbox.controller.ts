import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ConversationAnalysisService } from './conversation-analysis.service';
import { InboxService } from './inbox.service';

const MODES = ['setter', 'support', 'ignored'] as const;
const PROVIDERS = ['whatsapp', 'instagram', 'messenger'] as const;

class UpdateConversationDto {
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  // Key del pipeline de la org (editable); se valida en el servicio.
  @IsOptional() @IsString() @MaxLength(60) stage?: string;
  @IsOptional() @IsIn(MODES) mode?: (typeof MODES)[number];
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsBoolean() blocked?: boolean;
  @IsOptional() @IsBoolean() unread?: boolean;
  // Cadena vacía => desasignar. UUID => asignar a ese miembro.
  @IsOptional() @IsString() @MaxLength(64) assigned_to?: string | null;
  // Cadena vacía => agente del canal. UUID => forzar ese agente en este chat.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) agent_id?: string | null;
}

class BulkDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) ids?: string[];
  /** true = todas las conversaciones que cumplen `filters`. */
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsObject() filters?: {
    stage?: string;
    provider?: string;
    agent_id?: string;
    pipeline_id?: string;
  };
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  /** UUID = pasar a ese agente; cadena vacía = volver al agente del canal. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) agent_id?: string | null;
}

class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
}

@Controller('inbox')
@UseGuards(AuthGuard)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly analysis: ConversationAnalysisService,
  ) {}

  @Get('conversations')
  list(
    @CurrentUser() user: AuthContext,
    @Query('stage') stage?: string,
    @Query('archived') archived?: string,
    @Query('provider') provider?: string,
    @Query('agent_id') agentId?: string,
    @Query('pipeline_id') pipelineId?: string,
  ) {
    const prov = (PROVIDERS as readonly string[]).includes(provider ?? '') ? provider : undefined;
    return this.inbox.list(user.organizationId, stage, archived === 'true' || archived === '1', {
      provider: prov,
      agentId: agentId || undefined,
      pipelineId: pipelineId || undefined,
    });
  }

  @Post('bulk')
  bulk(@CurrentUser() user: AuthContext, @Body() dto: BulkDto) {
    const f = dto.filters ?? {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : undefined);
    const prov = str(f.provider);
    return this.inbox.bulk(user.organizationId, {
      ids: dto.ids,
      all: dto.all,
      filters: {
        stage: str(f.stage),
        provider: prov && (PROVIDERS as readonly string[]).includes(prov) ? prov : undefined,
        agentId: str(f.agent_id),
        pipelineId: str(f.pipeline_id),
      },
      ai_enabled: dto.ai_enabled,
      agent_id: dto.agent_id,
    });
  }

  /** Sincroniza los chats existentes desde Unipile (IA en pausa por defecto). */
  @Post('sync')
  sync(@CurrentUser() user: AuthContext) {
    return this.inbox.sync(user.organizationId);
  }

  /** Miembros de la organización (para asignar chats a personas del equipo). */
  @Get('members')
  members(@CurrentUser() user: AuthContext) {
    return this.inbox.members(user.organizationId);
  }

  @Get('conversations/:id')
  get(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    // refresh=0 → solo BD (rápido, para el poll). Por defecto refresca de Unipile.
    const doRefresh = refresh !== '0' && refresh !== 'false';
    return this.inbox.get(user.organizationId, id, doRefresh);
  }

  @Patch('conversations/:id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.update(user.organizationId, id, dto);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.inbox.sendAgentMessage(user.organizationId, id, dto.content);
  }

  /** Genera (o regenera) el análisis IA de la conversación. */
  @Post('conversations/:id/analyze')
  analyze(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.analysis.analyze(user.organizationId, id);
  }

  /** Añade esta conversación a los "ejemplos ganadores" del setter (entrenamiento). */
  @Post('conversations/:id/promote-example')
  promoteExample(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.inbox.promoteToExample(user.organizationId, id);
  }

  /** Descarga la conversación como transcript (.md) para revisarla o subirla. */
  @Get('conversations/:id/export')
  export(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.inbox.exportTranscript(user.organizationId, id);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.inbox.remove(user.organizationId, id);
  }
}
