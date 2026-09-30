import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SetterModule } from '../setter/setter.module';
import { WorkflowTriggerModule } from '../workflows/workflow-trigger.module';
import { TagClassifierService } from './tag-classifier.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [SetterModule, WorkflowTriggerModule],
  controllers: [TagsController],
  providers: [TagsService, TagClassifierService, AuthGuard],
  exports: [TagsService, TagClassifierService],
})
export class TagsModule {}
