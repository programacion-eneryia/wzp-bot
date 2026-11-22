import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { MediaService } from './media.service';
import { CreateMediaDto, UpdateMediaDto, UploadUrlDto } from './dto/media.dto';

/**
 * Biblioteca de archivos. Todos los miembros pueden verla y enviar archivos
 * desde el chat; solo los administradores la editan.
 */
@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.media.list(user.organizationId);
  }

  @Get(':id/url')
  url(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.media.signedUrl(user.organizationId, id);
  }

  @Post('upload-url')
  uploadUrl(@CurrentUser() user: AuthContext, @Body() dto: UploadUrlDto) {
    this.assertAdmin(user);
    return this.media.createUploadUrl(user.organizationId, dto);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateMediaDto) {
    this.assertAdmin(user);
    return this.media.create(user.organizationId, user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    this.assertAdmin(user);
    return this.media.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.media.remove(user.organizationId, id);
  }

  private assertAdmin(user: AuthContext) {
    if (user.role !== 'admin') {
      throw new ForbiddenException(
        'Solo un administrador puede gestionar los archivos',
      );
    }
  }
}
