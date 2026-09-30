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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AgentsService } from '../agents/agents.service';
import { SetterConfigService } from './setter-config.service';
import { SetterAssistantService } from './setter-assistant.service';
import { BriefApplyService } from './brief-apply.service';
import { SilencedContactsService } from './silenced-contacts.service';
import { extractTextFromFile } from './document-extract';
import { GenerateSetterDto, UpdateSetterConfigDto } from './dto/update-setter-config.dto';

class AddSilencedDto {
  @IsString() @MinLength(2) @MaxLength(120) identifier!: string;
}

class ImportSilencedDto {
  @IsOptional() @IsString() @MaxLength(2_000_000) csv?: string;
}

@Controller('setter')
@UseGuards(AuthGuard)
export class SetterController {
  constructor(
    private readonly setterConfig: SetterConfigService,
    private readonly assistant: SetterAssistantService,
    private readonly briefApply: BriefApplyService,
    private readonly agents: AgentsService,
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

  /**
   * Genera con IA, a partir del brief del negocio: la Base de Conocimiento, el
   * agente Setter, el agente de Soporte y etiquetas/etapas sugeridas. Con
   * `apply` lo guarda todo.
   */
  @Post('generate')
  async generate(@CurrentUser() user: AuthContext, @Body() dto: GenerateSetterDto) {
    this.assertAdmin(user);
    const gen = await this.assistant.generateFromBrief(dto.brief, user.organizationId);
    if (dto.apply) {
      const applied = await this.briefApply.apply(
        user.organizationId,
        user.userId,
        gen,
        dto.brief,
      );
      return { ...gen, ...applied };
    }
    return gen;
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

    const gen = await this.assistant.generateFromBrief(combined, user.organizationId);
    if (apply === 'true') {
      const applied = await this.briefApply.apply(
        user.organizationId,
        user.userId,
        gen,
        combined,
      );
      return {
        ...gen,
        ...applied,
        extractedChars: combined.length,
        files: files.length,
      };
    }
    return { ...gen, extractedChars: combined.length, files: files.length };
  }

  /**
   * Sube documentos con conversaciones que SALIERON BIEN (cerradas / agendadas).
   * Extraemos el texto y lo guardamos en `winning_examples` del AGENTE
   * (`agent_id`; por defecto el setter) para que aprenda su estilo y forma de
   * cerrar (few-shot en el prompt).
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
    @Body('agent_id') agentId?: string,
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

    const agent = agentId
      ? await this.agents.get(user.organizationId, agentId)
      : await this.agents.firstOfKind(user.organizationId, 'setter');
    if (!agent) throw new BadRequestException('No hay ningún agente al que añadir los ejemplos');

    // Si el usuario quiere acumular, anteponemos lo ya guardado.
    if (append === 'true' && agent.winning_examples) {
      combined = `${agent.winning_examples}\n\n${combined}`;
    }

    const winning_examples = combined.slice(0, 58000);
    const updated = await this.agents.update(user.organizationId, agent.id, { winning_examples });
    return { agent: updated, extractedChars: combined.length, files: files.length };
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

  /**
   * Importa silenciados desde CSV (una columna: teléfono o usuario de Instagram).
   * Acepta el archivo (`file`) o el texto (`csv`) en el body.
   */
  @Post('silenced/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importSilenced(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() dto: ImportSilencedDto,
  ) {
    this.assertAdmin(user);
    const text = file?.buffer ? file.buffer.toString('utf8') : (dto.csv ?? '');
    if (!text.trim()) throw new BadRequestException('CSV vacío');
    return this.silenced.importCsv(user.organizationId, text);
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
