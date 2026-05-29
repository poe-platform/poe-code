import { describe, expect, it, vi } from "vitest";
import { parseSuperintendentDoc } from "../document/parse.js";

const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
---
# Plan

## Task Board

- [ ] Keep this task open
- [x] Already done
`;

const documentWithReason = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
  reason: stale override
---
# Plan

## Task Board

- [ ] Keep this task open
- [x] Already done
`;

async function runComplete(options: { content?: string; reason?: string } = {}): Promise<{
  result: unknown;
  updatedContent: string;
  writeFile: ReturnType<typeof vi.fn>;
}> {
  const { completeCommand } = await import("./complete.js");
  const writeFile = vi.fn(async () => undefined);
  const targetPath = "docs/plans/feature.md";

  const result = await completeCommand.handler({
    params: { path: targetPath, reason: options.reason },
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(async (inputPath: string) => {
        expect(inputPath).toBe(targetPath);
        return options.content ?? document;
      }),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
      writeFile,
      exists: vi.fn(async () => true)
    },
    env: {
      get: vi.fn(() => undefined)
    },
    progress: vi.fn()
  });

  return {
    result,
    updatedContent: String(writeFile.mock.calls[0]?.[1] ?? ""),
    writeFile
  };
}

describe("superintendent complete command", () => {
  it("sets state to completed", async () => {
    const { updatedContent, writeFile } = await runComplete();
    const updated = parseSuperintendentDoc("docs/plans/feature.md", updatedContent);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(updated.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
      review_turn: 3
    });
  });

  it("preserves the existing task board without rewriting tasks", async () => {
    const { updatedContent } = await runComplete();
    const updated = parseSuperintendentDoc("docs/plans/feature.md", updatedContent);
    const original = parseSuperintendentDoc("docs/plans/feature.md", document);

    expect(updated.body).toBe(original.body);
  });

  it("accepts an optional reason", async () => {
    const { updatedContent, result } = await runComplete({
      reason: "operator override"
    });

    expect(updatedContent).toContain("reason: operator override");
    expect(result).toEqual({
      path: "docs/plans/feature.md",
      state: "completed",
      reason: "operator override"
    });
  });

  it("removes an existing reason when no reason is provided", async () => {
    const { updatedContent } = await runComplete({
      content: documentWithReason
    });

    expect(updatedContent).not.toContain("reason:");
  });

  it("rejects a symlinked document path before writing", async () => {
    const { completeCommand } = await import("./complete.js");
    const writeFile = vi.fn(async () => undefined);

    await expect(completeCommand.handler({
      params: { path: "docs/plans/feature.md" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async () => document),
        lstat: vi.fn(async () => ({ isSymbolicLink: () => true })),
        writeFile,
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    })).rejects.toThrow(/symbolic link/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
