import { CallControl, KNOWN_DEVICE_NAMES } from '../../dist/index.mjs';
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
// lowercased string from the PBX), so unrecognized values fall back to ⚪.
const PRESENCE_EMOJI = {
  online: '🟢',
  away: '🟡',
  dnd: '🔴',
  offline: '⚪',
  'only-sip': '🔵',
};

function getPresenceEmoji(status) {
  return PRESENCE_EMOJI[status] ?? '⚪';
}

function getCallCapabilities(call) {
  if (call.state === 'ringing') {
    return { ...NO_CAPABILITIES, answer: call.direction === 'inbound', hangup: true };
  }
  if (call.state === 'answered') {
    return { ...NO_CAPABILITIES, hold: true, hangup: true, dtmf: true, transfer: true, attendedTransfer: true };
  }
  if (call.state === 'held') {
    return { ...NO_CAPABILITIES, resume: true, hangup: true, transfer: true, attendedTransfer: true };
  }
  return NO_CAPABILITIES;
}

export function createUserSession({ pbxAddress, extension, sipPassword, getWebhookUrl, onRemove }) {
  const callControl = new CallControl({
    pbxAddress,
    extension,
    sipPassword,
    userAgent: 'wildix-callcontrol-dashboard',
  });

  let calls = [];
  let devices = [];
  let presence;

  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <header class="card-header">
      <div class="card-title-group">
        <h2 class="card-title">
          <span class="card-title-text"></span>
          <span class="presence-icon">⚪</span>
        </h2>
        <p class="status-message" hidden></p>
      </div>
      <span class="status-badge status-connecting">connecting</span>
      <button class="remove-btn" type="button">Remove</button>
    </header>
    <div class="error-banner" hidden>
      <span class="error-message"></span>
      <button class="error-dismiss" type="button">✕</button>
    </div>
    <section class="calls"></section>
    <form class="make-call-form">
      <select class="make-call-device"><option value="">(any device)</option></select>
      <div class="make-call-destination-group">
        <input class="make-call-destination" placeholder="destination" required />
        <button type="submit">Call</button>
      </div>
    </form>
    <section class="devices">
      <h3>Devices</h3>
      <ul class="devices-list"></ul>
    </section>
    <details class="event-log">
      <summary>Event log</summary>
      <ul class="event-log-list"></ul>
    </details>
  `;

  card.querySelector('.card-title-text').textContent = extension;

  const statusBadge = card.querySelector('.status-badge');
  const errorBanner = card.querySelector('.error-banner');
  const errorMessage = card.querySelector('.error-message');
  const eventLogList = card.querySelector('.event-log-list');
  const removeBtn = card.querySelector('.remove-btn');
  const callsSection = card.querySelector('.calls');
  const makeCallForm = card.querySelector('.make-call-form');
  const makeCallDestination = card.querySelector('.make-call-destination');
  const makeCallDeviceSelect = card.querySelector('.make-call-device');
  const makeCallSubmitBtn = card.querySelector('.make-call-form button[type="submit"]');
  const presenceIcon = card.querySelector('.presence-icon');
  const statusMessage = card.querySelector('.status-message');
  const devicesList = card.querySelector('.devices-list');

  card.querySelector('.error-dismiss').addEventListener('click', () => {
    errorBanner.hidden = true;
  });

  function logEvent(text) {
    const item = document.createElement('li');
    item.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
    eventLogList.prepend(item);
  }

  function forwardEvent(eventName, data) {
    const url = getWebhookUrl?.();
    if (!url) {
      return;
    }
    postWebhookEvent(url, { event: eventName, extension, pbxAddress, timestamp: new Date().toISOString(), data }).then(
      (result) => {
        if (!result.ok) {
          logEvent(`webhook delivery failed: ${eventName} (${result.reason})`);
        }
      },
    );
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
  }

  function setStatus(status) {
    statusBadge.textContent = status;
    statusBadge.className = `status-badge status-${status}`;
  }

  function runAction(promise) {
    promise.catch((error) => showError(error.message));
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

  function renderCalls() {
    callsSection.innerHTML = '';
    for (const call of calls) {
      const otherCalls = calls.filter((c) => c.id !== call.id);
      const row = document.createElement('div');
      row.className = 'call-row';
      row.innerHTML = `
        <div class="call-info">
          <span class="call-direction"></span>
          <span class="call-name"></span>
          <span class="call-number"></span>
          <span class="call-state"></span>
        </div>
        <div class="call-actions">
          <select class="answer-device"><option value="">(any device)</option></select>
          <button data-action="answer" type="button">✅ Answer</button>
          <button data-action="hold" type="button">⏸️ Hold</button>
          <button data-action="resume" type="button">▶️ Resume</button>
          <button data-action="hangup" type="button">📴 Hangup</button>
          <input class="dtmf-input" placeholder="digits" size="4" />
          <button data-action="dtmf" type="button">🔢 DTMF</button>
          <input class="transfer-destination" placeholder="transfer to" />
          <button data-action="transfer" type="button">↪️ Transfer</button>
          <select class="attended-transfer-target"><option value="">(pick call)</option></select>
          <button data-action="attended-transfer" type="button">🤝 Attended transfer</button>
        </div>
      `;

      row.querySelector('.call-direction').textContent = call.direction === 'inbound' ? '←' : '→';
      row.querySelector('.call-name').textContent = call.remoteName ?? '';
      row.querySelector('.call-number').textContent = call.remoteNumber ?? '';
      row.querySelector('.call-state').textContent = `[${CALL_STATE_LABEL[call.state] ?? call.state}]`;

      const deviceSelect = row.querySelector('.answer-device');
      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.uri;
        option.textContent = getDeviceDisplayName(device);
        deviceSelect.appendChild(option);
      }
      deviceSelect.value = findDefaultDeviceUri();

      const otherCallSelect = row.querySelector('.attended-transfer-target');
      for (const otherCall of otherCalls) {
        const option = document.createElement('option');
        option.value = otherCall.id;
        option.textContent = otherCall.remoteName ?? otherCall.remoteNumber ?? otherCall.id;
        otherCallSelect.appendChild(option);
      }

      const capabilities = getCallCapabilities(call);
      const attendedTransferEnabled = capabilities.attendedTransfer && otherCalls.length > 0;

      deviceSelect.disabled = !capabilities.answer;
      row.querySelector('[data-action="answer"]').disabled = !capabilities.answer;
      row.querySelector('[data-action="hold"]').disabled = !capabilities.hold;
      row.querySelector('[data-action="resume"]').disabled = !capabilities.resume;
      row.querySelector('[data-action="hangup"]').disabled = !capabilities.hangup;
      row.querySelector('.dtmf-input').disabled = !capabilities.dtmf;
      row.querySelector('[data-action="dtmf"]').disabled = !capabilities.dtmf;
      row.querySelector('.transfer-destination').disabled = !capabilities.transfer;
      row.querySelector('[data-action="transfer"]').disabled = !capabilities.transfer;
      otherCallSelect.disabled = !attendedTransferEnabled;
      row.querySelector('[data-action="attended-transfer"]').disabled = !attendedTransferEnabled;

      row.querySelector('[data-action="answer"]').addEventListener('click', () => {
        runAction(callControl.answer(call.id, deviceSelect.value || undefined));
      });
      row.querySelector('[data-action="hold"]').addEventListener('click', () => {
        runAction(callControl.hold(call.id));
      });
      row.querySelector('[data-action="resume"]').addEventListener('click', () => {
        runAction(callControl.resume(call.id));
      });
      row.querySelector('[data-action="hangup"]').addEventListener('click', () => {
        runAction(callControl.hangup(call.id));
      });
      row.querySelector('[data-action="dtmf"]').addEventListener('click', () => {
        const digits = row.querySelector('.dtmf-input').value.trim();
        if (digits) {
          runAction(callControl.sendDTMF(call.id, digits));
        }
      });
      row.querySelector('[data-action="transfer"]').addEventListener('click', () => {
        const destination = row.querySelector('.transfer-destination').value.trim();
        if (destination) {
          runAction(callControl.transfer(call.id, destination));
        }
      });
      row.querySelector('[data-action="attended-transfer"]').addEventListener('click', () => {
        if (otherCallSelect.value) {
          runAction(callControl.attendedTransfer(call.id, otherCallSelect.value));
        }
      });

      callsSection.appendChild(row);
    }
  }

  function renderPresence() {
    presenceIcon.textContent = getPresenceEmoji(presence?.status);
    presenceIcon.title = presence?.status ?? 'unknown';
    statusMessage.textContent = presence?.message ?? '';
    statusMessage.hidden = !presence?.message;
  }

  function renderDevices() {
    devicesList.innerHTML = '';
    for (const device of devices) {
      const item = document.createElement('li');
      item.textContent = `${getDeviceDisplayName(device)}${device.isLocalRegistration ? ' (this session)' : ''}`;
      devicesList.appendChild(item);
    }
  }

  function renderMakeCallDeviceOptions() {
    const callableDevices = getCallableDevices();

    const previousValue = makeCallDeviceSelect.value;
    makeCallDeviceSelect.innerHTML = '<option value="">(any device)</option>';
    for (const device of callableDevices) {
      const option = document.createElement('option');
      option.value = device.uri;
      option.textContent = getDeviceDisplayName(device);
      makeCallDeviceSelect.appendChild(option);
    }
    if (callableDevices.some((device) => device.uri === previousValue)) {
      makeCallDeviceSelect.value = previousValue;
    } else {
      makeCallDeviceSelect.value = findDefaultDeviceUri();
    }

    // "(any device)" only means something when there's at least one real
    // device for the PBX to ring — with none, calling isn't possible at all.
    const canCall = callableDevices.length > 0;
    makeCallDestination.disabled = !canCall;
    makeCallDeviceSelect.disabled = !canCall;
    makeCallSubmitBtn.disabled = !canCall;
    makeCallDestination.placeholder = canCall ? 'destination' : 'no devices to call through';
  }

  // Starts the make-call form disabled (devices is still empty at this
  // point) instead of leaving it enabled with a meaningless "(any device)"
  // until the first devicesChanged notification arrives.
  renderMakeCallDeviceOptions();

  callControl.on('registered', () => {
    setStatus('connected');
    logEvent('registered');
    forwardEvent('registered', undefined);
  });
  callControl.on('reconnecting', (info) => {
    setStatus('reconnecting');
    logEvent(`reconnecting (attempt ${info.attempt})`);
    forwardEvent('reconnecting', info);
  });
  callControl.on('error', (error) => {
    showError(error.message);
    logEvent(`error: ${error.message}`);
    forwardEvent('error', { message: error.message });
  });

  callControl.on('callStart', (call) => {
    calls = callControl.getActiveCalls();
    renderCalls();
    logEvent(`callStart ${call.id}`);
    forwardEvent('callStart', call);
  });
  callControl.on('callUpdate', (call) => {
    calls = callControl.getActiveCalls();
    renderCalls();
    logEvent(`callUpdate ${call.id} → ${call.state}`);
    forwardEvent('callUpdate', call);
  });
  callControl.on('callEnd', (call) => {
    calls = callControl.getActiveCalls();
    renderCalls();
    logEvent(`callEnd ${call.id}`);
    forwardEvent('callEnd', call);
  });

  callControl.on('devicesChanged', (nextDevices) => {
    devices = nextDevices;
    renderDevices();
    renderCalls();
    renderMakeCallDeviceOptions();
    logEvent('devicesChanged');
    forwardEvent('devicesChanged', nextDevices);
  });
  callControl.on('presenceChanged', (nextPresence) => {
    presence = nextPresence;
    renderPresence();
    logEvent(`presenceChanged → ${nextPresence.status}`);
    forwardEvent('presenceChanged', nextPresence);
  });
  callControl.on('activeDeviceChanged', (nextActiveDevice) => {
    logEvent(`activeDeviceChanged → ${nextActiveDevice.type}`);
    forwardEvent('activeDeviceChanged', nextActiveDevice);
  });

  makeCallForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const destination = makeCallDestination.value.trim();
    if (!destination) {
      return;
    }
    runAction(callControl.makeCall(destination, makeCallDeviceSelect.value || undefined));
    makeCallDestination.value = '';
  });

  removeBtn.addEventListener('click', () => {
    onRemove();
  });

  return {
    card,
    callControl,
    connect: () =>
      callControl.connect().catch((error) => {
        setStatus('error');
        showError(error.message);
      }),
  };
}
