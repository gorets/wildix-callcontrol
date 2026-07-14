import type { Element } from 'ltx';
import { parse } from 'ltx';

import { WILDIX_PARAMS } from '../constants';
import type { CallDirection } from '../types';

export interface ParsedDialog {
  id: string;
  direction: CallDirection;
  rawState?: string;
  rawStateReason?: string;
  hold: boolean;
  remoteName?: string;
  remoteNumber?: string;
  tags?: string[];
}

export interface ParsedPresence {
  status?: string;
  message?: string;
  until?: string;
}

export interface ParsedDialogInfo {
  dialogs: ParsedDialog[];
  presence: ParsedPresence | null;
}

export function parseDialogInfoXml(xmlBody: string): ParsedDialogInfo {
  const root = parse(xmlBody.trim());
  const dialogs: ParsedDialog[] = [];
  let presence: ParsedPresence | null = null;

  for (const dialogEl of root.getChildren('dialog')) {
    // Presence params can appear as direct children of <dialog> (seen on a real
    // PBX in a presence-only pseudo-dialog with no call-id, e.g. <dialog
    // id="10090"><state>terminated</state><param .../></dialog>) as well as
    // under <remote><target> on a real call's dialog. Scan both locations,
    // regardless of whether this element turns out to have a usable call-id.
    presence = applyPresenceParams(dialogEl.getChildren('param'), presence);

    const targetParams = dialogEl.getChild('remote')?.getChild('target')?.getChildren('param') ?? [];
    presence = applyPresenceParams(targetParams, presence);

    let tags: string[] | undefined;
    for (const paramEl of targetParams) {
      if (paramEl.attrs.pname === WILDIX_PARAMS.TAGS && paramEl.attrs.pval) {
        tags = String(paramEl.attrs.pval)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }
    }

    const id = dialogEl.attrs['call-id'] as string | undefined;
    if (!id) {
      continue;
    }

    const direction: CallDirection = dialogEl.attrs.direction === 'initiator' ? 'outbound' : 'inbound';
    const stateEl = dialogEl.getChild('state');
    const rawState = stateEl?.getText();
    // Confirmed live against a real Wildix PBX: a terminated dialog can carry
    // a `reason` attribute on <state> (e.g. `reason="cancelled"`) explaining
    // why the call ended. Only ever seen on terminated dialogs in practice.
    const rawStateReason = stateEl?.attrs.reason as string | undefined;
    const hold = dialogEl.getChild('note')?.getText() === 'On hold';

    let remoteName: string | undefined;
    let remoteNumber: string | undefined;
    const identityEl = dialogEl.getChild('local')?.getChild('identity');
    if (identityEl) {
      remoteName = (identityEl.attrs.display as string | undefined) || undefined;
      const uri = identityEl.getText();
      remoteNumber = uri ? (uri.startsWith('sip:') ? uri.slice(4).split('@')[0] : uri) : undefined;
    }

    dialogs.push({ id, direction, rawState, rawStateReason, hold, remoteName, remoteNumber, tags });
  }

  return { dialogs, presence };
}

function applyPresenceParams(paramEls: Element[], presence: ParsedPresence | null): ParsedPresence | null {
  for (const paramEl of paramEls) {
    const pname = paramEl.attrs.pname;
    const pval = paramEl.attrs.pval;

    if (pname === WILDIX_PARAMS.STATE && pval) {
      presence = { ...(presence ?? {}), status: String(pval).toLowerCase() };
    }
    if (pname === WILDIX_PARAMS.CUSTOM && pval) {
      presence = { ...(presence ?? {}), ...parseWildixCustomStatus(String(pval)) };
    }
  }
  return presence;
}

function parseWildixCustomStatus(base64Value: string): { message?: string; until?: string } {
  try {
    const binary = atob(base64Value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(decoded);
    return {
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      until: typeof parsed.untilTime === 'string' ? parsed.untilTime : undefined,
    };
  } catch {
    return {};
  }
}
