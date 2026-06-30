import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SetterConfigService } from './setter-config.service';
import { SetterAssistantService } from './setter-assistant.service';
import { SilencedContactsService } from './silenced-contacts.service';
import { extractTextFromFile } from './document-extract';
import { GenerateSetterDto, UpdateSetterConfigDto } from './dto/update-setter-config.dto';

class AddSilencedDto {
  @IsString() @MinLength(2) @MaxLength(120) identifier!: string;
}

@Controller('setter')
@UseGuards(AuthGuard)
export class SetterController {
  constructor(
    private readonly setterConfig: SetterConfigService,
    private readonly assistant: SetterAssistantService,
    private readonly silenced: SilencedContactsService,
  ) {}

  @Get('config')
  getConfig(@CurrentUser() user: AuthContext) {
    return this.setterConfig.getOrCreate(user.organizationId);
  }

  @Put('config')
  updateConfig(@CurrentUser() user: AuthContext, @Body() dto: UpdateSetterConfigDto) {
    this.assertAdmin(user);
    return this.setterConfig.update(user.organizationId, dto);
  }

  /** Genera la configuración del setter con IA a partir del brief del negocio. */
  @Post('generate')
  async generate(@CurrentUser() user: AuthContext, @Body() dto: GenerateSetterDto) {
    this.assertAdmin(user);
    const fields = await this.assistant.generateFromBrief(dto.brief);
    if (dto.apply) {
      const config = await this.setterConfig.update(user.organizationId, {
        ...fields,
        knowledge_base: dto.brief,
      });
      return { fields, config };
    }
    return { fields };
  }

  /** Sube uno o varios PDF/Word/TXT; la IA los lee todos y genera la config. */
  @Post('generate-from-file')
  @UseInterceptors(
    FilesInterceptor('files', 15, { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async generateFromFile(
    @CurrentUser() user: AuthContext,
    @UploadedFiles()
    files:
      | { originalname?: string; mimetype?: string; buffer: Buffer }[]
      | undefined,
    @Body('apply') apply?: string,
  ) {
    this.assertAdmin(user);
    if (!files?.length) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    // Extraemos el texto de cada documento y lo unimos con su nombre como cabecera.
    const parts: string[] = [];
    for (const file of files) {
      if (!file?.buffer) continue;
      const text = await extractTextFromFile(file);
      if (text && text.trim().length > 0) {
        parts.push(`===== DOCUMENTO: ${file.originalname ?? 'sin nombre'} =====\n${text.trim()}`);
      }
    }

    const combined = parts.join('\n\n');
    if (combined.trim().length < 20) {
      throw new BadRequestException(
        'No se pudo extraer texto de los documentos (¿están escaneados como imagen?)',
      );
    }

    const fields = await this.assistant.generateFromBrief(combined);
    if (apply === 'true') {
      const config = await this.setterConfig.update(user.organizationId, {
        ...fields,
        knowledge_base: combined.slice(0, 28000),
      });
      return {
        fields,
        config,
        extractedChars: combined.length,
        files: files.length,
      };
    }
    return { fields, extractedChars: combined.length, files: files.length };
  }

  /**
   * Sube documentos con conversaciones que SALIERON BIEN (cerradas / agendadas).
   * Extraemos el texto y lo guardamos en `winning_examples` para que el bot
   * aprenda su estilo y forma de cerrar (few-shot en el prompt).
   */
  @Post('examples-from-file')
  @UseInterceptors(
    FilesInterceptor('files', 15, { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async examplesFromFile(
    @CurrentUser() user: AuthContext,
    @UploadedFiles()
    files:
      | { originalname?: string; mimetype?: string; buffer: Buffer }[]
      | undefined,
    @Body('append') append?: string,
  ) {
    this.assertAdmin(user);
    if (!files?.length) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    const parts: string[] = [];
    for (const file of files) {
      if (!file?.buffer) continue;
      const text = await extractTextFromFile(file);
      if (text && text.trim().length > 0) {
        parts.push(`===== CONVERSACIÓN: ${file.originalname ?? 'ejemplo'} =====\n${text.trim()}`);
      }
    }

    let combined = parts.join('\n\n');
    if (combined.trim().length < 20) {
      throw new BadRequestException(
        'No se pudo extraer texto de los documentos (¿están escaneados como imagen?)',
      );
    }

    // Si el usuario quiere acumular, anteponemos lo ya guardado.
    if (append === 'true') {
      const current = await this.setterConfig.getOrCreate(user.organizationId);
      if (current.winning_examples) {
        combined = `${current.winning_examples}\n\n${combined}`;
      }
    }

    const winning_examples = combined.slice(0, 58000);
    const config = await this.setterConfig.update(user.organizationId, { winning_examples });
    return { config, extractedChars: combined.length, files: files.length };
  }

  // --- Contactos silenciados ---
  @Get('silenced')
  listSilenced(@CurrentUser() user: AuthContext) {
    return this.silenced.list(user.organizationId);
  }

  @Post('silenced')
  addSilenced(@CurrentUser() user: AuthContext, @Body() dto: AddSilencedDto) {
    this.assertAdmin(user);
    return this.silenced.add(user.organizationId, dto.identifier);
  }

  @Delete('silenced/:id')
  removeSilenced(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.silenced.remove(user.organizationId, id);
  }

  private assertAdmin(user: AuthContext) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede editar el setter');
    }
  }
}
