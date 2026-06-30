import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const CONNECTABLE_PROVIDERS = ['whatsapp', 'instagram', 'messenger'] as const;
export type ConnectableProvider = (typeof CONNECTABLE_PROVIDERS)[number];

export class ConnectChannelDto {
  @IsIn(CONNECTABLE_PROVIDERS, {
    message: 'provider debe ser whatsapp, instagram o messenger',
  })
  provider!: ConnectableProvider;
}

export class ConnectCloudDto {
  @IsString() @MinLength(4) @MaxLength(2000) code!: string;
  @IsString() @MinLength(3) @MaxLength(64) phoneNumberId!: string;
  @IsString() @MinLength(3) @MaxLength(64) wabaId!: string;
}
