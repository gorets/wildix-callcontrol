import type { Presence } from '../types';
import type { ParsedPresence } from '../xml/dialogInfoParser';

export interface PresenceStateDiff {
  changed: boolean;
  presence: Presence | undefined;
}

function presenceEqual(a: Presence | undefined, b: Presence | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export class PresenceStateTracker {
  private presence: Presence | undefined;

  apply(parsedPresence: ParsedPresence | null): PresenceStateDiff {
    const nextPresence: Presence | undefined = parsedPresence ? { ...parsedPresence } : undefined;
    const changed = !presenceEqual(this.presence, nextPresence);
    this.presence = nextPresence;
    return { changed, presence: nextPresence };
  }

  getPresence(): Presence | undefined {
    return this.presence;
  }
}
