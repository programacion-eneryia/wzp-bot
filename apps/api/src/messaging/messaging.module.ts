import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SetterModule } from '../setter/setter.module';
import { CalendarModule } from '../calendar/calendar.module';
import { MessagingService } from './messaging.service';
import { TransportService } from './transport.service';
import {
  IncomingProcessor,
  OutgoingProcessor,
  RespondProcessor,
} from './messaging.processors';
import { INCOMING_QUEUE, OUTGOING_QUEUE, RESPOND_QUEUE } from './queues';

@Module({
  imports: [
    SetterModule,
    CalendarModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: INCOMING_QUEUE },
      { name: OUTGOING_QUEUE },
      { name: RESPOND_QUEUE },
    ),
  ],
  providers: [
    MessagingService,
    TransportService,
    IncomingProcessor,
    OutgoingProcessor,
    RespondProcessor,
  ],
  exports: [MessagingService, TransportService],
})
export class MessagingModule {}
