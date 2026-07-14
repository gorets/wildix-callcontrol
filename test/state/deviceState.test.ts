import { DeviceStateTracker } from '../../src/state/deviceState';
import type { ParsedDevice } from '../../src/xml/registrationInfoParser';

const WEB_DEVICE: ParsedDevice = {
  uri: 'sip:10090@4e73kbfe3ms6.invalid;transport=ws',
  userAgent: 'x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b',
  isLocalRegistration: true,
};

describe('DeviceStateTracker', () => {
  test('the first non-empty device list is reported as changed', () => {
    const tracker = new DeviceStateTracker();
    const diff = tracker.apply([WEB_DEVICE]);

    expect(diff.changed).toBe(true);
    expect(diff.devices).toEqual([
      {
        uri: WEB_DEVICE.uri,
        userAgent: WEB_DEVICE.userAgent,
        deviceName: 'x-bees Web',
        isLocalRegistration: true,
      },
    ]);
    expect(tracker.getDevices()).toEqual(diff.devices);
  });

  test('applying the exact same device list again is reported as unchanged', () => {
    const tracker = new DeviceStateTracker();
    tracker.apply([WEB_DEVICE]);

    const diff = tracker.apply([WEB_DEVICE]);

    expect(diff.changed).toBe(false);
  });

  test('a different set of devices is reported as changed, regardless of array order', () => {
    const mobileDevice: ParsedDevice = {
      uri: 'sip:10090@another-host.invalid;transport=ws',
      userAgent: 'x-bees Android',
      isLocalRegistration: false,
    };
    const tracker = new DeviceStateTracker();
    tracker.apply([WEB_DEVICE, mobileDevice]);

    const diff = tracker.apply([mobileDevice, WEB_DEVICE]);

    expect(diff.changed).toBe(false);
  });

  test('an empty device list after a non-empty one is reported as changed', () => {
    const tracker = new DeviceStateTracker();
    tracker.apply([WEB_DEVICE]);

    const diff = tracker.apply([]);

    expect(diff.changed).toBe(true);
    expect(diff.devices).toEqual([]);
  });
});
