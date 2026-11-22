import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Límite por archivo (el de WhatsApp para audio/vídeo). */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export class UploadUrlDto {
  @IsString() @MinLength(1) @MaxLength(200) filename!: string;
  @IsString() @Matches(/^[\w.+-]+\/[\w.+-]+$/) mime_type!: string;
  @IsInt() @Min(1) @Max(MEDIA_MAX_BYTES) size_bytes!: number;
}

export class CreateMediaDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
  @IsString() @MinLength(1) @MaxLength(300) storage_path!: string;
  @IsString() @Matches(/^[\w.+-]+\/[\w.+-]+$/) mime_type!: string;
  @IsInt() @Min(1) @Max(MEDIA_MAX_BYTES) size_bytes!: number;
  @IsOptional() @IsBoolean() as_voice_note?: boolean;
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() agent_id?:
    | string
    | null;
}

export class UpdateMediaDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
  @IsOptional() @IsBoolean() as_voice_note?: boolean;
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() agent_id?:
    | string
    | null;
}

export class SendMediaDto {
  @IsUUID() conversation_id!: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  text?: string | null;
}
