import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../runtime/types.js";
import webPlugin, { spec as webPluginSpec } from "./poe-agent-plugin-web.js";

type TestTool = {
  name: string;
  call: (args: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
};

function createToolContext(signal: AbortSignal): ToolContext {
  return {
    fork: async () => {
      throw new Error("fork is not supported in plugin tests");
    },
    spawn: async () => {
      throw new Error("spawn is not supported in plugin tests");
    },
    signal,
  };
}

async function callTool(
  tools: TestTool[] | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const tool = tools?.find(candidate => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.call(args, createToolContext(signal));
}

describe("poe-agent-plugin-web", () => {
  it("validates config options with its plugin spec", () => {
    expect(webPluginSpec.parseOptions({})).toEqual({});
    expect(() => webPluginSpec.parseOptions({ fetch: true })).toThrow();
  });

  it("search_web flattens abstract text and nested related topics from DuckDuckGo", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          AbstractText: "Primary answer",
          RelatedTopics: [
            { Text: "First related" },
            { Topics: [{ Text: "Nested related" }] },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const plugin = webPlugin({ fetch: fetchMock });

    await expect(callTool(plugin.tools, "search_web", { query: "poe" })).resolves.toBe(
      "Primary answer\nFirst related\nNested related",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("https://api.duckduckgo.com/");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("q=poe");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it("passes the tool signal through search_web", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const plugin = webPlugin({ fetch: fetchMock });
    const pending = callTool(plugin.tools, "search_web", { query: "poe" }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toThrow("Aborted");
  });

  it("fetch_url converts HTML responses to markdown", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html><body><h1>Example</h1><p>Hello <strong>world</strong>.</p></body></html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );
    const plugin = webPlugin({ fetch: fetchMock });

    const output = await callTool(plugin.tools, "fetch_url", {
      url: "https://example.com/docs",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/docs", {
      signal: expect.any(AbortSignal),
    });
    expect(output).toContain("URL: https://example.com/docs");
    expect(output).toContain("Content type: text/html");
    expect(output).toContain("# Example");
    expect(output).toContain("Hello **world**.");
    expect(output).not.toContain("More content available");
  });

  it("fetch_url paginates long bodies with offset", async () => {
    const body = "0123456789".repeat(2_500);
    const fetchMock = vi.fn(async () =>
      new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    );
    const plugin = webPlugin({ fetch: fetchMock });

    const firstPage = await callTool(plugin.tools, "fetch_url", {
      url: "https://example.com/log",
    });
    const secondPage = await callTool(plugin.tools, "fetch_url", {
      url: "https://example.com/log",
      offset: 20_000,
    });

    expect(firstPage).toContain("Showing characters 0-20000 of 25000.");
    expect(firstPage).toContain("More content available at offset 20000.");
    expect(secondPage).toContain("Showing characters 20000-25000 of 25000.");
    expect(secondPage).not.toContain("More content available");
  });

  it.each([
    "http://localhost/private",
    "http://localHost./private",
    "http://127.0.0.1/private",
    "http://10.1.2.3/private",
    "http://172.16.0.1/private",
    "http://172.31.255.255/private",
    "http://192.168.1.1/private",
    "http://169.254.169.254/latest",
    "http://[::1]/private",
    "http://[fe80::1]/private",
    "http://[fc00::1]/private",
  ])("fetch_url rejects non-public URL host %s", async (url) => {
    const fetchMock = vi.fn(async () => new Response("secret"));
    const plugin = webPlugin({ fetch: fetchMock });

    await expect(callTool(plugin.tools, "fetch_url", { url })).rejects.toThrow(
      "fetch_url cannot access non-public URL host",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch_url rejects non-http URLs before fetching", async () => {
    const fetchMock = vi.fn(async () => new Response("secret"));
    const plugin = webPlugin({ fetch: fetchMock });

    await expect(callTool(plugin.tools, "fetch_url", { url: "file:///etc/passwd" })).rejects.toThrow(
      "fetch_url only supports http and https URLs",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized fetch_url bodies while streaming them", async () => {
    const body = "x".repeat(200_001);
    const text = vi.fn(async () => body);
    const plugin = webPlugin({
      fetch: vi.fn(async () => {
        const response = new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
        return Object.assign(response, { text });
      })
    });

    await expect(
      callTool(plugin.tools, "fetch_url", { url: "https://example.com/large" })
    ).rejects.toThrow("URL fetch response exceeds 200000 character limit.");
    expect(text).not.toHaveBeenCalled();
  });

  it("passes the tool signal through fetch_url", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const plugin = webPlugin({ fetch: fetchMock });
    const pending = callTool(
      plugin.tools,
      "fetch_url",
      { url: "https://example.com" },
      controller.signal,
    );

    controller.abort();

    await expect(pending).rejects.toThrow("Aborted");
  });
});
