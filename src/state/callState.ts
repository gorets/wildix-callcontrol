import type { Call, CallState } from '../types';
import type { ParsedDialog } from '../xml/dialogInfoParser';

export interface CallStateDiff {
  started: Call[];
  updated: Call[];
  ended: Call[];
}

function toCallState(rawState: string | undefined, hold: boolean): CallState {
  if (rawState === 'confirmed') {
    return hold ? 'held' : 'answered';
  }
  if (rawState === 'terminated') {
    return 'ended';
  }
  return 'ringing';
}

function toCall(parsed: ParsedDialog): Call {
  return {
    id: parsed.id,
    direction: parsed.direction,
    state: toCallState(parsed.rawState, parsed.hold),
    remoteNumber: parsed.remoteNumber,
    remoteName: parsed.remoteName,
    tags: parsed.tags,
    endReason: parsed.rawStateReason,
  };
}

function callsEqual(a: Call, b: Call): boolean {
  return (
    a.state === b.state &&
    a.remoteNumber === b.remoteNumber &&
    a.remoteName === b.remoteName &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}

export class CallStateTracker {
  private calls = new Map<string, Call>();

  apply(parsedDialogs: ParsedDialog[]): CallStateDiff {
    const started: Call[] = [];
    const updated: Call[] = [];
    const ended: Call[] = [];
    const seenIds = new Set<string>();

    for (const parsed of parsedDialogs) {
      seenIds.add(parsed.id);
      const nextCall = toCall(parsed);

      if (nextCall.state === 'ended') {
        const existing = this.calls.get(parsed.id);
        if (existing) {
          // Built from the last known-good state (the terminated NOTIFY
          // itself can carry degraded identity fields — see design notes),
          // except endReason: that only ever appears on the terminated
          // NOTIFY, so it has to come from nextCall, not existing.
          ended.push({ ...existing, state: 'ended', endReason: nextCall.endReason });
          this.calls.delete(parsed.id);
        }
        continue;
      }

      const existing = this.calls.get(parsed.id);
      if (!existing) {
        started.push(nextCall);
        this.calls.set(parsed.id, nextCall);
      } else if (!callsEqual(existing, nextCall)) {
        updated.push(nextCall);
        this.calls.set(parsed.id, nextCall);
      }
    }

    for (const [id, call] of this.calls) {
      if (!seenIds.has(id)) {
        ended.push({ ...call, state: 'ended' });
        this.calls.delete(id);
      }
    }

    return { started, updated, ended };
  }

  getActiveCalls(): Call[] {
    return Array.from(this.calls.values());
  }
}
