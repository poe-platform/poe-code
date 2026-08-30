import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { json } from './artifacts.mjs';

export const frozenRoot = fileURLToPath(new URL('../', import.meta.url));
export const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function cases() {
  const matrix = json(join(frozenRoot, 'unsupported-names.json'));
  const unsupported = [];
  for (const initial of matrix.initialStates) for (const [modeIndex, mode] of matrix.modes.entries()) for (const [nameIndex, name] of matrix.names.entries()) {
    unsupported.push({ id: `N-${initial}-${modeIndex}-${nameIndex}`, initial, args: [...mode, name], stdout: '', stderr: matrix.expected.stderrTemplate.replace('NAME', name), exitCode: 1, postState: initial });
  }
  const result = {
    commands: json(join(frozenRoot, 'command-cases.json')),
    unsupported,
    globs: json(join(frozenRoot, 'glob-cases.json')),
    states: json(join(frozenRoot, 'state-cases.json')),
    procedures: json(join(frozenRoot, 'procedures.json')),
    overlay: json(join(frozenRoot, 'byte-overlay-v1/expectations.json')).rows,
  };
  for (const [name, length] of Object.entries({ commands: 102, unsupported: 696, globs: 72, states: 14, procedures: 26, overlay: 8 })) {
    assert.equal(result[name].length, length, name);
    assert.equal(new Set(result[name].map(row => row.id)).size, length, `${name} IDs`);
  }
  return result;
}

export function commandScript(row) {
  return `${onSetup(row.initial)}shopt ${row.args.map(quote).join(' ')}; __dg_status=$?; shopt -q dotglob; __dg_receipt "$__dg_status" "$?"`;
}

export function onSetup(state) {
  return state === 'on' ? 'shopt -s dotglob; __dg_setup "$?"; shopt -q dotglob; __dg_setup "$?"; ' : '';
}
