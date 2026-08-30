import { Shell, MemoryFileSystem, createCurlCommand, networkCommands,
  type CommandContext, type NetworkCommandsOptions } from 'virtual-bash';
import { createCurlCommand as subpathCurl, networkCommands as subpathNetwork,
  type HttpTransport, type NetworkLimits } from 'virtual-bash/commands/network';

const transport: HttpTransport = async request => ({
  status: 200, statusText: 'OK', headers: [],
  body: (async function* () { request.signal.throwIfAborted(); yield new Uint8Array([65]); })(),
  async dispose() {},
});
const limits: Partial<NetworkLimits> = { maxRedirects: 0, maxRetries: 0 };
const options: NetworkCommandsOptions = { authorize: () => true, transport, limits };
const fs = new MemoryFileSystem();
const rootShell = new Shell({ fs }).use(networkCommands(options));
const subpathShell = new Shell({ fs }).use(subpathNetwork(options));
const context: CommandContext = {
  command: 'curl', args: ['https://fixture.invalid'], fs, cwd: '/', env: {},
  signal: new AbortController().signal, stdin: (async function* () {})(),
  stdout: { async write(_bytes) {} }, stderr: { async write(_bytes) {} },
};
assert.equal((await createCurlCommand(options).execute(context)).exitCode, 0);
assert.equal((await subpathCurl(options).execute(context)).exitCode, 0);
assert.equal((await rootShell.exec('curl https://fixture.invalid')).stdout, 'A');
assert.equal((await subpathShell.exec('curl https://fixture.invalid')).stdout, 'A');
await rootShell.dispose();
await subpathShell.dispose();
import assert from 'node:assert/strict';
