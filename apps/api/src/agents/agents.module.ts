import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

/** Agentes de IA por organización. Sin dependencias (solo Supabase global). */
@Module({
  controllers: [AgentsController],
  providers: [AgentsService, AuthGuard],
  exports: [AgentsService],
})
export class AgentsModule {}
