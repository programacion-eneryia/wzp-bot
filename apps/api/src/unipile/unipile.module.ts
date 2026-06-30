import { Global, Module } from '@nestjs/common';
import { UnipileService } from './unipile.service';

@Global()
@Module({
  providers: [UnipileService],
  exports: [UnipileService],
})
export class UnipileModule {}
