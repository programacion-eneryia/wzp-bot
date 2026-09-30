import { Module } from '@nestjs/common';
import { WorkflowTriggerService } from './workflow-trigger.service';

/**
 * Módulo mínimo SIN dependencias (solo los módulos globales) para disparar
 * workflows desde messaging/tags/inbox/ghl sin ciclos con WorkflowsModule.
 */
@Module({
  providers: [WorkflowTriggerService],
  exports: [WorkflowTriggerService],
})
export class WorkflowTriggerModule {}
