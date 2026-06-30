import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminModule } from '../admin/admin.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [AdminModule],
  controllers: [TeamController],
  providers: [TeamService, AuthGuard],
})
export class TeamModule {}
