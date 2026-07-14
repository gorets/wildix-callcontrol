import { CallStateTracker } from '../../src/state/callState';
import type { ParsedDialog } from '../../src/xml/dialogInfoParser';

function ringingDialog(overrides: Partial<ParsedDialog> = {}): ParsedDialog {
  return {
    id: 'call-1',
    direction: 'inbound',
    rawState: 'early',
    hold: false,
    remoteName: 'Vladimir',
    remoteNumber: '+380501122334',
    tags: undefined,
    ...overrides,
  };
}

describe('CallStateTracker', () => {
  test('a new dialog produces a started Call and appears in getActiveCalls()', () => {
    const tracker = new CallStateTracker();
    const diff = tracker.apply([ringingDialog()]);

    expect(diff.started).toEqual([
      {
        id: 'call-1',
        direction: 'inbound',
        state: 'ringing',
        remoteNumber: '+380501122334',
        remoteName: 'Vladimir',
        tags: undefined,
      },
    ]);
    expect(diff.updated).toEqual([]);
    expect(diff.ended).toEqual([]);
    expect(tracker.getActiveCalls()).toHaveLength(1);
  });

  test('a state change on an existing dialog produces an updated Call, not a new started Call', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog()]);

    const diff = tracker.apply([ringingDialog({ rawState: 'confirmed' })]);

    expect(diff.started).toEqual([]);
    expect(diff.updated).toEqual([
      {
        id: 'call-1',
        direction: 'inbound',
        state: 'answered',
        remoteNumber: '+380501122334',
        remoteName: 'Vladimir',
        tags: undefined,
      },
    ]);
  });

  test('the note "On hold" maps a confirmed dialog to the held state', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog({ rawState: 'confirmed' })]);

    const diff = tracker.apply([ringingDialog({ rawState: 'confirmed', hold: true })]);

    expect(diff.updated[0].state).toBe('held');
  });

  test('applying the exact same dialog twice produces no update', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog()]);

    const diff = tracker.apply([ringingDialog()]);

    expect(diff.started).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test('a dialog reaching the terminated state produces callEnd using its last known-good fields, not the (possibly degraded) terminated payload', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog()]);

    // Real Wildix NOTIFYs strip display name / sip: scheme on the terminated payload.
    const diff = tracker.apply([
      ringingDialog({ rawState: 'terminated', remoteName: undefined, remoteNumber: '380501122334' }),
    ]);

    expect(diff.ended).toEqual([
      {
        id: 'call-1',
        direction: 'inbound',
        state: 'ended',
        remoteNumber: '+380501122334',
        remoteName: 'Vladimir',
        tags: undefined,
      },
    ]);
    expect(tracker.getActiveCalls()).toHaveLength(0);
  });

  test('a dialog reaching the terminated state with a reason attribute surfaces it as endReason', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog({ rawState: 'confirmed' })]);

    const diff = tracker.apply([ringingDialog({ rawState: 'terminated', rawStateReason: 'cancelled' })]);

    expect(diff.ended).toHaveLength(1);
    expect(diff.ended[0].endReason).toBe('cancelled');
  });

  test('a dialog disappearing entirely from the NOTIFY body also produces callEnd using its last known state', () => {
    const tracker = new CallStateTracker();
    tracker.apply([ringingDialog({ rawState: 'confirmed' })]);

    const diff = tracker.apply([]);

    expect(diff.ended).toEqual([
      {
        id: 'call-1',
        direction: 'inbound',
        state: 'ended',
        remoteNumber: '+380501122334',
        remoteName: 'Vladimir',
        tags: undefined,
      },
    ]);
    expect(tracker.getActiveCalls()).toHaveLength(0);
  });

  test('a dialog that is terminated the very first time it is seen produces no event', () => {
    const tracker = new CallStateTracker();
    const diff = tracker.apply([ringingDialog({ rawState: 'terminated' })]);

    expect(diff.started).toEqual([]);
    expect(diff.ended).toEqual([]);
  });
});
