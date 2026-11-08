import assert from "node:assert/strict";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import type { HttpTransport } from "../../../src/commands/network/types.js";
import type { Lab } from "./lab.js";

export function loopbackTransport(lab: Lab): {
  transport: HttpTransport;
  calls: { url: string; method: string; signal: AbortSignal }[];
  close(): Promise<void>;
} {
  const requests = new Set<ClientRequest>();
  const responses = new Set<IncomingMessage>();
  const uploads = new Set<Promise<void>>();
  const calls: { url: string; method: string; signal: AbortSignal }[] = [];
  const transport: HttpTransport = async (input) => {
    assert(lab.allow(input.url), "Injected transport rejects nonfixture URL");
    input.signal.throwIfAborted();
    calls.push({ url: input.url, method: input.method, signal: input.signal });
    const url = new URL(input.url);
    return await new Promise((resolve, reject) => {
      const headers = input.headers.flatMap(([name, value]) => [name, value]);
      if (!input.headers.some(([name]) => name.toLowerCase() === "host")) headers.push("Host", url.host);
      headers.push("Connection", "close");
      const outgoing = httpRequest({ hostname: "127.0.0.1", port: url.port, path: `${url.pathname}${url.search}`, method: input.method, headers, agent: false, signal: input.signal });
      requests.add(outgoing);
      outgoing.on("error", reject);
      outgoing.once("close", () => requests.delete(outgoing));
      outgoing.once("response", (incoming) => {
        responses.add(incoming);
        incoming.once("close", () => responses.delete(incoming));
        incoming.on("error", () => {});
        const responseHeaders: [string, string][] = [];
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) responseHeaders.push([incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!]);
        resolve({
          status: incoming.statusCode ?? 0,
          statusText: incoming.statusMessage ?? "",
          headers: responseHeaders,
          httpVersion: incoming.httpVersion,
          body: incoming,
          async dispose() { incoming.destroy(); outgoing.destroy(); },
        });
      });
      const upload = (async () => {
        try {
          let count = 0;
          if (input.body) {
            for await (const chunk of input.body) {
              input.signal.throwIfAborted();
              count += chunk.length;
              assert(count <= 1024 * 1024, "Injected upload exceeds fixture budget");
              await new Promise<void>((resolveWrite, rejectWrite) => outgoing.write(chunk, (error) => error ? rejectWrite(error) : resolveWrite()));
            }
          }
          outgoing.end();
        } catch (error) {
          outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
          reject(error);
        }
      })();
      uploads.add(upload);
      void upload.then(() => uploads.delete(upload), () => uploads.delete(upload));
    });
  };
  return {
    calls, transport,
    async close() {
      for (const response of responses) response.destroy();
      for (const request of requests) request.destroy();
      await Promise.all(uploads);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
