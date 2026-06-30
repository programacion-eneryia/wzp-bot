import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Utilidades transversales (cifrado, comparación segura...). Global. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
