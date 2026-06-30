import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Provee acceso a Supabase desde la API.
 *
 *  - `admin`: cliente con SERVICE ROLE. Saltea RLS. Úsalo SOLO en lógica de
 *    servidor de confianza (workers, webhooks), nunca con datos sin validar.
 *  - `forUser(token)`: cliente que actúa COMO el usuario (respeta RLS).
 *    Úsalo para operaciones en nombre de un usuario autenticado.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private url!: string;
  private anonKey!: string;
  private serviceRoleKey!: string;
  private _admin!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.url = this.config.getOrThrow<string>('SUPABASE_URL');
    this.anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');
    this.serviceRoleKey = this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    this._admin = createClient(this.url, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Cliente con permisos elevados (SERVICE ROLE). Saltea RLS. */
  get admin(): SupabaseClient {
    return this._admin;
  }

  /** Cliente que actúa en nombre del usuario (respeta RLS). */
  forUser(accessToken: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
