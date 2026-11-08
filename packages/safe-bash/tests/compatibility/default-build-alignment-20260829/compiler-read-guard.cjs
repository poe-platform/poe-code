const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const admission = JSON.parse(fs.readFileSync(process.env.SAFE_BASH_INPUT_ADMISSION, 'utf8'));
const sourceRoot = path.resolve(admission.repo, 'src') + path.sep;
const allowed = new Set(admission.selectedPaths.map(filename => path.resolve(admission.repo, filename)));
function admit(filename) {
  if (typeof filename === 'number') return;
  const resolved = path.resolve(filename instanceof URL ? fileURLToPath(filename) : Buffer.isBuffer(filename) ? filename.toString() : filename);
  if (resolved.startsWith(sourceRoot) && !allowed.has(resolved)) {
    throw new Error('Unselected source content read refused: ' + resolved);
  }
}
for (const name of ['readFileSync', 'readFile', 'openSync', 'open']) {
  const original = fs[name];
  fs[name] = function(filename, ...args) { admit(filename); return original.call(this, filename, ...args); };
}
for (const name of ['readFile', 'open']) {
  const original = fs.promises[name];
  fs.promises[name] = function(filename, ...args) { admit(filename); return original.call(this, filename, ...args); };
}
