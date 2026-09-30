import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(AuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Filtros opcionales: agent_id, from, to (fechas ISO o YYYY-MM-DD). */
  @Get('overview')
  overview(
    @CurrentUser() user: AuthContext,
    @Query('agent_id') agentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stats.overview(user.organizationId, {
      agentId: agentId || undefined,
      from: isoOrUndefined(from, false),
      to: isoOrUndefined(to, true),
    });
  }
}

/** Normaliza una fecha; para `to` en formato YYYY-MM-DD incluye todo el día. */
function isoOrUndefined(v: string | undefined, endOfDay: boolean): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(d.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}
