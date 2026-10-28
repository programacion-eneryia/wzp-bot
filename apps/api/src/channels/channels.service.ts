import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import {
  UnipileService,
  type UnipileAccount,
  type UnipileProvider,
} from '../unipile/unipile.service';
import { WhatsAppCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { CryptoService } from '../common/crypto.service';
import { resolveWebUrl } from '../common/web-url';
import type { AuthContext } from '../auth/auth.types';
import type { ConnectableProvider } from './dto/connect-channel.dto';

type ChannelProvider = 'whatsapp' | 'instagram' | 'messenger' | 'linkedin' | 'telegram';

const TO_UNIPILE: Record<ConnectableProvider, UnipileProvider> = {
  whatsapp: 'WHATSAPP',
  instagram: 'INSTAGRAM',
  messenger: 'MESSENGER',
};

const FROM_UNIPILE: Record<string, ChannelProvider> = {
  WHATSAPP: 'whatsapp',
  INSTAGRAM: 'instagram',
  MESSENGER: 'messenger',
  LINKEDIN: 'linkedin',
  TELEGRAM: 'telegram',
};

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly unipile: UnipileService,
    private readonly cloud: WhatsAppCloudService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Lista los canales de la organización (orden: más recientes primero). */
  async list(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('channels')
      .select('id, provider, status, display_name, agent_id, unipile_account_id, last_error, created_at, connected_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Inicia la conexión de un canal:
   *  1. Crea una fila `channels` en estado "pending".
   *  2. Pide a Unipile un enlace de autenticación hosted (QR/login).
   *  3. Devuelve la URL a la que el frontend redirige al usuario.
   */
  async connect(ctx: AuthContext, provider: ConnectableProvider, origin?: string | null) {
    this.assertAdmin(ctx);

    const { data: channel, error } = await this.supabase.admin
      .from('channels')
      .insert({
        organization_id: ctx.organizationId,
        provider,
        status: 'pending',
        created_by: ctx.userId,
      })
      .select('id')
      .single();

    if (error) throw error;

    const { url } = await this.unipile.createHostedAuthLink({
      name: channel.id as string,
      providers: [TO_UNIPILE[provider]],
      ...this.hostedAuthUrls(origin),
    });

    return { channelId: channel.id as string, url };
  }

  /**
   * Reconecta un canal cuya sesión se cerró (WhatsApp cerró el dispositivo
   * vinculado, cambio de teléfono…). A diferencia de desconectar y volver a
   * conectar, mantiene la misma cuenta en Unipile: los chats conservan su id y
   * no hay que re-vincular nada.
   */
  async reconnect(ctx: AuthContext, channelId: string, origin?: string | null) {
    this.assertAdmin(ctx);

    const { data: channel } = await this.supabase.admin
      .from('channels')
      .select('id, unipile_account_id, transport')
      .eq('id', channelId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (!channel) throw new NotFoundException('Canal no encontrado');
    if (!channel.unipile_account_id || channel.transport !== 'unipile') {
      throw new NotFoundException('Este canal no se puede reconectar: vuelve a conectarlo');
    }

    const { url } = await this.unipile.createReconnectLink(channel.unipile_account_id as string, {
      name: channel.id as string,
      ...this.hostedAuthUrls(origin),
    });
    return { channelId: channel.id as string, url };
  }

  private hostedAuthUrls(origin?: string | null) {
    const webhookBase = this.config.get<string>('WEBHOOK_BASE_URL') ?? this.config.get<string>('API_URL');
    const webUrl = resolveWebUrl(this.config, origin);
    const secret = this.config.getOrThrow<string>('UNIPILE_WEBHOOK_SECRET');
    return {
      notify_url: `${webhookBase}/api/webhooks/unipile/account?secret=${encodeURIComponent(secret)}`,
      success_redirect_url: `${webUrl}/dashboard/channels?connected=1`,
      failure_redirect_url: `${webUrl}/dashboard/channels?error=1`,
    };
  }

  /**
   * Onboarding del WhatsApp oficial (Cloud API) vía Embedded Signup.
   * El frontend ejecuta el popup de Meta y nos envía `code` + `phoneNumberId` +
   * `wabaId`. Aquí: canjeamos el token, suscribimos nuestra app a la WABA del
   * cliente, registramos el número y guardamos el canal (token cifrado).
   */
  async connectCloud(
    ctx: AuthContext,
    params: { code: string; phoneNumberId: string; wabaId: string },
  ) {
    this.assertAdmin(ctx);

    const token = await this.cloud.exchangeCode(params.code);
    await this.cloud.subscribeApp(params.wabaId, token);
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    await this.cloud.registerPhone(params.phoneNumberId, token, pin);
    const info = await this.cloud.getPhoneNumberInfo(params.phoneNumberId, token);
    const appSecret = this.config.get<string>('META_APP_SECRET') ?? '';

    const row = {
      organization_id: ctx.organizationId,
      provider: 'whatsapp' as const,
      transport: 'whatsapp_cloud',
      status: 'connected',
      display_name: info.verified_name ?? info.display_phone_number ?? 'WhatsApp Cloud',
      cloud_phone_number_id: params.phoneNumberId,
      cloud_waba_id: params.wabaId,
      cloud_token_enc: this.crypto.encrypt(token),
      cloud_app_secret_enc: this.crypto.encrypt(appSecret),
      connected_at: new Date().toISOString(),
      created_by: ctx.userId,
      last_error: null,
    };

    // Upsert por número en la organización.
    const { data: existing } = await this.supabase.admin
      .from('channels')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('cloud_phone_number_id', params.phoneNumberId)
      .maybeSingle();

    if (existing) {
      await this.supabase.admin.from('channels').update(row).eq('id', existing.id);
      return { channelId: existing.id as string, ok: true };
    }

    const { data: created, error } = await this.supabase.admin
      .from('channels')
      .insert(row)
      .select('id')
      .single();
    if (error) throw error;
    return { channelId: created.id as string, ok: true };
  }

  /** Desconecta un canal: lo elimina en Unipile y lo marca como desconectado. */
  async disconnect(ctx: AuthContext, channelId: string) {
    this.assertAdmin(ctx);

    const { data: channel } = await this.supabase.admin
      .from('channels')
      .select('id, unipile_account_id')
      .eq('id', channelId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (!channel) throw new NotFoundException('Canal no encontrado');

    if (channel.unipile_account_id) {
      try {
        await this.unipile.deleteAccount(channel.unipile_account_id as string);
      } catch (err) {
        // Si ya no existe en Unipile seguimos: lo importante es limpiar nuestro lado.
        this.logger.warn(`No se pudo eliminar la cuenta en Unipile: ${String(err)}`);
      }
    }

    const { error } = await this.supabase.admin
      .from('channels')
      .update({ status: 'disconnected', unipile_account_id: null })
      .eq('id', channelId)
      .eq('organization_id', ctx.organizationId);

    if (error) throw error;

    // Archivamos (ocultamos del inbox) las conversaciones de este canal. No se
    // borran: se conservan en BD por si se reconecta o para histórico.
    const { error: archiveError, count } = await this.supabase.admin
      .from('conversations')
      .update({ archived_at: new Date().toISOString() }, { count: 'exact' })
      .eq('organization_id', ctx.organizationId)
      .eq('channel_id', channelId)
      .is('archived_at', null);
    if (archiveError) {
      this.logger.warn(`No se pudieron archivar las conversaciones: ${String(archiveError)}`);
    } else if (count) {
      this.logger.log(`Archivadas ${count} conversaciones del canal ${channelId}`);
    }

    // Sin conversaciones no hay histórico que conservar: se borra del todo.
    const { count: convs } = await this.supabase.admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', channelId);
    if (convs === 0) {
      await this.supabase.admin
        .from('channels')
        .delete()
        .eq('id', channelId)
        .eq('organization_id', ctx.organizationId);
    }

    return { ok: true };
  }

  /**
   * Reconcilia el estado local con Unipile (fallback útil en local sin webhooks
   * públicos; en producción la vía fiable es el webhook `notify_url`).
   *
   * Cuidado multi-tenant: una sola cuenta de Unipile aloja las conexiones de
   * TODO el SaaS. Por eso:
   *   1. Refresca solo los canales de ESTA org ya vinculados por id de cuenta.
   *   2. Empareja cada canal "pending" de esta org con una cuenta de Unipile
   *      del MISMO tipo que aún no esté vinculada a ningún canal nuestro.
   *      (Las cuentas libres se asignan por orden de creación.)
   */
  async reconcile(ctx: AuthContext) {
    this.assertAdmin(ctx);

    const accounts = await this.unipile.listAccounts();

    // Cuentas de Unipile YA vinculadas en nuestra base (cualquier org).
    const { data: linkedRows } = await this.supabase.admin
      .from('channels')
      .select('unipile_account_id')
      .not('unipile_account_id', 'is', null);
    const used = new Set((linkedRows ?? []).map((r) => r.unipile_account_id as string));

    let linked = 0;

    // 1) Refrescar canales de esta org ya vinculados.
    const { data: orgLinked } = await this.supabase.admin
      .from('channels')
      .select('id, unipile_account_id')
      .eq('organization_id', ctx.organizationId)
      .not('unipile_account_id', 'is', null);

    for (const ch of orgLinked ?? []) {
      const acc = accounts.find((a) => a.id === ch.unipile_account_id);
      if (!acc) continue;
      if (UnipileService.isAccountHealthy(acc)) {
        await this.markConnected(ch.id as string, acc);
        linked += 1;
      } else {
        // La cuenta existe pero la sesión está caída (CREDENTIALS/ERROR): no
        // la damos por conectada; el usuario tiene que reconectarla.
        await this.markSessionLost(ch.id as string, acc);
      }
    }

    // 2) Emparejar canales pendientes con cuentas libres del mismo tipo.
    const { data: pendings } = await this.supabase.admin
      .from('channels')
      .select('id, provider, created_at')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    const free = accounts
      .filter((a) => !used.has(a.id))
      .sort(
        (a, b) =>
          new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
      );

    for (const ch of pendings ?? []) {
      const idx = free.findIndex(
        (a) => a.type && FROM_UNIPILE[a.type] === (ch.provider as ChannelProvider),
      );
      if (idx >= 0) {
        const [acc] = free.splice(idx, 1);
        used.add(acc.id);
        await this.markConnected(ch.id as string, acc);
        linked += 1;
      }
    }

    return { ok: true, linked, accountsSeen: accounts.length };
  }

  /**
   * Procesa el webhook de Unipile cuando una cuenta termina de conectarse.
   * Payload: { status, account_id, name } — `name` es el id de nuestro canal.
   */
  async handleAccountWebhook(payload: {
    status?: string;
    account_id?: string;
    name?: string;
  }) {
    const channelId = payload.name;
    if (!channelId) {
      this.logger.warn('Webhook de cuenta sin `name`; no se puede correlacionar');
      return;
    }

    const ok = payload.status === 'CREATION_SUCCESS' || payload.status === 'RECONNECTED';
    if (!ok || !payload.account_id) {
      // Unipile puede mandar un CREATION_FAIL tardío (enlace caducado o
      // reintento) después de que el canal ya se conectó: no lo tumbamos.
      await this.supabase.admin
        .from('channels')
        .update({ status: 'error', last_error: `Conexión fallida: ${payload.status ?? 'desconocido'}` })
        .eq('id', channelId)
        .neq('status', 'connected');
      return;
    }

    try {
      const account = await this.unipile.getAccount(payload.account_id);
      await this.markConnected(channelId, account);
    } catch {
      // Si no podemos enriquecer, al menos guardamos el account_id.
      await this.markConnected(channelId, { id: payload.account_id });
    }
  }

  /**
   * Webhook `account_status` de Unipile: cambios de estado de una cuenta ya
   * conectada (sesión cerrada, recuperada, borrada…). Payload:
   *   { AccountStatus: { account_id, account_type, message } }
   * con message OK | CONNECTING | CREDENTIALS | ERROR | STOPPED | DELETED | …
   */
  async handleAccountStatus(payload: Record<string, unknown>) {
    const st = (payload.AccountStatus ?? payload) as Record<string, unknown>;
    const accountId = typeof st.account_id === 'string' ? st.account_id : null;
    const message = String(st.message ?? st.status ?? '').toUpperCase();
    if (!accountId || !message) return;

    const { data: channel } = await this.supabase.admin
      .from('channels')
      .select('id, status')
      .eq('unipile_account_id', accountId)
      .maybeSingle();
    if (!channel) return;

    if (message === 'OK' || message === 'RECONNECTED' || message === 'CREATION_SUCCESS') {
      if (channel.status !== 'connected') {
        await this.supabase.admin
          .from('channels')
          .update({ status: 'connected', last_error: null, connected_at: new Date().toISOString() })
          .eq('id', channel.id);
        this.logger.log(`Canal ${channel.id as string} vuelve a estar conectado (${message})`);
      }
      return;
    }
    if (message === 'DELETED') {
      await this.supabase.admin
        .from('channels')
        .update({ status: 'disconnected', unipile_account_id: null, last_error: 'La cuenta se eliminó en el proveedor' })
        .eq('id', channel.id);
      return;
    }
    if (['CREDENTIALS', 'ERROR', 'STOPPED', 'DISCONNECTED', 'PERMISSIONS'].includes(message)) {
      await this.markSessionLost(channel.id as string, { id: accountId, sources: [{ status: message }] });
    }
  }

  /** La sesión del número se ha cerrado: el canal queda en error hasta reconectar. */
  private async markSessionLost(channelId: string, account: UnipileAccount) {
    const reason = account.sources?.find((s) => s.status && s.status !== 'OK')?.status ?? 'CREDENTIALS';
    const { data } = await this.supabase.admin
      .from('channels')
      .update({
        status: 'error',
        last_error:
          'WhatsApp cerró la sesión de este número (p. ej. por cambio de teléfono). Pulsa "Reconectar" y escanea el código QR.',
      })
      .eq('id', channelId)
      .neq('status', 'error')
      .select('id');
    if (data?.length) this.logger.warn(`Canal ${channelId} sin sesión (${reason}): requiere reconexión`);
  }

  private async markConnected(channelId: string, account: UnipileAccount) {
    const update: Record<string, unknown> = {
      status: 'connected',
      unipile_account_id: account.id,
      connected_at: new Date().toISOString(),
      last_error: null,
    };

    if (account.name && account.name !== channelId) {
      update.display_name = account.name;
    }
    if (account.type && FROM_UNIPILE[account.type]) {
      update.provider = FROM_UNIPILE[account.type];
    }
    update.metadata = { type: account.type ?? null, sources: account.sources ?? null };

    const { data: channel, error } = await this.supabase.admin
      .from('channels')
      .update(update)
      .eq('id', channelId)
      .select('id, organization_id, provider, display_name')
      .maybeSingle();

    if (error) {
      this.logger.error(`No se pudo marcar conectado el canal ${channelId}: ${error.message}`);
      return;
    }
    if (channel) await this.adoptPrevious(channel);
  }

  /**
   * Al reconectar un número se crea un canal nuevo: el anterior (mismo tipo y
   * nombre) le cede su histórico y su agente, y desaparece.
   */
  private async adoptPrevious(channel: {
    id: string;
    organization_id: string;
    provider: string;
    display_name: string | null;
  }) {
    if (!channel.display_name) return;
    const { data: previous } = await this.supabase.admin
      .from('channels')
      .select('id')
      .eq('organization_id', channel.organization_id)
      .eq('provider', channel.provider)
      .eq('display_name', channel.display_name)
      .neq('status', 'connected')
      .neq('id', channel.id);
    for (const old of previous ?? []) {
      const { data: moved, error } = await this.supabase.admin.rpc('adopt_channel', {
        p_new: channel.id,
        p_old: old.id,
      });
      if (error) {
        this.logger.warn(`No se pudo traspasar el canal ${old.id as string}: ${error.message}`);
      } else {
        this.logger.log(
          `Canal ${old.id as string} traspasado a ${channel.id} (${String(moved)} conversaciones)`,
        );
      }
    }
  }

  private assertAdmin(ctx: AuthContext) {
    if (ctx.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede gestionar canales');
    }
  }
}
