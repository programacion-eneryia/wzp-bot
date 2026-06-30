import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService, AuthGuard],
  exports: [ChannelsService],
})
export class ChannelsModule {}
