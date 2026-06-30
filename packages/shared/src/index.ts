/**
 * Tipos compartidos entre `web` (Next.js) y `api` (NestJS).
 * Mantener aquí los contratos de datos que ambos lados necesitan conocer.
 */

/** Canales de mensajería soportados. */
export type Provider = 'whatsapp' | 'instagram' | 'messenger';

/** Roles de un usuario dentro de una organización (tenant). */
export type Role = 'admin' | 'closer';

/** Estado de una cuenta de canal conectada vía Unipile. */
export type ChannelStatus = 'operational' | 'auth_required' | 'paused';

/** Carpetas del inbox. */
export type Folder = 'chats' | 'calendario' | 'llamada_agendada' | 'comprados';

/** Dirección de un mensaje. */
export type MessageDirection = 'inbound' | 'outbound';

/** Quién originó el mensaje. */
export type MessageSender = 'lead' | 'ai' | 'human';

/** Tipo de contenido de un mensaje. */
export type MessageType = 'text' | 'voice' | 'image' | 'file';

/** Estado de la IA en una conversación. */
export type AiStatus = 'active' | 'paused';

/** Respuesta de salud del servicio. */
export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
