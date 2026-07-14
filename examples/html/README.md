# Browser example

A framework-free HTML page that connects to a PBX from the browser and logs call/device/presence events.

## Run

1. From the repository root: `npm install && npm run build`
2. Serve the repository root over HTTP — ES module import maps require an HTTP(S) origin, `file://` will not work:

   ```bash
   npx serve .
   ```

3. Open `http://localhost:3000/examples/html/index.html` (adjust the port to whatever `serve` printed).
4. Fill in the PBX address, extension, and SIP password, click Connect, and watch the browser console.

If the page fails to load with a module resolution error for `sip.js` or `ltx`, open the respective package's
`package.json` and check its `main`/`module`/`exports` field — the import map in `index.html` assumes
`sip.js/lib/index.js` and `ltx/src/ltx.js`; adjust the corresponding entry in the `<script type="importmap">`
block to match whatever path is actually correct for the installed version.

`events` is mapped to a small local shim (`event-emitter-shim.mjs`), not to the real `node_modules/events`
package — Node's `events` package ships as CommonJS and can't be loaded directly by a native
`<script type="module">` import map without a bundler. The library itself and its `ltx` dependency both
import the bare specifier `events`; the shim implements just enough of Node's `EventEmitter` API
(`on`/`once`/`off`/`emit`) for both to work.

This is a manual verification tool, not an automated test — it requires a real, reachable Wildix PBX.
