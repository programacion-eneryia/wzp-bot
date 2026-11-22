import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import {
  MEDIA_MAX_BYTES,
  type CreateMediaDto,
  type UpdateMediaDto,
  type UploadUrlDto,
} from './dto/media.dto';

export const MEDIA_BUCKET = 'media';

export type MediaKind = 'audio' | 'video' | 'image' | 'document';

export type MediaAsset = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  as_voice_note: boolean;
  ai_enabled: boolean;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  'id, organization_id, name, description, kind, mime_type, size_bytes, storage_path, as_voice_note, ai_enabled, agent_id, created_at, updated_at';

/** Tipos que WhatsApp/Instagram aceptan de forma fiable. */
const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/3gpp',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);

export function kindFromMime(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  return 'document';
}

export const KIND_LABEL: Record<MediaKind, string> = {
  audio: 'Audio',
  video: 'Vídeo',
  image: 'Imagen',
  document: 'Documento',
};

/** Texto con el que se guarda en el historial el envío de un archivo. */
export function mediaMessageContent(
  asset: Pick<MediaAsset, 'kind' | 'name'>,
  text?: string | null,
): string {
  const label = `[${KIND_LABEL[asset.kind]}: ${asset.name}]`;
  const t = text?.trim();
  return t ? `${t}\n${label}` : label;
}

/** Extensión para el nombre de archivo que ve el lead. */
function extensionFor(mime: string, filename: string): string {
  const fromName = filename.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/3gpp': '3gp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
  };
  return map[mime.toLowerCase()] ?? 'bin';
}

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'archivo'
  );
}

/**
 * Biblioteca de archivos de la organización: audios, vídeos, imágenes y
 * documentos que el bot (la IA o un workflow) envía al lead cuando se cumple
 * una condición. Los archivos viven en el bucket privado `media` de Storage.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<MediaAsset[]> {
    const { data, error } = await this.supabase.admin
      .from('media_assets')
      .select(COLS)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async get(orgId: string, id: string): Promise<MediaAsset> {
    const { data } = await this.supabase.admin
      .from('media_assets')
      .select(COLS)
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Archivo no encontrado');
    return data;
  }

  /** Busca por id o, si no, por nombre (sin distinguir mayúsculas ni acentos). */
  async findByRef(orgId: string, ref: string): Promise<MediaAsset | null> {
    const r = ref.trim();
    if (!r) return null;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(r)) {
      const { data } = await this.supabase.admin
        .from('media_assets')
        .select(COLS)
        .eq('organization_id', orgId)
        .eq('id', r)
        .maybeSingle();
      if (data) return data;
    }
    const all = await this.list(orgId);
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const want = norm(r);
    return (
      all.find((a) => norm(a.name) === want) ??
      all.find(
        (a) => norm(a.name).includes(want) || want.includes(norm(a.name)),
      ) ??
      null
    );
  }

  /** Archivos que la IA puede decidir enviar con este agente. */
  async forAi(orgId: string, agentId: string | null): Promise<MediaAsset[]> {
    const all = await this.list(orgId);
    return all.filter(
      (a) => a.ai_enabled && (!a.agent_id || a.agent_id === agentId),
    );
  }

  /**
   * URL firmada para que el navegador suba el archivo DIRECTO a Storage (la
   * API en Vercel no admite cuerpos de más de ~4,5 MB).
   */
  async createUploadUrl(
    orgId: string,
    dto: UploadUrlDto,
  ): Promise<{ path: string; upload_url: string; token: string }> {
    this.assertAllowed(dto.mime_type, dto.size_bytes);
    const ext = extensionFor(dto.mime_type, dto.filename);
    const path = `${orgId}/${randomUUID()}-${slug(dto.filename.replace(/\.[a-z0-9]{1,5}$/i, ''))}.${ext}`;
    const { data, error } = await this.supabase.admin.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      this.logger.error(
        `No se pudo crear la URL de subida: ${error?.message ?? 'sin datos'}`,
      );
      throw new BadRequestException(
        'No se pudo preparar la subida del archivo',
      );
    }
    return { path, upload_url: data.signedUrl, token: data.token };
  }

  /** Registra un archivo YA subido a Storage. */
  async create(
    orgId: string,
    userId: string,
    dto: CreateMediaDto,
  ): Promise<MediaAsset> {
    this.assertAllowed(dto.mime_type, dto.size_bytes);
    if (!dto.storage_path.startsWith(`${orgId}/`)) {
      throw new BadRequestException('Ruta de archivo no válida');
    }
    // Comprobamos que el archivo existe de verdad en Storage.
    const folder = dto.storage_path.slice(0, dto.storage_path.lastIndexOf('/'));
    const file = dto.storage_path.slice(dto.storage_path.lastIndexOf('/') + 1);
    const { data: objects } = await this.supabase.admin.storage
      .from(MEDIA_BUCKET)
      .list(folder, { search: file, limit: 5 });
    const obj = (objects ?? []).find((o) => o.name === file);
    if (!obj)
      throw new BadRequestException(
        'El archivo no se ha subido correctamente. Inténtalo de nuevo.',
      );
    const realSize = Number(
      (obj.metadata as { size?: number } | null)?.size ?? dto.size_bytes,
    );

    if (dto.agent_id) await this.assertAgent(orgId, dto.agent_id);
    const kind = kindFromMime(dto.mime_type);
    const { data, error } = await this.supabase.admin
      .from('media_assets')
      .insert({
        organization_id: orgId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        kind,
        mime_type: dto.mime_type,
        size_bytes: realSize,
        storage_path: dto.storage_path,
        as_voice_note: kind === 'audio' && Boolean(dto.as_voice_note),
        ai_enabled: dto.ai_enabled ?? true,
        agent_id: dto.agent_id ?? null,
        created_by: userId,
      })
      .select(COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateMediaDto,
  ): Promise<MediaAsset> {
    const current = await this.get(orgId, id);
    if (dto.agent_id) await this.assertAgent(orgId, dto.agent_id);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined)
      patch.description = dto.description?.trim() || null;
    if (dto.as_voice_note !== undefined)
      patch.as_voice_note = current.kind === 'audio' && dto.as_voice_note;
    if (dto.ai_enabled !== undefined) patch.ai_enabled = dto.ai_enabled;
    if (dto.agent_id !== undefined) patch.agent_id = dto.agent_id;
    if (Object.keys(patch).length === 0) return current;
    const { data, error } = await this.supabase.admin
      .from('media_assets')
      .update(patch)
      .eq('organization_id', orgId)
      .eq('id', id)
      .select(COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async remove(orgId: string, id: string): Promise<{ ok: true }> {
    const asset = await this.get(orgId, id);
    const { error } = await this.supabase.admin
      .from('media_assets')
      .delete()
      .eq('organization_id', orgId)
      .eq('id', id);
    if (error) throw error;
    const { error: storageErr } = await this.supabase.admin.storage
      .from(MEDIA_BUCKET)
      .remove([asset.storage_path]);
    if (storageErr)
      this.logger.warn(
        `No se pudo borrar ${asset.storage_path} de Storage: ${storageErr.message}`,
      );
    return { ok: true };
  }

  /** URL temporal para previsualizar/descargar el archivo desde el panel. */
  async signedUrl(
    orgId: string,
    id: string,
    seconds = 3600,
  ): Promise<{ url: string }> {
    const asset = await this.get(orgId, id);
    const { data, error } = await this.supabase.admin.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(asset.storage_path, seconds);
    if (error || !data)
      throw new BadRequestException('No se pudo generar el enlace del archivo');
    return { url: data.signedUrl };
  }

  /** Descarga el archivo para enviarlo por el canal. */
  async download(
    asset: MediaAsset,
  ): Promise<{ data: Buffer; filename: string; mime: string }> {
    const { data, error } = await this.supabase.admin.storage
      .from(MEDIA_BUCKET)
      .download(asset.storage_path);
    if (error || !data)
      throw new Error(
        `No se pudo descargar el archivo ${asset.name}: ${error?.message ?? 'sin datos'}`,
      );
    const buf = Buffer.from(await data.arrayBuffer());
    const ext = extensionFor(asset.mime_type, asset.storage_path);
    return {
      data: buf,
      filename: `${slug(asset.name)}.${ext}`,
      mime: asset.mime_type,
    };
  }

  private assertAllowed(mime: string, size: number) {
    if (!ALLOWED_MIME.has(mime.toLowerCase())) {
      throw new BadRequestException(
        'Tipo de archivo no admitido. Usa audio (mp3, m4a, ogg), vídeo (mp4), imagen (jpg, png, webp) o documento (pdf, docx, xlsx, pptx).',
      );
    }
    if (size > MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        'El archivo supera los 16 MB que admite WhatsApp',
      );
    }
  }

  private async assertAgent(orgId: string, agentId: string) {
    const { data } = await this.supabase.admin
      .from('agents')
      .select('id')
      .eq('organization_id', orgId)
      .eq('id', agentId)
      .maybeSingle();
    if (!data)
      throw new BadRequestException(
        'El agente indicado no existe en esta organización',
      );
  }
}
