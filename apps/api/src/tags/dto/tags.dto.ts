import {
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

// `set_stage` es una key del pipeline de la organización (editable), así que
// aquí solo validamos forma; la pertenencia se comprueba en el servicio.
export class CreateTagDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) set_stage?: string | null;
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  @IsOptional() @IsInt() sort_order?: number;
}

export class UpdateTagDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) set_stage?: string | null;
  @IsOptional() @IsBoolean() ai_enabled?: boolean;
  @IsOptional() @IsInt() sort_order?: number;
}

export class ApplyTagDto {
  @IsString() @MinLength(1) @MaxLength(64) tagId!: string;
}
