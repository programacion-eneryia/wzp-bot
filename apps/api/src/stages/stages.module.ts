import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { WorkflowTriggerModule } from '../workflows/workflow-trigger.module';
import { StagesController } from './stages.controller';
import { StagesService } from './stages.service';

/**
 * Etapas del pipeline editables. Solo depende de módulos sin ciclos
 * (Supabase global + WorkflowTriggerModule) para que messaging, tags, inbox,
 * calendar y ghl puedan importarlo libremente.
 */
@Module({
  imports: [WorkflowTriggerModule],
  controllers: [StagesController],
  providers: [StagesService, AuthGuard],
  exports: [StagesService],
})
export class StagesModule {}
