import assert from 'node:assert/strict';
import { root, read, hash } from './pinned.mjs';

export const paths = {
  adapter: `${root}actual-review-v2/adapter.mjs`,
  workflow: `${root}actual-review-v1/extra.mjs`,
  lifecycle: `${root}actual-review-v2/lifecycle.mjs`,
  diagnostics: `${root}preparation-v2/diagnostics.mjs`,
};

export const equivalentRows = ['X4-R04', 'X4-R05', 'X4-R06', 'X4-R07', 'X4-R08', 'B01-R1-repeat', 'B01-R3-space', 'B01-R7-invalid-plural'];
export const heldRows = ['X4-S01', 'X4-S02', 'X4-S03', 'X4-S04', 'X4-S05', 'B01-R4-start-length', 'B01-R4-index-one', 'B01-R4-header-column', 'B01-R5-interior', 'B01-R6-L-range', 'B01-R6-I-range', 'B01-R6-L-I'];

export function filePhaseArgv(argv) {
  assert.equal(argv[0], 'select');
  assert.equal(argv.filter(value => value === '--').length, 1);
  const boundary = argv.indexOf('--');
  return [...argv.slice(0, boundary), '-o', 'out.csv', ...argv.slice(boundary), 'input.csv'];
}

export function transform(path, source) {
  assert.ok(Object.values(paths).includes(path), 'four mechanical families only');
  assert.equal(hash(source), hash(read(path)), 'exact sealed verifier bytes required');
  let text = source.toString();
  const changes = [];
  const replace = (before, after, family) => {
    assert.equal(text.split(before).length - 1, 1, `unique replacement: ${before}`);
    text = text.replace(before, after);
    changes.push({ family, before, after });
  };
  if (path === paths.adapter) {
    replace("[...row.argv, 'input.csv', '-o', 'out.csv']", "[...row.argv.slice(0, row.argv.indexOf('--')), '-o', 'out.csv', ...row.argv.slice(row.argv.indexOf('--')), 'input.csv']", 'filephase');
    replace('shell.use(async (context, next) => { origins.push(context.stdinIsDefault); await next(); });', 'shell.use((context, next) => { origins.push(context.stdinIsDefault); return next(); });', 'middleware');
    replace('shell.use(async (context, next) => { seen.push(context.args[0]); await next(); });', 'shell.use((context, next) => { seen.push(context.args[0]); return next(); });', 'middleware');
    replace("shell.use(async (context, next) => { if (context.command === 'xan') contexts.push({ env: { ...context.env }, stdinIsDefault: context.stdinIsDefault }); await next(); });", "shell.use((context, next) => { if (context.command === 'xan') contexts.push({ env: { ...context.env }, stdinIsDefault: context.stdinIsDefault }); return next(); });", 'middleware');
  }
  if (path === paths.workflow) {
    replace('await next(); middleware.push(`${context.args[0]}:after`);', 'const result = await next(); middleware.push(`${context.args[0]}:after`); return result;', 'middleware');
  }
  if (path === paths.lifecycle) {
    replace('shell.use(async (context, next) => {', 'shell.use((context, next) => {', 'provenance');
    replace('    await next();', '    return next();', 'middleware/provenance');
    replace("name: 'review-bridge', async execute(context)", "name: 'review-bridge', execute(context)", 'provenance');
  }
  if (path === paths.diagnostics) {
    const lines = text.split('\n');
    for (const id of equivalentRows) {
      const line = lines.find(value => value.startsWith(`  '${id}': [`));
      assert.ok(line);
      let replacement = line;
      if (['X4-R04', 'X4-R05'].includes(id)) replacement = line.replace('missing|not found|no .*match', 'missing|not found|no .*match|selected nothing');
      if (id === 'X4-R06') replacement = line.replace('forbid|unsupported|cannot|not allowed|invalid', 'forbid|unsupported|cannot|not allowed|invalid|requires headers');
      if (['X4-R07', 'X4-R08'].includes(id)) replacement = line.replace('missing|unknown|not found|no .*match', 'missing|unknown|not found|no .*match|does not exist');
      if (id === 'B01-R1-repeat') replacement = line.replace(')-n(?=', ')(?:-n|--no-headers)(?=');
      if (id === 'B01-R3-space') replacement = "  'B01-R3-space': [/(?:length|number|integer|numeric|-l\\b)|^Could not deserialize ' ' to u64 for '--len'\\.$/i, /(?:invalid|digit|empty|space|positive|unsigned)|^Could not deserialize ' ' to u64 for '--len'\\.$/i],";
      if (id === 'B01-R7-invalid-plural') replacement = line.replace('invalid|number|integer|index|indices', 'invalid|number|integer|index|indices|Could not deserialize').replace(')-I(?=', ')(?:-I|-I\\/--indices)(?=');
      assert.notEqual(replacement, line);
      replace(line, replacement, 'diagmatcher-equivalent-only');
    }
  }
  return { source: text, changes, beforeSha256: hash(source), afterSha256: hash(text) };
}

export function proposal() {
  return Object.fromEntries(Object.values(paths).map(path => {
    const { source, ...record } = transform(path, read(path));
    return [path, record];
  }));
}
