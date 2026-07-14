import { TAPI_EVENT_PACKAGE, TAPI_PUBLISH_EXPIRES_SECONDS } from './constants';

export type TapiCommand = 'originate' | 'talk' | 'hangup' | 'hold' | 'senddigits' | 'transfer' | 'atttransfer';

export function buildTapiExtraHeaders(
  command: TapiCommand,
  param1?: string,
  param2?: string,
  param3?: string,
): string[] {
  const headers = [`W-TapiCommand: ${command}`];
  if (param1 !== undefined) {
    headers.push(`W-TapiParam1: ${param1}`);
  }
  if (param2 !== undefined) {
    headers.push(`W-TapiParam2: ${param2}`);
  }
  if (param3 !== undefined) {
    headers.push(`W-TapiParam3: ${param3}`);
  }
  headers.push(`Event: ${TAPI_EVENT_PACKAGE}`);
  headers.push(`Expires: ${TAPI_PUBLISH_EXPIRES_SECONDS}`);
  return headers;
}
