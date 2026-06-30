import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Utilidades de criptografía para datos sensibles:
 *   - `encrypt`/`decrypt`: cifrado simétrico AES-256-GCM (autenticado) para
 *     guardar secretos en BD (API keys de terceros, tokens de canal...).
 *   - `safeEqual`: comparación en tiempo constante (evita timing attacks al
 *     validar secretos de webhooks).
 *   - `token`: token aleatorio criptográficamente seguro.
 *
 * La clave sale de `FIELD_ENCRYPTION_KEY` (genera con `openssl rand -base64 32`).
 * Formato de salida: `enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>`.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer | null = null;
  private static readonly PREFIX = 'enc:v1:';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('FIELD_ENCRYPTION_KEY') ?? '';
    if (!raw) {
      this.logger.warn(
        'FIELD_ENCRYPTION_KEY no configurada: los secretos NO se cifrarán en reposo.',
      );
      return;
    }
    // Aceptamos base64 (recomendado) o hex; debe dar 32 bytes para AES-256.
    let buf = tryDecode(raw);
    if (buf.length !== 32) {
      this.logger.warn(
        `FIELD_ENCRYPTION_KEY debe ser de 32 bytes (recibidos ${buf.length}); cifrado deshabilitado.`,
      );
      return;
    }
    this.key = buf;
  }

  /** ¿Hay clave válida para cifrar secretos en reposo? */
  get enabled(): boolean {
    return this.key !== null;
  }

  /** Cifra un texto. Si no hay clave, devuelve el texto tal cual (con aviso). */
  encrypt(plain: string): string {
    if (plain === '' || plain == null) return plain;
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${CryptoService.PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  /** Descifra un valor cifrado por `encrypt`. Si no está cifrado, lo devuelve igual. */
  decrypt(value: string | null | undefined): string | null {
    if (value == null || value === '') return value ?? null;
    if (!value.startsWith(CryptoService.PREFIX)) return value; // valor en claro (legado)
    if (!this.key) {
      this.logger.error('No se puede descifrar: falta FIELD_ENCRYPTION_KEY');
      return null;
    }
    try {
      const [, , ivB64, tagB64, dataB64] = value.split(':');
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch (err) {
      this.logger.error(`Fallo al descifrar un secreto: ${String(err)}`);
      return null;
    }
  }

  /** Comparación de strings en tiempo constante (no filtra longitud ni contenido). */
  safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  /** Token aleatorio seguro (hex). Por defecto 32 bytes → 64 chars. */
  token(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }
}

function tryDecode(raw: string): Buffer {
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  const hex = /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.alloc(0);
  if (hex.length === 32) return hex;
  return b64; // se valida la longitud fuera
}
