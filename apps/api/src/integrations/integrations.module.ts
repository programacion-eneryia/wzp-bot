import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SetterModule } from '../setter/setter.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ManyChatController } from './manychat.controller';
import { ManyChatService } from './manychat.service';

@Module({
  imports: [SetterModule],
  controllers: [IntegrationsController, ManyChatController],
  providers: [IntegrationsService, ManyChatService, AuthGuard],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
