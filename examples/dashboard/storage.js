const STORAGE_KEY = 'callcontrol-dashboard';

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { pbxAddress: '', webhookUrl: '', users: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      pbxAddress: typeof parsed.pbxAddress === 'string' ? parsed.pbxAddress : '',
      webhookUrl: typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl : '',
      users: Array.isArray(parsed.users)
        ? parsed.users.filter((u) => u && typeof u.extension === 'string' && typeof u.sipPassword === 'string')
        : [],
    };
  } catch {
    return { pbxAddress: '', webhookUrl: '', users: [] };
  }
}

export function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ pbxAddress: state.pbxAddress, webhookUrl: state.webhookUrl, users: state.users }),
  );
}

export function addUser(state, extension, sipPassword) {
  const users = state.users.filter((u) => u.extension !== extension);
  users.push({ extension, sipPassword });
  return { ...state, users };
}

export function removeUser(state, extension) {
  return { ...state, users: state.users.filter((u) => u.extension !== extension) };
}
