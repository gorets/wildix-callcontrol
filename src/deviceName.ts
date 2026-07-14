const VERSION_LIKE = /^\d+(\.\d+)*$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Some clients (e.g. the "Wildix Zero Distance" WebRTC UA) glue the instance
// UUID directly onto the preceding token instead of space-separating it, e.g.
// "WebRTC-8f36c349-8fb2-4320-9c72-8fbf620a0e31" — strip that suffix so the
// per-registration UUID doesn't leak into (and destabilize) the device name.
const TRAILING_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deriveDeviceName(userAgent: string): string {
  if (!userAgent) {
    return 'Unknown device';
  }

  const meaningfulTokens = userAgent
    .split(' ')
    .map((token) => token.replace(TRAILING_UUID_SUFFIX, ''))
    .filter((token) => token.length > 0 && !VERSION_LIKE.test(token) && !UUID_LIKE.test(token));

  return meaningfulTokens.length > 0 ? meaningfulTokens.join(' ') : userAgent;
}

/**
 * Known Wildix client `deviceName` values — what `deriveDeviceName` produces
 * for each client's raw User-Agent, as observed via live PBX testing. Not
 * documented anywhere by sip.js or the PBX; discovered empirically. Useful
 * for a UI that wants to pick a default device or label device types without
 * hardcoding/guessing the exact strings itself.
 */
export const KNOWN_DEVICE_NAMES = {
  X_BEES_WEB: 'x-bees Web',
  COLLABORATION_WEB: 'Collaboration Web',
  X_HOPPERS_WEB: 'x-hoppers Web',
  /** The old Collaboration 6 client's WebRTC device. */
  COLLABORATION_OLD: 'Wildix Zero Distance WebRTC',
} as const;
