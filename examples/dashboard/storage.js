const STORAGE_KEY = 'callcontrol-dashboard';

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { webhookUrl: '', users: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      webhookUrl: typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl : '',
      users: Array.isArray(parsed.users)
        ? parsed.users.filter(
            (u) =>
              u &&
              typeof u.pbxAddress === 'string' &&
              typeof u.extension === 'string' &&
              typeof u.sipPassword === 'string',
          )
        : [],
    };
  } catch {
    return { webhookUrl: '', users: [] };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ webhookUrl: state.webhookUrl, users: state.users }));
}

export function addUser(state, pbxAddress, extension, sipPassword) {
  const users = state.users.filter((u) => u.extension !== extension);
  users.push({ pbxAddress, extension, sipPassword });
  return { ...state, users };
}

export function removeUser(state, extension) {
  return { ...state, users: state.users.filter((u) => u.extension !== extension) };
}
