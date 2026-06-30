import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { MessagingModule } from '../messaging/messaging.module';
import { CalendarModule } from '../calendar/calendar.module';
import { WebhooksController } from './webhooks.controller';
import { MetaWebhookController } from './meta-webhook.controller';

@Module({
  imports: [ChannelsModule, MessagingModule, CalendarModule],
  controllers: [WebhooksController, MetaWebhookController],
})
export class WebhooksModule {}
