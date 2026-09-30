export type Theme = "dark" | "light";

const KEY = "eneryeter-theme";

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
    // Cookie para que el servidor pueda pintar el tema correcto sin parpadeo.
    document.cookie = `${KEY}=${theme}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* modo privado */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

/** Script inline (se ejecuta antes de pintar) para aplicar el tema guardado. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(!t){var m=document.cookie.match(/(?:^|; )${KEY}=(dark|light)/);t=m?m[1]:null}if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`;
