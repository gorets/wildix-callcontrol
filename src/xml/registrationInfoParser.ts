import { parse } from 'ltx';

import { SYSTEM_USER_AGENT_MARKERS } from '../constants';

export interface ParsedDevice {
  uri: string;
  userAgent: string;
  isLocalRegistration: boolean;
}

export function parseRegistrationInfoXml(xmlBody: string, localViaHost: string): ParsedDevice[] {
  const root = parse(xmlBody.trim());
  const devices: ParsedDevice[] = [];

  for (const registrationEl of root.getChildren('registration')) {
    for (const contactEl of registrationEl.getChildren('contact')) {
      const state = contactEl.attrs.state;
      const userAgent = (contactEl.attrs.user_agent as string | undefined) ?? '';
      const uri = contactEl.getChild('uri')?.getText();

      if (state !== 'active' || !uri || !userAgent) {
        continue;
      }

      const lowerUserAgent = userAgent.toLowerCase();
      if (SYSTEM_USER_AGENT_MARKERS.some((marker) => lowerUserAgent.includes(marker))) {
        continue;
      }

      devices.push({
        uri,
        userAgent,
        isLocalRegistration: Boolean(localViaHost) && uri.includes(localViaHost),
      });
    }
  }

  return devices;
}
