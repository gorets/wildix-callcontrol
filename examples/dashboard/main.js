import { addUser, loadState, removeUser, saveState } from './storage.js';
import { createUserSession } from './userSession.js';

const state = loadState();
const sessions = new Map(); // extension -> { session }

const pbxAddressInput = document.getElementById('pbx-address');
const webhookUrlInput = document.getElementById('webhook-url');
const extensionInput = document.getElementById('extension-input');
const sipPasswordInput = document.getElementById('sip-password-input');
const addUserForm = document.getElementById('add-user-form');
const sessionsContainer = document.getElementById('sessions');

webhookUrlInput.value = state.webhookUrl;

webhookUrlInput.addEventListener('input', () => {
  state.webhookUrl = webhookUrlInput.value.trim();
  saveState(state);
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
  });

  sessions.set(extension, { session });
  sessionsContainer.appendChild(session.card);
  session.connect();
}

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
});

// Restore every previously-added user immediately, without waiting for a click.
for (const user of state.users) {
  addSession(user.pbxAddress, user.extension, user.sipPassword, false);
}
