import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

class CreateLeadDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
  @IsOptional() @IsString() @MaxLength(200) source_detail?: string;
  @IsOptional() @IsString() @MaxLength(200) campaign?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

/**
 * CRM de leads (autenticado). Lista y gestiona los leads que han entrado por
 * cualquier fuente (GHL, ManyChat, formulario, alta manual, CSV…).
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
    @Query('tag_id') tagId?: string,
  ) {
    return this.leads.list(user.organizationId, { status, source, search, tagId });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthContext) {
    return this.leads.stats(user.organizationId);
  }

  /** Alta manual de un lead. */
  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateLeadDto) {
    if (!dto.name && !dto.phone && !dto.email) {
      throw new BadRequestException('Indica al menos nombre, teléfono o email');
    }
    return this.leads.create(user.organizationId, {
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      source: dto.source ?? 'manual',
      sourceDetail: dto.source_detail,
      campaign: dto.campaign,
      consentOptin: true,
    });
  }

  /** Alta masiva desde un archivo CSV. */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async import(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Body('csv') csv?: string,
  ) {
    const text = file?.buffer ? file.buffer.toString('utf8') : csv;
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('No se recibió ningún CSV');
    }
    return this.leads.importCsv(user.organizationId, text);
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

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.leads.remove(user.organizationId, id);
  }
}
