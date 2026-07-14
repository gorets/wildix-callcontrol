import { CallControl } from '../src/index';

describe('package public API', () => {
  test('exports the CallControl class', () => {
    expect(typeof CallControl).toBe('function');
    expect(CallControl.name).toBe('CallControl');
  });
});
