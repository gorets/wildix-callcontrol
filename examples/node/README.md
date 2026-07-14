# Node.js example

Watches call, device, and presence events for one extension and logs them to the console.

## Run

1. From the repository root: `npm install && npm run build`
2. Set the three required environment variables and run the example:

   ```bash
   CALLCONTROL_PBX_ADDRESS=your-pbx.wildixin.com \
   CALLCONTROL_EXTENSION=10090 \
   CALLCONTROL_SIP_PASSWORD=your-sip-password \
   node examples/node/index.mjs
   ```

3. Place or receive a real call on that extension's phone/softphone and watch the console for `callStart`/`callUpdate`/`callEnd` events.

This is a manual verification tool, not an automated test — it requires a real, reachable Wildix PBX.
