/**
 * The shell's own title bar - drawn only while the shell is windowed.
 *
 * Fullscreen is the default and has no chrome at all. This appears when the user has chosen a
 * window (Settings -> Fullscreen off, F11, or `--windowed`), because a borderless window with no
 * bar cannot otherwise be moved, minimised or closed with a mouse.
 *
 * - The bar is a Tauri drag region, so the OS moves the window by it and a double-click toggles
 *   maximise. Only the bar and its label carry the attribute: a drag region swallows presses on
 *   whatever carries it, so the buttons must not.
 * - Maximise is the windowed maximise, never fullscreen - the two do not share a button.
 * - Close opens the same exit confirmation as Settings. A stray click must not end the shell.
 * - Every button is a focusable in the `titlebar` group, so a D-pad reaches it (Up from the nav
 *   bar) rather than only a mouse.
 */

import { useEffect } from 'react';

import { api } from '@/bridge';
import { useFocusable } from '@/focus';
import { useUiStore } from '@/store';
import { toggleShellMaximize, useShellWindow } from '@/store/shellWindow';

/** How long the window must stop resizing before its state is re-read. */
const SETTLE_MS = 120;

export function ShellTitleBar(): React.JSX.Element | null {
  const state = useShellWindow((s) => s.state);
  const refresh = useShellWindow((s) => s.refresh);
  const setOverlay = useUiStore((s) => s.setOverlay);

  /*
   * Re-read on resize. Every change that matters here - fullscreen in or out, maximise, restore,
   * a double-click on the drag region, Win+Up - resizes the webview, so this catches the ones
   * the UI did not start itself without the host having to push an event.
   */
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), SETTLE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [refresh]);

  // Unknown until the first answer: draw nothing rather than flash a bar over a fullscreen shell.
  if (!state || state.fullscreen) return null;

  return (
    <header className="aura-titlebar" data-tauri-drag-region>
      <span className="aura-titlebar-name aura-type-window-title" data-tauri-drag-region>
        Aura Shell
      </span>
      <div className="aura-titlebar-controls">
        <TitleButton id="minimise" label="Minimise" onActivate={() => void api.minimizeShell()}>
          &#x2013;
        </TitleButton>
        <TitleButton
          id="maximise"
          label={state.maximized ? 'Restore' : 'Maximise'}
          onActivate={() => void toggleShellMaximize()}
        >
          {state.maximized ? '❐' : '□'}
        </TitleButton>
        <TitleButton id="close" label="Close" danger onActivate={() => setOverlay('exit')}>
          &#x2715;
        </TitleButton>
      </div>
    </header>
  );
}

function TitleButton({
  id,
  label,
  danger,
  onActivate,
  children,
}: {
  id: string;
  label: string;
  danger?: boolean;
  onActivate(): void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { ref, props } = useFocusable({ id: `titlebar:${id}`, group: 'titlebar', onActivate });
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-titlebar-control"
      data-danger={danger || undefined}
      aria-label={label}
      title={label}
      {...props}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
