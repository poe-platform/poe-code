import { describe, expect, it, vi } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server/testing";

import { startNativeOtelCapture } from "./native-otel.js";

describe("startNativeOtelCapture", () => {
  it("returns declarative Codex overlays and captured OTLP JSON", async () => {
    const capture = await startNativeOtelCapture("codex");
    expect(capture).toBeDefined();
    expect(capture?.args.join(" ")).toContain("otel.trace_exporter");
    expect(capture?.env.OTEL_RESOURCE_ATTRIBUTES).toContain("poe.code.spawn.id=");

    await postJson(`${capture!.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, {
      resourceSpans: [{ scopeSpans: [] }]
    });

    await expect(capture?.drain()).resolves.toEqual([
      {
        signal: "traces",
        contentType: "application/json",
        body: { resourceSpans: [{ scopeSpans: [] }] }
      }
    ]);
  });

  it("preserves OTLP protobuf payloads as base64", async () => {
    const capture = await startNativeOtelCapture("claude-code");
    await postBytes(`${capture!.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`, Buffer.from([1, 2, 3]));

    await expect(capture?.drain()).resolves.toEqual([
      {
        signal: "logs",
        contentType: "application/x-protobuf",
        body: "AQID"
      }
    ]);
  });

  it("warns and continues for unsupported agents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(startNativeOtelCapture("kimi")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not emit OpenTelemetry"));
  });

  it("rejects malformed OTLP JSON without crashing the receiver", async () => {
    const capture = await startNativeOtelCapture("codex");
    const status = await post(
      `${capture!.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      Buffer.from("not-json"),
      "application/json"
    );

    expect(status).toBe(400);
    await expect(capture?.drain()).resolves.toEqual([]);
  });
});

async function postJson(url: string, body: Record<string, unknown>): Promise<void> {
  await post(url, Buffer.from(JSON.stringify(body)), "application/json");
}

async function postBytes(url: string, body: Buffer): Promise<void> {
  await post(url, body, "application/x-protobuf");
}

async function post(url: string, body: Buffer, contentType: string): Promise<number> {
  const response = await nodeFetch(url, {
      method: "POST",
      headers: { "content-type": contentType, "content-length": String(body.byteLength) },
      body,
  });
  return response.status;
}
