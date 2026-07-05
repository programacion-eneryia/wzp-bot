import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Tope generoso para campos de texto libre del "cerebro" del setter.
const TXT = 8000;

export class UpdateSetterConfigDto {
  @IsOptional() @IsString() @MaxLength(120) setter_name?: string;
  @IsOptional() @IsString() @MaxLength(200) identity_role?: string;
  @IsOptional() @IsString() @MaxLength(200) company_name?: string;
  @IsOptional() @IsString() @MaxLength(TXT) offer?: string;
  @IsOptional() @IsString() @MaxLength(40000) knowledge_base?: string;
  @IsOptional() @IsString() @MaxLength(TXT) objective?: string;
  @IsOptional() @IsString() @MaxLength(TXT) qualification_criteria?: string;
  @IsOptional() @IsString() @MaxLength(TXT) tone?: string;
  @IsOptional() @IsString() @MaxLength(TXT) rules?: string;

  // Contexto rico
  @IsOptional() @IsString() @MaxLength(TXT) summary?: string;
  @IsOptional() @IsString() @MaxLength(TXT) promise?: string;
  @IsOptional() @IsString() @MaxLength(TXT) funnel_phases?: string;
  @IsOptional() @IsString() @MaxLength(TXT) conversation_types?: string;
  @IsOptional() @IsString() @MaxLength(TXT) best_practices?: string;
  @IsOptional() @IsString() @MaxLength(TXT) product?: string;
  @IsOptional() @IsString() @MaxLength(TXT) team?: string;
  @IsOptional() @IsString() @MaxLength(TXT) social_proof?: string;
  @IsOptional() @IsString() @MaxLength(TXT) pricing_links?: string;
  @IsOptional() @IsString() @MaxLength(TXT) special_cases?: string;
  @IsOptional() @IsString() @MaxLength(TXT) followups?: string;

  // Cerebro de Soporte + proactivo
  @IsOptional() @IsString() @MaxLength(TXT) support_objective?: string;
  @IsOptional() @IsString() @MaxLength(TXT) support_instructions?: string;
  @IsOptional() @IsString() @MaxLength(2000) proactive_template?: string;

  // Aprendizaje por ejemplos + agendamiento
  @IsOptional() @IsString() @MaxLength(60000) winning_examples?: string;
  @IsOptional() @IsIn(['off', 'slots', 'link']) calendar_mode?: 'off' | 'slots' | 'link';
  @IsOptional() @IsString() @MaxLength(500) calendar_link?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) call_duration_min?: number;
  @IsOptional() @IsUUID() default_calendar_id?: string;

  @IsOptional() @IsString() @MaxLength(120) model?: string;
  @IsOptional() @IsString() @MaxLength(20) language?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;

  @IsOptional() @IsBoolean() multi_bubble?: boolean;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() support_enabled?: boolean;
  @IsOptional() @IsBoolean() active_hours_enabled?: boolean;
  @IsOptional() @IsBoolean() ignore_followed?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60000) min_delay_ms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60000) max_delay_ms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3600) first_reply_min_s?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3600) first_reply_max_s?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) typing_cps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(23) active_hours_start?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(23) active_hours_end?: number;

  // Control de coste: tope de tokens de IA por día (0 = ilimitado).
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) daily_token_limit?: number;
}

export class GenerateSetterDto {
  @IsString() @MaxLength(60000) brief!: string;

  /** Si true, además de devolver la propuesta, la guarda en la config. */
  @IsOptional() @IsBoolean() apply?: boolean;
}
