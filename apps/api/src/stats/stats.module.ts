import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { StagesModule } from '../stages/stages.module';
import { AgentsModule } from '../agents/agents.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [StagesModule, AgentsModule],
  controllers: [StatsController],
  providers: [StatsService, AuthGuard],
})
export class StatsModule {}
