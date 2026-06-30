import { Global, Module } from '@nestjs/common';
import { OpenRouterService } from './openrouter.service';

@Global()
@Module({
  providers: [OpenRouterService],
  exports: [OpenRouterService],
})
export class OpenRouterModule {}
