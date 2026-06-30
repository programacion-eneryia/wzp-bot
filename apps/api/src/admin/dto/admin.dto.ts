import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrgDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(60) slug!: string;
  @IsOptional() @IsString() @MaxLength(40) plan?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) seats?: number;
}

export class UpdateOrgDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) plan?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) seats?: number;
  @IsOptional() @IsIn(['active', 'suspended']) status?: 'active' | 'suspended';
}

export class SuspendOrgDto {
  @IsBoolean() suspended!: boolean;
}

export class CreateUserDto {
  @IsEmail() @MaxLength(160) email!: string;
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsUUID() organizationId!: string;
  @IsOptional() @IsIn(['admin', 'closer']) role?: 'admin' | 'closer';
}

export class RoleDto {
  @IsUUID() organizationId!: string;
  @IsIn(['admin', 'closer']) role!: 'admin' | 'closer';
}

export class MembershipDto {
  @IsUUID() organizationId!: string;
  @IsOptional() @IsIn(['admin', 'closer']) role?: 'admin' | 'closer';
}

export class MoveUserDto {
  @IsOptional() @IsUUID() fromOrganizationId?: string;
  @IsUUID() toOrganizationId!: string;
  @IsOptional() @IsIn(['admin', 'closer']) role?: 'admin' | 'closer';
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
}

export class BanDto {
  @IsBoolean() banned!: boolean;
}

export class PlatformAdminDto {
  @IsBoolean() value!: boolean;
}
