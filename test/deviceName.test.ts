import { deriveDeviceName } from '../src/deviceName';

describe('deriveDeviceName', () => {
  test('strips version numbers and a trailing UUID', () => {
    expect(deriveDeviceName('x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b')).toBe('x-bees Web');
  });

  test('strips a UUID glued onto the preceding token without a space', () => {
    expect(deriveDeviceName('Wildix Zero Distance 4.0.1 WebRTC-8f36c349-8fb2-4320-9c72-8fbf620a0e31')).toBe(
      'Wildix Zero Distance WebRTC',
    );
  });

  test('returns the raw value unchanged when there is nothing to strip', () => {
    expect(deriveDeviceName('SomeDevice')).toBe('SomeDevice');
  });

  test('falls back to the raw value when every token looks like a version or UUID', () => {
    expect(deriveDeviceName('1.2.3')).toBe('1.2.3');
  });

  test('returns a placeholder for an empty User-Agent', () => {
    expect(deriveDeviceName('')).toBe('Unknown device');
  });
});
