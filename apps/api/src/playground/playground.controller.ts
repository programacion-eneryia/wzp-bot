import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PlaygroundService } from './playground.service';
import { CreateConversationDto, SendMessageDto } from './dto/playground.dto';

@Controller('playground')
@UseGuards(AuthGuard)
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthContext) {
    return this.playground.listConversations(user.organizationId);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateConversationDto) {
    return this.playground.createConversation(
      user.organizationId,
      dto.provider,
      dto.contact_name ?? '',
    );
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.playground.getConversation(user.organizationId, id);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.playground.deleteConversation(user.organizationId, id);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.playground.sendMessage(user.organizationId, id, dto.content);
  }
}
