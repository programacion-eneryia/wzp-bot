import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, AuthGuard],
})
export class StatsModule {}
