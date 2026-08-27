import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import type { ByteSource, ReadStreamOptions, RegexExecutionOptions, VirtualShellPlugin } from 'virtual-bash';

const output = process.env.GREP_ALIAS_SUPPLEMENT_OUTPUT;
assert.ok(output); mkdirSync(output, { recursive: false });
const workerModule = createRequire(import.meta.url)('node:worker_threads') as { Worker: typeof Worker };
const OriginalWorker = workerModule.Worker;
const active = new Set<Worker>();
const events: { event: string; workerThreadId: number; case: string; path?: string }[] = [];
const rows: { id: string; status: 'pass' | 'fail'; error?: string; outputHex?: string; activeAtSettlement?: number; observation?: unknown }[] = [];
let current = 'init';
class ObservedWorker extends OriginalWorker {
  constructor(...args: ConstructorParameters<typeof Worker>) {
    super(...args); const workerThreadId = this.threadId; active.add(this);
    events.push({ event: 'create', workerThreadId, case: current, path: String(args[0]) });
    this.once('exit', () => { active.delete(this); events.push({ event: 'exit', workerThreadId, case: current }); });
  }
}
workerModule.Worker = ObservedWorker; syncBuiltinESMExports();
const { Shell, MemoryFileSystem, ShellLimitError } = await import('virtual-bash');
const aliases = await import(new URL('../node_modules/virtual-bash/dist/commands/grep-aliases/index.js', import.meta.url).href) as { grepAliasCommands(options: { regex: RegexExecutionOptions }): VirtualShellPlugin };
const regex: RegexExecutionOptions = { maxWorkers: 1, maxQueuedRequests: 1, maxQueuedBytes: 4096, requestTimeoutMs: 1500, startupTimeoutMs: 1500, idleTimeoutMs: 1000 };
function record(): void {
  writeFileSync(join(output!, 'results.json'), `${JSON.stringify({ classification: 'supplement-to-S02-S03-not-a-replacement-cohort', rows, events, activeWorkers: active.size, verifierForcedWorkerTermination: 0 }, null, 2)}\n`);
}
function reused(width: number): ByteSource {
  return (async function* () {
    const buffer = Buffer.alloc(width); const bytes = Buffer.from('keep:01\ndrop:xx\nkeep:02\n');
    try { for (let offset = 0; offset < bytes.length; offset += width) { bytes.copy(buffer, 0, offset, offset + width); yield buffer; } }
    finally { buffer.fill(0x78); }
  })();
}
class SourceFs extends MemoryFileSystem {
  constructor(readonly width: number) { super(); }
  override readStream(path: string, options?: ReadStreamOptions): ByteSource {
    assert.equal(path, '/input'); assert.ok(options?.signal); return reused(this.width);
  }
}
for (const name of ['egrep', 'fgrep']) for (const width of [4, 8]) {
  const id = `S02/${name}-${width}-owned-reuse-internal-pipe-to-file`;
  test(id, { timeout: 5000 }, async () => {
    current = id; const fs = new SourceFs(width); const shell = new Shell({ fs, limits: { maxOutputBytes: 65536, pipeHighWaterMark: 4 } });
    shell.use(aliases.grepAliasCommands({ regex }));
    try {
      const result = await shell.exec(`${name} 'keep:' input | fgrep 'keep:' > selected`);
      const bytes = Buffer.from(await fs.readFile('/selected'));
      assert.equal(result.exitCode, 0); assert.equal(result.stdoutBytes.byteLength, 0); assert.equal(result.stderr, '');
      assert.deepEqual(bytes, Buffer.from('keep:01\nkeep:02\n')); assert.equal(shell.commands.has('grep'), false); assert.equal(active.size, 0);
      rows.push({ id, status: 'pass', outputHex: bytes.toString('hex'), activeAtSettlement: active.size });
    } catch (error) { rows.push({ id, status: 'fail', error: error instanceof Error ? error.stack ?? error.message : String(error), activeAtSettlement: active.size }); throw error; }
    finally { await shell.dispose(); record(); }
  });
}
test('S03/pipeline-output-budget', { timeout: 5000 }, async () => {
  current = 'S03/pipeline-output-budget'; const fs = new MemoryFileSystem(); await fs.writeFile('/input', Buffer.from('keep:01\n'.repeat(1024)));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 6144, pipeHighWaterMark: 128 } }); shell.use(aliases.grepAliasCommands({ regex: { ...regex, maxQueuedRequests: 64, maxQueuedBytes: 65536 } }));
  let observation: unknown;
  try {
    const pending = shell.exec("egrep 'keep:' input | fgrep 'keep:'").then(result => { observation = { exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') }; return result; }, error => { observation = { rejectionName: error?.name, rejectionMessage: error?.message, limit: error?.limit }; throw error; });
    await assert.rejects(pending, error => error instanceof ShellLimitError && error.limit === 'maxOutputBytes');
    assert.equal(active.size, 0); rows.push({ id: current, status: 'pass', activeAtSettlement: active.size, observation });
  } catch (error) { rows.push({ id: current, status: 'fail', error: error instanceof Error ? error.stack ?? error.message : String(error), activeAtSettlement: active.size, observation }); throw error; }
  finally { await shell.dispose(); record(); }
});
after(() => { record(); assert.equal(rows.length, 5); assert.equal(active.size, 0); workerModule.Worker = OriginalWorker; syncBuiltinESMExports(); });
