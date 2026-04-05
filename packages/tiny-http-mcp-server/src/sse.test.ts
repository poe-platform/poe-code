import { describe, expect, it } from "vitest";
import { formatSseEvent, SSE_HEADERS } from "./sse.js";

describe("sse", () => {
  it("S1: formats basic SSE event with data only", () => {
    expect(formatSseEvent({ data: "hello" })).toBe("data: hello\n\n");
  });

  it("S2: formats event with id field", () => {
    expect(formatSseEvent({ id: "42", data: "hello" })).toBe(
      "id: 42\ndata: hello\n\n",
    );
  });

  it("S3: formats event with event type", () => {
    expect(formatSseEvent({ event: "message", data: "hello" })).toBe(
      "event: message\ndata: hello\n\n",
    );
  });

  it("S4: formats event with all fields in correct order", () => {
    expect(formatSseEvent({ id: "42", event: "message", data: "hello" })).toBe(
      "id: 42\nevent: message\ndata: hello\n\n",
    );
  });

  it("S5: handles empty data string", () => {
    expect(formatSseEvent({ data: "" })).toBe("data: \n\n");
  });

  it("S6: handles data with special characters", () => {
    expect(formatSseEvent({ data: '{"message":"hello","text":"zażółć 😀"}' })).toBe(
      'data: {"message":"hello","text":"zażółć 😀"}\n\n',
    );
  });

  it("S7: SSE_HEADERS contains correct content-type", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
  });

  it("S8: SSE_HEADERS contains cache-control", () => {
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache");
  });

  it("S9: SSE_HEADERS contains connection", () => {
    expect(SSE_HEADERS.Connection).toBe("keep-alive");
  });

  it("formats multiline data as multiple data lines", () => {
    expect(formatSseEvent({ data: "first\r\nsecond\nthird\rfourth" })).toBe(
      "data: first\ndata: second\ndata: third\ndata: fourth\n\n",
    );
  });
});
