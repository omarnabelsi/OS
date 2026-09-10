/**
 * The Settings screen.
 *
 * A thin frame around `SettingsApp`, which is the same component the Settings *window* uses.
 * Every control and every category is defined once, in `components/settings/catalog.tsx`; two
 * copies of that JSX would have drifted within a release, and search would have had two lists
 * to keep in step.
 *
 * Kept as a screen as well as a window because the nav bar is the one route to settings that
 * needs no working desktop - if a theme or a stored layout ever renders the desktop unusable,
 * this is how the user gets back out.
 */

import { SettingsApp } from '@/components/settings/SettingsApp';

export { step } from '@/components/settings/catalog';

export function SettingsScreen(): React.JSX.Element {
  return (
    <div className="aura-screen aura-settings">
      <h2 className="aura-screen-title">Settings</h2>
      <SettingsApp group="content" variant="panes" />
    </div>
  );
}
