import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { asMCPResult, defineCommand } from "./index.js";
import { renderObjectTable, renderResult } from "./renderer.js";
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
    outputFormat: "rich",
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

describe("ordinary result ownership", () => {
  const cases = [
    { name: "empty content", result: { content: [] } },
    { name: "text-like content", result: { content: [{ type: "text", text: "domain-text" }] } },
    { name: "structured content", result: { structuredContent: { name: "domain" } } },
    { name: "structured metadata", result: { structuredContent: { name: "domain" }, _meta: { source: "local" } } },
    { name: "domain error flag", result: { content: [], isError: true } },
    { name: "extra-key control", result: { content: [], kind: "document" } }
  ];

  describe.each(cases)("$name", ({ result }) => {
    describe.each([false, true])("declared schema: %s", (typed) => {
      it("preserves the full value in automatic JSON output", () => {
        const original = structuredClone(result);
        const command = defineCommand({
          name: "demo",
          params: S.Object({}),
          ...(typed ? { result: S.Object(Object.fromEntries(Object.keys(result).map((key) => [key, S.Json()]))) } : {}),
          handler: () => result
        });
        const write = vi.fn();
        const status = renderResult(command, result, "json", createPrimitives(), write);
        expect(status.mcpError).toBe(false);
        expect(write).toHaveBeenCalledTimes(1);
        expect(JSON.parse(write.mock.calls[0]![0])).toStrictEqual(original);
        expect(write.mock.calls[0]![1]).not.toBe("stderr");
        expect(result).toStrictEqual(original);
      });

      it.each(["rich", "md", "json"] as const)("passes the actual handler value to custom %s rendering", (output) => {
        const rich = vi.fn();
        const markdown = vi.fn(() => "rendered");
        const json = vi.fn((value: unknown) => value);
        const command = defineCommand({
          name: "demo",
          params: S.Object({}),
          ...(typed ? { result: S.Object(Object.fromEntries(Object.keys(result).map((key) => [key, S.Json()]))) } : {}),
          handler: () => result,
          render: { rich, markdown, json }
        });
        const primitives = createPrimitives();
        const status = renderResult(command, result, output, primitives, vi.fn());
        const renderer = output === "rich" ? rich : output === "md" ? markdown : json;
        expect(status.mcpError).toBe(false);
        expect(renderer).toHaveBeenCalledWith(result, primitives);
        expect(renderer.mock.calls[0]![0]).toBe(result);
      });
    });
  });
});

describe("result field label ownership", () => {
  const cases = [
    { name: "scalar keys", result: { "display-name": "dash", display_name: "underscore" }, keys: ["display-name", "display_name"] },
    { name: "nested keys", result: { record: { "display-name": "dash", display_name: "underscore" } }, keys: ["display-name", "display_name"] },
    { name: "object sections", result: { "profile-name": { value: "dash" }, profile_name: { value: "underscore" } }, keys: ["profile-name", "profile_name"] },
    { name: "lists", result: { "tag-name": ["dash"], tag_name: ["underscore"] }, keys: ["tag-name", "tag_name"] },
    { name: "array sections", result: { "group-name": [{ value: "dash" }], group_name: [{ value: "underscore" }] }, keys: ["group-name", "group_name"] },
    { name: "mixed sections", result: { "profile-name": "dash", profile_name: { value: "underscore" } }, keys: ["profile-name", "profile_name"] },
    { name: "Unicode keys", result: { "café-id": "dash", café_id: "underscore" }, keys: ["café-id", "café_id"] },
    { name: "already humanized keys", result: { "display-name": "dash", display_name: "underscore", "Display name": "literal" }, keys: ["display-name", "display_name", "Display name"] }
  ];

  describe.each(cases)("$name", ({ result, keys }) => {
    it("disambiguates rich labels without changing the result", () => {
      const original = structuredClone(result);
      const rendered = render(result);
      for (const key of keys) expect(rendered.stdout).toContain(key);
      expect(rendered.stdout).toContain("dash");
      expect(rendered.stdout).toContain("underscore");
      expect(rendered.stderr).toBe("");
      expect(result).toStrictEqual(original);
    });

    it("disambiguates detail-table labels", () => {
      const primitives = createPrimitives();
      const table = JSON.parse(renderObjectTable(result, primitives)) as { rows: Array<{ label: string; value: string }> };
      const labels = table.rows.map((row) => row.label.trim());
      for (const key of keys) expect(labels).toContain(key);
    });

    it.each(["md", "json"] as const)("preserves literal keys in %s", (output) => {
      const rendered = render(result, output);
      for (const key of keys) expect(rendered.stdout).toContain(key);
      if (output === "json") expect(JSON.parse(rendered.stdout)).toStrictEqual(result);
    });
  });

  it("retains readable labels when there is no collision", () => {
    const rendered = render({ display_name: "known", age: 42 });
    expect(rendered.stdout).toContain("Display name");
    expect(rendered.stdout).toContain("Age");
    expect(rendered.stdout).not.toContain("display_name");
  });

  it("does not treat matching keys in separate parents as sibling collisions", () => {
    const rendered = render({ first: { display_name: "one" }, second: { display_name: "two" } });
    expect(rendered.stdout.split("Display name")).toHaveLength(3);
    expect(rendered.stdout).not.toContain("display_name");
  });

  it("keeps unrelated sibling labels human-readable", () => {
    const rendered = render({ "field-name": "dash", field_name: "underscore", display_name: "known" });
    expect(rendered.stdout).toContain("field-name");
    expect(rendered.stdout).toContain("field_name");
    expect(rendered.stdout).toContain("Display name");
    expect(rendered.stdout).not.toContain("display_name");
  });

  it("preserves raw column names in top-level array tables", () => {
    const table = JSON.parse(render([{ "display-name": "dash", display_name: "underscore" }]).stdout) as { columns: Array<{ name: string; title: string }> };
    expect(table.columns).toEqual([{ name: "display-name", title: "display-name" }, { name: "display_name", title: "display_name" }]);
  });

  it("leaves custom rich renderers in control of presentation", () => {
    const result = { "display-name": "dash", display_name: "underscore" };
    const rich = vi.fn();
    const primitives = createPrimitives();
    renderResult(createCommand(result, { rich }), result, "rich", primitives, vi.fn());
    expect(rich).toHaveBeenCalledWith(result, primitives);
  });
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
      "Url            https://cdn.example.com/files/long-resource-preview.jpeg",
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

  it("stacks list values one entry per line instead of joining them", () => {
    expect(render({
      created: [
        "/Users/dev/.poe-code/code-review/profiles/generic.md",
        "/Users/dev/.poe-code/code-review/prompts/orchestrator.md"
      ],
      skipped: []
    }).stdout).toBe([
      "Show result",
      "",
      "Lists",
      "Created  /Users/dev/.poe-code/code-review/profiles/generic.md",
      "         /Users/dev/.poe-code/code-review/prompts/orchestrator.md",
      "Skipped  —",
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
  describe.each(["text", { name: "item" }, [], null, false, 0])("result value %j", (value) => {
    it.each(["rich", "md", "json"] as const)("preserves sibling fields in %s", (output) => {
      const payload = { result: value, cursor: "next-page" };
      const envelope = asMCPResult({ content: [], structuredContent: payload });
      const original = structuredClone(envelope);
      const rendered = render(envelope, output);
      expect(rendered.stdout).toContain("next-page");
      if (output === "json") expect(JSON.parse(rendered.stdout)).toStrictEqual(payload);
      expect(rendered.stderr).toBe("");
      expect(envelope).toStrictEqual(original);
    });

    it.each(["rich", "md", "json"] as const)("retains single-result wrapper compatibility in %s", (output) => {
      expect(render(asMCPResult({ content: [], structuredContent: { result: value } }), output)).toEqual(render(value, output));
    });
  });

  it.each(["rich", "md", "json"] as const)("preserves error payload siblings in %s", (output) => {
    const payload = { result: "failed", detail: "actionable-context" };
    const rendered = render(asMCPResult({ content: [], structuredContent: payload, isError: true }), output);
    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toContain("actionable-context");
    if (output === "json") expect(JSON.parse(rendered.stderr)).toStrictEqual(payload);
    expect(rendered.status.mcpError).toBe(true);
  });

  it.each(["rich", "md", "json"] as const)("passes the actual marked envelope to custom %s renderers", (output) => {
    const payload = { result: "visible", cursor: "next-page" };
    const envelope = asMCPResult({ content: [], structuredContent: payload });
    const rich = vi.fn();
    const markdown = vi.fn(() => "rendered");
    const json = vi.fn((value: unknown) => value);
    const primitives = createPrimitives();
    const command = createCommand(envelope, { rich, markdown, json });
    renderResult(command, envelope, output, primitives, vi.fn());
    expect(output === "rich" ? rich : output === "md" ? markdown : json).toHaveBeenCalledWith(envelope, primitives);
  });

  it("unwraps structuredContent.result before rendering", () => {
    const result = asMCPResult({
      content: [],
      structuredContent: {
        result: "- Daily Focus",
      },
    });

    expect(render(result).stdout).toBe("- Daily Focus\n");
    expect(render(result).status.mcpError).toBe(false);
  });

  it("passes marked structuredContent without result inside the actual custom-renderer value", () => {
    const markdown = vi.fn(() => "rendered");
    const result = asMCPResult({
      content: [],
      structuredContent: {
        foo: 1,
        bar: 2,
      },
    });
    const command = createCommand(result, { markdown });
    const primitives = createPrimitives();
    let stdout = "";

    renderResult(command, result, "md", primitives, (chunk) => {
      stdout += chunk;
    });

    expect(markdown).toHaveBeenCalledWith(result, primitives);
    expect(stdout).toBe("rendered\n");
  });

  it("joins text content when structuredContent is absent", () => {
    const result = asMCPResult({
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    });

    expect(render(result).stdout).toBe("hello\nworld\n");
  });

  it("falls back to the empty-result renderer when text content is empty", () => {
    const result = asMCPResult({
      content: [],
    });

    expect(render(result).stdout).toBe("Done.\n");
  });

  it("writes error envelopes to stderr and marks the result as an MCP error", () => {
    const result = asMCPResult({
      content: [{ type: "text", text: "failed" }],
      isError: true,
    });

    const rendered = render(result);

    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toBe("failed\n");
    expect(rendered.status.mcpError).toBe(true);
  });

  it.each(["rich", "md", "json"] as const)("does not describe an empty MCP failure as success in %s", (output) => {
    const result = asMCPResult({ content: [], isError: true });
    const rendered = render(result, output);
    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toContain("Upstream tool failed.");
    expect(rendered.stderr).not.toContain("Done.");
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
