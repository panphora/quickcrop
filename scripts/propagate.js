#!/usr/bin/env node
// Copies quickcrop.js into every client that vendors it, swapping the standalone
// export footer for that client's own footer.
//
// The destinations live in one table because a fix that reaches one client and
// not the other is how quickcrop stayed missing from clayjs: hyperclayjs had a
// copy script, clayjs had nothing, and clayjs's own CMS bundle went on naming
// `quickcrop` in a capability lookup that could never resolve. A missing path is
// a failure here, not a destination to skip quietly.
//
// `--only <client>` narrows to one client; `--check` writes nothing and exits 1
// naming every destination that is missing or stale.
//
// After adding a destination, register the module in that client:
//   hyperclayjs — build/generate-dependency-graph.js (MODULE_DEFINITIONS), then `npm run build`
//   clayjs      — src/loader-logic.js (PLUGIN_PATHS + PLUGIN_ORDER) and attachPluginMember in src/loader.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(dir, '..');
const workspace = path.join(rootDir, '..');
const src = path.join(rootDir, 'quickcrop.js');

// hyperclayjs auto-attaches every module to window.hyperclay; clayjs suppresses
// that (__hyperclayNoAutoExport) and assembles window.clay in its loader, so its
// copy only exports. Both keep the `export default` that follows the markers.
const FOOTERS = {
  hyperclayjs: `// __QC_EXPORT_START__
if (!window.__hyperclayNoAutoExport) {
  window.quickcrop = quickcrop;
  window.hyperclay = window.hyperclay || {};
  window.hyperclay.quickcrop = quickcrop;
  window.h = window.hyperclay;
}
// __QC_EXPORT_END__`,
  clayjs: `// __QC_EXPORT_START__
// clayjs assembles window.clay in its loader and writes no auto-export globals,
// so this copy only exports. The loader attaches it as clay.quickcrop, which is
// where the vendored hypercms bundle looks for the cropper.
export { quickcrop };
// __QC_EXPORT_END__`,
};

const DESTINATIONS = [
  { client: 'hyperclayjs', path: 'hyperclayjs/src/ui/quickcrop.js' },
  { client: 'clayjs', path: 'clayjs/src/vendor/quickcrop.vendor.js' },
];

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

const clients = [...new Set(DESTINATIONS.map(destination => destination.client))];

if (onlyIndex !== -1 && !only) {
  console.error(`Error: --only needs a client name. Known clients: ${clients.join(', ')}.`);
  process.exit(1);
}

const targets = only ? DESTINATIONS.filter(destination => destination.client === only) : DESTINATIONS;

if (!targets.length) {
  console.error(`Error: no destination for client "${only}". Known clients: ${clients.join(', ')}.`);
  process.exit(1);
}

const js = fs.readFileSync(src, 'utf8');
const pattern = /\/\/ __QC_EXPORT_START__[\s\S]*?\/\/ __QC_EXPORT_END__/;
if (!pattern.test(js)) throw new Error('propagate: export markers not found in quickcrop.js');

const contentFor = client => {
  const footer = FOOTERS[client];
  if (!footer) throw new Error(`propagate: no footer defined for client "${client}"`);
  return js.replace(pattern, footer);
};

if (isCheck) {
  const stale = targets.filter(destination => {
    const file = path.join(workspace, destination.path);
    if (!fs.existsSync(file)) return true;
    return fs.readFileSync(file, 'utf8') !== contentFor(destination.client);
  });
  stale.forEach(destination => {
    const file = path.join(workspace, destination.path);
    console.error(`✗ ${fs.existsSync(file) ? 'stale' : 'missing'}: ${destination.path}`);
  });
  if (stale.length) process.exit(1);
  targets.forEach(destination => console.log(`✓ in sync ${destination.path}`));
  process.exit(0);
}

const missing = targets.filter(
  destination => !fs.existsSync(path.dirname(path.join(workspace, destination.path)))
);
if (missing.length) {
  missing.forEach(destination => {
    console.error(`Error: destination folder not found for ${destination.path}`);
  });
  console.error(`Every destination is resolved against ${workspace}.`);
  process.exit(1);
}

targets.forEach(destination => {
  fs.writeFileSync(path.join(workspace, destination.path), contentFor(destination.client), 'utf8');
  console.log(`✓ Updated ${destination.path}`);
});
