import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureLaunch, publishTerminal, processPresence, LIMITS } from './fixture/capture.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(home, 'novel-evidence');
await fs.mkdir(root, { mode: 0o700 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const journal = await fs.open(path.join(root, 'CONTROLS.ndjson'), 'wx', 0o600);
const rows = [];
let unsafe = false, children = 0;
const specs = [
  { id: 'N01', mode: 'all-caps' },
  { id: 'N02', mode: 'stderr-over' },
  { id: 'N03', mode: 'normal' },
  { id: 'N04', mode: 'normal' },
  { id: 'N05', mode: 'normal' },
  { id: 'N06', mode: 'normal' },
  { id: 'N07', mode: 'normal' },
  { id: 'N08', mode: null },
];
for (const spec of specs) {
  if (unsafe) { rows.push({ id: spec.id, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  const row = { id: spec.id, pass: false };
  const handles = [];
  const directory = path.join(root, spec.id);
  const sentinel = Object.freeze({ id: spec.id, eventWrite: true });
  let enrolled = false, result;
  const io = { open: async (filename, flags, mode) => {
    const handle = await fs.open(filename, flags, mode);
    const state = { name: path.basename(filename), closed: false, syncCalls: 0, closeCalls: 0, writeCalls: 0, actualBytes: 0 };
    handles.push(state);
    return {
      write: async (bytes, offset, length, position) => {
        state.writeCalls++;
        if (spec.id === 'N04' && state.name === 'events.ndjson' && enrolled) throw sentinel;
        if (spec.id === 'N05' && state.name === 'stdout.raw') {
          const actual = await handle.write(bytes, offset, 1, position);
          state.actualBytes += actual.bytesWritten;
          return { bytesWritten: length + 1 };
        }
        const actual = await handle.write(bytes, offset, length, position);
        state.actualBytes += actual.bytesWritten;
        return actual;
      },
      sync: async () => {
        state.syncCalls++;
        if (spec.id === 'N03' && state.name === 'RECEIPT.json') throw undefined;
        return handle.sync();
      },
      close: async () => {
        state.closeCalls++;
        await handle.close(); state.closed = true;
        if (spec.id === 'N03' && state.name === 'RECEIPT.json') throw null;
        if (spec.id === 'N06' && state.name === 'RECEIPT.json') await fs.writeFile(path.join(directory, 'EXTRA.data'), 'unreferenced\n', { flag: 'wx', mode: 0o600 });
      },
    };
  } };
  try {
    if (spec.id === 'N08') {
      const parts = [];
      let calls = 0;
      const publication = publishTerminal({ captureQualified: false }, (bytes, offset) => {
        if (calls++) throw 0;
        parts.push(Buffer.from(bytes.subarray(offset, offset + 3)));
        return 3;
      });
      assert.equal(publication.ok, false);
      assert.equal(publication.primaryPresent, true);
      assert.equal(publication.primaryReason, 0);
      assert.equal(publication.retained, 3);
      assert.equal(Buffer.concat(parts).toString(), '{"c');
      row.publication = { ...publication, exactReasonIsZero: true, prefixBase64: Buffer.concat(parts).toString('base64') };
    } else {
      result = await captureLaunch({ directory, runId: spec.id, totalMs: 5000, termMs: 100, killMs: 100, command: { file: process.execPath, args: ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(home, 'child.mjs'), spec.mode], cwd: root, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: root, TMPDIR: root } } }, {
        io,
        beforeLaunch: async () => {
          if (spec.id !== 'N07') return;
          const names = await fs.readdir(directory);
          assert.deepEqual(names.sort(), ['events.ndjson', 'fd3.raw', 'intent.ndjson', 'stderr.raw', 'stdout.raw']);
          for (const name of names) assert.equal((await fs.stat(path.join(directory, name))).mode & 0o777, 0o600);
          row.capturesExistBeforeAdmission = true;
          throw undefined;
        },
        afterEnrolled: child => {
          assert.equal(child.enrolled, true); assert.ok(Number.isInteger(child.pid));
          enrolled = true; children++; assert.ok(children <= 6);
        },
      });
      row.receipt = result.receipt;
      row.qualified = result.qualified;
      row.primaryPresent = result.primaryPresent;
      row.publicationPresent = result.publicationPresent;
      if (result.receipt.child.pid !== null) {
        row.independentlyRetired = result.receipt.child.exit !== null && result.receipt.child.close !== null && processPresence(result.receipt.child.pid) === 'absent' && processPresence(-result.receipt.child.pid) === 'absent';
        if (!row.independentlyRetired) { unsafe = true; throw Error('UNKNOWN_CHILD_RETIREMENT'); }
      }
      assert.ok(handles.every(handle => handle.closed), 'REAL_HANDLE_NOT_CLOSED');
      if (spec.id === 'N01') {
        assert.equal(result.qualified, true);
        assert.equal(result.receipt.child.exit.code, 0);
        for (const [name, value] of [['stdout', 65], ['stderr', 66], ['fd3', 67]]) {
          const bytes = await fs.readFile(path.join(directory, name + '.raw'));
          assert.deepEqual(bytes, Buffer.alloc(LIMITS[name], value));
          assert.equal(result.receipt.streams[name].observed, LIMITS[name]);
          assert.equal(result.receipt.streams[name].retained, LIMITS[name]);
          assert.equal(result.receipt.streams[name].lost, 0);
          assert.equal(result.receipt.streams[name].sha256, hash(bytes));
        }
        assert.ok(result.receipt.actualCaptureBytes <= LIMITS.outer);
      } else assert.equal(result.qualified, false);
      if (spec.id === 'N02') {
        const state = result.receipt.streams.stderr;
        assert.equal(state.observed, 65537); assert.equal(state.retained, 65536);
        assert.equal(state.lost, 1); assert.equal(state.truncated, true);
        assert.deepEqual(await fs.readFile(path.join(directory, 'stderr.raw')), Buffer.alloc(65536, 68));
        assert.equal(result.receipt.primary.reason.code, 'OUTER_CAPTURE_CAP');
      }
      if (spec.id === 'N03') {
        assert.equal(result.publicationPresent, true); assert.equal(result.publicationReason, undefined);
        assert.equal(result.primaryPresent, true); assert.equal(result.primaryReason, undefined);
        assert.ok(result.receipt.secondary.some(entry => entry.phase === 'receipt-publication-close' && entry.reason.type === 'null'));
        assert.equal(handles.find(handle => handle.name === 'RECEIPT.json').closeCalls, 1);
      }
      if (spec.id === 'N04') {
        assert.equal(result.primaryReason, sentinel);
        assert.equal(result.receipt.primary.phase, 'after-enrollment');
        assert.ok(result.receipt.events.some(entry => entry.phase === 'child-enrolled-listeners-installed'));
        assert.ok(result.receipt.signals.some(signal => signal.name === 'SIGTERM'));
      }
      if (spec.id === 'N05') {
        assert.equal(result.receipt.primary.reason.code, 'OUTER_WRITE_PROGRESS');
        assert.equal(result.receipt.streams.stdout.retained, 0);
        assert.equal((await fs.readFile(path.join(directory, 'stdout.raw'))).toString(), 'o');
        assert.ok(result.receipt.secondary.some(entry => entry.phase === 'capture-postguard' && entry.reason.code === 'OUTER_CAPTURE_LENGTH'));
        row.qualification = 'Injected invalid write progress: physical one-byte effect is separate from untrusted reported progress; capture is refused.';
      }
      if (spec.id === 'N06') {
        const durable = JSON.parse(await fs.readFile(path.join(directory, 'RECEIPT.json')));
        assert.equal(durable.captureQualified, true);
        assert.equal(durable.publication, 'REQUIRES_TERMINAL_CONFIRMATION');
        assert.equal(result.receipt.primary.reason.code, 'OUTER_CAPTURE_CENSUS');
        const terminalParts = [];
        const published = publishTerminal({ captureQualified: result.qualified }, (bytes, offset, length) => { terminalParts.push(Buffer.from(bytes.subarray(offset, offset + length))); return length; });
        assert.equal(published.ok, true);
        assert.equal(Buffer.concat(terminalParts).toString(), '{"captureQualified":false}\n');
        row.durableReceiptAloneNotAcceptance = true;
      }
      if (spec.id === 'N07') {
        assert.equal(result.primaryPresent, true); assert.equal(result.primaryReason, undefined);
        assert.equal(result.receipt.child.attempted, false); assert.equal(result.receipt.child.pid, null);
        assert.equal(row.capturesExistBeforeAdmission, true);
      }
    }
    row.pass = true;
  } catch (error) {
    row.failure = { message: error?.message ?? String(error), code: error?.code ?? null };
    if (handles.some(handle => !handle.closed) || result?.receipt.child.pid && !row.independentlyRetired) unsafe = true;
  }
  row.handles = handles;
  rows.push(row);
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  assert.ok(bytes.length <= 65536);
  await journal.writeFile(bytes); await journal.sync();
}
await journal.sync(); await journal.close();
const report = { schema: 'INDEPENDENT_OUTER_EIGHT_HOLDOUTS_V1', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => row.pass === false).length, unsafe, actualChildren: children, allHandlesPhysicallyClosed: rows.every(row => (row.handles ?? []).every(handle => handle.closed)), ownerEntrypointExecuted: false, productOrComparatorImports: 0 };
await fs.writeFile(path.join(root, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ pass: report.pass, fail: report.fail, unsafe, children }) + '\n');
process.exitCode = report.fail || unsafe ? 1 : 0;
