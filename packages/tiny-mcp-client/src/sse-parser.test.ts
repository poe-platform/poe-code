import { describe, expect, it } from "bun:test";
import { SseParser } from "./internal.js";

describe("SseParser", () => {
  it("parses event: message with data payload", () => {
    const parser = new SseParser();

    const parsed = parser.push('event: message\ndata: {"jsonrpc":"2.0"}\n\n');

    expect(parsed).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });

  it("defaults missing event field to message", () => {
    const parser = new SseParser();

    const parsed = parser.push('data: {"jsonrpc":"2.0"}\n\n');

    expect(parsed).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });

  it("extracts data-only event correctly", () => {
    const parser = new SseParser();

    const parsed = parser.push("data: payload-only\n\n");

    expect(parsed).toEqual([
      {
        data: "payload-only",
      },
    ]);
  });

  it("parses two events in sequence independently", () => {
    const parser = new SseParser();

    const parsed = parser.push(
      "event: message\ndata: first\n\nevent: message\ndata: second\n\n"
    );

    expect(parsed).toEqual([
      {
        data: "first",
      },
      {
        data: "second",
      },
    ]);
  });

  it("handles empty lines between events", () => {
    const parser = new SseParser();

    const parsed = parser.push(
      "event: message\ndata: first\n\n\n\nevent: message\ndata: second\n\n"
    );

    expect(parsed).toEqual([
      {
        data: "first",
      },
      {
        data: "second",
      },
    ]);
  });

  it("concatenates multi-line data fields with newlines", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: message\ndata: line-1\ndata: line-2\n\n");

    expect(parsed).toEqual([
      {
        data: "line-1\nline-2",
      },
    ]);
  });

  it("ignores comment lines", () => {
    const parser = new SseParser();

    const parsed = parser.push(": keepalive\nevent: message\ndata: pong\n\n");

    expect(parsed).toEqual([
      {
        data: "pong",
      },
    ]);
  });

  it("ignores non-message events", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: ping\ndata: should-not-emit\n\n");

    expect(parsed).toEqual([]);
  });

  it("extracts lastEventId from event with id field", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: message\nid: evt-1\ndata: payload\n\n");

    expect(parsed).toEqual([
      {
        data: "payload",
        id: "evt-1",
      },
    ]);
    expect(parser.lastEventId).toBe("evt-1");
  });

  it("handles event split across stream chunks", () => {
    const parser = new SseParser();

    expect(parser.push("event: messa")).toEqual([]);
    expect(parser.push("ge\ndata: {\"jsonrpc\":\"2.0\"}")).toEqual([]);
    expect(parser.push("\n\n")).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });
});
