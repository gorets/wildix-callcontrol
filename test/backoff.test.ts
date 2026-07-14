import { getResubscribeDelayMs } from '../src/backoff';

describe('getResubscribeDelayMs', () => {
  test('returns the minimum delay on the first attempt', () => {
    expect(getResubscribeDelayMs(1)).toBe(3000);
  });

  test('returns the maximum delay on the final step', () => {
    expect(getResubscribeDelayMs(5)).toBe(30000);
  });

  test('clamps attempts beyond the final step to the maximum delay', () => {
    expect(getResubscribeDelayMs(6)).toBe(30000);
    expect(getResubscribeDelayMs(100)).toBe(30000);
  });

  test('clamps attempts below 1 to the minimum delay', () => {
    expect(getResubscribeDelayMs(0)).toBe(3000);
    expect(getResubscribeDelayMs(-5)).toBe(3000);
  });

  test('grows non-linearly between the min and max steps', () => {
    expect(getResubscribeDelayMs(3)).toBe(9750);
  });
});
