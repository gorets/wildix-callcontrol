export const DIALOG_EVENT_PACKAGE = 'dialog';
export const REG_EVENT_PACKAGE = 'reg';
export const ACTIVE_DEVICE_EVENT_PACKAGE = 'active-device';
export const TAPI_EVENT_PACKAGE = 'wildixtsp/action';

export const SUBSCRIPTION_EXPIRES_SECONDS = 3600;
export const TAPI_PUBLISH_EXPIRES_SECONDS = 1;

export const DEFAULT_USER_AGENT = 'callcontrol';

export const RESUBSCRIBE_MIN_DELAY_MS = 3000;
export const RESUBSCRIBE_MAX_DELAY_MS = 30000;
export const RESUBSCRIBE_STEPS = 5;

export const WILDIX_PARAMS = {
  STATE: 'X-Wildix-state',
  CUSTOM: 'X-Wildix-custom',
  TAGS: 'X-Wildix-tags',
} as const;

export const SYSTEM_USER_AGENT_MARKERS = ['wildixgw', 'wildix tapi'];
