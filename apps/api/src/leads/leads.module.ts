import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MessagingModule } from '../messaging/messaging.module';
import { SetterModule } from '../setter/setter.module';
import { CrmController } from './crm.controller';
import { LeadIntakeService } from './lead-intake.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [SetterModule, MessagingModule],
  controllers: [LeadsController, CrmController],
  providers: [LeadIntakeService, LeadsService, AuthGuard],
  exports: [LeadIntakeService, LeadsService],
})
export class LeadsModule {}
