/**
 * The built-in icon set, drawn inline so icons inherit `currentColor` and scale with the UI.
 *
 * Names match the SVGs in a theme package's `assets/icons/`, which stay the reference art for
 * theme authors and for future per-theme icon overrides. Drawing them inline here means the
 * shell never waits on a file read to paint its chrome, and the same code path works in the
 * browser mock and in the packaged app.
 */

export type IconName =
  | 'home'
  | 'games'
  | 'apps'
  | 'files'
  | 'media'
  | 'settings'
  | 'play'
  | 'star'
  | 'search'
  | 'plus'
  | 'check'
  | 'back'
  | 'hidden'
  | 'image'
  | 'trash'
  | 'list'
  | 'clock'
  | 'battery'
  | 'pin'
  | 'palette'
  | 'folder'
  | 'desktop';

const PATHS: Record<IconName, React.JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  games: (
    <>
      <path d="M7 12h4M9 10v4" />
      <circle cx="16" cy="11" r="1" />
      <circle cx="18.5" cy="13.5" r="1" />
      <path d="M6.5 6.5h11a3.5 3.5 0 0 1 3.4 2.7l1 5a3.5 3.5 0 0 1-6.2 2.9l-.8-1H9.1l-.8 1a3.5 3.5 0 0 1-6.2-2.9l1-5A3.5 3.5 0 0 1 6.5 6.5Z" />
    </>
  ),
  apps: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  files: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.5h7.8A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />,
  media: (
    <>
      <rect x="2.5" y="4.5" width="19" height="13" rx="2.5" />
      <path d="M10 8.5v5l4.5-2.5zM7.5 21h9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5z" />,
  star: <path d="m12 3.5 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 20l1.03-6L3.3 9.9l6-.9z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  hidden: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.3A9.6 9.6 0 0 1 12 6.2c5 0 9 5.8 9 5.8a17 17 0 0 1-3 3.5M6.2 8.3A17.6 17.6 0 0 0 3 12s4 5.8 9 5.8a8.5 8.5 0 0 0 3.3-.7" />
      <path d="M9.9 10.2a3 3 0 0 0 4 4.1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 5-5 4.5 4.5L16.5 14l3.5 3.5" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5M10.5 10.5v6M13.5 10.5v6" />,
  list: <path d="M4 6.5h.01M4 12h.01M4 17.5h.01M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  battery: (
    <>
      <rect x="2.5" y="8" width="16" height="8" rx="2.2" />
      <path d="M21 11v2" />
    </>
  ),
  pin: <path d="M9 3.5h6l-.8 5.2 3.3 3.1H6.5l3.3-3.1zM12 11.8V20.5" />,
  palette: (
    <>
      <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.3 0 1.9-.9 1.9-1.8 0-1.3-1.1-1.6-1.1-2.7 0-.8.7-1.5 1.6-1.5h1.4A4.4 4.4 0 0 0 20.8 10c0-3.8-3.9-6.8-8.8-6.8Z" />
      <circle cx="8" cy="9.5" r="1.1" />
      <circle cx="12" cy="7.5" r="1.1" />
      <circle cx="16" cy="9.8" r="1.1" />
    </>
  ),
  folder: <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h3.4l2 2.4h8.2A2.2 2.2 0 0 1 21 9.6v7.2a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 16.8Z" />,
  desktop: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2.2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number | string;
  /** Solid shapes (play, star) read better filled than stroked. */
  filled?: boolean;
  className?: string;
  title?: string;
}

const FILLED_BY_DEFAULT: ReadonlySet<IconName> = new Set<IconName>(['play', 'star']);

export function Icon({ name, size = '1em', filled, className, title }: IconProps): React.JSX.Element {
  const solid = filled ?? FILLED_BY_DEFAULT.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
