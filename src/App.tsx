/**
 * Root component. Composition order (outer -> inner):
 *   ThemeProvider   - loads the active ThemeBundle, applies tokens as CSS vars + theme.css
 *   SoundProvider   - preloads theme sounds, exposes useSound()
 *   InputProvider   - keyboard + gamepad -> FocusEngine actions
 *   FocusProvider   - spatial focus engine (D-pad navigation)
 *   Background      - image / video / shader wallpaper + colour bleed + blur
 *   Shell           - NavBar + active screen + overlays (launch, toast)
 *
 * STATUS: stub - owner ui-shell agent composes the real tree once providers exist.
 */

import { useEffect } from 'react';

import { api } from '@/bridge';

export default function App() {
  useEffect(() => {
    // Reveal the (hidden) native window after the first paint.
    const id = requestAnimationFrame(() => void api.shellReady());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="aura-root" data-screen="home">
      <main className="aura-boot">
        <h1>Aura Shell</h1>
        <p>UI layer not composed yet.</p>
      </main>
    </div>
  );
}
