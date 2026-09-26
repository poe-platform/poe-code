import { test } from "vitest";
import assert from "node:assert/strict";
import { Volume } from "memfs";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import { pythonCodecs } from "./codecs/python.js";
import type { CsvkitContext } from "./contracts.js";
import reference from "../../../docs/csvkit/in2csv-geojson-reference.json" with { type: "json" };

async function invoke(item: typeof reference.cases[number], sdk = false, overrides: Partial<CsvkitContext> = {}) {
  const volume = new Volume(); volume.mkdirSync('/work');
  let stdout = ''; let stderr = ''; const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/work',
    fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); } },
    stdin: (async function* () { yield new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: {},
    codecs: [utf8Codec, ...pythonCodecs], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = sdk ? await run({ command: 'in2csv', settings: { filetype: 'geojson' } }, context) : await execute('in2csv', context);
    const effects = Object.fromEntries(volume.readdirSync('/work').map(name => [String(name), (volume.readFileSync(`/work/${String(name)}`) as Buffer).toString('base64')]));
    return { stdout, stderr, status, effects };
  } finally { for (const cleanup of cleanups) await cleanup(); }
}
for (const [index, item] of reference.cases.entries()) test(`in2csv GeoJSON frozen original differential ${index}: ${item.argv.join(' ')}`, async () => {
  assert.deepEqual(await invoke(item), { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
});

test('GeoJSON SDK uses the same raw converter', async () => {
  const item = reference.cases.find(item => item.name === 'raw defaults')!;
  assert.deepEqual(await invoke(item, true), { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
});

test('GeoJSON JSON cells escape DEL while raw text cells preserve it in CLI and SDK', async () => {
  const item = {
    name: 'DEL in raw and JSON cells', argv: ['-f', 'geojson'],
    stdin: JSON.stringify({ type: 'FeatureCollection', features: [{
      id: '\u007f', properties: { raw: '\u007f', object: { '\u007f': '\u007f' }, list: ['\u007f'] },
      geometry: { type: 'Point', coordinates: [1, 2], '\u007f': '\u007f' }
    }] }),
    stdout: 'id,raw,object,list,geojson,type,longitude,latitude\n' +
      '\u007f,\u007f,"{""\\u007f"": ""\\u007f""}",[\'\\x7f\'],"{""type"": ""Point"", ""coordinates"": [1, 2], ""\\u007f"": ""\\u007f""}",Point,1,2\n',
    stderr: '', status: 0, effects: {}
  };
  for (const sdk of [false, true]) {
    assert.deepEqual(await invoke(item, sdk), { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
  }
});
