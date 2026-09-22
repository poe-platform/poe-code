/** Explicit Node operator lifecycle; absent from every portable entrypoint. */
import type {Server} from 'node:https';
import type {Socket} from 'node:net';
import {createMediaHttpHandler, createMediaHttpsServer, type MediaHttpOptions} from './http-server.js';
import type {ServerOptions} from 'node:https';

export interface MediaServiceOptions {
  /** Ownership transfers after acquisition. This callback must verify deployment
   * pins and install the explicitly configured isolation driver. */
  createService(): Promise<{
    fetch(request: Request): Promise<Response>;
    sweep(): Promise<void>;
    close(): Promise<void>;
  }>;
  http: Omit<MediaHttpOptions, 'fetch'> & {tls: ServerOptions};
  listen: {host: string; port: number};
  sweepIntervalMs: number;
  shutdownGraceMs: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  /** Operator diagnostics only; never a tool stream or protocol lane. */
  reportError(error: unknown): void;
}

/** Await verified service acquisition and HTTPS listening. No module import or
 * construction of a client starts this lifecycle or executes a native tool. */
export async function startMediaService(options: MediaServiceOptions): Promise<{server: Server; close(): Promise<void>}> {
  options = {...options, listen: {...options.listen}, http: {...options.http, tls: {...options.http.tls}}};
  if (typeof options.createService !== 'function' || typeof options.reportError !== 'function') throw new TypeError('Explicit service owner and error reporter required');
  if (typeof options.listen.host !== 'string' || !options.listen.host || options.listen.host.includes('\0')
    || !Number.isSafeInteger(options.listen.port) || options.listen.port < 1 || options.listen.port > 65535) throw new TypeError('Explicit listen host and port required');
  for (const bound of [options.sweepIntervalMs, options.shutdownGraceMs, options.requestTimeoutMs, options.headersTimeoutMs, options.keepAliveTimeoutMs]) {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 2147483647) throw new TypeError('Finite service timing bounds required');
  }
  if (options.headersTimeoutMs > options.requestTimeoutMs) throw new TypeError('Header timeout exceeds request timeout');
  // Validate public transport configuration before acquiring canonical resources.
  createMediaHttpHandler({...options.http, async fetch() {throw new Error('Service not acquired');}});
  const acquired = await options.createService();
  const retireService = acquired.close.bind(acquired);
  let server: Server | undefined;
  let sweeping: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  let stopping = false;
  const sockets = new Set<Socket>();
  const reportError = (error: unknown) => {
    // A failed operator reporter cannot create an unhandled sweep rejection or
    // prevent owned transport/native resources from retiring.
    try {options.reportError(error);} catch { /* Reporting has no resource authority. */ }
  };
  function close(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    clearInterval(timer);
    let grace: ReturnType<typeof setTimeout> | undefined;
    const transport = new Promise<void>((resolve, reject) => {
      if (!server) {resolve(); return;}
      grace = setTimeout(() => {
        // Include incomplete TLS handshakes and upgraded connections that are
        // outside closeAllConnections' HTTP connection inventory.
        for (const socket of sockets) socket.destroy();
        server!.closeAllConnections();
      }, options.shutdownGraceMs);
      try {
        server.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
      } catch (error) {reject(error);}
    });
    const cleanup = (async () => {
      await sweeping;
      await retireService();
    })();
    closing = (async () => {
      try {
        const results = await Promise.allSettled([transport, cleanup]);
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Media service retirement failed');
      } finally {clearTimeout(grace);}
    })();
    void closing.catch(() => {});
    return closing;
  }
  try {
    const fetch = acquired.fetch.bind(acquired);
    const sweep = acquired.sweep.bind(acquired);
    server = createMediaHttpsServer({...options.http, async fetch(request) {
      if (stopping) return Response.json({category: 'protocol', code: 'serviceRetiring', message: 'Media service is retiring', phase: 'notAccepted'},
        {status: 503, headers: {'Cache-Control': 'no-store'}});
      return fetch(request);
    }});
    server.maxConnections = options.http.maxConnections;
    server.requestTimeout = options.requestTimeoutMs;
    server.headersTimeout = options.headersTimeoutMs;
    server.keepAliveTimeout = options.keepAliveTimeoutMs;
    server.on('connection', (socket: Socket) => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {server!.removeListener('listening', ready); reject(error);};
      const ready = () => {server!.removeListener('error', failed); resolve();};
      server!.once('error', failed); server!.once('listening', ready);
      try {server!.listen(options.listen);} catch (error) {
        server!.removeListener('listening', ready); server!.removeListener('error', failed); reject(error);
      }
    });
    server.on('error', reportError);
    timer = setInterval(() => {
      if (sweeping || closing) return;
      sweeping = Promise.resolve().then(sweep).catch(reportError).finally(() => {sweeping = undefined;});
    }, options.sweepIntervalMs);
    timer.unref();
    return {server, close};
  } catch (startup) {
    try {await close();}
    catch (cleanup) {
      const failures = cleanup instanceof AggregateError ? cleanup.errors : [cleanup];
      throw new AggregateError([startup, ...failures], 'Media service startup and retirement failed');
    }
    throw startup;
  }
}
