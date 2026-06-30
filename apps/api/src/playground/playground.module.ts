import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SetterModule } from '../setter/setter.module';
import { PlaygroundController } from './playground.controller';
import { PlaygroundService } from './playground.service';

@Module({
  imports: [SetterModule],
  controllers: [PlaygroundController],
  providers: [PlaygroundService, AuthGuard],
})
export class PlaygroundModule {}
