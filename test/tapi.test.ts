import { buildTapiExtraHeaders } from '../src/tapi';

describe('buildTapiExtraHeaders', () => {
  test('originate (makeCall): destination as param1, "any" device mode as param2', () => {
    expect(buildTapiExtraHeaders('originate', '+31612345678', 'any')).toEqual([
      'W-TapiCommand: originate',
      'W-TapiParam1: +31612345678',
      'W-TapiParam2: any',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('originate (makeCall to a specific device): destination as param1, "device" literal as param2, deviceUri as param3', () => {
    expect(
      buildTapiExtraHeaders('originate', '+31612345678', 'device', 'sip:10090@device-a.invalid;transport=ws'),
    ).toEqual([
      'W-TapiCommand: originate',
      'W-TapiParam1: +31612345678',
      'W-TapiParam2: device',
      'W-TapiParam3: sip:10090@device-a.invalid;transport=ws',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('talk (answer): callId only', () => {
    expect(buildTapiExtraHeaders('talk', 'call-1')).toEqual([
      'W-TapiCommand: talk',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('talk (answer on a specific device): callId + deviceUri', () => {
    expect(buildTapiExtraHeaders('talk', 'call-1', 'sip:101@10.0.0.5:5060')).toEqual([
      'W-TapiCommand: talk',
      'W-TapiParam1: call-1',
      'W-TapiParam2: sip:101@10.0.0.5:5060',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('hangup: callId only', () => {
    expect(buildTapiExtraHeaders('hangup', 'call-1')).toEqual([
      'W-TapiCommand: hangup',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('hold: callId only', () => {
    expect(buildTapiExtraHeaders('hold', 'call-1')).toEqual([
      'W-TapiCommand: hold',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('senddigits (DTMF): callId + digits', () => {
    expect(buildTapiExtraHeaders('senddigits', 'call-1', '123#')).toEqual([
      'W-TapiCommand: senddigits',
      'W-TapiParam1: call-1',
      'W-TapiParam2: 123#',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('transfer (cold): callId + destination', () => {
    expect(buildTapiExtraHeaders('transfer', 'call-1', '203')).toEqual([
      'W-TapiCommand: transfer',
      'W-TapiParam1: call-1',
      'W-TapiParam2: 203',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('atttransfer (warm): two call ids', () => {
    expect(buildTapiExtraHeaders('atttransfer', 'call-1', 'call-2')).toEqual([
      'W-TapiCommand: atttransfer',
      'W-TapiParam1: call-1',
      'W-TapiParam2: call-2',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });
});
