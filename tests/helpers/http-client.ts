import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { HttpClient, HttpResponse } from "../../src/cli/http.js";

export function createNodeHttpClient(): HttpClient {
  return async (url, init) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const client = isHttps ? https : http;
    const port =
      parsed.port.length > 0 ? Number(parsed.port) : isHttps ? 443 : 80;

    return await new Promise<HttpResponse>((resolve, reject) => {
      const request = client.request(
        {
          method: init?.method ?? "GET",
          hostname: parsed.hostname,
          port,
          path: `${parsed.pathname}${parsed.search}`,
          headers: init?.headers
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            if (Buffer.isBuffer(chunk)) {
              chunks.push(chunk);
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok:
                typeof response.statusCode === "number"
                  ? response.statusCode >= 200 && response.statusCode < 300
                  : false,
              status: response.statusCode ?? 0,
              json: async () => JSON.parse(body),
              text: async () => body
            });
          });
        }
      );

      request.on("error", reject);
      if (init?.body) {
        request.write(init.body);
      }
      request.end();
    });
  };
}
