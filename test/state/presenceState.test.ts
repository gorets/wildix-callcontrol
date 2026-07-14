import { PresenceStateTracker } from '../../src/state/presenceState';

describe('PresenceStateTracker', () => {
  test('the first non-null presence is reported as changed', () => {
    const tracker = new PresenceStateTracker();
    const diff = tracker.apply({ status: 'online' });

    expect(diff.changed).toBe(true);
    expect(diff.presence).toEqual({ status: 'online' });
    expect(tracker.getPresence()).toEqual({ status: 'online' });
  });

  test('applying an identical presence again is reported as unchanged', () => {
    const tracker = new PresenceStateTracker();
    tracker.apply({ status: 'online' });

    const diff = tracker.apply({ status: 'online' });

    expect(diff.changed).toBe(false);
  });

  test('a different status is reported as changed', () => {
    const tracker = new PresenceStateTracker();
    tracker.apply({ status: 'online' });

    const diff = tracker.apply({ status: 'away' });

    expect(diff.changed).toBe(true);
    expect(diff.presence).toEqual({ status: 'away' });
  });

  test('a null parsed presence clears the tracked presence', () => {
    const tracker = new PresenceStateTracker();
    tracker.apply({ status: 'online' });

    const diff = tracker.apply(null);

    expect(diff.changed).toBe(true);
    expect(diff.presence).toBeUndefined();
    expect(tracker.getPresence()).toBeUndefined();
  });
});
