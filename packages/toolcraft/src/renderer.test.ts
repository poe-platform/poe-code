import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand } from "./index.js";
import { renderResult } from "./renderer.js";
import type { RenderPrimitives } from "./index.js";
import type { OutputMode } from "./renderer.js";

function createPrimitives(): RenderPrimitives {
  return {
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn(),
    },
    renderTable: vi.fn((options: { columns: Array<{ name: string; title: string }>; rows: Record<string, string>[] }) =>
      JSON.stringify({
        columns: options.columns.map((column) => ({ name: column.name, title: column.title })),
        rows: options.rows,
      })
    ),
    getTheme: vi.fn(() => ({
      header: (value: string) => value,
      muted: (value: string) => value,
      badge: (value: string) => `[${value}]`,
    })),
    note: vi.fn(),
  };
}

function createCommand(result: unknown, render?: Parameters<typeof defineCommand>[0]["render"]) {
  return defineCommand({
    name: "demo",
    description: "Show result",
    params: S.Object({}),
    handler: async () => result,
    render,
  });
}

function render(result: unknown, output: OutputMode = "rich") {
  const command = createCommand(result);
  const primitives = createPrimitives();
  let stdout = "";
  let stderr = "";
  const status = renderResult(command, result, output, primitives, (chunk, stream = "stdout") => {
    if (stream === "stderr") {
      stderr += chunk;
      return;
    }

    stdout += chunk;
  });

  return { stdout, stderr, status };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderResult auto renderer", () => {
  it("renders strings as-is", () => {
    expect(render("hello").stdout).toBe("hello\n");
  });

  it("renders string arrays joined with newlines", () => {
    expect(render(["hello", "world"]).stdout).toBe("hello\nworld\n");
  });

  it("renders arbitrary objects as rich detail cards by default", () => {
    expect(render({
      resource_id: 3065,
      resource_name: "Example",
      enabled: true,
      url: "https://cdn.example.com/files/long-resource-preview.jpeg",
      settings: { allow_uploads: false }
    }).stdout).toBe([
      "Show result",
      "",
      "Resource id    3065",
      "Resource name  Example",
      "Enabled        Yes",
      "Url            cdn.example.com/…/long-resource-preview.jpeg",
      "",
      "Settings",
      "Allow uploads  No",
      ""
    ].join("\n"));
  });

  it("does not infer hierarchy from a long scalar string", () => {
    const text = "This is a sufficiently long piece of descriptive text that should read as a paragraph instead of being squeezed into one metadata row.";
    expect(render({ id: 1, narrative: text }).stdout).toBe([
      "Show result",
      "",
      "Id         1",
      "Narrative  This is a sufficiently long piece of descriptive text that should",
      "           read as a paragraph instead of being squeezed into one metadata row.",
      ""
    ].join("\n"));
  });

  it("renders mutation responses without resource-specific rules", () => {
    expect(render({
      success: true,
      message: "Update applied.",
      before: { enabled: false },
      after: { enabled: true },
      changed_fields: ["enabled"]
    }).stdout).toBe([
      "Show result",
      "",
      "Success  Yes",
      "Message  Update applied.",
      "",
      "Before",
      "Enabled  No",
      "",
      "After",
      "Enabled  Yes",
      "",
      "Lists",
      "Changed fields  enabled",
      ""
    ].join("\n"));
  });

  it("renders nested object arrays as repeated detail sections", () => {
    expect(render({
      message_id: 488587457099,
      text: "Smoke test. Reply with exactly: smoke-ok",
      responses: [
        {
          message_id: 488587459147,
          author_handle: "GLM-5.2-Vercel",
          text: "smoke-ok",
          state: "complete",
          attachments: []
        }
      ]
    }).stdout).toBe([
      "Show result",
      "",
      "Message id  488587457099",
      "Text        Smoke test. Reply with exactly: smoke-ok",
      "",
      "Responses",
      "Message id     488587459147",
      "Author handle  GLM-5.2-Vercel",
      "Text           smoke-ok",
      "State          complete",
      "Attachments    —",
      ""
    ].join("\n"));
  });

  it("renders deeply nested object arrays as indented detail groups", () => {
    expect(render({
      responses: [
        {
          message_id: 488587459147,
          text: "smoke-ok",
          attachments: [
            { name: "trace.txt", content_type: "text/plain" },
            { name: "result.json", content_type: "application/json" }
          ],
          metadata: {
            tool_calls: [
              {
                name: "search",
                arguments: { query: "smoke" }
              }
            ]
          }
        }
      ]
    }).stdout).toBe([
      "Show result",
      "",
      "Responses",
      "Message id        488587459147",
      "Text              smoke-ok",
      "Attachments       ",
      "  1               ",
      "    Name          trace.txt",
      "    Content type  text/plain",
      "  2               ",
      "    Name          result.json",
      "    Content type  application/json",
      "Metadata          ",
      "  Tool calls      ",
      "    Name          search",
      "    Arguments     ",
      "      Query       smoke",
      ""
    ].join("\n"));
  });

  it("labels repeated top-level object-array sections", () => {
    expect(render({
      responses: [
        { message_id: 1, text: "first" },
        { message_id: 2, text: "second" }
      ]
    }).stdout).toBe([
      "Show result",
      "",
      "Responses 1",
      "Message id  1",
      "Text        first",
      "",
      "Responses 2",
      "Message id  2",
      "Text        second",
      ""
    ].join("\n"));
  });

  it("uses the command name when a description is too long for a title", () => {
    const command = defineCommand({
      name: "set-policy",
      description: "Update a resource policy while validating all dependent settings and returning an audit summary.",
      params: S.Object({}),
      handler: async () => ({ success: true })
    });
    const primitives = createPrimitives();
    let stdout = "";

    renderResult(command, { success: true }, "rich", primitives, (chunk) => {
      stdout += chunk;
    });

    expect(stdout).toBe("Set policy\n\nSuccess  Yes\n");
  });

  it("renders arrays of objects as rich tables by default", () => {
    expect(render([{ foo: 1 }, { bar: [1, 2] }]).stdout).toBe(
      `${JSON.stringify({
        columns: [
          { name: "foo", title: "foo" },
          { name: "bar", title: "bar" }
        ],
        rows: [
          { foo: "1", bar: "" },
          { foo: "", bar: "[1,2]" }
        ]
      })}\n`
    );
  });

  it("invokes Command.render.rich and bypasses automatic details", () => {
    const rich = vi.fn();
    const command = createCommand({ foo: 1 }, { rich });
    const primitives = createPrimitives();
    let stdout = "";

    renderResult(command, { foo: 1 }, "rich", primitives, (chunk) => {
      stdout += chunk;
    });

    expect(rich).toHaveBeenCalledWith({ foo: 1 }, primitives);
    expect(stdout).toBe("");
  });

  it("uses the markdown renderer for --output md", () => {
    expect(render({ foo: 1, bar: [1, 2] }, "md").stdout).toBe("- foo: 1\n- bar: [1,2]\n");
  });

  it("uses the JSON renderer for --output json", () => {
    expect(render({ foo: 1, bar: [1, 2] }, "json").stdout).toBe(
      '{\n  "foo": 1,\n  "bar": [\n    1,\n    2\n  ]\n}\n'
    );
  });
});

describe("renderResult MCP call tool envelopes", () => {
  it("unwraps structuredContent.result before rendering", () => {
    const result = {
      structuredContent: {
        result: "- Daily Focus",
      },
    };

    expect(render(result).stdout).toBe("- Daily Focus\n");
    expect(render(result).status.mcpError).toBe(false);
  });

  it("passes structuredContent without result to downstream renderers", () => {
    const markdown = vi.fn(() => "rendered");
    const result = {
      structuredContent: {
        foo: 1,
        bar: 2,
      },
    };
    const command = createCommand(result, { markdown });
    const primitives = createPrimitives();
    let stdout = "";

    renderResult(command, result, "md", primitives, (chunk) => {
      stdout += chunk;
    });

    expect(markdown).toHaveBeenCalledWith({ foo: 1, bar: 2 }, primitives);
    expect(stdout).toBe("rendered\n");
  });

  it("joins text content when structuredContent is absent", () => {
    const result = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    };

    expect(render(result).stdout).toBe("hello\nworld\n");
  });

  it("falls back to the empty-result renderer when text content is empty", () => {
    const result = {
      content: [],
    };

    expect(render(result).stdout).toBe("Done.\n");
  });

  it("writes error envelopes to stderr and marks the result as an MCP error", () => {
    const result = {
      content: [{ type: "text", text: "failed" }],
      isError: true,
    };

    const rendered = render(result);

    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toBe("failed\n");
    expect(rendered.status.mcpError).toBe(true);
  });

  it("does not unwrap objects with extra keys", () => {
    const result = {
      content: [],
      structuredContent: {
        result: "inner",
      },
      isError: false,
      customKey: "keep",
    };

    expect(render(result, "json").stdout).toBe(
      '{\n  "content": [],\n  "structuredContent": {\n    "result": "inner"\n  },\n  "isError": false,\n  "customKey": "keep"\n}\n'
    );
  });
});
