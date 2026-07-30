import { afterEach, describe, expect, it, vi } from "vitest";
import { createInputParser, type TerminalInputEvent } from "./input.js";

function parseAtSplits(input: Buffer): TerminalInputEvent[][] {
  const results: TerminalInputEvent[][] = [];
  for (let split = 0; split <= input.length; split += 1) {
    const parser = createInputParser();
    results.push([
      ...parser.feed(input.subarray(0, split)),
      ...parser.feed(input.subarray(split)),
      ...parser.flush()
    ]);
    parser.destroy();
  }
  return results;
}

describe("createInputParser", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["CSI arrow", Buffer.from("\u001b[A")],
    ["SS3 arrow", Buffer.from("\u001bOA")],
    ["modified arrow", Buffer.from("\u001b[1;5B")],
    ["UTF-8", Buffer.from("hé🙂")],
    ["paste", Buffer.from("\u001b[200~a\n\u001b[31m🙂\u001b[201~")],
    ["wheel", Buffer.from("\u001b[<64;12;4M")]
  ])("parses %s identically at every chunk boundary", (_label, input) => {
    const results = parseAtSplits(input);
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });

  it("parses navigation, control keys, paste, wheel, and printable text", () => {
    const parser = createInputParser();
    expect(parser.feed(Buffer.from("a\u0003\u001bOA\u001b[6~"))).toEqual([
      { type: "key", ch: "a", name: "a", ctrl: false, alt: false, shift: false },
      { type: "key", name: "c", ctrl: true, alt: false, shift: false },
      { type: "key", name: "up", ctrl: false, alt: false, shift: false },
      { type: "key", name: "pagedown", ctrl: false, alt: false, shift: false }
    ]);
    expect(parser.feed(Buffer.from("\u001b[200~a\nb\u001b[201~"))).toEqual([
      { type: "paste", text: "a\nb" }
    ]);
    expect(parser.feed(Buffer.from("\u001b[<65;9;3M"))).toEqual([
      { type: "wheel", direction: "down", x: 8, y: 2 }
    ]);
    parser.destroy();
  });

  it("preserves Shift on modified arrow sequences used by explorer reordering", () => {
    const parser = createInputParser();

    expect(parser.feed(Buffer.from("\u001b[1;2A\u001b[1;2B"))).toEqual([
      { type: "key", name: "up", ctrl: false, alt: false, shift: true },
      { type: "key", name: "down", ctrl: false, alt: false, shift: true }
    ]);

    parser.destroy();
  });

  it("waits before resolving a lone escape", () => {
    vi.useFakeTimers();
    const parser = createInputParser({ escTimeoutMs: 50 });
    expect(parser.feed(Buffer.from("\u001b"))).toEqual([]);
    vi.advanceTimersByTime(49);
    expect(parser.flush()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(parser.flush()).toEqual([
      { type: "key", name: "escape", ctrl: false, alt: false, shift: false }
    ]);
    parser.destroy();
  });

  it("keeps Ctrl+C unconditional when it follows Escape in the same chunk", () => {
    const parser = createInputParser();
    expect(parser.feed(Buffer.from("\u001b\u0003"))).toEqual([
      { type: "key", name: "escape", ctrl: false, alt: false, shift: false },
      { type: "key", name: "c", ctrl: true, alt: false, shift: false }
    ]);
    parser.destroy();
  });
});
