import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthContext } from './auth.types';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  /** Devuelve el contexto del usuario: rol activo, organizaciones y flag de plataforma. */
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships: user.memberships,
    };
  }
}
