import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };
const temporary = mkdtempSync(`${directory}.native-`);
const invoke = (argv, inputHex = '', files = {}) => {
  for (const [name, hex] of Object.entries(files)) {
    assert.match(name, /^[a-z]+(?:[.-][a-z]+)*$/u);
    writeFileSync(`${temporary}/${name}`, Buffer.from(hex, 'hex'));
  }
  const result = spawnSync('/usr/bin/jq', argv, { shell: false, cwd: temporary,
    env: { ...environment, HOME: temporary }, input: Buffer.from(inputHex, 'hex'),
    timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, null);
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
};
const bytes = expected => ({ status: expected.status,
  stdoutHex: expected.stdoutHex ?? Buffer.from(expected.stdout).toString('hex'),
  stderrHex: expected.stderrHex ?? Buffer.from(expected.stderr).toString('hex') });

try {
  const version = invoke(['--version']);
  const build = invoke(['--build-configuration']);
  if (process.argv[2] === '--verify-fresh') {
    const content = readFileSync(new URL('./fresh-native.json', import.meta.url));
    assert.equal(digest(content), '2724f85ce5745706a96fb9c0052d84df2cabd28e00811eb9e42ad34be105a4ca');
    const document = JSON.parse(content);
    assert.deepEqual(version, document.version);
    assert.deepEqual(build, document.build);
    assert.equal(digest(readFileSync('/usr/bin/jq')), document.executableSha256);
    for (const fixture of document.cases) assert.deepEqual(invoke(fixture.argv, fixture.inputHex), fixture.expected, fixture.id);
    console.log(JSON.stringify({ cases: document.cases.length, fixtureInvocations: document.cases.length, metadataInvocations: 2 }));
  } else if (process.argv[2] === '--replay') {
    const reports = [];
    for (const name of ['native-vectors.json', 'supplement-vectors.json', 'phase2-vectors.json',
      'phase2-extra-vectors.json', 'exponent-vectors.json', 'overflow-comparison-vectors.json']) {
      const content = readFileSync(new URL(`../independent-increment/${name}`, import.meta.url));
      const document = JSON.parse(content);
      assert.deepEqual(version, bytes(document.provenance.version));
      assert.deepEqual(build, bytes(document.provenance.build));
      assert.equal(digest(readFileSync('/usr/bin/jq')), document.provenance.executableSha256);
      let invocations = 0;
      for (const fixture of document.cases) {
        let inputHex = fixture.inputHex;
        let actual;
        let stderrHex = '';
        for (const stage of fixture.stages ?? [fixture]) {
          actual = invoke(stage.argv, inputHex, fixture.files);
          invocations++;
          assert.deepEqual(actual, bytes(stage.expected), `${name}:${fixture.id}:stage`);
          stderrHex += actual.stderrHex;
          inputHex = actual.stdoutHex;
        }
        assert.deepEqual({ ...actual, stderrHex }, bytes(fixture.expected), `${name}:${fixture.id}`);
      }
      reports.push({ name, sha256: digest(content), cases: document.cases.length, invocations });
    }
    const content = readFileSync(new URL('../split-increment/native.json', import.meta.url));
    const document = JSON.parse(content);
    assert.equal(digest(readFileSync('/usr/bin/jq')), document.executableSha256);
    for (const fixture of document.cases) assert.deepEqual(invoke(fixture.argv, Buffer.from(fixture.input).toString('hex')), bytes(fixture), fixture.id);
    reports.push({ name: 'split-increment/native.json', sha256: digest(content), cases: document.cases.length, invocations: document.cases.length });
    for (const name of ['raw-input-native.json', 'join-native.json']) {
      const legacyContent = readFileSync(new URL(`../${name}`, import.meta.url));
      const legacy = JSON.parse(legacyContent);
      for (const fixture of legacy.cases) {
        const files = Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex]));
        assert.deepEqual(invoke(fixture.argv, fixture.inputHex ?? Buffer.from(fixture.input).toString('hex'), files), bytes(fixture), `${name}:${fixture.id}`);
      }
      reports.push({ name, sha256: digest(legacyContent), cases: legacy.cases.length, invocations: legacy.cases.length });
    }
    console.log(JSON.stringify({ metadataInvocations: 2, version, build, reports }, null, 2));
  } else {
    assert.equal(process.argv[2], '--freeze');
    const fixtures = [];
    const add = (id, input, filter, flags = ['-R', '-s', '-c']) => fixtures.push({ id, argv: [...flags, filter], inputHex: Buffer.from(input).toString('hex') });
    const rows = [
      ['integers', '9007199254740993|9007199254740992|9007199254740993'],
      ['scaled', '12.3400|1.234e1|0.00000100|-0.000'],
      ['signed', '-2|-0|0|2'],
      ['computed', '0.1|0.2|1e-7|100000000000000000000'],
      ['precision', '1.00000000000000001|1.00000000000000002|1.0'],
    ];
    const flows = [
      ['roundtrip', 'split("|") | map(tonumber) | map(tojson | fromjson) | join("|")'],
      ['ordered', 'split("|") | map(tonumber) | sort | group_by(.) | map({value: .[0], count: length})'],
      ['computed', 'split("|") | map(tonumber) | map(. + 0) | join("|")'],
      ['quantified', 'split("|") | map(tonumber) | {yes: any(. > 0), all: all(. >= 0), generated: any(.[]; . > 0)}'],
    ];
    for (const [row, input] of rows) for (const [flow, filter] of flows) add(`${row}-${flow}`, input, filter);
    for (const [id, input, filter] of [
      ['unicode-codepoints', 'A😀é\0Z', 'split("") | join("|")'],
      ['unicode-delimiter', '😀1😀2😀', 'split("😀") | map(select(length > 0) | tonumber) | add'],
      ['empty-quantifiers', '', 'split("|") | {values: ., any: any, all: all}'],
      ['overlap', 'ababa', 'split("aba") | join("|")'],
      ['separator-order', '1,2;3', '[split((",", ";"))]'],
      ['raw-lines', '9007199254740993\n12.3400\n', 'split("\\n") | map(select(length > 0) | tonumber) | join("|")'],
    ]) add(id, input, filter);
    add('object-quantifiers', '{"a":0,"b":null,"c":false,"d":1}', '[any,all,any(. == 0),all(. != null),any(.[]; . == 1)]', ['-c']);
    add('join-output', '[9007199254740993,12.3400,null,true]', 'join("|")', ['-j']);
    add('line-raw-output', '9007199254740993|12.3400\n1|2\n', 'split("|") | map(tonumber) | join(":")', ['-R', '-j']);
    const document = { schema: 1, capturedAt: new Date().toISOString(), executable: '/usr/bin/jq',
      executableSha256: digest(readFileSync('/usr/bin/jq')), version, build, environment,
      fixtureInvocations: fixtures.length, metadataInvocations: 2,
      note: 'Independently selected literal-argv native bytes frozen before any product comparisons. Native whole input; product replays whole and bytewise.',
      cases: fixtures.map(fixture => ({ ...fixture, expected: invoke(fixture.argv, fixture.inputHex) })) };
    const destination = `${directory}fresh-native.json`;
    assert.equal(existsSync(destination), false);
    const content = `${JSON.stringify(document, null, 2)}\n`;
    const patch = `*** Begin Patch\n*** Add File: ${destination}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
    const applied = spawnSync('apply_patch', [patch], { shell: false, timeout: 2000, maxBuffer: 65536 });
    assert.equal(applied.status, 0, applied.stderr.toString());
    console.log(JSON.stringify({ cases: fixtures.length, sha256: digest(content), version, build }));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
