/**
 * La app se puede abrir embebida en GHL (enlace de menú personalizado = iframe
 * de otro dominio). Con el SameSite=Lax por defecto el navegador no guarda ni
 * envía la sesión dentro de ese iframe, así que el login no se mantendría.
 * La API usa el token Bearer (no cookies), por lo que SameSite=None no abre CSRF.
 */
export const authCookieOptions =
  process.env.NODE_ENV === "production"
    ? ({ sameSite: "none", secure: true } as const)
    : undefined;
