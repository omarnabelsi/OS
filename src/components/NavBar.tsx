/**
 * The top nav bar. Each item is focusable, so a D-pad walks it exactly like a tile row, and the
 * theme styles the focus state through `.aura-nav-item[data-focused]`.
 */

import { motion } from 'framer-motion';

import { useFocusable } from '@/focus';
import { useSound } from '@/sound';
import { NAV_ITEMS, useLibraryStore, useUiStore, type NavItem } from '@/store';
import { useWmStore } from '@/wm';

import { Icon, type IconName } from './Icon';

/**
 * Open the Settings app. One window, ever: `open` raises the existing one rather than stacking
 * a second, the same rule folders follow.
 */
export function openSettingsWindow(): void {
  useWmStore.getState().open({
    kind: 'settings',
    targetId: null,
    title: 'Settings',
    icon: 'settings',
    size: { width: 760, height: 560 },
  });
}

function NavButton({ item }: { item: NavItem }): React.JSX.Element {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  // A window item is "active" while its window is open - the nav bar should not claim a screen
  // is showing when what is showing is a window.
  const windowOpen = useWmStore((s) => s.windows.some((w) => w.kind === item.id));
  const play = useSound();

  const active = item.opens === 'window' ? windowOpen : screen === item.id;
  const { ref, props } = useFocusable({
    id: `nav:${item.id}`,
    group: 'nav',
    onActivate: () => {
      play('select');
      if (item.opens === 'window') {
        // Windows live on the desktop, so go there first - otherwise Settings would open over
        // the Games screen and look like part of it.
        setScreen('home');
        openSettingsWindow();
        return;
      }
      setScreen(item.id);
    },
  });

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-nav-item"
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      <Icon name={item.icon as IconName} size="1.25em" />
      <span>{item.label}</span>
    </button>
  );
}

/** A quiet, non-blocking indicator while a store scan runs in the background. */
function ScanIndicator(): React.JSX.Element | null {
  const scan = useLibraryStore((s) => s.scan);
  if (!scan) return null;

  const label =
    scan.message ??
    { queued: 'Preparing', discovering: 'Looking for games', parsing: 'Reading', saving: 'Saving', done: 'Done', error: 'Scan failed' }[
      scan.stage
    ];

  return (
    <div className="aura-scan" role="status">
      <motion.span
        className="aura-scan-dot"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span>
        {label}
        {scan.found > 0 ? ` · ${scan.found} found` : ''}
      </span>
    </div>
  );
}

export function NavBar(): React.JSX.Element {
  return (
    <header className="aura-nav">
      <nav className="aura-nav-items">
        {NAV_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} />
        ))}
      </nav>
      <ScanIndicator />
    </header>
  );
}
