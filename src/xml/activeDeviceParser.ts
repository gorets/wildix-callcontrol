import { parse } from 'ltx';

export interface ParsedActiveDevice {
  type: string;
  userAgent?: string;
  contactUri?: string;
}

export function parseActiveDeviceXml(xmlBody: string): ParsedActiveDevice | null {
  const root = parse(xmlBody.trim());
  const type = root.getChild('type')?.getText();
  if (!type) {
    return null;
  }

  return {
    type,
    userAgent: root.getChild('user-agent')?.getText() || undefined,
    contactUri: root.getChild('contact')?.getText() || undefined,
  };
}
