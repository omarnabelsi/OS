/**
 * React's view of the shared status poller. See `shellStatus.ts` for why it is a singleton.
 */

import { useSyncExternalStore } from 'react';

import { getShellStatus, subscribeShellStatus, type ShellStatus } from './shellStatus';

const EMPTY: ShellStatus = { status: null, epochMs: null, offsetMinutes: 0, sessions: [] };

export function useShellStatus(): ShellStatus {
  return useSyncExternalStore(subscribeShellStatus, getShellStatus, () => EMPTY);
}
