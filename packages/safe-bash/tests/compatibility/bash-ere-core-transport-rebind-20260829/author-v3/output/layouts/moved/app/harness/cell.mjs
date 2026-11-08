import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { observeWorker } from './worker-observer.mjs';
import { observeArrays } from './array-observer.mjs';
import { boundFile } from './guards.mjs';
import { h02, h03, h04, h05, h07 } from './host-bodies.mjs';
import { h03Expansion, h06False, h08Fresh, eh04, eh05 } from './additions.mjs';
import { createEventWriter, createFailureLedger, describeFailures, FINAL_AUDIT_BYTES } from './event-writer.mjs';
import { finalizeCell } from './finalize-cell.mjs';
const [cellPath, capturePath] = process.argv.slice(2);
const failures = createFailureLedger();
const audit = createEventWriter({ descriptor: 2, byteLimit: FINAL_AUDIT_BYTES, close() {} });
let writer;
const emit = row => writer.emit(row);
let observer;
let arrays;
let shell;
let cellId;
try {
  writer = createEventWriter({ descriptor: fs.openSync(capturePath, 'wx', 0o600) });
  emit({ event: 'startup', pid: process.pid, execPath: process.execPath });
  const cell = JSON.parse(fs.readFileSync(cellPath, 'utf8'));
  cellId = cell.definition.id;
  if (cell.definition.route === 'DEFERRED_ADAPTER') throw new Error(`DEFERRED ${cell.definition.id}: ${cell.definition.gate}`);
  observer = observeWorker({ ...cell.worker, maximumStarts: cell.definition.workerStartsMaximum }, emit);
  const api = await import(pathToFileURL(cell.modulePath).href);
  if (cell.definition.id === 'H04') {
    for (const member of cell.arrayModules) boundFile(member);
    const ledger = await import(pathToFileURL(cell.arrayModules[0].path).href);
    const bindings = await import(pathToFileURL(cell.arrayModules[1].path).href);
    arrays = observeArrays(ledger.ArrayOwner, bindings.IndexedBinding);
  }
  shell = new api.Shell({ fs: new api.MemoryFileSystem(), cwd: '/', env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, limits: cell.limits });
  shell.use(api.agentCommands());
  const check = async (script, expected, options) => {
    const result = await shell.exec(script, options);
    observer.assertRetired();
    assert.equal(result.exitCode, expected.exitCode);
    assert.equal(result.stdout, expected.stdout ?? '');
    if (expected.stderr?.exact !== undefined) assert.equal(result.stderr, expected.stderr.exact);
    else if (expected.stderr?.contains) assert.ok(result.stderr.includes(expected.stderr.contains), result.stderr);
    return result;
  };
  const definition = cell.definition;
  if (definition.route === 'script') {
    const result = await check(definition.script, definition.expected);
    if (definition.id.startsWith('EC') && definition.id !== 'EC19') assert.equal(result.stderr, 'shell: line 1: [[ invalid ERE\n'.repeat(definition.invalidVisits));
  } else if (definition.id === 'H01') {
    for (const reason of [null, false, 0, '', Object.freeze({ caller: true })]) {
      const controller = new AbortController(); controller.abort(reason);
      let caught; let rejected = false;
      try { await shell.exec("BASH_REMATCH=(saved); [[ a =~ (a) ]]", { signal: controller.signal }); } catch (error) { rejected = true; caught = error; }
      assert.equal(rejected, true); assert.equal(caught, reason);
      observer.assertRetired(); assert.equal(observer.rows.length, 0);
    }
    await check('[[ yes || a =~ (a) ]]', { exitCode: 0, stderr: { exact: '' } });
    assert.equal(observer.rows.length, 0);
  } else if (definition.id === 'H02') {
    await h02({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H03') {
    await h03({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H04') {
    await h04({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H05') {
    await h05({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H07') {
    await h07({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H06') {
    for (const [script, reason] of [["bad='('; [[ a =~ $bad ]]", 0], ["BASH_REMATCH=(saved); readonly BASH_REMATCH; [[ a =~ (a) ]]", Object.freeze({ sink: true })]]) {
      let caught; let rejected = false;
      try { await shell.exec(script, { stderr: { write() { throw reason; } } }); } catch (error) { rejected = true; caught = error; }
      assert.equal(rejected, true); assert.equal(caught, reason); observer.assertRetired();
    }
    const controller = new AbortController(); const caller = Object.freeze({ caller: true });
    let caught; let rejected = false;
    try { await shell.exec("bad='('; [[ a =~ $bad ]]", { signal: controller.signal, stderr: { write() { controller.abort(caller); throw false; } } }); } catch (error) { rejected = true; caught = error; }
    assert.equal(rejected, true); assert.equal(caught, caller); observer.assertRetired();
    await h06False({ shell, observer });
  } else if (definition.id === 'H08') {
    shell.register({ name: 'relay', execute(context) { assert.equal(typeof context.invoke, 'function'); return context.invoke('match', []); } });
    const script = "match(){ [[ aa =~ (a+) ]]; printf '<%s>\\n' \"${BASH_REMATCH[1]}\"; }; relay; relay";
    await check(script, { exitCode: 0, stdout: '<aa>\n<aa>\n', stderr: { exact: '' } });
    assert.equal(observer.rows.length, 1); assert.equal(observer.rows[0].requests.length, 2);
    assert.ok(observer.rows[0].requests[1].work < observer.rows[0].requests[0].work);
    await check("[[ a =~ (a) ]]; printf '<%s>\\n' \"${BASH_REMATCH[1]}\"", { exitCode: 0, stdout: '<a>\n', stderr: { exact: '' } });
    assert.equal(observer.rows.length, 2);
    h08Fresh({ observer });
  } else if (definition.id === 'EH04') {
    await eh04({ shell, observer });
  } else if (definition.id === 'EH05') {
    await eh05({ shell, observer });
  } else if (definition.id === 'EH01' || definition.id === 'EH02') {
    const pattern = 'a'.repeat(65537);
    const prefix = ''; 
    const variants = definition.id === 'EH01'
      ? [['[[ x =~ $re ]]', 3], ['[[ ! x =~ $re ]]', 3], ['[[ x =~ $re || yes ]]', 3], ['[[ x =~ $re && yes ]]', 3], ['[[ yes && x =~ $re ]]', 3], ["[[ '' || x =~ $re ]]", 3], ['[[ yes || x =~ $re ]]', 0], ["[[ '' && x =~ $re ]]", 1]]
      : [['[[ x =~ $re ]] || :', 0], ['[[ x =~ $re ]] && :', 3], ['! [[ x =~ $re ]]', 0]];
    for (const [script, exitCode] of variants) await check(prefix + script, { exitCode }, { env: { re: pattern } });
  } else if (definition.id === 'EH03') {
    for (const [script, options, limit] of [['echo ignored', { limits: { maxSourceBytes: 0 } }, 'maxSourceBytes'], ["bad='('; [[ a =~ $bad ]]", { limits: { maxOutputBytes: 0 } }, 'maxOutputBytes']]) {
      let caught; try { await shell.exec(script, options); } catch (error) { caught = error; }
      assert.ok(caught instanceof api.ShellLimitError); assert.equal(caught.limit, limit); observer.assertRetired();
    }
  } else throw new Error('missing host executor');
} catch (error) {
  failures.record(error, 'body');
  try { writer?.emit({ event: 'failure', failure: describeFailures(failures.snapshot()) }); }
  catch (reason) { failures.record(reason, 'failure-event'); }
} finally {
  const final = await finalizeCell({
    failures, writer, audit, id: cellId, workers: observer?.rows ?? [],
    actions: [
      { phase: 'shell-dispose', run: () => shell?.dispose() },
      { phase: 'array-settle', run: () => arrays?.settle() },
      { phase: 'worker-retirement', run: () => observer?.assertRetired() },
      { phase: 'array-restore', run: () => arrays?.restore() },
      { phase: 'worker-restore', run: () => observer?.restore() },
    ],
  });
  process.exitCode = final.exitCode;
}
