/**
 * Loads the active theme and applies it to the document.
 *
 * Three things happen here and nowhere else:
 *  1. `tokens.json` becomes custom properties on `<html>`, so every component and the theme's own
 *     CSS read the same values.
 *  2. `theme.css` is injected as a single managed <style> after `base.css`.
 *  3. The user's runtime overrides (tile size, UI scale, accent, reduced motion) are layered on.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, onCoreEvent } from '@/bridge';
import type { ThemeBundle } from '@/bridge';
import { errorMessage } from '@/store/errors';
import { useSettingsStore } from '@/store';

import { cssVariables } from './tokens';

const STYLE_ELEMENT_ID = 'aura-theme-css';

export interface ThemeContextValue {
  bundle: ThemeBundle | null;
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [bundle, setBundle] = useState<ThemeBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const settings = useSettingsStore((s) => s.settings);
  const themeId = settings?.themeId;

  const load = useMemo(
    () => async (id?: string) => {
      setLoading(true);
      try {
        const next = await api.getTheme(id);
        setBundle(next);
        setError(null);
      } catch (e) {
        // A broken theme must not blank the screen: base.css carries a complete fallback
        // palette, so the shell stays usable and the error surfaces in Settings.
        setError(errorMessage(e, 'Could not load the theme'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(themeId);
  }, [load, themeId]);

  useEffect(() => onCoreEvent('theme://changed', ({ themeId: id }) => void load(id)), [load]);

  // ---- custom properties ----------------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    const vars = cssVariables(bundle?.tokens, {
      tileSize: settings?.tileSize ?? 'medium',
      uiScale: settings?.uiScale ?? 1,
      accentColor: settings?.accentColor ?? null,
    });

    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [bundle, settings?.tileSize, settings?.uiScale, settings?.accentColor]);

  // ---- theme.css ------------------------------------------------------------------------------
  useEffect(() => {
    const css = bundle?.css;
    if (!css) return;

    let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ELEMENT_ID;
      // Last in <head> so a theme can override base.css without !important.
      document.head.appendChild(style);
    }
    style.textContent = css;

    return () => {
      style?.remove();
    };
  }, [bundle?.css]);

  // ---- reduced motion -------------------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.reduceMotion) root.setAttribute('data-reduce-motion', 'true');
    else root.removeAttribute('data-reduce-motion');
  }, [settings?.reduceMotion]);

  const value = useMemo<ThemeContextValue>(
    () => ({ bundle, loading, error, reload: () => load(themeId) }),
    [bundle, loading, error, load, themeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a <ThemeProvider>');
  return ctx;
}
