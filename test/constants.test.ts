import {
  DEFAULT_USER_AGENT,
  DIALOG_EVENT_PACKAGE,
  REG_EVENT_PACKAGE,
  SUBSCRIPTION_EXPIRES_SECONDS,
  SYSTEM_USER_AGENT_MARKERS,
  TAPI_EVENT_PACKAGE,
  TAPI_PUBLISH_EXPIRES_SECONDS,
  WILDIX_PARAMS,
} from '../src/constants';

describe('constants', () => {
  test('SIP event package names match the Wildix PBX wire format', () => {
    expect(DIALOG_EVENT_PACKAGE).toBe('dialog');
    expect(REG_EVENT_PACKAGE).toBe('reg');
    expect(TAPI_EVENT_PACKAGE).toBe('wildixtsp/action');
  });

  test('subscription and command expiry values', () => {
    expect(SUBSCRIPTION_EXPIRES_SECONDS).toBe(3600);
    expect(TAPI_PUBLISH_EXPIRES_SECONDS).toBe(1);
  });

  test('default User-Agent header value', () => {
    expect(DEFAULT_USER_AGENT).toBe('callcontrol');
  });

  test('Wildix dialog-info param names', () => {
    expect(WILDIX_PARAMS.STATE).toBe('X-Wildix-state');
    expect(WILDIX_PARAMS.CUSTOM).toBe('X-Wildix-custom');
    expect(WILDIX_PARAMS.TAGS).toBe('X-Wildix-tags');
  });

  test('system/gateway User-Agent markers used to filter the device list', () => {
    expect(SYSTEM_USER_AGENT_MARKERS).toEqual(['wildixgw', 'wildix tapi']);
  });
});
