import { describe, expect, it, vi } from "vitest";
import { type ValidationResult, validateCommand } from "./superintendent-group.js";

const validDocument = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Build the next task in {{plan.path}}.

    Previous summary:
    {{superintendent.summary}}
inspectors:
  code-quality:
    agent: codex
    prompt: |
      Review the latest changes.
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
    {{builder.log}}
    {{inspectors.code-quality}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
    {{owner.feedback}}
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Feature plan

## Task Board

- [ ] Ship the validate command
`;

async function runValidate(content: string, path = "plans/feature.md"): Promise<ValidationResult> {
  return validateCommand.handler({
    params: { path },
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(async (target: string) => {
        expect(target).toBe(path);
        return content;
      }),
      writeFile: vi.fn(async () => undefined),
      exists: vi.fn(async () => true)
    },
    env: {
      get: vi.fn(() => undefined)
    },
    progress: vi.fn()
  });
}

describe("superintendent validate", () => {
  it("passes a valid superintendent document", async () => {
    await expect(runValidate(validDocument)).resolves.toEqual({
      valid: true,
      problems: []
    });
  });

  it("flags a missing required role as an error", async () => {
    const document = validDocument.replace(
      "owner:\n  agent: claude-code\n  prompt: |\n    Review {{superintendent.summary}}\n    {{owner.feedback}}\n",
      ""
    );

    const result = await runValidate(document);

    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual({
      level: "error",
      message: expect.stringContaining("missing required role `owner`")
    });
  });

  it("flags a missing task board as an error", async () => {
    const document = validDocument.replace(
      "## Task Board\n\n- [ ] Ship the validate command\n",
      "## Notes\n\nNo task board here.\n"
    );

    const result = await runValidate(document);

    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual({
      level: "error",
      message: 'Missing "## Task Board" section'
    });
  });

  it("flags a task board without checkbox items as an error", async () => {
    const document = validDocument.replace("- [ ] Ship the validate command", "No tasks yet.");

    const result = await runValidate(document);

    expect(result.valid).toBe(false);
    expect(result.problems).toContainEqual({
      level: "error",
      message: "Task Board must contain markdown checkbox items"
    });
  });

  it("flags unknown prompt variables as warnings", async () => {
    const document = validDocument.replace(
      "{{builder.log}}",
      "{{builder.unknown}}\n    {{builder.log}}"
    );

    const result = await runValidate(document);

    expect(result.valid).toBe(true);
    expect(result.problems).toContainEqual({
      level: "warning",
      message: expect.stringContaining('Unknown prompt variable "builder.unknown"')
    });
  });

  it("returns a structured result suitable for JSON output", async () => {
    const result = await runValidate(validDocument);
    const payload = validateCommand.render?.json?.(result, {
      logger: {
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        resolved: vi.fn(),
        errorResolved: vi.fn(),
        message: vi.fn()
      },
      renderTable: vi.fn(() => ""),
      getTheme: vi.fn(() => {
        throw new Error("getTheme should not be called");
      }),
      note: vi.fn()
    });

    expect(payload).toEqual({
      valid: true,
      problems: []
    });
  });

  it("renders markdown output", async () => {
    const result = await runValidate(validDocument);

    expect(
      validateCommand.render?.markdown?.(result, {
        logger: {
          info: vi.fn(),
          success: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          resolved: vi.fn(),
          errorResolved: vi.fn(),
          message: vi.fn()
        },
        renderTable: vi.fn(() => ""),
        getTheme: vi.fn(() => {
          throw new Error("getTheme should not be called");
        }),
        note: vi.fn()
      })
    ).toBe("## Validation result\n\n- Status: valid\n- Problems: 0");
  });
});
