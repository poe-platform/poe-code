import { Buffer } from 'node:buffer';
import { Readable, Writable } from 'node:stream';
import type { RequestOptions } from 'node:http';
import http from '@jspm/core/nodelibs/http';

type HeaderValue = string | number | readonly string[];
type IncomingResponse = Readable & {
  url: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  rawHeaders: string[];
};
type ResponseCallback = (response: IncomingResponse) => void;

/** The pinned SDK retains cookies, redirects, auth and retries. This bridge
 * supplies its HTTP stream using Fetch, without sockets or ambient location. */
export class ClientRequest extends Writable {
  private readonly controller = new AbortController();
  private readonly chunks: Buffer[] = [];
  private readonly headers = new Map<string, HeaderValue>();
  private response?: IncomingResponse;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private readonly url: URL, private readonly options: RequestOptions, callback?: ResponseCallback) {
    // Finishing the request body must not close the pending response stream.
    super({ autoDestroy: false });
    if (callback) this.once('response', callback);
    for (const [name, value] of Object.entries(options.headers ?? {}))
      if (value !== undefined) this.setHeader(name, value);
    if (options.timeout) this.setTimeout(options.timeout);
  }
  setHeader(name: string, value: HeaderValue): this { this.headers.set(name.toLowerCase(), value); return this; }
  getHeader(name: string): HeaderValue | undefined { return this.headers.get(name.toLowerCase()); }
  removeHeader(name: string): void { this.headers.delete(name.toLowerCase()); }
  setTimeout(milliseconds: number, callback?: () => void): this {
    if (milliseconds !== Infinity && (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2147483647))
      throw new RangeError('Invalid HTTP request timeout');
    clearTimeout(this.timeout);
    if (callback) this.once('timeout', callback);
    if (milliseconds > 0 && milliseconds !== Infinity) this.timeout = setTimeout(() => this.emit('timeout'), milliseconds);
    return this;
  }
  _write(chunk: Uint8Array, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  _final(callback: (error?: Error | null) => void): void {
    void this.send().catch(error => { if (!this.destroyed) this.destroy(error); });
    callback();
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    clearTimeout(this.timeout);
    this.chunks.length = 0;
    this.controller.abort(error ?? undefined);
    if (!this.response?.readableEnded) this.response?.destroy(error ?? undefined);
    callback(error);
  }
  private async send(): Promise<void> {
    const headers = new Headers();
    for (const [name, value] of this.headers)
      for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
    const body = this.chunks.length ? Buffer.concat(this.chunks) : undefined;
    this.chunks.length = 0;
    const response = await fetch(this.url, {
      method: this.options.method ?? 'GET', headers, body,
      redirect: 'manual', signal: this.controller.signal,
    });
    if (this.destroyed) { await response.body?.cancel(); return; }
    const rawHeaders: string[] = [];
    const decodedHeaders: Record<string, string | string[]> = {};
    for (const [name, value] of response.headers) {
      if (name === 'set-cookie') continue;
      rawHeaders.push(name, value);
      // Fetch has already decoded the body. Preserve original APIResponse
      // headers in rawHeaders, but prevent the SDK from decoding it twice.
      if (name !== 'content-encoding' && (name !== 'content-length' || !response.headers.has('content-encoding'))) decodedHeaders[name] = value;
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      decodedHeaders['set-cookie'] = cookies;
      for (const cookie of cookies) rawHeaders.push('set-cookie', cookie);
    }
    const reader = response.body?.getReader();
    const incoming: IncomingResponse = Object.assign(new Readable({
      read() {
        if (!reader) { this.push(null); return; }
        void reader.read().then(({ done, value }) => this.push(done ? null : Buffer.from(value)), error => this.destroy(error));
      },
      destroy(error, callback) {
        if (!reader) { callback(error); return; }
        void reader.cancel(error).then(() => callback(error), reason => callback(error ?? reason));
      },
    }), { url: response.url || this.url.toString(), statusCode: response.status, statusMessage: response.statusText,
      headers: decodedHeaders, rawHeaders });
    this.response = incoming;
    incoming.on('error', error => this.destroy(error));
    incoming.once('end', () => this.destroy());
    this.emit('response', incoming);
  }
}

export function request(input: string | URL | RequestOptions, options?: RequestOptions | ResponseCallback, callback?: ResponseCallback): ClientRequest {
  const supplied = typeof options === 'function' ? {} : options ?? {};
  let url: URL;
  let settings: RequestOptions;
  if (typeof input === 'string' || input instanceof URL) {
    url = new URL(input);
    settings = supplied;
  } else {
    settings = { ...input, ...supplied };
    const host = settings.hostname ?? settings.host ?? 'localhost';
    url = new URL(`${settings.protocol ?? 'http:'}//${host}${settings.port ? ':' + settings.port : ''}${settings.path ?? '/'}`);
  }
  return new ClientRequest(url, settings, typeof options === 'function' ? options : callback);
}
export function get(input: string | URL | RequestOptions, options?: RequestOptions | ResponseCallback, callback?: ResponseCallback): ClientRequest {
  const pending = request(input, options, callback);
  pending.end();
  return pending;
}
export const { Agent, globalAgent, STATUS_CODES, METHODS } = http;
export default { ...http, request, get, ClientRequest };
