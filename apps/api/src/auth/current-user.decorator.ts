import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './auth.types';

/** Inyecta el `AuthContext` resuelto por el AuthGuard en el parámetro del método. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.auth) {
      // No debería ocurrir si el endpoint usa AuthGuard.
      throw new InternalServerErrorException('Contexto de autenticación ausente');
    }
    return req.auth;
  },
);
