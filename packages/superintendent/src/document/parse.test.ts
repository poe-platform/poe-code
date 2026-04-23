import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSuperintendentDoc } from "./parse.js";

describe("parseSuperintendentDoc", () => {
  it("parses a valid document with all fields", () => {
    const content = `---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
  plan_browser:
    command: poe-code
    args:
      - plan
      - list
builder:
  agent: claude-code
  mode: yolo
  prompt: |
    Build the next task.
inspectors:
  code-quality:
    agent: codex
    mode: read
    prompt: |
      Review the implementation.
superintendent:
  agent: claude-code
  mode: read
  prompt: |
    Review the builder output.
owner:
  agent: claude-code
  prompt: |
    Approve or reject.
max_rounds: 12
status:
  state: review
  round: 3
  review_turn: 2
---
# Task Board

- [ ] Build the next task
`;

    const result = parseSuperintendentDoc("plans/feature.md", content);

    expect(result).toEqual({
      filePath: path.resolve("plans/feature.md"),
      body: "# Task Board\n\n- [ ] Build the next task\n",
      frontmatter: {
        kind: "superintendent",
        version: 1,
        mcp: {
          delegate: {
            command: "poe-superintendent-mcp"
          },
          plan_browser: {
            command: "poe-code",
            args: ["plan", "list"]
          }
        },
        builder: {
          agent: "claude-code",
          mode: "yolo",
          prompt: "Build the next task.\n"
        },
        inspectors: {
          "code-quality": {
            agent: "codex",
            mode: "read",
            prompt: "Review the implementation.\n"
          }
        },
        superintendent: {
          agent: "claude-code",
          mode: "read",
          prompt: "Review the builder output.\n"
        },
        owner: {
          agent: "claude-code",
          prompt: "Approve or reject.\n"
        },
        max_rounds: 12,
        status: {
          state: "review",
          round: 3,
          review_turn: 2
        }
      }
    });
  });

  it("parses optional cwd on each role", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  cwd: ../../packages/agent-harness-tools
  prompt: build
inspectors:
  testing:
    agent: claude-code
    cwd: /absolute/workspace
    prompt: test
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.builder.cwd).toBe("../../packages/agent-harness-tools");
    expect(result.frontmatter.inspectors?.testing.cwd).toBe("/absolute/workspace");
    expect(result.frontmatter.superintendent.cwd).toBeUndefined();
    expect(result.frontmatter.owner.cwd).toBeUndefined();
  });

  it("defaults agent to claude-code when omitted on each role", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  prompt: build
inspectors:
  testing:
    prompt: test
superintendent:
  prompt: review
owner:
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.builder.agent).toBe("claude-code");
    expect(result.frontmatter.inspectors?.testing.agent).toBe("claude-code");
    expect(result.frontmatter.superintendent.agent).toBe("claude-code");
    expect(result.frontmatter.owner.agent).toBe("claude-code");
  });

  it("rejects non-string cwd", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  cwd: 42
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(/builder\.cwd must be a string/i);
  });

  it("parses inline mcp on a role in addition to global mcp", () => {
    const content = `---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
builder:
  agent: claude-code
  prompt: build
inspectors:
  testing:
    agent: claude-code
    mcp:
      terminal-pilot:
        command: npx
        args:
          - terminal-pilot-mcp
    prompt: |
      Test it.
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.mcp).toEqual({
      delegate: { command: "poe-superintendent-mcp" }
    });
    expect(result.frontmatter.inspectors?.testing).toEqual({
      agent: "claude-code",
      mcp: {
        "terminal-pilot": {
          command: "npx",
          args: ["terminal-pilot-mcp"]
        }
      },
      prompt: "Test it.\n"
    });
  });

  it("parses optional mcp timeout values", () => {
    const content = `---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
    timeout: 45
builder:
  agent: claude-code
  mcp:
    local-tools:
      command: poe-code
      timeout: 120
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.mcp).toEqual({
      delegate: {
        command: "poe-superintendent-mcp",
        timeout: 45
      }
    });
    expect(result.frontmatter.builder.mcp).toEqual({
      "local-tools": {
        command: "poe-code",
        timeout: 120
      }
    });
  });

  it("parses a minimal document", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Build the next task.
superintendent:
  agent: claude-code
  prompt: |
    Review the work.
owner:
  agent: claude-code
  prompt: |
    Approve or reject.
status:
  state: in_progress
  round: 0
  review_turn: 0
---
## Task Board

- [ ] Ship it
`;

    const result = parseSuperintendentDoc("/tmp/plan.md", content);

    expect(result.frontmatter.builder).toEqual({
      agent: "claude-code",
      prompt: "Build the next task.\n"
    });
    expect(result.frontmatter.superintendent).toEqual({
      agent: "claude-code",
      prompt: "Review the work.\n"
    });
    expect(result.frontmatter.owner).toEqual({
      agent: "claude-code",
      prompt: "Approve or reject.\n"
    });
    expect(result.frontmatter.inspectors).toBeUndefined();
    expect(result.frontmatter.mcp).toBeUndefined();
  });

  it("extracts the markdown body correctly", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: completed
  round: 4
  review_turn: 1
---
# Heading

Paragraph.

- [x] Done
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.body).toBe("# Heading\n\nParagraph.\n\n- [x] Done\n");
  });

  it("parses documents prefixed with a UTF-8 BOM", () => {
    const content = `\uFEFF---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.kind).toBe("superintendent");
    expect(result.body).toBe("Body\n");
  });

  it("parses CRLF-delimited frontmatter without corrupting the last value", () => {
    const content = "---\r\nkind: superintendent\r\nversion: 1\r\nbuilder:\r\n  agent: claude-code\r\n  prompt: build\r\nsuperintendent:\r\n  agent: claude-code\r\n  prompt: review\r\nowner:\r\n  agent: claude-code\r\n  prompt: approve\r\nstatus:\r\n  state: review\r\n  round: 3\r\n  review_turn: 2\r\n---\r\nBody\r\n";

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.status).toEqual({
      state: "review",
      round: 3,
      review_turn: 2
    });
    expect(result.body).toBe("Body\r\n");
  });

  it("throws on missing kind field", () => {
    const content = `---
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(/missing `kind` field/i);
  });

  it("throws when kind is not superintendent", () => {
    const content = `---
kind: pipeline
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(
      /kind must be "superintendent"/i
    );
  });

  it("throws on invalid YAML", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent: [oops
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(/invalid yaml/i);
  });

  it("throws on a missing frontmatter end delimiter", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(/frontmatter end delimiter/i);
  });

  it.each(["builder", "superintendent", "owner"])(
    "throws on missing required role %s",
    (missingRole) => {
      const sections = {
        builder: `builder:\n  agent: claude-code\n  prompt: build`,
        superintendent: `superintendent:\n  agent: claude-code\n  prompt: review`,
        owner: `owner:\n  agent: claude-code\n  prompt: approve`
      };

      const content = `---
kind: superintendent
version: 1
${Object.entries(sections)
  .filter(([role]) => role !== missingRole)
  .map(([, section]) => section)
  .join("\n")}
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

      expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(
        new RegExp("missing required role `" + missingRole + "`", "i")
      );
    }
  );

  it("handles optional mcp and inspectors fields", () => {
    const content = `---
kind: superintendent
version: 1
mcp:
  repo:
    command: poe-code
    args:
      - plan
builder:
  agent: claude-code
  prompt: build
inspectors:
  qa:
    agent: codex
    prompt: inspect
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.mcp).toEqual({
      repo: {
        command: "poe-code",
        args: ["plan"]
      }
    });
    expect(result.frontmatter.inspectors).toEqual({
      qa: {
        agent: "codex",
        prompt: "inspect"
      }
    });
  });

  it("defaults max_rounds to 100", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.max_rounds).toBe(100);
  });

  it("parses the status block correctly", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: completed
  round: 7
  review_turn: 4
---
Body
`;

    const result = parseSuperintendentDoc("plan.md", content);

    expect(result.frontmatter.status).toEqual({
      state: "completed",
      round: 7,
      review_turn: 4
    });
  });

  it("throws on an unsupported status state", () => {
    const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: queued
  round: 7
  review_turn: 4
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(
      /status\.state must be one of/i
    );
  });

  it("throws when mcp timeout is not a positive number", () => {
    const content = `---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
    timeout: 0
builder:
  agent: claude-code
  prompt: build
superintendent:
  agent: claude-code
  prompt: review
owner:
  agent: claude-code
  prompt: approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
Body
`;

    expect(() => parseSuperintendentDoc("plan.md", content)).toThrow(
      /mcp\.delegate\.timeout must be a positive number/i
    );
  });
});
