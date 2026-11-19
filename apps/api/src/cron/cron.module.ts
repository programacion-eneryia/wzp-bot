import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ChannelsModule } from '../channels/channels.module';
import { CronController } from './cron.controller';
import { LocalSchedulerService } from './local-scheduler.service';

/**
 * Procesamiento asíncrono dirigido por cron:
 *   - `CronController` expone `/api/cron/tick` para el cron de Vercel.
 *   - `LocalSchedulerService` hace el mismo trabajo en desarrollo local.
 */
@Module({
  imports: [MessagingModule, WorkflowsModule, ChannelsModule],
  controllers: [CronController],
  providers: [LocalSchedulerService],
})
export class CronModule {}
