import { Command } from 'commander';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const { runBash, createWriteStream } = vi.hoisted(() => ({ runBash: vi.fn(async () => ({ exitCode: 0 })), createWriteStream: vi.fn() }));
vi.mock('../../sdk/bash.js', () => ({ runBash }));
vi.mock('@poe-platform/safe-bash', () => ({ MemoryFileSystem: class {}, RealFileSystem: class {} }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), createWriteStream }));
import { registerBashCommand } from './bash.js';

it('forwards inherited dry run to the SDK without opening the progress destination', async () => {
  runBash.mockClear(); createWriteStream.mockClear();
  const program = new Command().option('--dry-run');
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned', resource: { namespaceId: 'work' } };
  await program.parseAsync(['--dry-run', 'bash', '--media-config', JSON.stringify(media),
    '--media-progress', '/host-ui', '-c', 'printf changed > /proof.txt'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  expect(createWriteStream).not.toHaveBeenCalled();
});

it('deep merges explicit settings into media configuration without losing resource or provider options', async () => {
  const program = new Command();
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned',
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    provider: { module: 'file:///provider.mjs', options: { account: 'a', region: 'before' } } };
  await program.parseAsync(['bash', '--media-config', JSON.stringify(media),
    '--media-provider', '{"options":{"region":"after"}}', '--media-resource', '{"rights":["read","write"]}',
    '--', 'ffmpeg', '--media-resource', 'native-value'], { from: 'user' });
  expect(runBash).toHaveBeenLastCalledWith(expect.objectContaining({ args: ['--media-resource', 'native-value'],
    media: { ...media, resource: { ...media.resource, rights: ['read', 'write'] },
      provider: { ...media.provider, options: { account: 'a', region: 'after' } } } }));
});

it('rejects a media progress destination without explicit remote settings before opening it', async () => {
  runBash.mockClear(); createWriteStream.mockClear();
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '--media-progress', '/host-ui', '--', 'ffmpeg', '-help'], { from: 'user' }))
    .rejects.toThrow('service/auth/build/resource');
  expect(runBash).not.toHaveBeenCalled();
  expect(createWriteStream).not.toHaveBeenCalled();
});

it.each(['{"authToken":"private-token",', 'null', '[]', '"value"'])('reports invalid media JSON as a configuration error without echoing input: %s', async configuration => {
  runBash.mockClear();
  const program = new Command();
  registerBashCommand(program);
  const execution = program.parseAsync(['bash', '--media-config', configuration, '--', 'ffmpeg', '-help'], { from: 'user' });
  await expect(execution).rejects.toThrow('--media-config must be a JSON object');
  expect(runBash).not.toHaveBeenCalled();
});

it('exposes explicit remote collision replacement outside native argv', async () => {
  const program = new Command();
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned', resource: { namespaceId: 'work' } };
  await program.parseAsync(['bash', '--media-config', JSON.stringify(media), '--media-replace', '--', 'ffmpeg', '-version'], { from: 'user' });
  expect(runBash).toHaveBeenLastCalledWith(expect.objectContaining({ args: ['-version'], media: { ...media, replace: true } }));
});

it('forwards remote settings to SDK separately from native argv without prompts', async () => {
  const program = new Command();
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned', resource: { namespaceId: 'work' } };
  await program.parseAsync(['bash', '--media-config', JSON.stringify(media), '--', 'ffmpeg', '-i', 'a b', '--service', 'native-value'], { from: 'user' });
  expect(runBash).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'ffmpeg', args: ['-i', 'a b', '--service', 'native-value'], media }));
});

it('forwards native help and host-looking options literally after the argv separator', async () => {
  const program = new Command().exitOverride();
  registerBashCommand(program);
  const args = ['-h', '--help', '--version', '--media-config', '{}', '--root', '/native', '--env', 'native-value'];
  await program.parseAsync(['bash', '--', 'ffmpeg', ...args], { from: 'user' });
  expect(runBash).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'ffmpeg', args }));
  expect(runBash.mock.calls.at(-1)![0]).not.toHaveProperty('media');
});

it('rejects missing media configuration before SDK or interactive work', async () => {
  runBash.mockClear();
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '--media-config', '{}', '--', 'ffmpeg', '-help'], { from: 'user' })).rejects.toThrow('service/auth/build/resource');
  expect(runBash).not.toHaveBeenCalled();
});

it('accepts each public remote setting as an explicit outer CLI option', async () => {
  const program = new Command();
  registerBashCommand(program);
  const resource = { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' };
  const provider = { module: 'file:///provider.mjs', options: { account: 'configured' } };
  await program.parseAsync(['bash', '--media-service', 'https://media.test', '--media-provider', JSON.stringify(provider), '--media-auth-token', 'configured', '--media-build-digest', 'pinned', '--media-resource', JSON.stringify(resource), '--', 'identify', '-version'], { from: 'user' });
  expect(runBash).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'identify', args: ['-version'], media: { service: 'https://media.test', provider, authToken: 'configured', buildDigest: 'pinned', resource } }));
});

it('retains a progress destination that opens while the shell module loads', async () => {
  const ui = Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn(() => true), end() { queueMicrotask(() => this.emit('finish')); } });
  createWriteStream.mockImplementationOnce(() => { queueMicrotask(() => ui.emit('open')); return ui; });
  runBash.mockImplementationOnce(async () => {
    const [{ media }] = runBash.mock.calls.at(-1)! as unknown as [{ media: { onProgress(event: { direction: string; bytes: number }): Promise<void> } }];
    await media.onProgress({ direction: 'download', bytes: 4 });
    return { exitCode: 0 };
  });
  const program = new Command();
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned', resource: { namespaceId: 'work' } };
  const execution = program.parseAsync(['bash', '--media-config', JSON.stringify(media), '--media-progress', '/host-ui', '-c', 'ffmpeg -version'], { from: 'user' }).then(() => 'completed');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(await Promise.race([execution, new Promise(resolve => { timer = setTimeout(() => resolve('missed open'), 100); })])).toBe('completed');
    expect(ui.write).toHaveBeenCalledWith(expect.stringContaining('Media download: 4 bytes'));
  } finally { clearTimeout(timer); ui.emit('open'); await execution; }
});

it('awaits progress destination backpressure before the SDK completes', async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const ui = Object.assign(new EventEmitter(), { destroyed: false,
    write: vi.fn(() => { entered(); return false; }),
    end() { queueMicrotask(() => this.emit('finish')); },
  });
  createWriteStream.mockImplementationOnce(() => { queueMicrotask(() => ui.emit('open')); return ui; });
  runBash.mockImplementationOnce(async () => {
    const [{ media }] = runBash.mock.calls.at(-1)! as unknown as [{ media: { onProgress(event: { direction: string; bytes: number }): Promise<void> } }];
    await media.onProgress({ direction: 'download', bytes: 4 });
    return { exitCode: 0 };
  });
  const program = new Command();
  registerBashCommand(program);
  const media = { service: 'https://media.test', authToken: 'token', buildDigest: 'pinned', resource: { namespaceId: 'work' } };
  let settled = false;
  const execution = program.parseAsync(['bash', '--media-config', JSON.stringify(media), '--media-progress', '/host-ui', '-c', 'ffmpeg -version'], { from: 'user' }).then(() => { settled = true; });
  try {
    await ready;
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { ui.emit('drain'); await execution; }
  expect(settled).toBe(true);
});
