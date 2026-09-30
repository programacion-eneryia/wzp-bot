import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { StagesService } from './stages.service';

const COLOR = /^#[0-9a-fA-F]{6}$/;

class CreateStageDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @IsString() @Matches(COLOR) color?: string;
}

class UpdateStageDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @Matches(COLOR) color?: string;
  @IsOptional() @IsInt() sort_order?: number;
}

class ReorderDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
}

@Controller('stages')
@UseGuards(AuthGuard)
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.stages.list(user.organizationId);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateStageDto) {
    this.assertAdmin(user);
    return this.stages.create(user.organizationId, dto);
  }

  @Put('reorder')
  reorder(@CurrentUser() user: AuthContext, @Body() dto: ReorderDto) {
    this.assertAdmin(user);
    return this.stages.reorder(user.organizationId, dto.ids);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: UpdateStageDto) {
    this.assertAdmin(user);
    return this.stages.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('fallback') fallback?: string,
  ) {
    this.assertAdmin(user);
    return this.stages.remove(user.organizationId, id, fallback || 'new');
  }

  private assertAdmin(user: AuthContext) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede editar las etapas');
    }
  }
}
