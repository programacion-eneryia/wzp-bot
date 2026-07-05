import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { LeadsService } from './leads.service';

const STATUSES = [
  'new',
  'qualifying',
  'qualified',
  'not_qualified',
  'call_scheduled',
  'won',
  'lost',
] as const;

class UpdateLeadDto {
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
}

/**
 * CRM de leads (autenticado). Lista y gestiona los leads que han entrado por
 * cualquier fuente (GHL, ManyChat, formulario, alta manual…).
 */
@Controller('crm/leads')
@UseGuards(AuthGuard)
export class CrmController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    return this.leads.list(user.organizationId, { status, source, search });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthContext) {
    return this.leads.stats(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.leads.get(user.organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(user.organizationId, id, dto);
  }
}
