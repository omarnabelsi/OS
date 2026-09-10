/**
 * Toasts and the modal overlays.
 *
 * Every overlay scopes the focus engine to its own group while open, so a D-pad cannot wander
 * back onto the tiles behind it, and restores the previous scope on close.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';

import { api } from '@/bridge';
import type { EntryType } from '@/bridge';
import { useFocus, useFocusable } from '@/focus';
import { useSound } from '@/sound';
import { useLibraryStore, useUiStore, type OverlayId } from '@/store';

import { Icon, type IconName } from './Icon';

// ---- toasts ------------------------------------------------------------------------------------

export function Toasts(): React.JSX.Element {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  return (
    <div className="aura-toasts" role="log" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            className="aura-toast"
            data-level={toast.level}
            onClick={() => dismiss(toast.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            {toast.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---- shared overlay chrome ----------------------------------------------------------------------

interface OverlayProps {
  id: Exclude<OverlayId, null>;
  title: string;
  children: ReactNode;
}

function Overlay({ id, title, children }: OverlayProps): React.JSX.Element {
  const setOverlay = useUiStore((s) => s.setOverlay);
  const { setScope } = useFocus();

  // Trap navigation inside the overlay for as long as it is open.
  useEffect(() => {
    setScope(`overlay:${id}`);
    return () => setScope(null);
  }, [id, setScope]);

  return (
    <motion.div
      className="aura-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOverlay(null);
      }}
    >
      <motion.div
        className="aura-panel"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.05, 0.7, 0.1, 1] }}
      >
        <h2 className="aura-panel-title">{title}</h2>
        {children}
      </motion.div>
    </motion.div>
  );
}

interface PanelButtonProps {
  overlayId: string;
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  /** Marks the current choice when the button is one of a set (see the Add overlay's kind picker). */
  selected?: boolean;
  onActivate(): void;
}

function PanelButton({
  overlayId,
  id,
  label,
  icon,
  danger,
  selected,
  onActivate,
}: PanelButtonProps): React.JSX.Element {
  const { ref, props } = useFocusable({
    id: `${overlayId}:${id}`,
    group: `overlay:${overlayId}`,
    onActivate,
  });

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      className="aura-panel-button"
      data-danger={danger || undefined}
      data-selected={selected || undefined}
      aria-pressed={selected === undefined ? undefined : selected}
      {...props}
    >
      {icon ? <Icon name={icon} size="1.1em" /> : null}
      <span>{label}</span>
    </button>
  );
}

// ---- exit ---------------------------------------------------------------------------------------

function ExitOverlay(): React.JSX.Element {
  const setOverlay = useUiStore((s) => s.setOverlay);

  return (
    <Overlay id="exit" title="Leave Aura Shell?">
      <p className="aura-panel-text">
        Windows keeps running underneath. You can start Aura Shell again at any time.
      </p>
      <div className="aura-panel-actions">
        <PanelButton
          overlayId="exit"
          id="cancel"
          label="Stay"
          icon="back"
          onActivate={() => setOverlay(null)}
        />
        <PanelButton
          overlayId="exit"
          id="confirm"
          label="Exit to Windows"
          danger
          onActivate={() => void api.exitShell()}
        />
      </div>
    </Overlay>
  );
}

// ---- item menu ----------------------------------------------------------------------------------

function ItemMenuOverlay(): React.JSX.Element {
  const setOverlay = useUiStore((s) => s.setOverlay);
  const focusedId = useUiStore((s) => s.focusedItemId);
  const item = useLibraryStore((s) => (focusedId ? s.byId[focusedId] : undefined));
  const toggleFavourite = useLibraryStore((s) => s.toggleFavourite);
  const setHidden = useLibraryStore((s) => s.setHidden);
  const fetchArtwork = useLibraryStore((s) => s.fetchArtwork);
  const setArtwork = useLibraryStore((s) => s.setArtwork);
  const remove = useLibraryStore((s) => s.remove);
  const launch = useLibraryStore((s) => s.launch);
  const pushToast = useUiStore((s) => s.pushToast);

  if (!item) {
    return (
      <Overlay id="itemMenu" title="Nothing selected">
        <p className="aura-panel-text">Move to a tile first, then press the menu button.</p>
        <div className="aura-panel-actions">
          <PanelButton overlayId="itemMenu" id="close" label="Close" onActivate={() => setOverlay(null)} />
        </div>
      </Overlay>
    );
  }

  const close = () => setOverlay(null);

  return (
    <Overlay id="itemMenu" title={item.name}>
      <div className="aura-panel-list">
        <PanelButton
          overlayId="itemMenu"
          id="play"
          label="Play"
          icon="play"
          onActivate={() => {
            close();
            void launch(item.id);
          }}
        />
        <PanelButton
          overlayId="itemMenu"
          id="favourite"
          label={item.stats.favourite ? 'Remove from favourites' : 'Add to favourites'}
          icon="star"
          onActivate={() => void toggleFavourite(item.id)}
        />
        <PanelButton
          overlayId="itemMenu"
          id="artwork"
          label="Find artwork"
          icon="image"
          onActivate={() => {
            pushToast('info', `Looking for artwork for ${item.name}`);
            void fetchArtwork(item.id, true);
          }}
        />
        <PanelButton
          overlayId="itemMenu"
          id="choose-artwork"
          label="Choose artwork file"
          icon="image"
          onActivate={() => {
            void (async () => {
              const path = await api.pickFile('image');
              if (path) await setArtwork(item.id, 'grid', path);
            })();
          }}
        />
        <PanelButton
          overlayId="itemMenu"
          id="hide"
          label={item.stats.hidden ? 'Unhide' : 'Hide from library'}
          icon="hidden"
          onActivate={() => void setHidden(item.id, !item.stats.hidden)}
        />
        {item.source === 'manual' ? (
          <PanelButton
            overlayId="itemMenu"
            id="remove"
            label="Remove from library"
            icon="trash"
            danger
            onActivate={() => {
              close();
              void remove(item.id);
            }}
          />
        ) : null}
      </div>
      <div className="aura-panel-actions">
        <PanelButton overlayId="itemMenu" id="close" label="Close" icon="back" onActivate={close} />
      </div>
    </Overlay>
  );
}

// ---- add entry ----------------------------------------------------------------------------------

function AddEntryOverlay(): React.JSX.Element {
  const setOverlay = useUiStore((s) => s.setOverlay);
  const addManual = useLibraryStore((s) => s.addManual);
  const pushToast = useUiStore((s) => s.pushToast);
  // Whichever screen opened the overlay decides the default; the picker below lets the user
  // correct it, so an entry point that guesses wrong is never a dead end.
  const addEntryType = useUiStore((s) => s.addEntryType);
  const play = useSound();

  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<EntryType>(addEntryType === 'game' ? 'game' : 'app');

  const submit = async () => {
    if (!path.trim()) {
      play('error');
      pushToast('warning', 'Choose a program first');
      return;
    }
    const item = await addManual({ path: path.trim(), name: name.trim() || null, type });
    if (item) {
      play('select');
      pushToast('info', `Added ${item.name} to ${item.type === 'game' ? 'Games' : 'Apps'}`);
      setOverlay(null);
    }
  };

  return (
    <Overlay id="addEntry" title="Add a program">
      <p className="aura-panel-text">
        Pick any .exe, shortcut or batch file. Aura Shell launches it exactly as Windows would.
      </p>

      <label className="aura-field">
        <span>Program</span>
        <div className="aura-field-row">
          <input
            className="aura-input"
            value={path}
            placeholder="C:\Programs\Thing\thing.exe"
            onChange={(e) => setPath(e.target.value)}
          />
          <PanelButton
            overlayId="addEntry"
            id="browse"
            label="Browse"
            icon="files"
            onActivate={() => {
              void (async () => {
                const picked = await api.pickFile('exe');
                if (picked) setPath(picked);
              })();
            }}
          />
        </div>
      </label>

      <label className="aura-field">
        <span>Name (optional)</span>
        <input
          className="aura-input"
          value={name}
          placeholder="Taken from the file name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="aura-field">
        <span>Show it under</span>
        <div className="aura-field-choices">
          <PanelButton
            overlayId="addEntry"
            id="kind-game"
            label="Games"
            icon="games"
            selected={type === 'game'}
            onActivate={() => setType('game')}
          />
          <PanelButton
            overlayId="addEntry"
            id="kind-app"
            label="Apps"
            icon="apps"
            selected={type === 'app'}
            onActivate={() => setType('app')}
          />
        </div>
      </div>

      <div className="aura-panel-actions">
        <PanelButton
          overlayId="addEntry"
          id="cancel"
          label="Cancel"
          icon="back"
          onActivate={() => setOverlay(null)}
        />
        <PanelButton
          overlayId="addEntry"
          id="add"
          label="Add"
          icon="plus"
          onActivate={() => void submit()}
        />
      </div>
    </Overlay>
  );
}

// ---- launch curtain -------------------------------------------------------------------------------

/**
 * Shown while a title is starting. In the packaged app the host minimises the window a moment
 * later; this makes that handover feel deliberate rather than like a crash.
 */
function LaunchCurtain(): React.JSX.Element | null {
  const session = useLibraryStore((s) => s.session);
  const item = useLibraryStore((s) => (s.session ? s.byId[s.session.entryId] : undefined));
  const play = useSound();

  useEffect(() => {
    if (session) play('launch');
  }, [session, play]);

  if (!session) return null;

  return (
    <motion.div
      className="aura-overlay aura-launch"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        className="aura-launch-body"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.05, 0.7, 0.1, 1] }}
      >
        <Icon name="play" size="2.4em" />
        <h2>Starting {item?.name ?? 'your game'}</h2>
        <p>Aura Shell will step aside and come back when you are done.</p>
      </motion.div>
    </motion.div>
  );
}

// ---- root ----------------------------------------------------------------------------------------

export function Overlays(): React.JSX.Element {
  const overlay = useUiStore((s) => s.overlay);
  const session = useLibraryStore((s) => s.session);

  return (
    <>
      <AnimatePresence>
        {session ? <LaunchCurtain key="launch" /> : null}
        {!session && overlay === 'exit' ? <ExitOverlay key="exit" /> : null}
        {!session && overlay === 'itemMenu' ? <ItemMenuOverlay key="itemMenu" /> : null}
        {!session && overlay === 'addEntry' ? <AddEntryOverlay key="addEntry" /> : null}
      </AnimatePresence>
      <Toasts />
    </>
  );
}
