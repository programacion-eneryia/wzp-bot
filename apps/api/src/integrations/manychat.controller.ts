import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ManyChatService } from './manychat.service';

/**
 * Endpoint PÚBLICO que llama el Dynamic Block / External Request de ManyChat.
 * La autenticidad se valida con el intake_token de la org (?token=...).
 */
@Controller('integrations/manychat')
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class ManyChatController {
  constructor(private readonly manychat: ManyChatService) {}

  @Post('dynamic')
  @HttpCode(200)
  async dynamic(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.manychat.handleDynamic(token, body);
  }
}
