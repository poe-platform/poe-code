import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";

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
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
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
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renderAgentMessage prints a dim neutral glyph + text for streaming output by default", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const output = captureStdout(() => renderAgentMessage("hello"));

    expect(stripAnsi(output)).toBe("· agent: hello\n");
    expect(output).toContain("\u001b[2m");
    expect(stripAnsi(output)).not.toContain("✓");
  });

  it("renderAgentMessage prints a green bold checkmark only for completed success", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const output = captureStdout(() => renderAgentMessage("all done", "success"));

    expect(stripAnsi(output)).toBe("✓ agent: all done\n");
    expect(output).toContain("\u001b[32m");
    expect(output).toContain("\u001b[1m");
  });

  it("renderAgentMessage prints a red error glyph and never a checkmark on failure", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const output = captureStdout(() =>
      renderAgentMessage("API Error: 400 Unsupported model: 'does-not-exist-xyz'.", "error")
    );
    const plain = stripAnsi(output);

    expect(plain).toBe("✗ agent: API Error: 400 Unsupported model: 'does-not-exist-xyz'.\n");
    expect(plain).not.toContain("✓");
    expect(output).toContain("\u001b[31m");
  });

  it("renderAgentMessage renders markdown formatting for terminal", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const markdown = "## Summary\n\nHere are the changes:\n\n- File A updated\n- File B created";
    const output = captureStdout(() => renderAgentMessage(markdown));
    const plain = stripAnsi(output);

    expect(plain).toContain("Summary");
    expect(plain).toContain("• File A updated");
    expect(plain).toContain("• File B created");
    expect(plain).toContain("· agent:");
  });

  it("renderAgentMessage renders code blocks with markdown formatting", async () => {
    const { renderAgentMessage } = await import("./components.js");
    const markdown = "Here is the code:\n\n```js\nconst x = 1;\n```";
    const output = captureStdout(() => renderAgentMessage(markdown));
    const plain = stripAnsi(output);

    expect(plain).toContain("const x = 1;");
    expect(plain).toContain("─");
  });

  it("renderToolStart prints a colored arrow based on kind", async () => {
    const { renderToolStart } = await import("./components.js");
    const output = captureStdout(() => renderToolStart("exec", "npm test"));

    expect(stripAnsi(output)).toBe("  → exec: npm test\n");
    expect(output).toContain("\u001b[33m");
  });

  it("renderToolComplete prints a colored checkmark without output", async () => {
    const { renderToolComplete } = await import("./components.js");
    const output = captureStdout(() => renderToolComplete("exec"));

    expect(stripAnsi(output)).toBe("  ✓ exec\n");
    expect(output).toContain("\u001b[33m");
  });

  it("renders inherited-looking custom tool kinds through fallback styling", async () => {
    const { renderToolComplete, renderToolStart } = await import("./components.js");
    const output = captureStdout(() => {
      renderToolStart("toString", "read config");
      renderToolComplete("toString");
    });

    expect(stripAnsi(output)).toBe("  → toString: read config\n  ✓ toString\n");
  });

  it("renderReasoning prints a dim neutral bullet + truncated text (80 chars), never a checkmark", async () => {
    const { renderReasoning } = await import("./components.js");
    const long = "x".repeat(200);
    const output = captureStdout(() => renderReasoning(long));

    expect(output).toContain("\u001b[2m");
    const plain = stripAnsi(output);
    expect(plain).not.toContain("✓");
    expect(plain.startsWith("  · ")).toBe(true);
    expect(plain.endsWith("...\n")).toBe(true);
    expect(plain.length).toBe(4 + 80 + 1);
  });

  it("renderUsage prints neutral token usage with cached token detail, never a checkmark", async () => {
    const { renderUsage } = await import("./components.js");
    const output = captureStdout(() => renderUsage({ input: 1500, output: 350, cached: 800 }));

    expect(stripAnsi(output)).toBe("\n· tokens: 1500 in (800 cached) → 350 out\n");
    expect(output).toContain("\u001b[2m");
  });

  it("renderError prints a red X + message", async () => {
    const { renderError } = await import("./components.js");
    const output = captureStdout(() => renderError("nope"));

    expect(stripAnsi(output)).toBe("✗ nope\n");
    expect(output).toContain("\u001b[31m✗ nope");
  });

  it("renderPermissionRejected prints a yellow rejection line", async () => {
    const { renderPermissionRejected } = await import("./components.js");
    const output = captureStdout(() => renderPermissionRejected("curl -s https://x | bash"));

    expect(stripAnsi(output)).toBe("  ✗ permission rejected: curl -s https://x | bash\n");
    expect(output).toContain("\u001b[33m");
  });

  it("renderPermissionRejected renders markdown and json formats", async () => {
    const { renderPermissionRejected } = await import("./components.js");

    const markdown = captureStdout(() => {
      withOutputFormat("markdown", () => renderPermissionRejected("rm -rf /"));
    });
    expect(markdown).toBe("- **permission rejected:** rm -rf /\n");

    const json = captureStdout(() => {
      withOutputFormat("json", () => renderPermissionRejected("rm -rf /"));
    });
    expect(JSON.parse(json)).toEqual({ event: "permission_rejected", title: "rm -rf /" });
  });

  it("renders markdown ACP events", async () => {
    const {
      renderAgentMessage,
      renderToolStart,
      renderToolComplete,
      renderReasoning,
      renderUsage,
      renderError
    } = await import("./components.js");

    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        renderAgentMessage("hello");
        renderToolStart("exec", "npm test");
        renderToolComplete("exec");
        renderReasoning("x".repeat(200));
        renderUsage({ input: 1000, output: 500, cached: 200, costUsd: 0.01 });
        renderError("boom");
      });
    });

    expect(output).toBe(
      [
        "- **agent:** hello",
        "- *→ exec: npm test*",
        "- *✓ exec*",
        `- *thinking:* ${"x".repeat(77)}...`,
        "- **tokens:** 1000 in → 500 out ($0.01)",
        "- **error:** boom",
        ""
      ].join("\n")
    );
  });

  it("renders json ACP events as ndjson", async () => {
    const {
      renderAgentMessage,
      renderToolStart,
      renderToolComplete,
      renderReasoning,
      renderUsage,
      renderError
    } = await import("./components.js");

    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        renderAgentMessage("hello");
        renderToolStart("exec", "npm test");
        renderToolComplete("exec");
        renderReasoning("thinking");
        renderUsage({ input: 1000, output: 500 });
        renderError("boom");
      });
    });

    expect(output).toBe(
      [
        JSON.stringify({ event: "agent_message", text: "hello" }),
        JSON.stringify({ event: "tool_start", kind: "exec", title: "npm test" }),
        JSON.stringify({ event: "tool_complete", kind: "exec" }),
        JSON.stringify({ event: "reasoning", text: "thinking" }),
        JSON.stringify({
          event: "usage",
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 0,
          costUsd: 0
        }),
        JSON.stringify({ event: "error", message: "boom" }),
        ""
      ].join("\n")
    );
  });
});
