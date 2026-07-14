import { parseActiveDeviceXml } from '../../src/xml/activeDeviceParser';

const ACTIVE_DEVICE_XML = `<?xml version="1.0"?>
<active-device xmlns="urn:ietf:params:xml:ns:active-device" version="0" state="full">
  <user-agent>Wildix Zero Distance 4.0.1 WebRTC-8f36c349-8fb2-4320-9c72-8fbf620a0e31</user-agent>
  <contact>sip:147@80.245.92.51:53573;transport=ws</contact>
  <type>device</type>
</active-device>`;

const EMPTY_ACTIVE_DEVICE_XML = `<?xml version="1.0"?>
<active-device xmlns="urn:ietf:params:xml:ns:active-device" version="1" state="full"></active-device>`;

describe('parseActiveDeviceXml', () => {
  test('parses type, user-agent, and contact', () => {
    expect(parseActiveDeviceXml(ACTIVE_DEVICE_XML)).toEqual({
      type: 'device',
      userAgent: 'Wildix Zero Distance 4.0.1 WebRTC-8f36c349-8fb2-4320-9c72-8fbf620a0e31',
      contactUri: 'sip:147@80.245.92.51:53573;transport=ws',
    });
  });

  test('returns null when there is no <type>', () => {
    expect(parseActiveDeviceXml(EMPTY_ACTIVE_DEVICE_XML)).toBeNull();
  });
});
