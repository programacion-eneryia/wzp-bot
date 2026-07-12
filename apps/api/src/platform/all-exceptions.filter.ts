import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorLogService } from './error-log.service';

type MaybeOrgRequest = Request & {
  authContext?: { organizationId?: string };
  user?: { organizationId?: string };
};

/**
 * Filtro global de excepciones: mantiene la respuesta de error estándar de Nest
 * pero, además, PERSISTE en `error_logs` los errores de servidor (5xx y no
 * controlados) para que el super-admin los vea en el panel. Los errores de
 * cliente (4xx) no se guardan (son esperables: validación, no autorizado, etc.).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly errorLog: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<MaybeOrgRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    if (status >= 500) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`${req?.method} ${req?.url} → ${status}: ${message}`, stack);

      const orgId =
        req?.authContext?.organizationId ?? req?.user?.organizationId ?? null;

      void this.errorLog.log({
        level: 'error',
        source: 'http',
        message,
        detail: stack ? { stack: stack.slice(0, 4000) } : null,
        organizationId: orgId,
        requestMethod: req?.method ?? null,
        requestPath: req?.originalUrl ?? req?.url ?? null,
        statusCode: status,
      });
    }

    res.status(status).json(body);
  }
}
