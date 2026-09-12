import { describe, expect, it } from 'vitest';

import { actionForKey } from './actions';

describe('F11', () => {
  it('toggles fullscreen', () => {
    expect(actionForKey({ key: 'F11' })).toBe('toggleFullscreen');
  });

  it('is left alone with Ctrl, Alt or the Windows key held', () => {
    expect(actionForKey({ key: 'F11', ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: 'F11', altKey: true })).toBeNull();
    expect(actionForKey({ key: 'F11', metaKey: true })).toBeNull();
  });
});
