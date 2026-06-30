import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Operaciones de bajo nivel sobre usuarios de Supabase Auth (service role).
 * Compartido por el panel de plataforma y el de equipo. Diseñado para que en el
 * futuro el alta también la pueda disparar el flujo de signup + Stripe.
 */
@Injectable()
export class UsersAdminService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Crea un usuario con email + contraseña (confirmado). Devuelve su id. */
  async createAuthUser(params: { email: string; password: string; fullName?: string }): Promise<string> {
    const { data, error } = await this.supabase.admin.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: params.fullName ? { full_name: params.fullName } : undefined,
    });
    if (error || !data.user) {
      throw new BadRequestException(error?.message ?? 'No se pudo crear el usuario');
    }
    // Aseguramos el profile (el trigger lo crea, pero por si acaso).
    await this.supabase.admin
      .from('profiles')
      .upsert({ id: data.user.id, email: params.email, full_name: params.fullName ?? '' }, { onConflict: 'id' });
    return data.user.id;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.supabase.admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new BadRequestException(error.message);
  }

  /** Banea (deshabilita) o reactiva un usuario. */
  async setBanned(userId: string, banned: boolean): Promise<void> {
    const { error } = await this.supabase.admin.auth.admin.updateUserById(userId, {
      // ban_duration acepta una duración tipo Go ('876000h' ≈ 100 años) o 'none'.
      ban_duration: banned ? '876000h' : 'none',
    });
    if (error) throw new BadRequestException(error.message);
  }

  async deleteAuthUser(userId: string): Promise<void> {
    const { error } = await this.supabase.admin.auth.admin.deleteUser(userId);
    if (error) throw new BadRequestException(error.message);
  }

  async findByEmail(email: string): Promise<{ id: string } | null> {
    const { data } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    return data ? { id: data.id as string } : null;
  }

  /** Genera un token de un solo uso para INICIAR SESIÓN como el usuario (impersonar). */
  async generateImpersonationToken(email: string): Promise<string> {
    const { data, error } = await this.supabase.admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      throw new BadRequestException(error?.message ?? 'No se pudo generar el acceso de impersonación');
    }
    return tokenHash;
  }
}
