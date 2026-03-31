import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";

function stripAnsi(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\u001b") {
      output += char;
      continue;
    }
    const next = input[index + 1];
    if (next !== "[") continue;

    index += 2;
    while (index < input.length && input[index] !== "m") {
      index += 1;
    }
  }
  return output;
}

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return chunks.join("");
}

describe("acp/components", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    vi.resetModules();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
  });

  it("renderAgentMessage prints a green bold checkmark + text", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const output = captureStdout(() => renderAgentMessage("hello"));

    expect(stripAnsi(output)).toBe("✓ agent: hello\n");
    expect(output).toContain("\u001b[32m");
    expect(output).toContain("\u001b[1m");
  });

  it("renderToolStart prints a colored arrow based on kind", async () => {
    const { renderToolStart } = await import("./components.js");
    const output = captureStdout(() => renderToolStart("exec", "bun test"));

    expect(stripAnsi(output)).toBe("  → exec: bun test\n");
    expect(output).toContain("\u001b[33m");
  });

  it("renderToolComplete prints a colored checkmark without output", async () => {
    const { renderToolComplete } = await import("./components.js");
    const output = captureStdout(() => renderToolComplete("exec"));

    expect(stripAnsi(output)).toBe("  ✓ exec\n");
    expect(output).toContain("\u001b[33m");
  });

  it("renderReasoning prints a dim checkmark + truncated text (80 chars)", async () => {
    const { renderReasoning } = await import("./components.js");
    const long = "x".repeat(200);
    const output = captureStdout(() => renderReasoning(long));

    expect(output).toContain("\u001b[2m");
    const plain = stripAnsi(output);
    expect(plain.startsWith("  ✓ ")).toBe(true);
    expect(plain.endsWith("...\n")).toBe(true);
    expect(plain.length).toBe(4 + 80 + 1);
  });

  it("renderUsage prints green token usage with cached token detail", async () => {
    const { renderUsage } = await import("./components.js");
    const output = captureStdout(() => renderUsage({ input: 1500, output: 350, cached: 800 }));

    expect(stripAnsi(output)).toBe("✓ tokens: 1500 in (800 cached) → 350 out\n");
    expect(output).toContain("\u001b[32m");
  });

  it("renderError prints a red X + message", async () => {
    const { renderError } = await import("./components.js");
    const output = captureStdout(() => renderError("nope"));

    expect(stripAnsi(output)).toBe("✗ nope\n");
    expect(output).toContain("\u001b[31m✗ nope");
  });
});
