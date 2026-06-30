import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ConnectCalendarDto {
  @IsIn(['google', 'outlook'])
  provider!: 'google' | 'outlook';
}

export class AvailabilityRulesDto {
  @IsOptional() @IsString() tz?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) days?: number[];
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) start?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) end?: string;
  @IsOptional() @IsInt() @Min(5) @Max(240) slot_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) buffer_min?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) max_per_day?: number;
}

export class UpdateCalendarDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityRulesDto)
  availability_rules?: AvailabilityRulesDto;

  @IsOptional() @IsBoolean() is_default?: boolean;
}
