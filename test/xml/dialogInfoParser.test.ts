import { parseDialogInfoXml } from '../../src/xml/dialogInfoParser';

const RINGING_DIALOG_XML = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="3" state="full" entity="sip:10090@your-pbx.wildixin.com">
  <dialog id="5c7fc34b345454777551139f6671c782" call-id="5c7fc34b345454777551139f6671c782" local-tag="as43ed18e9" remote-tag="0tu343i69f" remote-uri="sip:10090@127.0.0.1" local-uri="sip:+15555550123@127.0.0.1:6050" direction="recipient">
    <note>Ringing</note>
    <remote>
      <identity display="user10090">sip:10090@wildix</identity>
      <target uri="sip:pickup*10090@wildix">
        <param pname="X-Wildix-state" pval="Online"/>
        <param pname="X-Wildix-ua" pval="x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b"/>
        <param pname="X-Wildix-tags" pval=""/>
        <param pname="X-Wildix-custom" pval="eyJ1bnRpbFRpbWUiOiIiLCJtZXNzYWdlIjoiIiwibG9jYXRpb24iOiIifQ=="/>
        <param pname="X-Wildix-record" pval="off"/>
      </target>
    </remote>
    <local>
      <identity display="Jane Doe">sip:+15555550123@wildix</identity>
      <target uri="sip:+15555550123@wildix">
        <param pname="X-Wildix-type" pval="trunk"/>
        <param pname="X-Wildix-record" pval="system"/>
      </target>
    </local>
    <state>early</state>
  </dialog>
</dialog-info>`;

const TERMINATED_DIALOG_XML = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="4" state="full" entity="sip:10090@your-pbx.wildixin.com">
  <dialog id="5c7fc34b345454777551139f6671c782" call-id="5c7fc34b345454777551139f6671c782" local-tag="as43ed18e9" remote-tag="0tu343i69f" remote-uri="sip:10090@127.0.0.1" local-uri="sip:+15555550123@127.0.0.1:6050" direction="recipient">
    <note>Ready</note>
    <remote>
      <identity>10090</identity>
      <target uri="10090">
        <param pname="X-Wildix-state" pval="Online"/>
        <param pname="X-Wildix-tags" pval=""/>
        <param pname="X-Wildix-custom" pval="eyJ1bnRpbFRpbWUiOiIiLCJtZXNzYWdlIjoiIiwibG9jYXRpb24iOiIifQ=="/>
      </target>
    </remote>
    <local>
      <identity>+15555550123</identity>
      <target uri="+15555550123">
        <param pname="X-Wildix-type" pval="service"/>
      </target>
    </local>
    <state reason="cancelled">terminated</state>
  </dialog>
</dialog-info>`;

const EMPTY_DIALOG_INFO_XML = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="5" state="full" entity="sip:10090@your-pbx.wildixin.com"></dialog-info>`;

// Captured live from a real Wildix PBX (host, names and numbers replaced) during
// manual verification: a presence-only pseudo-dialog with no call-id (only a
// plain "id" holding the extension number) and its presence <param>s as
// direct children of <dialog>, not nested under <remote><target>.
const PRESENCE_ONLY_PSEUDO_DIALOG_XML = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="1" state="full" entity="sip:10090@your-pbx.wildixin.com">
  <dialog id="10090">
<state>terminated</state>
<param pname="X-Wildix-state" pval="Online"/>
<param pname="X-Wildix-custom" pval="eyJ1bnRpbFRpbWUiOiIiLCJtZXNzYWdlIjoiIiwibG9jYXRpb24iOiIifQ=="/>
</dialog>
</dialog-info>`;

const OUTBOUND_HELD_DIALOG_XML = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="1" state="full" entity="sip:10090@your-pbx.wildixin.com">
  <dialog call-id="call-held-1" direction="initiator">
    <note>On hold</note>
    <local><identity display="Jane Roe">sip:79001112233@wildix</identity></local>
    <remote><target uri="sip:pickup*10090@wildix">
      <param pname="X-Wildix-tags" pval="vip, sales"/>
    </target></remote>
    <state>confirmed</state>
  </dialog>
</dialog-info>`;

describe('parseDialogInfoXml', () => {
  test('parses a ringing inbound dialog, reading identity from <local> per the real Wildix wire format', () => {
    const result = parseDialogInfoXml(RINGING_DIALOG_XML);

    expect(result.dialogs).toEqual([
      {
        id: '5c7fc34b345454777551139f6671c782',
        direction: 'inbound',
        rawState: 'early',
        hold: false,
        remoteName: 'Jane Doe',
        remoteNumber: '+15555550123',
        tags: undefined,
        recording: 'system',
      },
    ]);
  });

  test('parses presence params from <remote><target>, lowercased', () => {
    const result = parseDialogInfoXml(RINGING_DIALOG_XML);
    expect(result.presence).toEqual({ status: 'online', message: '', until: '' });
  });

  test('parses a terminated dialog even with degraded (no display, no sip: scheme) identity fields', () => {
    const result = parseDialogInfoXml(TERMINATED_DIALOG_XML);
    expect(result.dialogs).toEqual([
      {
        id: '5c7fc34b345454777551139f6671c782',
        direction: 'inbound',
        rawState: 'terminated',
        rawStateReason: 'cancelled',
        hold: false,
        remoteName: undefined,
        remoteNumber: '+15555550123',
        tags: undefined,
      },
    ]);
  });

  test('returns no dialogs for an empty dialog-info body', () => {
    const result = parseDialogInfoXml(EMPTY_DIALOG_INFO_XML);
    expect(result.dialogs).toEqual([]);
    expect(result.presence).toBeNull();
  });

  test('parses an outbound, held dialog with comma-separated tags', () => {
    const result = parseDialogInfoXml(OUTBOUND_HELD_DIALOG_XML);
    expect(result.dialogs).toEqual([
      {
        id: 'call-held-1',
        direction: 'outbound',
        rawState: 'confirmed',
        hold: true,
        remoteName: 'Jane Roe',
        remoteNumber: '79001112233',
        tags: ['vip', 'sales'],
      },
    ]);
  });

  test('extracts presence from a call-id-less pseudo-dialog with params as direct children of <dialog>', () => {
    const result = parseDialogInfoXml(PRESENCE_ONLY_PSEUDO_DIALOG_XML);

    expect(result.dialogs).toEqual([]);
    expect(result.presence).toEqual({ status: 'online', message: '', until: '' });
  });

  describe('recording (X-Wildix-record: <remote> is the user, <local> the other party)', () => {
    const recordParam = (value?: string) => (value ? `<param pname="X-Wildix-record" pval="${value}"/>` : '');
    const dialogWithRecord = (user?: string, other?: string) => `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="1" state="full" entity="sip:10090@your-pbx.wildixin.com">
  <dialog id="call-r" call-id="call-r" direction="recipient">
    <remote><identity>sip:10090@wildix</identity><target uri="sip:10090@wildix">${recordParam(user)}</target></remote>
    <local><identity>sip:203@wildix</identity><target uri="sip:203@wildix">${recordParam(other)}</target></local>
    <state>confirmed</state>
  </dialog>
</dialog-info>`;
    const recordingOf = (user?: string, other?: string) =>
      parseDialogInfoXml(dialogWithRecord(user, other)).dialogs[0].recording;

    test.each([
      ['off', undefined, 'off'],
      ['personal', undefined, 'personal'],
      ['off', 'system', 'system'],
      ['system', undefined, 'system'],
      ['paused', 'system', 'paused'],
      ['personal', 'paused', 'paused'],
    ])('user %s, other party %s -> %s', (user, other, expected) => {
      expect(recordingOf(user, other)).toBe(expected);
    });

    test('is undefined when the PBX reports no recording at all', () => {
      expect(recordingOf(undefined, undefined)).toBeUndefined();
    });

    test('an unknown value is not taken for a recording state', () => {
      expect(recordingOf('maybe', undefined)).toBeUndefined();
    });
  });
});
