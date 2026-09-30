import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SetterModule } from '../setter/setter.module';
import { StagesModule } from '../stages/stages.module';
import { TagClassifierService } from './tag-classifier.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [SetterModule, StagesModule],
  controllers: [TagsController],
  providers: [TagsService, TagClassifierService, AuthGuard],
  exports: [TagsService, TagClassifierService],
})
export class TagsModule {}
