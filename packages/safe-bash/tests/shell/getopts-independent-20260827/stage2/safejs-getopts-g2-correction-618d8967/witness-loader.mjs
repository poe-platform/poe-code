import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.env.SURFACE_ROOT;
const target = join(root, 'consumer/node_modules/virtual-bash/dist/shell/runtime.js');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = JSON.parse(readFileSync(join(root, 'CURRENT-IMPORTS.json')));
const expected = binding.files.find(entry => entry.path === 'consumer/node_modules/virtual-bash/dist/shell/runtime.js');
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== pathToFileURL(target).href) return result;
    const original = readFileSync(target);
    assert.equal(digest(original), expected.sha256);
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
    assert.equal(digest(source), expected.sha256);
    const needle = 'async getoptsBuiltin(context, state) {';
    assert.equal(source.split(needle).length, 2);
    const transformed = source.replace(needle, needle + '\n        globalThis[Symbol.for("virtual-bash.getopts.followup.witness")]({ args: [...context.args], positional: [...state.positional], OPTIND: state.variables.OPTIND, OPTERR: state.variables.OPTERR });');
    appendFileSync(process.env.WITNESS_LOAD, JSON.stringify({ candidate: binding.candidateCommit, path: expected.path, originalSHA256: expected.sha256, transformedSHA256: digest(transformed), needle, occurrences: 1, diskModified: false }) + '\n');
    return { ...result, source: transformed };
  },
});
