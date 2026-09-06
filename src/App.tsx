/**
 * Root component. Composition order (outer -> inner):
 *   ThemeProvider   - loads the active ThemeBundle, applies tokens as CSS vars + theme.css
 *   SoundProvider   - preloads theme sounds, exposes useSound()
 *   FocusProvider   - spatial focus engine (D-pad navigation)
 *   InputProvider   - keyboard + gamepad -> focus engine actions
 *   Shell           - background, nav bar, hero, active screen, overlays
 *
 * The ordering matters: InputProvider needs both the focus engine and sounds, so it sits inside
 * both; the focus engine needs no theme, but sound does, so the theme is outermost.
 */

import { Shell } from '@/components/Shell';
import { FocusProvider } from '@/focus';
import { InputProvider } from '@/input';
import { SoundProvider } from '@/sound';
import { ThemeProvider } from '@/theme';

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <SoundProvider>
        <FocusProvider>
          <InputProvider>
            <Shell />
          </InputProvider>
        </FocusProvider>
      </SoundProvider>
    </ThemeProvider>
  );
}
