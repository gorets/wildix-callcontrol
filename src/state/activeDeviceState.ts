import type { ActiveDevice, ActiveDeviceType } from '../types';
import type { ParsedActiveDevice } from '../xml/activeDeviceParser';

export interface ActiveDeviceStateDiff {
  changed: boolean;
  activeDevice: ActiveDevice | undefined;
}

const KNOWN_TYPES: ActiveDeviceType[] = ['device', 'any_device', 'mobility'];

function toActiveDevice(parsed: ParsedActiveDevice): ActiveDevice {
  const type: ActiveDeviceType = (KNOWN_TYPES as string[]).includes(parsed.type)
    ? (parsed.type as ActiveDeviceType)
    : 'unknown';
  return { type, contactUri: parsed.contactUri, userAgent: parsed.userAgent };
}

function activeDeviceEqual(a: ActiveDevice | undefined, b: ActiveDevice | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export class ActiveDeviceStateTracker {
  private activeDevice: ActiveDevice | undefined;

  apply(parsed: ParsedActiveDevice | null): ActiveDeviceStateDiff {
    const next: ActiveDevice | undefined = parsed ? toActiveDevice(parsed) : undefined;
    const changed = !activeDeviceEqual(this.activeDevice, next);
    this.activeDevice = next;
    return { changed, activeDevice: next };
  }

  getActiveDevice(): ActiveDevice | undefined {
    return this.activeDevice;
  }
}
