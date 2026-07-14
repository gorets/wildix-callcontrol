import { deriveDeviceName } from '../deviceName';
import type { Device } from '../types';
import type { ParsedDevice } from '../xml/registrationInfoParser';

export interface DeviceStateDiff {
  changed: boolean;
  devices: Device[];
}

function toDevice(parsed: ParsedDevice): Device {
  return {
    uri: parsed.uri,
    userAgent: parsed.userAgent,
    deviceName: deriveDeviceName(parsed.userAgent),
    isLocalRegistration: parsed.isLocalRegistration,
  };
}

function devicesEqual(a: Device[], b: Device[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort((x, y) => x.uri.localeCompare(y.uri));
  const sortedB = [...b].sort((x, y) => x.uri.localeCompare(y.uri));
  return sortedA.every((device, index) => JSON.stringify(device) === JSON.stringify(sortedB[index]));
}

export class DeviceStateTracker {
  private devices: Device[] = [];

  apply(parsedDevices: ParsedDevice[]): DeviceStateDiff {
    const nextDevices = parsedDevices.map(toDevice);
    const changed = !devicesEqual(this.devices, nextDevices);
    this.devices = nextDevices;
    return { changed, devices: nextDevices };
  }

  getDevices(): Device[] {
    return this.devices;
  }
}
