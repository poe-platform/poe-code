import { runBash, type BashOptions, type RemoteMediaOptions, type MediaProviderSettings, type MediaProviderRuntime } from 'poe-code';
import { Shell, MemoryFileSystem } from 'poe-code/safe-bash';
import { createRemoteMediaCommands, mediaCommands, type MediaCommandsOptions } from 'poe-code/safe-bash/commands/media';
const media: RemoteMediaOptions = {
  service: 'https://media.test', authToken: 'explicit', buildDigest: 'pinned',
  resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'], grantId: 'g', profile: 'live' },
  provider: { module: 'file:///provider.mjs', options: { account: 'a' } },
  replace: false, fetch: globalThis.fetch, onProgress(event) { const ignoredCount: number = event.bytes; }
};
const options: BashOptions = { fs: new MemoryFileSystem(), command: 'ffprobe', args: [Uint8Array.of(255), ''], media };
runBash(options);
new Shell({ fs: options.fs }).use(createRemoteMediaCommands(media));
createRemoteMediaCommands(media).dispose();
const binding: MediaCommandsOptions = { engine: { async execute(request) { await request.stdout.write(request.args[0]!); return { exitCode: 0 }; } } };
new Shell({ fs: options.fs }).use(mediaCommands(binding));
export function createMediaProvider(settings: MediaProviderSettings): MediaProviderRuntime { return { fetch: settings.fetch ?? globalThis.fetch }; }
