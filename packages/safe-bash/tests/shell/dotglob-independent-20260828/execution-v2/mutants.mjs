import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from '../execution-prep-v1/artifacts.mjs';
import { digestFile } from '../execution-prep-v1/admission.mjs';

export function installAbsentBuiltin(packageRoot, expectedRuntimeSha256) {
  const path = join(packageRoot, 'dist/shell/runtime.js'), before = digestFile(path, expectedRuntimeSha256);
  const appended = '\nconst __dgOriginalBuiltin = Runtime.prototype.builtin;\nRuntime.prototype.builtin = function(context, ...rest) {\n  if (context.command === "shopt") {\n    process.stdout.write(JSON.stringify({ activation: { id: "absent-builtin", hits: 1 } }) + "\\n");\n    return Promise.resolve(127);\n  }\n  return __dgOriginalBuiltin.call(this, context, ...rest);\n};\n';
  const bytes = Buffer.concat([before, Buffer.from(appended)]);
  writeFileSync(path, bytes);
  assert.notEqual(hash(readFileSync(path)), expectedRuntimeSha256);
  return { id: 'absent-builtin', runtimeModule: path, runtimeSha256: hash(bytes), beforeSha256: expectedRuntimeSha256, requiredFailed: ['R01'], mechanism: 'actual loaded module changes shopt builtin to status127; other builtins delegate' };
}

export function installStackReversion(packageRoot, baselineRoot, binding) {
  for (const [name, entry] of Object.entries(binding.package.members)) {
    if (!/^dist\/shell\/(?:runtime|shell)\./u.test(name)) continue;
    writeFileSync(join(packageRoot, name), digestFile(join(baselineRoot, name), entry.sha256));
  }
  const runtimeModule = join(packageRoot, 'dist/shell/runtime.js');
  return { id: 'accepted-stack-reversion', runtimeModule, runtimeSha256: hash(readFileSync(runtimeModule)), requiredFailed: ['R01'], mechanism: 'exact accepted compiled runtime/shell reloaded; worker delegates actual dispatch and records shopt entry' };
}
