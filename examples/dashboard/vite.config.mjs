import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite's project root is this directory (examples/dashboard), but the demo
// imports the library from ../../dist and Node resolves sip.js/ltx from the
// repo root's node_modules — allow serving files from the whole repo.
//
// base is relative only for `vite build`: the built output is meant to be
// served from a GitHub Pages project subpath (e.g. /<repo>/), whose exact
// prefix isn't known here, so asset URLs must resolve relative to the HTML
// file rather than absolute from site root. The dev server keeps the
// default absolute '/' base, which `vite examples/dashboard` already relies on.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: {
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
}));
