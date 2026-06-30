import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { SetterModule } from '../setter/setter.module';
import { LeadIntakeService } from './lead-intake.service';
import { LeadsController } from './leads.controller';

@Module({
  imports: [SetterModule, MessagingModule],
  controllers: [LeadsController],
  providers: [LeadIntakeService],
  exports: [LeadIntakeService],
})
export class LeadsModule {}
