/**
 * The clock widget's style settings: 12h/24h, seconds, and the date line.
 *
 * All three default to exactly what the widget did before they existed, so the only thing worth
 * proving here is what changes when a setting is turned on - not the whole formatting pipeline,
 * which `shellStatus.ts` already covers.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/bridge', async () => {
  const helpers = await import('@/store/test-helpers');
  return helpers.fakeBridgeModule();
});

const { baseSettings, fakeApi, resetFakeApi } = await import('@/store/test-helpers');
const { useLibraryStore, useSettingsStore } = await import('@/store');
const { ClockWidget } = await import('./ClockWidget');

// 13:05:09 UTC, reported with no offset - one o'clock in the afternoon, an hour that reads
// differently in 12h and 24h.
const EPOCH = Date.UTC(2026, 8, 12, 13, 5, 9);

beforeEach(() => {
  resetFakeApi();
  useSettingsStore.setState({ settings: { ...baseSettings } });
  useLibraryStore.setState({ items: [], byId: {} });
  fakeApi.getSystemStatus.mockResolvedValue({
    batteryPercent: null,
    charging: false,
    hasBattery: false,
    epochMs: EPOCH,
    utcOffsetMinutes: 0,
  });
  fakeApi.activeSessions.mockResolvedValue([]);
});

describe('ClockWidget', () => {
  it("leaves the hour in the locale's own convention by default", async () => {
    render(<ClockWidget />);
    // en-US (the test environment's default locale) reads 13:00 as "1:05 PM" left alone.
    expect(await screen.findByText(/1:05/)).toBeDefined();
    expect(screen.queryByText(/13:05/)).toBeNull();
  });

  it('forces 24-hour time when asked, in the same locale', async () => {
    useSettingsStore.setState({ settings: { ...baseSettings, clockUse24Hour: true } });
    render(<ClockWidget />);
    expect(await screen.findByText(/13:05/)).toBeDefined();
  });

  it('adds seconds only when asked', async () => {
    const { rerender } = render(<ClockWidget />);
    await screen.findByText(/1:05/);
    expect(screen.queryByText(/:09/)).toBeNull();

    useSettingsStore.setState({ settings: { ...baseSettings, clockShowSeconds: true } });
    rerender(<ClockWidget />);
    expect(await screen.findByText(/:09/)).toBeDefined();
  });

  it('hides the date line when asked', async () => {
    const { container, rerender } = render(<ClockWidget />);
    await screen.findByText(/1:05/);
    expect(container.querySelector('.aura-widget-clock-date')).not.toBeNull();

    useSettingsStore.setState({ settings: { ...baseSettings, clockShowDate: false } });
    rerender(<ClockWidget />);
    expect(container.querySelector('.aura-widget-clock-date')).toBeNull();
  });
});
