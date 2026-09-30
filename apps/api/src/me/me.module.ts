import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/** Perfil, preferencias del dashboard y estado del onboarding. */
@Module({
  controllers: [MeController],
  providers: [MeService, AuthGuard],
  exports: [MeService],
})
export class MeModule {}
