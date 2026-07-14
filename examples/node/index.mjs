import { CallControl } from '../../dist/index.mjs';

// sip.js's own log levels, from least to most verbose. 'debug' is where the
// full raw SIP message dumps come from.
const LOG_LEVEL_RANK = { error: 0, warn: 1, log: 2, debug: 3 };
const MIN_LOG_LEVEL = 'warn'; // show log/warn/error, skip the noisy 'debug' dumps

const callControl = new CallControl({
  pbxAddress: process.env.CALLCONTROL_PBX_ADDRESS,
  extension: process.env.CALLCONTROL_EXTENSION,
  sipPassword: process.env.CALLCONTROL_SIP_PASSWORD,
  userAgent: 'callcontrol-node-example',
  // `logger` receives every sip.js log line regardless of `logLevel` (that
  // option only filters the built-in console writer, which is off here via
  // `logToConsole: false`) — so filtering by level is up to the logger itself.
  logger: (level, category, _label, content) => {
    if (LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK[MIN_LOG_LEVEL]) return;
    console.log(`[sip.js:${level}] ${category}`, content);
  },
  logToConsole: false, // avoid duplicate output — the logger above already prints to the console
});

callControl.on('registered', () => console.log('✅ [callcontrol] registered'));
callControl.on('reconnecting', (info) => console.log('🔄 [callcontrol] reconnecting', info));
callControl.on('error', (error) => console.error('❌ [callcontrol] error', error));
callControl.on('callStart', (call) => console.log('📞 [callcontrol] callStart', call));
callControl.on('callUpdate', (call) => console.log('🔃 [callcontrol] callUpdate', call));
callControl.on('callEnd', (call) => console.log('📴 [callcontrol] callEnd', call));
callControl.on('devicesChanged', (devices) => console.log('📱 [callcontrol] devicesChanged', devices));
callControl.on('presenceChanged', (presence) => console.log('🟢 [callcontrol] presenceChanged', presence));
callControl.on('activeDeviceChanged', (activeDevice) =>
  console.log('🎯 [callcontrol] activeDeviceChanged', activeDevice),
);

await callControl.connect();
console.log('🚀 Connected. Watching for call events on this extension — press Ctrl+C to exit.');
