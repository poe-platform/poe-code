/** In-memory transport fixture. No native tool or deployed-service claims. */
import { createMediaServer } from '../../remote-execution/src/media-server.js';
import type { Build, Limits, Grant, FileOperation, CallbackResult } from '../../remote-execution/src/wire.generated.js';
import type { NativeProcess, ProcessStreams } from '../../remote-execution/src/native-process.js';
import type { AdmissionRecord } from '../../remote-execution/src/admissions.js';
import { mediaFrontendContract } from '../src/frontend-contract.js';
import { nativeReference } from '../src/options.generated.js';
import { imageMagickReference } from '../src/imagemagick.generated.js';

export const fixtureDigest = 'a'.repeat(64);
export const fixtureLimits: Limits = { maxJobs: 2, maxHandles: 4, maxArgvBytes: 4096, maxManifestEntries: 8, maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192, maxReplayBytes: 65536, maxCallbacks: 8, maxNativeMemoryBytes: 8192, maxNativeProcesses: 4, maxJobDurationMs: 10000 };
export function createMediaProvider() {
  return { fetch: createTransport() };
}
export function createTransport(options?: { limits?: Limits; grants?: readonly Grant[]; fileRequest?: { grantId: string; operation: FileOperation; observe(result: CallbackResult): void }; observe?: (request: unknown) => void; output?: Uint8Array; extraOutput?: Uint8Array; descriptorOutput?: Uint8Array; descriptorInput?: (bytes: Uint8Array) => void; onSignal?: (signal: string) => void; outcome?: Awaited<NativeProcess['exit']> }) {
  const executables = Object.fromEntries([
    ...Object.keys(nativeReference.executables),
    ...Object.entries(imageMagickReference.executables).filter(([, executable]) => executable.kind === 'media').map(([name]) => name),
  ].map(name => [name, fixtureDigest]));
  const build: Build = { digest: fixtureDigest, imageDigest: 'sha256:' + fixtureDigest, os: 'linux', architecture: 'x86_64', executables, librariesDigest: fixtureDigest, ...mediaFrontendContract, inventoryDigest: fixtureDigest, assetsDigest: fixtureDigest, launcherRevision: 'fixture', bridgeRevision: 'fixture', runtimeRequirements: [], runtimeEnvironment: {}, policyDigest: fixtureDigest, configDigest: fixtureDigest, policyDifferences: [], inventory: { codecs: [], coders: [], delegates: [], fonts: [], profiles: [] } };
  const admissions = new Map<string, AdmissionRecord>();
  const server = createMediaServer({
    authenticate: async request => request.headers.get('Authorization') === 'Bearer fixture' ? { tenantId: 'fixture', principalId: 'fixture', expiresAt: Date.now() + 60000 } : null,
    builds: [build], tools: Object.keys(build.executables).map(id => ({ id, buildDigest: build.digest, executable: '/fixture/' + id, requiredFeatures: ['live-files'] })),
    admissions: {
      async record(value) {
        const previous = admissions.get(value.operationId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('Fixture admission conflict');
        admissions.set(value.operationId, structuredClone(value));
      },
      async inspect(id) { return structuredClone(admissions.get(id) ?? null); },
    },
    storage: { async append() {}, async read() { return new Uint8Array(); }, async remove() {} },
    limits: options?.limits ?? fixtureLimits, maxDocumentBytes: 65536, maxRecords: 128, leaseMs: 20000, retentionMs: 20000,
    driver: {
      features: ['live-files', 'byte-argv', 'descriptors'].map(name => ({ name, evidence: ['in-memory-fixture-only'] })),
      async inspectBuild() { return build; },
      async admitSession() { return {
        async close() {},
        grants: options?.grants ?? (options?.extraOutput || options?.descriptorOutput || options?.descriptorInput ? [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: options?.descriptorInput ? ['read', 'write'] : ['write'], maxBytes: String(Math.max(8192, options?.descriptorOutput?.length ?? 0)), maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }] : []),
        async prepare({ request, hooks }) {
          options?.observe?.(request);
          return { async close() {}, start(streams: ProcessStreams): NativeProcess {
            let resolve!: (value: Awaited<NativeProcess['exit']>) => void;
            let settle!: () => void;
            const exit = new Promise<Awaited<NativeProcess['exit']>>(done => { resolve = done; });
            const settled = new Promise<void>(done => { settle = done; });
            let completion: Promise<void> | undefined;
            const finish = () => completion ??= (async () => {
              if (options?.fileRequest) {
                const result = await hooks.request(options.fileRequest.grantId, options.fileRequest.operation);
                options.fileRequest.observe(result);
              }
              if (options?.descriptorOutput) { await streams.output(4, options.descriptorOutput); await streams.end(4); }
              if (options?.extraOutput) {
                const channel = await hooks.openChannel({ type: 'ChannelOpen', channelId: 4, correlationId: '1', direction: 'write', resourceId: 'extra-output', seekable: false });
                const writer = channel.writable!.getWriter();
                try { await writer.write(options.extraOutput); await writer.close(); } finally { writer.releaseLock(); }
              }
              await streams.output(2, options?.output ?? new TextEncoder().encode('fixture media output\n'));
              await streams.end(2); await streams.end(3);
              resolve(options?.outcome ?? { kind: 'exited', exitCode: 0 }); settle();
            })();
            if (request.args.some(arg => ['-version', '-help'].includes(new TextDecoder().decode(Uint8Array.from(arg))))) void finish();
            const endedInputs = new Set<number>();
            return { exit, settled, async write(channel, bytes) { if (channel === 4) options?.descriptorInput?.(bytes); }, async end(channel) {
              endedInputs.add(channel);
              if (endedInputs.has(1) && request.descriptors.filter(d => d.rights.includes('read') && !d.seekable).every(d => endedInputs.has(d.fd + 1))) await finish();
            },
              signal(name) { if (options?.onSignal) { options.onSignal(name); return; } resolve({ kind: 'exited', exitCode: 143 }); settle(); } };
          } };
        },
      }; },
    },
  });
  return (input: string | URL | Request, init?: RequestInit) => server.fetch(new Request(input, init));
}
