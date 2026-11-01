import { hydrateIcons, Icons, iconElement } from './icons.js';
import { addUser, loadState, removeUser, saveState, setUserPaused } from './storage.js';
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
const pausedStrip = document.getElementById('paused-users');
const pausedList = document.getElementById('paused-list');
const pausedCount = document.getElementById('paused-count');
const resumeAllBtn = document.getElementById('resume-all');
const pausedToggle = document.getElementById('paused-toggle');
const pausedToggleCount = document.getElementById('paused-toggle-count');
// The paused strip stays folded behind the "Paused N" button unless opened, or unless nobody is connected.
let pausedOpen = false;
const confirmDialog = document.getElementById('confirm-remove');
const confirmExtension = document.getElementById('confirm-remove-ext');
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

  // With nobody saved at all the open form says it all: no filters, no empty-state note.
  usersControls.hidden = state.users.length === 0;
  if (sessions.size === 0 && state.users.length > 0) {
    emptyState.textContent = 'All users are paused. Resume the ones you need above.';
    emptyState.hidden = false;
  } else if (sessions.size > 0 && visible === 0) {
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

/** Removing forgets the user's credentials, so it asks first; resolves true only on the Remove button. */
function confirmRemove(extension) {
  return new Promise((resolve) => {
    confirmExtension.textContent = extension;
    confirmDialog.returnValue = '';
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'remove'), { once: true });
    confirmDialog.showModal();
  });
}

/** The strip of paused users: one chip each, a click reconnects it. */
function renderPaused() {
  const paused = state.users.filter((user) => user.paused);
  const open = paused.length > 0 && (pausedOpen || sessions.size === 0);
  pausedToggle.hidden = paused.length === 0;
  pausedToggle.setAttribute('aria-expanded', String(open));
  pausedToggleCount.textContent = String(paused.length);
  pausedStrip.hidden = !open;
  pausedCount.textContent = String(paused.length);
  pausedList.replaceChildren();
  for (const user of paused) {
    const chip = document.createElement('li');
    chip.className = 'paused-chip';

    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'paused-resume';
    resume.title = `Resume ${user.extension} · ${user.pbxAddress}`;
    resume.setAttribute('aria-label', `Resume user ${user.extension}`);
    resume.append(iconElement(Icons.resumeUser), user.extension);
    resume.addEventListener('click', () => resumeUser(user.extension));

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'paused-forget';
    forget.title = 'Remove user';
    forget.setAttribute('aria-label', `Remove user ${user.extension}`);
    forget.append(iconElement(Icons.dismiss));
    forget.addEventListener('click', async () => {
      if (!(await confirmRemove(user.extension))) {
        return;
      }
      Object.assign(state, removeUser(state, user.extension));
      saveState(state);
      renderPaused();
      renderOverview();
    });

    chip.append(resume, forget);
    pausedList.append(chip);
  }
}

/** Disconnects a user but keeps its settings, so a click on its chip brings it back. */
function pauseSession(extension) {
  const entry = sessions.get(extension);
  if (!entry) {
    return;
  }
  entry.session.callControl.disconnect().catch(() => undefined);
  entry.session.card.remove();
  sessions.delete(extension);
  Object.assign(state, setUserPaused(state, extension, true));
  saveState(state);
  renderPaused();
  renderOverview();
}

function resumeUser(extension) {
  const user = state.users.find((u) => u.extension === extension);
  if (!user) {
    return;
  }
  Object.assign(state, setUserPaused(state, extension, false));
  saveState(state);
  renderPaused();
  addSession(user.pbxAddress, user.extension, user.sipPassword, false);
}

/** Pauses every other connected user: a quick way down to the few a test needs. */
function keepOnly(extension) {
  for (const other of [...sessions.keys()]) {
    if (other !== extension) {
      pauseSession(other);
    }
  }
}

pausedToggle.addEventListener('click', () => {
  pausedOpen = pausedToggle.getAttribute('aria-expanded') !== 'true';
  renderPaused();
});

resumeAllBtn.addEventListener('click', () => {
  for (const user of state.users.filter((u) => u.paused)) {
    resumeUser(user.extension);
  }
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
    // Adding a user that is paused replaces it with a connected one, so its chip goes away.
    Object.assign(state, addUser(state, pbxAddress, extension, sipPassword));
    saveState(state);
    renderPaused();
  }

  const session = createUserSession({
    pbxAddress,
    extension,
    sipPassword,
    getWebhookUrl: () => state.webhookUrl,
    onRemove: async () => {
      if (await confirmRemove(extension)) {
        removeSession(extension);
      }
    },
    onPause: () => pauseSession(extension),
    onKeepOnly: () => keepOnly(extension),
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
  const empty = state.users.length === 0;
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
  if (event.key === 'Escape' && state.users.length > 0) {
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

// Restore every previously-added user immediately, without waiting for a click; paused ones only get their chip.
for (const user of state.users.filter((u) => !u.paused)) {
  addSession(user.pbxAddress, user.extension, user.sipPassword, false);
}
renderPaused();

// A card's ⋯ menu is a <details>; it closes on a click anywhere else or on Esc.
document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll('.card-menu[open]')) {
    if (!menu.contains(event.target)) {
      menu.open = false;
    }
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }
  for (const menu of document.querySelectorAll('.card-menu[open]')) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
