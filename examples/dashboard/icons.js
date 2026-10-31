import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  createElement,
  ExternalLink,
  Handshake,
  Hash,
  Link,
  Monitor,
  MonitorSmartphone,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
  Plus,
  Search,
  Trash2,
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
  phone: Phone,
  hold: Pause,
  resume: Play,
  hangup: PhoneOff,
  dtmf: Hash,
  transfer: PhoneForwarded,
  attendedTransfer: Handshake,
  dismiss: X,
  inbound: ArrowDownRight,
  outbound: ArrowUpRight,
  externalLink: ExternalLink,
  plus: Plus,
  link: Link,
  search: Search,
  remove: Trash2,
  chevron: ChevronRight,
  localDevice: Monitor,
  device: MonitorSmartphone,
};

/** Replaces every static `<span data-icon="name">` placeholder in the page with its icon. */
export function hydrateIcons(root = document) {
  for (const placeholder of root.querySelectorAll('[data-icon]')) {
    const iconNode = Icons[placeholder.dataset.icon];
    if (iconNode) {
      placeholder.replaceChildren(iconElement(iconNode));
    }
  }
}
