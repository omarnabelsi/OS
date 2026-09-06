/**
 * Screen routing. There is no URL router: the shell is a single surface and `useUiStore.screen`
 * is the whole navigation model.
 */

import { Icon, type IconName } from '@/components/Icon';
import { useUiStore, type ScreenId } from '@/store';

import { HomeScreen } from './HomeScreen';
import { LibraryScreen } from './LibraryScreen';
import { SettingsScreen } from './SettingsScreen';

/**
 * Files and Media are V2 by design (see docs/PLAN.md section 05): V1 is a launcher, not a file
 * manager. Saying so plainly beats shipping a half-working browser.
 */
function ComingSoonScreen({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="aura-empty">
      <Icon name={icon} size="2.6em" />
      <h2>{title}</h2>
      <p>{children}</p>
      <p className="aura-empty-tag">Planned for V2</p>
    </div>
  );
}

export function Screen(): React.JSX.Element {
  const screen = useUiStore((s) => s.screen);

  switch (screen satisfies ScreenId) {
    case 'home':
      return <HomeScreen />;
    case 'games':
      return (
        <LibraryScreen
          type="game"
          title="Games"
          emptyMessage="Run a scan to pull in your Steam library, or add a game by hand."
        />
      );
    case 'apps':
      return (
        <LibraryScreen
          type="app"
          title="Apps"
          emptyMessage="Add any program you want to reach from the sofa."
        />
      );
    case 'files':
      return (
        <ComingSoonScreen icon="files" title="Files">
          A gamepad-friendly file browser with skinnable folders, backed by the real Windows copy
          and delete operations.
        </ComingSoonScreen>
      );
    case 'media':
      return (
        <ComingSoonScreen icon="media" title="Media">
          Video and music playback, plus wallpaper management for the animated backgrounds.
        </ComingSoonScreen>
      );
    case 'settings':
      return <SettingsScreen />;
  }
}

export { HomeScreen } from './HomeScreen';
export { LibraryScreen } from './LibraryScreen';
export { SettingsScreen } from './SettingsScreen';
