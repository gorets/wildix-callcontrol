import { hydrateIcons } from './icons.js';
import { addUser, loadState, removeUser, saveState } from './storage.js';
import { createUserSession, formatDuration } from './userSession.js';

const state = loadState();
const sessions = new Map(); // extension -> { session }
let activeFilter = 'all'; // 'all' | 'in-call' | 'idle'
let searchQuery = '';

const pbxAddressInput = document.getElementById('pbx-address');
const webhookUrlInput = document.getElementById('webhook-url');
const webhookStatus = document.getElementById('webhook-status');
const extensionInput = document.getElementById('extension-input');
const sipPasswordInput = document.getElementById('sip-password-input');
const addUserForm = document.getElementById('add-user-form');
const addUserToggle = document.getElementById('add-user-toggle');
const addUserCancel = document.getElementById('add-user-cancel');
const usersControls = document.querySelector('.users-controls');
const sessionsContainer = document.getElementById('sessions');
const emptyState = document.getElementById('sessions-empty');
const searchInput = document.getElementById('user-search');
const filterButtons = document.querySelectorAll('[data-filter]');

const countElements = {
  countAll: document.getElementById('count-all'),
  countInCall: document.getElementById('count-in-call'),
  countIdle: document.getElementById('count-idle'),
};

hydrateIcons();

webhookUrlInput.value = state.webhookUrl;

function renderWebhookStatus() {
  const forwarding = Boolean(state.webhookUrl);
  webhookStatus.textContent = forwarding ? 'Forwarding' : 'Not forwarding';
  webhookStatus.className = `pill ${forwarding ? 'pill-success' : 'pill-neutral'}`;
}

webhookUrlInput.addEventListener('input', () => {
  state.webhookUrl = webhookUrlInput.value.trim();
  saveState(state);
  renderWebhookStatus();
});

function matchesFilter(session) {
  const inCall = session.getCallCount() > 0;
  if (activeFilter === 'in-call' && !inCall) {
    return false;
  }
  if (activeFilter === 'idle' && inCall) {
    return false;
  }
  return !searchQuery || session.extension.toLowerCase().includes(searchQuery);
}

/** Re-derives the filter counts and card visibility from the live sessions. */
function renderOverview() {
  let usersInCall = 0;
  let visible = 0;

  for (const { session } of sessions.values()) {
    const callCount = session.getCallCount();
    if (callCount > 0) {
      usersInCall += 1;
    }
    const show = matchesFilter(session);
    session.card.hidden = !show;
    if (show) {
      visible += 1;
    }
  }

  countElements.countAll.textContent = String(sessions.size);
  countElements.countInCall.textContent = String(usersInCall);
  countElements.countIdle.textContent = String(sessions.size - usersInCall);

  syncAddUserMode();

  // With nobody connected the open form says it all: no filters, no empty-state note.
  usersControls.hidden = sessions.size === 0;
  if (sessions.size > 0 && visible === 0) {
    emptyState.textContent = 'No users match this filter.';
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
  }
}

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    for (const other of filterButtons) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    renderOverview();
  });
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  renderOverview();
});

function removeSession(extension) {
  const entry = sessions.get(extension);
  if (!entry) {
    return;
  }
  entry.session.callControl.disconnect().catch(() => undefined);
  entry.session.card.remove();
  sessions.delete(extension);
  Object.assign(state, removeUser(state, extension));
  saveState(state);
  renderOverview();
}

function addSession(pbxAddress, extension, sipPassword, persist) {
  if (sessions.has(extension)) {
    return;
  }

  if (persist) {
    Object.assign(state, addUser(state, pbxAddress, extension, sipPassword));
    saveState(state);
  }

  const session = createUserSession({
    pbxAddress,
    extension,
    sipPassword,
    getWebhookUrl: () => state.webhookUrl,
    onRemove: () => removeSession(extension),
    onChange: renderOverview,
  });

  sessions.set(extension, { session });
  sessionsContainer.appendChild(session.card);
  renderOverview();
  session.connect();
}

// With nobody connected the connect form is the whole point of the page, so it shows in full with no way
// to fold it. Once there's at least one user it folds behind "Add user" so the cards keep the first screen.
function setAddUserOpen(open, { focus = false } = {}) {
  addUserForm.hidden = !open;
  addUserToggle.setAttribute('aria-expanded', String(open));
  if (open && focus) {
    (pbxAddressInput.value ? extensionInput : pbxAddressInput).focus();
  }
}

let addUserWasEmpty = true;

function syncAddUserMode() {
  const empty = sessions.size === 0;
  addUserToggle.hidden = empty;
  addUserCancel.hidden = empty;
  if (empty) {
    setAddUserOpen(true);
  } else if (addUserWasEmpty) {
    // The first user just arrived (added or restored): fold the form into the button.
    setAddUserOpen(false);
  }
  addUserWasEmpty = empty;
}

addUserToggle.addEventListener('click', () => {
  setAddUserOpen(addUserForm.hidden, { focus: true });
});

addUserCancel.addEventListener('click', () => {
  setAddUserOpen(false);
  addUserToggle.focus();
});

addUserForm.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sessions.size > 0) {
    setAddUserOpen(false);
    addUserToggle.focus();
  }
});

addUserForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pbxAddress = pbxAddressInput.value.trim();
  const extension = extensionInput.value.trim();
  const sipPassword = sipPasswordInput.value;
  if (!pbxAddress || !extension || !sipPassword) {
    return;
  }

  addSession(pbxAddress, extension, sipPassword, true);
  extensionInput.value = '';
  sipPasswordInput.value = '';
  setAddUserOpen(false);
  addUserToggle.focus();
});

// One shared ticker for every live call's duration, rather than a timer per call.
setInterval(() => {
  const now = Date.now();
  for (const timer of sessionsContainer.querySelectorAll('.call-timer[data-started]')) {
    timer.textContent = formatDuration(now - Number(timer.dataset.started));
  }
}, 1000);

renderWebhookStatus();
renderOverview();

// Restore every previously-added user immediately, without waiting for a click.
for (const user of state.users) {
  addSession(user.pbxAddress, user.extension, user.sipPassword, false);
}
