import assert from 'node:assert/strict';
import { join } from 'node:path';
import { jsonHash, readJson, regularBytes, sha256 } from './integrity.mjs';

export function loadData(recipeRoot, frozenRepository) {
  const inventory = readJson(join(recipeRoot, 'inventory.json'));
  const bindings = readJson(join(recipeRoot, 'source-bindings.json'));
  const sources = new Map();
  for (const binding of bindings.bindings) {
    const bytes = regularBytes(join(frozenRepository, binding.path));
    assert.equal(sha256(bytes), binding.sha256, `Frozen input hash: ${binding.id}`);
    if (binding.path.endsWith('.json')) sources.set(binding.id, JSON.parse(bytes));
  }
  return { inventory, bindings, sources };
}

function boundedCount(value) {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= 100001, 'Frozen fixture count bound');
  return value;
}

export function materializeDataRecipe(recipe) {
  let text;
  const anchors = (count) => '- &a 0\n'.repeat(boundedCount(count));
  const aliases = (count) => `[&a 0${', *a'.repeat(boundedCount(count))}]\n`;
  switch (recipe.kind) {
    case 'quoted-repeat':
      assert.equal(recipe.unit, '🙂');
      text = `"${recipe.unit.repeat(boundedCount(recipe.count))}"\n`;
      break;
    case 'anchor-reuse-lines': text = anchors(recipe.count); break;
    case 'two-documents-anchor-reuse': text = `${anchors(recipe.countEach)}---\n${anchors(recipe.countEach)}`; break;
    case 'two-documents-aliases': text = `${aliases(recipe.first)}---\n${aliases(recipe.second)}`; break;
    case 'explicit-null-documents': text = '---\n'.repeat(boundedCount(recipe.count)); break;
    case 'plain-implicit-key':
      assert.equal(recipe.unit, '🙂');
      text = `${recipe.unit.repeat(boundedCount(recipe.count))}: 0\n`;
      break;
    default: throw new Error('Unbound data recipe');
  }
  const bytes = Buffer.from(text);
  assert(bytes.length <= 1048576, 'Materialized fixture byte bound');
  return bytes;
}

function decodeHex(hex) {
  assert(typeof hex === 'string' && /^(?:[0-9a-f]{2})*$/.test(hex), 'Malformed hex');
  return Buffer.from(hex, 'hex');
}

function inputChunks(input, defaults) {
  if (input.stdinChunksHex) return input.stdinChunksHex.map(decodeHex);
  if (input.stdinHex !== undefined) return [decodeHex(input.stdinHex)];
  if (input.stdinRecipe) return [materializeDataRecipe(input.stdinRecipe)];
  return [Buffer.from(input.stdinUtf8 ?? defaults.stdinUtf8 ?? '', 'utf8')];
}

function currentExpected(row, original, sources) {
  let expected = structuredClone(original.expect);
  if (row.currentOverlay) {
    const overlay = sources.get('final-manifest').overlays.find((entry) => entry.id === row.id);
    if (overlay.currentExpectation?.source === 'n-cases') {
      expected = structuredClone(sources.get('n-cases').cases.find((entry) => entry.id === overlay.currentExpectation.caseId).expect);
    }
  }
  if (expected.stdout) {
    if (expected.stdout.hex !== undefined) expected.stdoutHex = expected.stdout.hex;
    if (expected.stdout.utf8 !== undefined) expected.stdoutUtf8 = expected.stdout.utf8;
  }
  if (expected.diagnostic) expected.diagnosticCode = expected.diagnostic.code;
  if (expected.stdoutBinding) {
    const key = expected.stdoutBinding.split('/').at(-1);
    assert(['version', 'help'].includes(key));
    expected.stdoutUtf8 = sources.get('final').exactInformation[key];
  }
  return expected;
}

export function materializeJobs(data, selectedIds) {
  assert(Array.isArray(selectedIds) && selectedIds.length > 0 && selectedIds.length <= 194);
  assert.equal(new Set(selectedIds).size, selectedIds.length, 'Duplicate selected ID');
  const jobs = [];
  for (const id of selectedIds) {
    const row = data.inventory.rows.find((entry) => entry.id === id);
    assert(row?.runtimeProofRole, `Missing adapter binding, not a skipped PASS: ${id}`);
    const packet = data.sources.get(row.frozen.source);
    const original = packet.cases.find((entry) => entry.id === id);
    assert.equal(jsonHash(original), row.frozen.recordSha256);
    const defaults = packet.defaults ?? {};
    const input = original.input;
    const chunks = inputChunks(input, defaults);
    const bytes = Buffer.concat(chunks);
    assert(bytes.length <= 1048576);
    let variants = [{ name: 'whole', chunks }];
    if (input.chunkPlan === 'single-byte-chunks' || input.chunkPlan === 'every-single-cut-and-single-byte-chunks') {
      assert(bytes.length > 0 && bytes.length <= 4096, 'Fragmentation bound');
      variants = [{ name: 'single-byte', chunks: [...bytes].map((byte) => Buffer.from([byte])) }];
      if (input.chunkPlan.startsWith('every-')) {
        variants.push({ name: 'whole', chunks });
        for (let cut = 1; cut < bytes.length; cut += 1) variants.push({ name: `cut-${cut}`, chunks: [bytes.subarray(0, cut), bytes.subarray(cut)] });
      }
    }
    for (const variant of variants) {
      jobs.push({
        id: `${id}--${variant.name}`, recordId: id, role: row.primaryRole,
        argv: input.argv ?? defaults.argv ?? ['-o', 'json', '-c', '.'],
        stdinChunksHex: variant.chunks.map((chunk) => chunk.toString('hex')),
        stdinIsDefault: !['stdinUtf8', 'stdinHex', 'stdinChunksHex', 'stdinRecipe'].some((key) => key in input),
        producerReuse: input.producer === 'same-Uint8Array-overwritten-before-each-next-and-on-return',
        files: (input.files ?? []).map((file) => ({ path: file.path, hex: Buffer.from(file.utf8).toString('hex') })),
        expected: currentExpected(row, original, data.sources),
        fullRecordEligibleAfterProjection: row.fullRecordEligibleAfterProjection,
        sourceReference: row.frozen, overlayReference: row.currentOverlay,
        missingBindings: row.missingBindings,
      });
    }
  }
  assert(jobs.length <= 512, 'Job variant bound');
  return jobs;
}
