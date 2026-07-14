import { parseRegistrationInfoXml } from '../../src/xml/registrationInfoParser';

// Attribute is user_agent (underscore) on the real wire, confirmed against a
// live captured NOTIFY — a prior version of this fixture (and the parser)
// wrongly assumed the RFC-3680-flavored "user-agent" (hyphen), which meant
// every real contact was silently dropped (getDevices() always empty).
const REGISTRATION_XML = `<?xml version="1.0"?>
<reginfo xmlns="urn:ietf:params:xml:ns:reginfo" version="0" state="full">
  <registration aor="sip:10090@pbx.example.com" id="a1" state="active">
    <contact id="c1" state="active" event="registered" expires="3556" callid="tr82sgp1tibeef092uv0" cseq="3" received="sip:127.0.0.1:35171;transport=ws" path="" user_agent="x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b">
      <uri>sip:10090@4e73kbfe3ms6.invalid;transport=ws</uri>
    </contact>
    <contact id="c2" state="active" event="registered" user_agent="Wildix TAPI">
      <uri>sip:10090@10.0.0.5:5060</uri>
    </contact>
    <contact id="c3" state="terminated" event="unregistered" user_agent="Old Desk Phone">
      <uri>sip:10090@10.0.0.9:5060</uri>
    </contact>
  </registration>
</reginfo>`;

describe('parseRegistrationInfoXml', () => {
  test('keeps only active, non-system contacts', () => {
    const devices = parseRegistrationInfoXml(REGISTRATION_XML, '4e73kbfe3ms6.invalid');

    expect(devices).toEqual([
      {
        uri: 'sip:10090@4e73kbfe3ms6.invalid;transport=ws',
        userAgent: 'x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b',
        isLocalRegistration: true,
      },
    ]);
  });

  test('flags isLocalRegistration false when the URI does not contain the local via-host', () => {
    const devices = parseRegistrationInfoXml(REGISTRATION_XML, 'some-other-host.invalid');
    expect(devices[0].isLocalRegistration).toBe(false);
  });

  test('returns an empty list for an empty registration body', () => {
    const emptyXml = `<?xml version="1.0"?><reginfo xmlns="urn:ietf:params:xml:ns:reginfo"></reginfo>`;
    expect(parseRegistrationInfoXml(emptyXml, 'host.invalid')).toEqual([]);
  });
});
