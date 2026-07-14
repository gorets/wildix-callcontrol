import { ActiveDeviceStateTracker } from '../../src/state/activeDeviceState';

describe('ActiveDeviceStateTracker', () => {
  test('the first known type is reported as changed', () => {
    const tracker = new ActiveDeviceStateTracker();
    const diff = tracker.apply({ type: 'device', userAgent: 'Some Phone', contactUri: 'sip:1@host' });

    expect(diff.changed).toBe(true);
    expect(diff.activeDevice).toEqual({ type: 'device', userAgent: 'Some Phone', contactUri: 'sip:1@host' });
    expect(tracker.getActiveDevice()).toEqual(diff.activeDevice);
  });

  test('an unrecognized type is normalized to "unknown"', () => {
    const tracker = new ActiveDeviceStateTracker();
    const diff = tracker.apply({ type: 'something-new' });

    expect(diff.activeDevice).toEqual({ type: 'unknown', userAgent: undefined, contactUri: undefined });
  });

  test('applying an identical value again is reported as unchanged', () => {
    const tracker = new ActiveDeviceStateTracker();
    tracker.apply({ type: 'any_device' });

    const diff = tracker.apply({ type: 'any_device' });

    expect(diff.changed).toBe(false);
  });

  test('a null parsed value clears the tracked active device', () => {
    const tracker = new ActiveDeviceStateTracker();
    tracker.apply({ type: 'mobility' });

    const diff = tracker.apply(null);

    expect(diff.changed).toBe(true);
    expect(diff.activeDevice).toBeUndefined();
    expect(tracker.getActiveDevice()).toBeUndefined();
  });
});
