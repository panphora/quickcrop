#!/usr/bin/env node
// Copies quickcrop.js into hyperclayjs as src/ui/quickcrop.js, swapping the
// standalone export footer for the hyperclayjs auto-export footer.
// After copying, register the module in hyperclayjs/build/generate-dependency-graph.js
// (MODULE_DEFINITIONS) and run `npm run build` there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'quickcrop.js');
const destDir = path.join(dir, '..', 'hyperclayjs', 'src', 'ui');
const dest = path.join(destDir, 'quickcrop.js');

if (!fs.existsSync(destDir)) throw new Error('copy-to-hyperclayjs: ' + destDir + ' not found');

const FOOTER = `// __QC_EXPORT_START__
if (!window.__hyperclayNoAutoExport) {
  window.quickcrop = quickcrop;
  window.hyperclay = window.hyperclay || {};
  window.hyperclay.quickcrop = quickcrop;
  window.h = window.hyperclay;
}
// __QC_EXPORT_END__`;

let js = fs.readFileSync(src, 'utf8');
const pattern = /\/\/ __QC_EXPORT_START__[\s\S]*?\/\/ __QC_EXPORT_END__/;
if (!pattern.test(js)) throw new Error('copy-to-hyperclayjs: export markers not found in quickcrop.js');
js = js.replace(pattern, FOOTER);

fs.writeFileSync(dest, js);
console.log('copied quickcrop.js -> ' + path.relative(path.join(dir, '..'), dest));
