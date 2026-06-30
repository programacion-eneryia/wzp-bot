export type OrgMembership = {
  organizationId: string;
  role: 'admin' | 'closer';
  organizationName?: string | null;
};

export type AuthContext = {
  userId: string;
  email: string | null;
  accessToken: string;
  /** Organización ACTIVA (según cabecera X-Org-Id o la primera del usuario). */
  organizationId: string;
  /** Rol del usuario EN la organización activa. */
  role: 'admin' | 'closer';
  /** Super admin del SaaS (acceso global, panel de plataforma). */
  isPlatformAdmin: boolean;
  /** Todas las organizaciones a las que pertenece el usuario. */
  memberships: OrgMembership[];
};

declare module 'express' {
  interface Request {
    auth?: AuthContext;
  }
}
