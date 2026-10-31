import {
  ArrowDownLeft,
  ArrowUpRight,
  Circle,
  createElement,
  ExternalLink,
  Handshake,
  Hash,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
  X,
} from 'lucide';

// Lucide icons (https://lucide.dev/icons/). Only the ones used are imported, so the bundle carries just those.
// The icons are decoration next to a text label, or carry their own label where they stand alone.
function render(iconNode, attributes = {}) {
  return createElement(iconNode, { class: 'icon', 'aria-hidden': 'true', ...attributes });
}

export function iconElement(iconNode, attributes) {
  return render(iconNode, attributes);
}

/** The icon as markup, for the template strings the cards are built from. */
export function iconMarkup(iconNode, attributes) {
  return render(iconNode, attributes).outerHTML;
}

export const Icons = {
  answer: Phone,
  hold: Pause,
  resume: Play,
  hangup: PhoneOff,
  dtmf: Hash,
  transfer: PhoneForwarded,
  attendedTransfer: Handshake,
  dismiss: X,
  inbound: ArrowDownLeft,
  outbound: ArrowUpRight,
  externalLink: ExternalLink,
  presence: Circle,
};
