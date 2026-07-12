import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsIn(['whatsapp', 'instagram', 'messenger'])
  provider!: 'whatsapp' | 'instagram' | 'messenger';

  @IsOptional() @IsString() @MaxLength(80)
  contact_name?: string;
}

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  content!: string;

  /**
   * Si false, solo GUARDA el mensaje del lead (no genera respuesta todavía). Se
   * usa para imitar WhatsApp: se acumulan varios mensajes y luego el frontend
   * pide UNA respuesta con /generate cuando el lead deja de escribir (debounce).
   */
  @IsOptional() @IsBoolean()
  reply?: boolean;
}
