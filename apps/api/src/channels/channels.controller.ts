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
import { ChannelsService } from './channels.service';
import { ConnectChannelDto, ConnectCloudDto } from './dto/connect-channel.dto';

@Controller('channels')
@UseGuards(AuthGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.channels.list(user.organizationId);
  }

  @Post('connect')
  connect(@CurrentUser() user: AuthContext, @Body() dto: ConnectChannelDto) {
    return this.channels.connect(user, dto.provider);
  }

  @Post('reconcile')
  reconcile(@CurrentUser() user: AuthContext) {
    return this.channels.reconcile(user);
  }

  /** Onboarding del WhatsApp oficial (Cloud API) tras el Embedded Signup. */
  @Post('cloud/connect')
  connectCloud(@CurrentUser() user: AuthContext, @Body() dto: ConnectCloudDto) {
    return this.channels.connectCloud(user, dto);
  }

  @Delete(':id')
  disconnect(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.channels.disconnect(user, id);
  }
}
