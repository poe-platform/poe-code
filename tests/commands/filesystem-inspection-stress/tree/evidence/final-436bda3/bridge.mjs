import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = resolve(process.env.TREE_CANDIDATE_DIR ?? new URL('./candidate', import.meta.url).pathname);
const load = (relative) => import(pathToFileURL(resolve(candidate, relative)).href);
const { createTreeCommand } = await load('src/commands/tree/index.ts');
const { FsError, CommandRegistry } = await load('src/contracts/index.ts');
const { Shell } = await load('src/shell/index.ts');
const { MemoryFileSystem } = await load('src/fs/memory/index.ts');
const { RealFileSystem } = await load('src/fs/real/index.ts');
const observations = { candidate, api: 'standalone src/commands/tree/index.ts', invocations: [], shells: [] };
const describe = (error) => error instanceof Error ? { name: error.name, message: error.message, code: error.code, path: error.path, stack: error.stack } : { primitive: String(error) };

export const makeFsError = (code, options) => new FsError(code, options);
export const createRealFileSystem = (root) => new RealFileSystem({ root });
export const createMemoryFileSystem = () => new MemoryFileSystem();
export function createCommand(request = {}) {
  const limits = {
    ...(request.entries === undefined ? {} : { maxEntries: request.entries }),
    ...(request.outputBytes === undefined ? {} : { maxOutputBytes: request.outputBytes }),
  };
  const definition = createTreeCommand({ limits });
  return { ...definition, execute(context) {
    const record = { argv: [...context.args], limits, cwd: context.cwd, env: { ...context.env }, stdout: [], stderr: [], startedAt: new Date().toISOString() };
    observations.invocations.push(record);
    const tap = (sink, stream) => ({ write(chunk) {
      const write = { attemptedBase64: Buffer.from(chunk).toString('base64'), state: 'pending' };
      record[stream].push(write);
      let operation;
      try { operation = sink.write(chunk); }
      catch (error) { write.state = 'threw'; write.error = describe(error); throw error; }
      operation.then(() => { write.state = 'fulfilled'; }, (error) => { write.state = 'rejected'; write.error = describe(error); });
      return operation;
    } });
    const operation = definition.execute({ ...context, stdout: tap(context.stdout, 'stdout'), stderr: tap(context.stderr, 'stderr') });
    Promise.resolve(operation).then((result) => { record.result = result; record.finishedAt = new Date().toISOString(); }, (error) => {
      record.error = describe(error); record.rejected = true; record.sameAsSignalReason = error === context.signal.reason; record.finishedAt = new Date().toISOString();
    });
    return operation;
  } };
}
export async function executeShell({ fs, commands, script, env, signal }) {
  const shell = new Shell({ fs, commands: new CommandRegistry(commands), cwd: '/', env });
  const record = { script, commandNames: commands.map((command) => command.name), className: shell.constructor.name, disposed: false };
  observations.shells.push(record);
  try {
    const result = await shell.exec(script, { signal });
    record.exitCode = result.exitCode;
    record.stdoutBase64 = Buffer.from(result.stdoutBytes).toString('base64');
    record.stderrBase64 = Buffer.from(result.stderrBytes).toString('base64');
    return { exitCode: result.exitCode, stdout: result.stdoutBytes, stderr: result.stderrBytes };
  } catch (error) { record.error = describe(error); throw error; }
  finally { await shell.dispose(); record.disposed = true; }
}
process.on('exit', () => {
  if (process.env.TREE_HOLDOUT_OBSERVATION) writeFileSync(process.env.TREE_HOLDOUT_OBSERVATION, `${JSON.stringify(observations, null, 2)}\n`);
});
