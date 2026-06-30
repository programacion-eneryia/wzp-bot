import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CalendarModule } from '../calendar/calendar.module';
import { ConversationClassifierService } from './conversation-classifier.service';
import { SetterAssistantService } from './setter-assistant.service';
import { SetterConfigService } from './setter-config.service';
import { SetterController } from './setter.controller';
import { SetterService } from './setter.service';
import { SilencedContactsService } from './silenced-contacts.service';

@Module({
  imports: [CalendarModule],
  controllers: [SetterController],
  providers: [
    SetterConfigService,
    SetterService,
    SetterAssistantService,
    SilencedContactsService,
    ConversationClassifierService,
    AuthGuard,
  ],
  exports: [
    SetterConfigService,
    SetterService,
    SilencedContactsService,
    ConversationClassifierService,
  ],
})
export class SetterModule {}
