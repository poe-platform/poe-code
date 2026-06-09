import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import {
  Audio,
  defineSchema,
  File,
  Image,
} from "tiny-stdio-mcp-server";
import { createHttpServer, type HttpServer } from "./http-server.js";

const TEST_PNG_BASE64 = "iVBORw0KGgo=";
const TEST_MP3_BASE64 = "SUQzBAAAAAA=";

function normalizeRequestHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: init.method ?? "GET",
        hostname: normalizeRequestHostname(url.hostname),
        port: url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders.set(key, value);
            continue;
          }

          if (Array.isArray(value)) {
            for (const entry of value) {
              responseHeaders.append(key, entry);
            }
          }
        }

        const body =
          response.statusCode === 204
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    request.on("error", reject);

    const signal = init.signal ?? undefined;

    if (signal !== undefined) {
      const onAbort = () => {
        request.destroy(new Error("Request aborted"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => {
        signal.removeEventListener("abort", onAbort);
      });
    }

    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      request.write(init.body);
    } else if (init.body instanceof URLSearchParams) {
      request.write(init.body.toString());
    }

    request.end();
  });
}

export function createTestMcpServer(
  options: Partial<{
    name: string;
    version: string;
    enableJsonResponse: boolean;
    sessionIdGenerator: (() => string) | undefined;
    oauth: import("./http-server.js").TinyHttpMcpServerOAuthOptions;
  }> = {}
): HttpServer {
  const emptySchema = defineSchema({});
  const textSchema = defineSchema({
    text: { type: "string" },
  });

  return createHttpServer({
    name: options.name ?? "conformance-test-server",
    version: options.version ?? "1.0.0",
    ...(hasOwnProperty(options, "enableJsonResponse")
      ? { enableJsonResponse: options.enableJsonResponse }
      : {}),
    ...(hasOwnProperty(options, "sessionIdGenerator")
      ? { sessionIdGenerator: options.sessionIdGenerator }
      : {}),
    ...(hasOwnProperty(options, "oauth") ? { oauth: options.oauth } : {}),
  })
    .tool("echo", "Echo input text", textSchema, ({ text }) => String(text))
    .tool("reverse", "Reverse input text", textSchema, ({ text }) =>
      String(text).split("").reverse().join("")
    )
    .tool("uppercase", "Uppercase input text", textSchema, ({ text }) =>
      String(text).toUpperCase()
    )
    .tool(
      "get_user",
      "Return a test user object",
      defineSchema({ id: { type: "string" } }),
      ({ id }) => ({
        id: String(id),
        name: "Alice",
        role: "admin",
      })
    )
    .tool("get_list", "Return a numeric array", emptySchema, () => [1, 2, 3])
    .tool("get_image", "Return an image block", emptySchema, () =>
      Image.fromBase64(TEST_PNG_BASE64, "image/png")
    )
    .tool("get_audio", "Return an audio block", emptySchema, () =>
      Audio.fromBase64(TEST_MP3_BASE64, "audio/mpeg")
    )
    .tool("get_file", "Return a file block", emptySchema, () =>
      File.fromText("hello,world", "text/csv")
    )
    .tool("get_mixed", "Return multiple content blocks", emptySchema, () => [
      Image.fromBase64(TEST_PNG_BASE64, "image/png"),
      "Caption for the image",
      File.fromText("notes"),
    ])
    .tool("throw_sync", "Throw synchronously", emptySchema, () => {
      throw new Error("sync boom");
    })
    .tool("throw_async", "Throw asynchronously", emptySchema, async () => {
      throw new Error("async boom");
    })
    .tool("empty_result", "Return undefined", emptySchema, () => undefined)
    .tool("slow", "Resolve slowly", emptySchema, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    })
    .tool("large_output", "Return 100KB of text", emptySchema, () =>
      "x".repeat(100_000)
    );
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
