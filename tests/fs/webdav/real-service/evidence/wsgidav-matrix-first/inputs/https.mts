import { request } from "node:https";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import type { WebDavFetch } from "virtual-bash/fs/webdav";

export interface WireObservation {
  readonly url: string;
  readonly method: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  status?: number;
  responseHeaders?: Record<string, string>;
  uploadedBytes: number;
  downloadedBytes: number;
  pulls: number;
  drains: number;
  aborted: boolean;
  cancelled: boolean;
  ended: boolean;
}

export function createHttpsFetch(origin: string, certificate: Uint8Array, events: WireObservation[] = []): WebDavFetch {
  const allowed = new URL(origin);
  if (allowed.protocol !== "https:" || allowed.hostname !== "127.0.0.1" || allowed.username || allowed.password) {
    throw new Error("fixture transport requires explicit numeric loopback HTTPS");
  }
  const ca = Buffer.from(certificate);
  return async (url, init) => {
    const target = new URL(url);
    if (target.origin !== allowed.origin || target.username || target.password) throw new Error("unconfigured HTTPS origin");
    if (init.redirect !== "manual" || init.credentials !== "omit") throw new Error("explicit manual/omit policy required");
    const normalized = new Request(url, init);
    const signal = AbortSignal.any([normalized.signal, AbortSignal.timeout(10000)]);
    signal.throwIfAborted();
    const event: WireObservation = {
      url, method: normalized.method, requestHeaders: Object.fromEntries(normalized.headers),
      uploadedBytes: 0, downloadedBytes: 0, pulls: 0, drains: 0,
      aborted: false, cancelled: false, ended: false,
    };
    events.push(event);
    return new Promise<Response>((resolve, reject) => {
      let incoming: IncomingMessage | undefined;
      let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const upload = normalized.body?.getReader();
      let finished = false;
      const cleanup = () => signal.removeEventListener("abort", abort);
      const fail = (reason: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(reason);
        bodyController?.error(reason);
        incoming?.destroy();
        outgoing.destroy(reason instanceof Error ? reason : new Error(String(reason)));
        void upload?.cancel(reason).catch(() => {});
      };
      const abort = () => { event.aborted = true; fail(signal.reason); };
      const outgoing = request(target, {
        method: normalized.method, headers: Object.fromEntries(normalized.headers),
        ca, rejectUnauthorized: true, agent: false,
      }, response => {
        incoming = response;
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
        }
        event.status = response.statusCode!;
        event.responseHeaders = Object.fromEntries(headers);
        response.on("error", fail);
        const iterator = response[Symbol.asyncIterator]();
        const noBody = normalized.method === "HEAD" || [204, 205, 304].includes(response.statusCode!);
        const body = noBody ? null : new ReadableStream<Uint8Array>({
          start(controller) { bodyController = controller; },
          async pull(controller) {
            try {
              signal.throwIfAborted();
              event.pulls++;
              const item = await iterator.next();
              signal.throwIfAborted();
              if (item.done) {
                event.ended = true;
                finished = true;
                cleanup();
                controller.close();
              } else {
                const bytes = new Uint8Array(item.value as Uint8Array);
                event.downloadedBytes += bytes.byteLength;
                controller.enqueue(bytes);
              }
            } catch (error) { fail(error); }
          },
          cancel(reason) {
            event.cancelled = true;
            finished = true;
            cleanup();
            response.destroy();
            outgoing.destroy();
            void upload?.cancel(reason).catch(() => {});
            void iterator.return?.().catch(() => {});
          },
        }, { highWaterMark: 0 });
        if (noBody) {
          response.once("end", () => { event.ended = true; finished = true; cleanup(); });
          response.resume();
        }
        const result = new Response(body, { status: response.statusCode!, statusText: response.statusMessage ?? "", headers });
        Object.defineProperty(result, "url", { value: target.href });
        resolve(result);
      });
      outgoing.on("error", fail);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      void (async () => {
        try {
          if (upload) {
            while (true) {
              signal.throwIfAborted();
              const item = await upload.read();
              if (item.done) break;
              const bytes = Buffer.from(item.value);
              event.uploadedBytes += bytes.length;
              if (!outgoing.write(bytes)) {
                event.drains++;
                await once(outgoing, "drain", { signal });
              }
            }
          }
          outgoing.end();
        } catch (error) { fail(error); }
        finally { upload?.releaseLock(); }
      })();
    });
  };
}
