/** Operator-only executable owner, never imported by the local virtual CLI. */
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startMediaService, type MediaServiceOptions} from '@poe-code/remote-execution/server';
import {createMediaDeployment, type MediaDeploymentOptions} from './server.js';

export interface MediaServerConfiguration {
  deployment: MediaDeploymentOptions;
  service: Omit<MediaServiceOptions, 'createService' | 'reportError'>;
}

export async function runMediaServer(args: readonly string[], dependencies: {
  load?: (path: string) => Promise<{configuration: MediaServerConfiguration}>;
  signals?: Pick<NodeJS.Process, 'once' | 'removeListener'>;
  reportError?: (error: unknown) => void;
} = {}): Promise<{close(): Promise<void>}> {
  if (!Array.isArray(args) || args.length !== 1 || !Object.hasOwn(args, 0)) throw new TypeError('One absolute operator configuration module is required');
  const path = args[0];
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new TypeError('One absolute operator configuration module is required');
  const load = dependencies.load ?? (async path => import(pathToFileURL(path).href));
  const signals = dependencies.signals ?? process;
  const report = dependencies.reportError ?? (() => {
    process.exitCode = 1;
    // Operator errors can contain credentials, argv or file paths. Keep command
    // diagnostics fixed and separate from every native/protocol byte stream.
    process.stderr.write('Remote media service failed; inspect deployment diagnostics.\n');
  });
  const reportError = (error: unknown) => {try {report(error);} catch { /* No reporting authority over cleanup. */ }};
  let requested = false;
  let running: Awaited<ReturnType<typeof startMediaService>> | undefined;
  let closing: Promise<void> | undefined;
  const stop = () => {
    requested = true;
    if (running) void close().catch(reportError);
  };
  function removeSignals() {
    signals.removeListener('SIGINT', stop); signals.removeListener('SIGTERM', stop);
  }
  function close(): Promise<void> {
    closing ??= Promise.resolve().then(async () => {
      removeSignals(); await running!.close();
    });
    void closing.catch(() => {}); return closing;
  }
  signals.once('SIGINT', stop); signals.once('SIGTERM', stop);
  try {
    const {configuration} = await load(path);
    if (requested) throw new Error('Remote media service startup canceled');
    if (!configuration || !configuration.deployment || !configuration.service) throw new TypeError('Explicit deployment and service configuration required');
    // Capture selection before the asynchronous verification/listen boundaries.
    const deployment = configuration.deployment;
    running = await startMediaService({...configuration.service,
      createService: () => createMediaDeployment(deployment), reportError,
    });
    if (requested) await close();
    return {close};
  } catch (error) {removeSignals(); throw error;}
}
