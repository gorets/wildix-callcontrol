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
        ? parsed.users
            .filter(
              (u) =>
                u &&
                typeof u.pbxAddress === 'string' &&
                typeof u.extension === 'string' &&
                typeof u.sipPassword === 'string',
            )
            .map((u) => ({
              pbxAddress: u.pbxAddress,
              extension: u.extension,
              sipPassword: u.sipPassword,
              paused: u.paused === true,
            }))
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

/** A paused user keeps its settings but is not connected, now or on the next page load. */
export function setUserPaused(state, extension, paused) {
  return { ...state, users: state.users.map((u) => (u.extension === extension ? { ...u, paused } : u)) };
}

export function removeUser(state, extension) {
  return { ...state, users: state.users.filter((u) => u.extension !== extension) };
}
