import { CallControl, KNOWN_DEVICE_NAMES } from '../../dist/index.mjs';
import { Icons, iconElement, iconMarkup } from './icons.js';
import { postWebhookEvent } from './webhook.js';

const CALL_STATE_LABEL = {
  ringing: 'Ringing',
  answered: 'Answered',
  held: 'On hold',
  ended: 'Ended',
};

const NO_CAPABILITIES = {
  answer: false,
  hold: false,
  resume: false,
  hangup: false,
  dtmf: false,
  transfer: false,
  attendedTransfer: false,
  record: false,
};

// Which actions make sense for a call, given its state AND direction — e.g.
// you can't Answer an already-answered call, Resume one that isn't on hold,
// or Answer an outbound call (there's nothing to answer — you're the one
// waiting for the other side to pick up). Disabled (not hidden) so the demo
// still shows the library's full command surface.
// x-bees Web (or its newer name, Collaboration Web) is preferred as the
// default device pick, since a real user answering the call almost always
// has one of these open, unlike "any device" mode (which rings back an
// ambiguous/possibly stale target — see the design spec's Command → TAPI
// mapping notes). "Wildix Zero Distance WebRTC" is the old Collaboration 6
// client — still in use by some customers, so it's a lower-priority fallback
// ahead of "any device". Checked in priority order.
const PREFERRED_DEFAULT_DEVICE_NAMES = [
  KNOWN_DEVICE_NAMES.X_BEES_WEB,
  KNOWN_DEVICE_NAMES.X_HOPPERS_WEB,
  KNOWN_DEVICE_NAMES.COLLABORATION_WEB,
  KNOWN_DEVICE_NAMES.COLLABORATION_OLD,
];

// Friendly display names for raw deviceName values that aren't self-explanatory.
const DEVICE_DISPLAY_NAME_OVERRIDES = {
  [KNOWN_DEVICE_NAMES.COLLABORATION_OLD]: 'Collaboration Old',
};

function getDeviceDisplayName(device) {
  return DEVICE_DISPLAY_NAME_OVERRIDES[device.deviceName] ?? device.deviceName;
}

// Wildix presence statuses aren't a fixed enum (they're passed through as a raw
// lowercased string from the PBX), so unrecognized values fall back to 'offline'.
// The dot's colour comes from CSS, keyed on the status.
const KNOWN_PRESENCE_STATUSES = new Set(['online', 'away', 'dnd', 'offline', 'only-sip']);

function getPresenceStatus(status) {
  return KNOWN_PRESENCE_STATUSES.has(status) ? status : 'offline';
}

const PRESENCE_LABEL = {
  online: 'Available',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
  'only-sip': 'SIP only',
};

function renderPresenceDot(element, status) {
  const known = getPresenceStatus(status);
  const label = KNOWN_PRESENCE_STATUSES.has(status) ? PRESENCE_LABEL[known] : (status ?? 'Unknown');
  element.dataset.status = known;
  element.title = `Presence: ${label}`;
  element.setAttribute('aria-label', element.title);
}

// The secondary call tools, each revealed as an inline panel by its own button. Blind, conference and attended
// transfer are the three modes of the one Transfer panel, so the row stays a single line.
const CALL_TOOLS = [
  { id: 'dtmf', label: 'DTMF', icon: Icons.dtmf },
  { id: 'transfer', label: 'Transfer', icon: Icons.transfer },
  { id: 'record', label: 'Record', icon: Icons.record },
];

const TRANSFER_MODES = [
  {
    id: 'blind',
    label: 'Blind',
    submit: 'Transfer',
    hint: 'Hands the call straight over; you leave it immediately.',
  },
  {
    id: 'conference',
    label: 'Conference',
    submit: 'Conference',
    hint: 'All three talk in a conference; hang up to leave the caller and the destination connected.',
  },
  {
    id: 'attended',
    label: 'Attended',
    submit: 'Connect',
    hint: 'Joins the far ends of this call and your other call; both of your legs end.',
  },
];

// Start and Stop draw their glyph in CSS (a record dot, a stop square); Pause and Resume use the call icons.
const RECORD_ACTIONS = [
  { value: 'on', label: 'Start' },
  { value: 'pause', label: 'Pause', icon: Icons.hold },
  { value: 'unpause', label: 'Resume', icon: Icons.resume },
  { value: 'off', label: 'Stop' },
];

const RECORDING_LABEL = { personal: 'Recording', system: 'Recording (PBX rule)', paused: 'Recording paused' };

// What the PBX accepts for each recording state (checked live, except `system`): `on` on a recorded call is rejected
// with 500 "recording already started", `off` on a stopped one with "recording already stopped". With no state
// reported every action stays available.
const RECORD_ACTIONS_FOR_STATE = {
  off: ['on'],
  personal: ['pause', 'off'],
  system: ['pause', 'off'],
  paused: ['unpause', 'off'],
};

// The make-call target that is not a device: the PBX rings the user's mobile first (`makeMobilityCall`).
const MOBILITY_TARGET = 'mobility:';

function getCallCapabilities(call) {
  if (call.state === 'ringing') {
    return { ...NO_CAPABILITIES, answer: call.direction === 'inbound', hangup: true };
  }
  if (call.state === 'answered') {
    return {
      ...NO_CAPABILITIES,
      hold: true,
      hangup: true,
      dtmf: true,
      transfer: true,
      attendedTransfer: true,
      record: true,
    };
  }
  if (call.state === 'held') {
    return { ...NO_CAPABILITIES, resume: true, hangup: true, transfer: true, attendedTransfer: true, record: true };
  }
  return NO_CAPABILITIES;
}

const MAX_LOG_ENTRIES = 200;

function formatLogTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** mm:ss, or h:mm:ss past an hour — used by the call timers (main.js ticks them every second). */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function createUserSession({ pbxAddress, extension, sipPassword, getWebhookUrl, onRemove, onChange }) {
  const callControl = new CallControl({
    pbxAddress,
    extension,
    sipPassword,
    userAgent: 'wildix-callcontrol-dashboard',
  });

  let calls = [];
  let devices = [];
  let presence;
  let status = 'connecting';
  let eventCount = 0;

  // The call rows are rebuilt on every call/device update, so the UI state a
  // person is in the middle of (which tool panel is open, what they've typed)
  // lives here, keyed by call id, instead of in the DOM.
  const callStartedAt = new Map(); // callId -> ms timestamp the dashboard first saw the call
  const openTool = new Map(); // callId -> 'dtmf' | 'transfer' | 'record'
  const transferMode = new Map(); // callId -> 'blind' | 'conference' | 'attended'
  const drafts = new Map(); // `${callId}:${toolId}` -> input value
  let focusToolInputFor; // callId whose tool input should take focus after the next render

  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.extension = extension;
  card.innerHTML = `
    <header class="card-header">
      <div class="card-title-group">
        <h2 class="card-title">
          <span class="card-title-text"></span>
          <span class="presence-dot" role="img"></span>
        </h2>
        <p class="card-pbx-address"></p>
        <p class="status-message" hidden></p>
      </div>
      <div class="card-header-actions">
        <span class="status-badge status-connecting">connecting</span>
        <button class="remove-btn" type="button">${iconMarkup(Icons.remove)}</button>
      </div>
    </header>
    <div class="error-banner" role="alert" hidden>
      <span class="error-message"></span>
      <button class="error-dismiss" type="button" aria-label="Dismiss">${iconMarkup(Icons.dismiss)}</button>
    </div>
    <div class="card-body">
      <section class="calls" aria-label="Calls"></section>
      <section class="make-call">
        <span class="section-label">New call</span>
        <form class="make-call-form">
          <select class="make-call-device" aria-label="Call from device"></select>
          <input class="make-call-destination" type="tel" aria-label="Destination" placeholder="Destination" required />
          <button type="submit">${iconMarkup(Icons.phone)}Call</button>
        </form>
      </section>
      <section class="devices">
        <h3 class="section-label">Devices · <span class="devices-count">0</span></h3>
        <ul class="devices-list"></ul>
      </section>
    </div>
    <details class="event-log">
      <summary>${iconMarkup(Icons.chevron)}Event log<span class="event-count">0</span></summary>
      <ul class="event-log-list"></ul>
    </details>
  `;

  card.querySelector('.card-title-text').textContent = extension;
  card.querySelector('.card-pbx-address').textContent = pbxAddress;
  card.querySelector('.card-pbx-address').title = pbxAddress;

  const statusBadge = card.querySelector('.status-badge');
  const errorBanner = card.querySelector('.error-banner');
  const errorMessage = card.querySelector('.error-message');
  const eventLogList = card.querySelector('.event-log-list');
  const eventCountElement = card.querySelector('.event-count');
  const removeBtn = card.querySelector('.remove-btn');
  const callsSection = card.querySelector('.calls');
  const makeCallForm = card.querySelector('.make-call-form');
  const makeCallDestination = card.querySelector('.make-call-destination');
  const makeCallDeviceSelect = card.querySelector('.make-call-device');
  const presenceDot = card.querySelector('.presence-dot');
  const statusMessage = card.querySelector('.status-message');
  const devicesList = card.querySelector('.devices-list');
  const devicesCount = card.querySelector('.devices-count');

  removeBtn.setAttribute('aria-label', `Remove user ${extension}`);
  removeBtn.title = 'Remove user';
  renderPresenceDot(presenceDot, undefined);

  card.querySelector('.error-dismiss').addEventListener('click', () => {
    errorBanner.hidden = true;
  });

  function notifyChange() {
    onChange?.();
  }

  function logEvent(name, detail = '', isError = false) {
    const item = document.createElement('li');
    if (isError) {
      item.className = 'is-error';
    }
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatLogTime(new Date());
    const event = document.createElement('span');
    event.className = 'log-event';
    event.textContent = name;
    const text = document.createElement('span');
    text.className = 'log-detail';
    text.textContent = detail;
    item.append(time, '  ', event, '  ', text);
    eventLogList.prepend(item);
    while (eventLogList.children.length > MAX_LOG_ENTRIES) {
      eventLogList.lastElementChild.remove();
    }
    eventCount += 1;
    eventCountElement.textContent = String(eventCount);
  }

  function forwardEvent(eventName, data) {
    const url = getWebhookUrl?.();
    if (!url) {
      return;
    }
    postWebhookEvent(url, { event: eventName, extension, pbxAddress, timestamp: new Date().toISOString(), data }).then(
      (result) => {
        if (!result.ok) {
          logEvent('webhook', `delivery failed: ${eventName} (${result.reason})`, true);
        }
      },
    );
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
  }

  function setStatus(nextStatus) {
    status = nextStatus;
    statusBadge.textContent = nextStatus;
    statusBadge.className = `status-badge status-${nextStatus}`;
    notifyChange();
  }

  function runAction(promise) {
    return promise.catch((error) => {
      showError(error.message);
      throw error;
    });
  }

  function findDefaultDeviceUri() {
    for (const name of PREFERRED_DEFAULT_DEVICE_NAMES) {
      const match = devices.find((device) => device.deviceName === name);
      if (match) {
        return match.uri;
      }
    }
    return '';
  }

  // This library's own SIP registration (used purely for signaling/TAPI, no
  // media) always shows up in the device list — it's never a valid call
  // target. "Callable" devices are everything else: the real phones/clients
  // that "(any device)" routing actually has something to ring.
  function getCallableDevices() {
    return devices.filter((device) => !device.isLocalRegistration);
  }

  function setCalls(nextCalls) {
    calls = nextCalls;
    const activeIds = new Set(calls.map((call) => call.id));
    for (const map of [callStartedAt, openTool, transferMode]) {
      for (const id of map.keys()) {
        if (!activeIds.has(id)) {
          map.delete(id);
        }
      }
    }
    for (const key of drafts.keys()) {
      if (!activeIds.has(key.slice(0, key.lastIndexOf(':')))) {
        drafts.delete(key);
      }
    }
    card.classList.toggle('is-in-call', calls.length > 0);
    renderCalls();
    notifyChange();
  }

  function renderNoCalls() {
    const hint = document.createElement('div');
    hint.className = 'no-calls';
    const text = document.createElement('span');
    text.textContent =
      getCallableDevices().length > 0
        ? 'No active calls'
        : 'No active calls · no devices online, use Mobile (callback) to call';
    hint.append(iconElement(Icons.phone), text);
    callsSection.replaceChildren(hint);
  }

  /** Esc inside a panel closes it and hands focus back to the button that opened it. */
  function closeOnEscape(panel, call, toolId) {
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        openTool.delete(call.id);
        renderCalls();
        callsSection.querySelector(`[data-call-id="${CSS.escape(call.id)}"] [data-tool="${toolId}"]`)?.focus();
      }
    });
  }

  /** The inline form behind the DTMF or Transfer button; Record has its own panel of buttons. */
  function buildToolPanel(call, toolId, otherCalls, panelId) {
    if (toolId === 'record') {
      return buildRecordPanel(call, panelId);
    }

    const panel = document.createElement('form');
    panel.className = 'call-panel';
    panel.id = panelId;
    const inputId = `${panelId}-input`;

    let mode;
    if (toolId === 'transfer') {
      const attendedPossible = getCallCapabilities(call).attendedTransfer && otherCalls.length > 0;
      mode = transferMode.get(call.id) ?? 'blind';
      if (mode === 'attended' && !attendedPossible) {
        mode = 'blind';
      }
      const modes = document.createElement('div');
      modes.className = 'transfer-modes';
      modes.setAttribute('role', 'group');
      modes.setAttribute('aria-label', 'Transfer type');
      for (const option of TRANSFER_MODES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.setAttribute('aria-pressed', String(option.id === mode));
        if (option.id === 'attended' && !attendedPossible) {
          button.disabled = true;
          button.title = 'Attended transfer needs a second call';
        }
        button.addEventListener('click', () => {
          transferMode.set(call.id, option.id);
          focusToolInputFor = call.id;
          renderCalls();
        });
        modes.append(button);
      }
      panel.append(modes);
    }

    const formRow = document.createElement('div');
    formRow.className = 'call-form-row';
    const label = document.createElement('label');
    label.htmlFor = inputId;
    const submit = document.createElement('button');
    submit.type = 'submit';
    let field;

    if (mode === 'attended') {
      label.textContent = 'Connect to';
      field = document.createElement('select');
      for (const otherCall of otherCalls) {
        const option = document.createElement('option');
        option.value = otherCall.id;
        option.textContent = otherCall.remoteName ?? otherCall.remoteNumber ?? otherCall.id;
        field.appendChild(option);
      }
    } else {
      label.textContent = toolId === 'dtmf' ? 'Digits' : 'Transfer to';
      field = document.createElement('input');
      field.type = 'text';
      field.autocomplete = 'off';
      field.placeholder = toolId === 'dtmf' ? 'e.g. 1#' : 'Extension or number';
      if (toolId === 'dtmf') {
        field.inputMode = 'tel';
      }
      field.value = drafts.get(`${call.id}:${toolId}`) ?? '';
      field.addEventListener('input', () => {
        drafts.set(`${call.id}:${toolId}`, field.value);
      });
    }
    const modeInfo = TRANSFER_MODES.find((option) => option.id === mode);
    submit.textContent = modeInfo ? modeInfo.submit : 'Send';
    field.id = inputId;
    field.className = 'call-panel-input';
    field.dataset.callId = call.id;
    formRow.append(label, field, submit);
    panel.append(formRow);

    if (modeInfo) {
      const hint = document.createElement('p');
      hint.className = 'panel-hint';
      hint.textContent = modeInfo.hint;
      panel.append(hint);
    }

    closeOnEscape(panel, call, toolId);

    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = field.value.trim();
      if (!value) {
        return;
      }
      if (toolId === 'dtmf') {
        runAction(callControl.sendDTMF(call.id, value)).then(
          () => {
            drafts.delete(`${call.id}:dtmf`);
            field.value = '';
          },
          () => undefined,
        );
      } else if (mode === 'attended') {
        runAction(callControl.attendedTransfer(call.id, value)).catch(() => undefined);
      } else {
        const sent =
          mode === 'conference' ? callControl.conferenceTransfer(call.id, value) : callControl.transfer(call.id, value);
        runAction(sent).then(
          () => {
            drafts.delete(`${call.id}:transfer`);
            openTool.delete(call.id);
            renderCalls();
          },
          () => undefined,
        );
      }
    });

    return panel;
  }

  /** One button per recording action; only the ones the PBX accepts in the call's recording state are enabled. */
  function buildRecordPanel(call, panelId) {
    const panel = document.createElement('div');
    panel.className = 'call-panel';
    panel.id = panelId;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Recording');

    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const allowed = RECORD_ACTIONS_FOR_STATE[call.recording];
    let focusTargetMarked = false;
    for (const action of RECORD_ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.recordAction = action.value;
      if (action.icon) {
        button.append(iconElement(action.icon));
      } else {
        const glyph = document.createElement('span');
        glyph.className = `record-glyph record-glyph-${action.value}`;
        glyph.setAttribute('aria-hidden', 'true');
        button.append(glyph);
      }
      button.append(action.label);
      button.disabled = allowed !== undefined && !allowed.includes(action.value);
      // The first available action is where focus lands when the panel opens (see renderCalls).
      if (!button.disabled && !focusTargetMarked) {
        button.classList.add('call-panel-input');
        button.dataset.callId = call.id;
        focusTargetMarked = true;
      }
      button.addEventListener('click', () => {
        runAction(callControl.record(call.id, action.value)).catch(() => undefined);
      });
      actions.append(button);
    }

    const hint = document.createElement('p');
    hint.className = 'panel-hint';
    hint.textContent = 'Needs the recording right on the PBX.';
    panel.append(actions, hint);
    closeOnEscape(panel, call, 'record');
    return panel;
  }

  function renderCalls() {
    const focused = document.activeElement;
    const refocusCallId =
      focusToolInputFor ??
      (focused?.classList?.contains('call-panel-input') && callsSection.contains(focused)
        ? focused.dataset.callId
        : undefined);
    focusToolInputFor = undefined;

    if (calls.length === 0) {
      renderNoCalls();
      return;
    }

    callsSection.replaceChildren();
    for (const call of calls) {
      if (!callStartedAt.has(call.id)) {
        callStartedAt.set(call.id, Date.now());
      }
      const otherCalls = calls.filter((c) => c.id !== call.id);
      const capabilities = getCallCapabilities(call);
      const toolEnabled = {
        dtmf: capabilities.dtmf,
        transfer: capabilities.transfer,
        record: capabilities.record,
      };
      // A panel whose action is no longer possible (e.g. DTMF after Hold) closes itself.
      if (openTool.has(call.id) && !toolEnabled[openTool.get(call.id)]) {
        openTool.delete(call.id);
      }
      const activeTool = openTool.get(call.id);
      const panelId = `call-panel-${extension}-${call.id}`.replace(/[^A-Za-z0-9_-]/g, '-');

      const row = document.createElement('div');
      row.className = 'call-row';
      row.dataset.callId = call.id;
      row.innerHTML = `
        <div class="call-info">
          <span class="call-direction" role="img"></span>
          <div class="call-who">
            <span class="call-name"></span>
            <span class="call-meta"></span>
          </div>
          <div class="call-status">
            <span class="call-state"></span>
            <span class="call-recording" hidden></span>
            <span class="call-timer"></span>
          </div>
        </div>
        <div class="call-form-row is-wide answer-on" hidden>
          <label>Answer on</label>
          <select class="answer-device"><option value="">(any device)</option></select>
        </div>
        <div class="call-buttons">
          <button data-action="answer" type="button">${iconMarkup(Icons.answer)}Answer</button>
          <button data-action="hold" type="button">${iconMarkup(Icons.hold)}Hold</button>
          <button data-action="resume" type="button">${iconMarkup(Icons.resume)}Resume</button>
          <button data-action="hangup" type="button">${iconMarkup(Icons.hangup)}Hang up</button>
        </div>
        <div class="call-tools" role="group" aria-label="More call actions">
          ${CALL_TOOLS.map(
            (tool) =>
              `<button type="button" data-tool="${tool.id}" aria-controls="${panelId}">${iconMarkup(tool.icon)}${tool.label}</button>`,
          ).join('')}
        </div>
      `;

      const isInbound = call.direction === 'inbound';
      const directionElement = row.querySelector('.call-direction');
      directionElement.replaceChildren(iconElement(isInbound ? Icons.inbound : Icons.outbound));
      directionElement.dataset.direction = isInbound ? 'inbound' : 'outbound';
      directionElement.title = isInbound ? 'Incoming' : 'Outgoing';
      directionElement.setAttribute('aria-label', directionElement.title);

      const name = call.remoteName || call.remoteNumber || 'Unknown caller';
      row.querySelector('.call-name').textContent = name;
      const meta = row.querySelector('.call-meta');
      meta.append(isInbound ? 'Incoming' : 'Outgoing');
      if (call.remoteName && call.remoteNumber) {
        const number = document.createElement('span');
        number.className = 'call-number';
        number.textContent = call.remoteNumber;
        meta.append(' · ', number);
      }

      const stateElement = row.querySelector('.call-state');
      stateElement.textContent = CALL_STATE_LABEL[call.state] ?? call.state;
      stateElement.dataset.state = call.state;

      const recordingElement = row.querySelector('.call-recording');
      const recordingLabel = RECORDING_LABEL[call.recording];
      recordingElement.hidden = !recordingLabel;
      recordingElement.textContent = recordingLabel ?? '';
      recordingElement.dataset.recording = call.recording ?? '';

      const timer = row.querySelector('.call-timer');
      timer.dataset.started = String(callStartedAt.get(call.id));
      timer.textContent = formatDuration(Date.now() - callStartedAt.get(call.id));

      const answerOn = row.querySelector('.answer-on');
      const deviceSelect = row.querySelector('.answer-device');
      const answerSelectId = `${panelId}-answer`;
      deviceSelect.id = answerSelectId;
      answerOn.querySelector('label').htmlFor = answerSelectId;
      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.uri;
        option.textContent = getDeviceDisplayName(device);
        deviceSelect.appendChild(option);
      }
      deviceSelect.value = findDefaultDeviceUri();
      // Only a ringing inbound call can be answered, so the device picker only shows then.
      answerOn.hidden = !capabilities.answer;

      for (const action of ['answer', 'hold', 'resume', 'hangup']) {
        row.querySelector(`[data-action="${action}"]`).disabled = !capabilities[action];
      }

      row.querySelector('[data-action="answer"]').addEventListener('click', () => {
        runAction(callControl.answer(call.id, deviceSelect.value || undefined)).catch(() => undefined);
      });
      row.querySelector('[data-action="hold"]').addEventListener('click', () => {
        runAction(callControl.hold(call.id)).catch(() => undefined);
      });
      row.querySelector('[data-action="resume"]').addEventListener('click', () => {
        runAction(callControl.resume(call.id)).catch(() => undefined);
      });
      row.querySelector('[data-action="hangup"]').addEventListener('click', () => {
        runAction(callControl.hangup(call.id)).catch(() => undefined);
      });

      for (const tool of CALL_TOOLS) {
        const button = row.querySelector(`[data-tool="${tool.id}"]`);
        button.disabled = !toolEnabled[tool.id];
        button.setAttribute('aria-expanded', String(activeTool === tool.id));
        if (tool.id === 'record') {
          // Lets the Record button turn red while the PBX actually records the call (see style.css).
          button.dataset.recording = call.recording ?? '';
        }
        button.addEventListener('click', () => {
          if (openTool.get(call.id) === tool.id) {
            openTool.delete(call.id);
          } else {
            openTool.set(call.id, tool.id);
            focusToolInputFor = call.id;
          }
          renderCalls();
        });
      }

      if (activeTool) {
        row.append(buildToolPanel(call, activeTool, otherCalls, panelId));
      }

      callsSection.appendChild(row);
    }

    if (refocusCallId) {
      callsSection.querySelector(`.call-panel-input[data-call-id="${CSS.escape(refocusCallId)}"]`)?.focus();
    }
  }

  function renderPresence() {
    renderPresenceDot(presenceDot, presence?.status);
    statusMessage.textContent = presence?.message ?? '';
    statusMessage.hidden = !presence?.message;
  }

  function renderDevices() {
    devicesList.replaceChildren();
    devicesCount.textContent = String(devices.length);
    for (const device of devices) {
      const item = document.createElement('li');
      item.className = 'device-chip';
      const name = document.createElement('span');
      name.className = 'device-name';
      name.textContent = getDeviceDisplayName(device);
      name.title = device.userAgent || name.textContent;
      item.append(iconElement(device.isLocalRegistration ? Icons.localDevice : Icons.device), name);
      if (device.isLocalRegistration) {
        const tag = document.createElement('span');
        tag.className = 'device-tag';
        tag.textContent = 'this session';
        item.append(tag);
      }
      devicesList.appendChild(item);
    }
  }

  let deviceTargetPicked = false;
  makeCallDeviceSelect.addEventListener('change', () => {
    deviceTargetPicked = true;
  });

  function renderMakeCallDeviceOptions() {
    const callableDevices = getCallableDevices();
    // "(any device)" only means something when there's at least one real device for the PBX to ring. Mobile
    // (callback) rings the user's mobile number and needs no registered device, so the form stays usable without one.
    const hasDevices = callableDevices.length > 0;

    const previousValue = makeCallDeviceSelect.value;
    makeCallDeviceSelect.replaceChildren();
    if (hasDevices) {
      const anyOption = document.createElement('option');
      anyOption.value = '';
      anyOption.textContent = '(any device)';
      makeCallDeviceSelect.appendChild(anyOption);
    }
    const mobilityOption = document.createElement('option');
    mobilityOption.value = MOBILITY_TARGET;
    mobilityOption.textContent = 'Mobile (callback)';
    makeCallDeviceSelect.appendChild(mobilityOption);
    for (const device of callableDevices) {
      const option = document.createElement('option');
      option.value = device.uri;
      option.textContent = getDeviceDisplayName(device);
      makeCallDeviceSelect.appendChild(option);
    }
    // Only a target the person picked survives a device change; the automatic pick follows the devices, so the
    // Mobile (callback) fallback shown before any device is known gives way to x-bees once it registers.
    const keepPick =
      deviceTargetPicked &&
      (previousValue === MOBILITY_TARGET ||
        (previousValue === '' && hasDevices) ||
        callableDevices.some((device) => device.uri === previousValue));
    if (keepPick) {
      makeCallDeviceSelect.value = previousValue;
    } else {
      makeCallDeviceSelect.value = hasDevices ? findDefaultDeviceUri() : MOBILITY_TARGET;
    }
  }

  // Fills the device picker before the first devicesChanged notification arrives: with no devices known yet
  // only Mobile (callback) is offered.
  renderMakeCallDeviceOptions();
  renderDevices();
  renderNoCalls();

  callControl.on('registered', () => {
    setStatus('connected');
    logEvent('registered');
    forwardEvent('registered', undefined);
  });
  callControl.on('reconnecting', (info) => {
    setStatus('reconnecting');
    logEvent('reconnecting', `attempt ${info.attempt}`);
    forwardEvent('reconnecting', info);
  });
  callControl.on('error', (error) => {
    showError(error.message);
    logEvent('error', error.message, true);
    forwardEvent('error', { message: error.message });
  });

  callControl.on('callStart', (call) => {
    setCalls(callControl.getActiveCalls());
    logEvent('callStart', call.id);
    forwardEvent('callStart', call);
  });
  callControl.on('callUpdate', (call) => {
    setCalls(callControl.getActiveCalls());
    logEvent('callUpdate', `${call.id} → ${call.state}`);
    forwardEvent('callUpdate', call);
  });
  callControl.on('callEnd', (call) => {
    setCalls(callControl.getActiveCalls());
    logEvent('callEnd', call.id);
    forwardEvent('callEnd', call);
  });

  callControl.on('devicesChanged', (nextDevices) => {
    devices = nextDevices;
    renderDevices();
    renderCalls();
    renderMakeCallDeviceOptions();
    logEvent('devicesChanged', `${nextDevices.length} device${nextDevices.length === 1 ? '' : 's'}`);
    forwardEvent('devicesChanged', nextDevices);
  });
  callControl.on('presenceChanged', (nextPresence) => {
    presence = nextPresence;
    renderPresence();
    logEvent('presenceChanged', nextPresence.status ?? '');
    forwardEvent('presenceChanged', nextPresence);
  });
  callControl.on('activeDeviceChanged', (nextActiveDevice) => {
    logEvent('activeDeviceChanged', nextActiveDevice.type);
    forwardEvent('activeDeviceChanged', nextActiveDevice);
  });

  makeCallForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const destination = makeCallDestination.value.trim();
    if (!destination) {
      return;
    }
    const target = makeCallDeviceSelect.value;
    const placed =
      target === MOBILITY_TARGET
        ? callControl.makeMobilityCall(destination)
        : callControl.makeCall(destination, target || undefined);
    runAction(placed).catch(() => undefined);
    makeCallDestination.value = '';
  });

  removeBtn.addEventListener('click', () => {
    onRemove();
  });

  return {
    card,
    callControl,
    extension,
    getStatus: () => status,
    getCallCount: () => calls.length,
    connect: () =>
      callControl.connect().catch((error) => {
        setStatus('error');
        showError(error.message);
      }),
  };
}
