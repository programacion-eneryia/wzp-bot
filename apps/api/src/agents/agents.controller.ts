import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AgentsService } from './agents.service';

const LONG = 60_000;

class AgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['setter', 'support', 'custom']) kind?: 'setter' | 'support' | 'custom';
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() uses_stages?: boolean;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) persona_name?: string;
  @IsOptional() @IsString() @MaxLength(200) identity_role?: string;
  @IsOptional() @IsString() @MaxLength(4000) objective?: string;
  @IsOptional() @IsString() @MaxLength(2000) tone?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) rules?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) instructions?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) qualification_criteria?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) funnel_phases?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) conversation_types?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) special_cases?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) followups?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) best_practices?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(LONG) winning_examples?: string | null;

  @IsOptional() @IsIn(['off', 'slots', 'link']) calendar_mode?: 'off' | 'slots' | 'link';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) calendar_link?: string | null;
  @IsOptional() @IsInt() @Min(5) call_duration_min?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) default_calendar_id?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) model?: string | null;
  @IsOptional() @IsInt() sort_order?: number;
}

class AssignChannelsDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) channel_ids!: string[];
}

@Controller('agents')
@UseGuards(AuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.agents.listWithChannels(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.agents.get(user.organizationId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: AgentDto) {
    this.assertAdmin(user);
    return this.agents.create(user.organizationId, user.userId, dto);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.agents.duplicate(user.organizationId, user.userId, id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: AgentDto) {
    this.assertAdmin(user);
    return this.agents.update(user.organizationId, id, dto);
  }

  @Put(':id/channels')
  async assignChannels(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignChannelsDto,
  ) {
    this.assertAdmin(user);
    await this.agents.assignChannels(user.organizationId, id, dto.channel_ids);
    return { ok: true };
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.agents.remove(user.organizationId, id);
  }

  private assertAdmin(user: AuthContext) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede editar los agentes');
    }
  }
}
