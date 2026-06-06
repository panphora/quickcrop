#!/usr/bin/env node
// Keeps the generated files in sync with their sources of truth:
//   - package.json "version"  -> quickcrop.js banner + the version pin in README.md and llms.txt
//   - quickcrop.css           -> the embedded CSS const in quickcrop.js used for self-injection
// Run via `npm run build`; also runs automatically on `prepublishOnly`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsPath = path.join(dir, 'quickcrop.js');

const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const css = fs
  .readFileSync(path.join(dir, 'quickcrop.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '') // strip comments
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}:;,])\s*/g, '$1') // drop space around structural chars, keep it inside values
  .trim()
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

let js = fs.readFileSync(jsPath, 'utf8');
const before = js;

js = js.replace(/quickcrop v\d+\.\d+\.\d+/, 'quickcrop v' + pkg.version);
js = js.replace(/const CSS = `[^`]*`;/, () => 'const CSS = `' + css + '`;');

if (!/quickcrop v\d+\.\d+\.\d+/.test(js)) throw new Error('build: version banner not found in quickcrop.js');
if (!/const CSS = `[^`]*`;/.test(js)) throw new Error('build: CSS const not found in quickcrop.js');

if (js !== before) {
  fs.writeFileSync(jsPath, js);
  console.log('quickcrop.js synced: v' + pkg.version + ', CSS ' + css.length + ' chars');
} else {
  console.log('quickcrop.js already in sync: v' + pkg.version);
}

for (const name of ['README.md', 'llms.txt']) {
  const docPath = path.join(dir, name);
  const doc = fs.readFileSync(docPath, 'utf8');
  const synced = doc.replace(/quickcrop@\d+\.\d+\.\d+/g, 'quickcrop@' + pkg.version);

  if (!/quickcrop@\d+\.\d+\.\d+/.test(synced)) throw new Error('build: version pin not found in ' + name);

  if (synced !== doc) {
    fs.writeFileSync(docPath, synced);
    console.log(name + ' synced: v' + pkg.version);
  } else {
    console.log(name + ' already in sync: v' + pkg.version);
  }
}
