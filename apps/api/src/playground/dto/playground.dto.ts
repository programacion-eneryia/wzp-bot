import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsIn(['whatsapp', 'instagram', 'messenger'])
  provider!: 'whatsapp' | 'instagram' | 'messenger';

  @IsOptional() @IsString() @MaxLength(80)
  contact_name?: string;
}

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  content!: string;
}
