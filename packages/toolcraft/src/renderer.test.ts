import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import YAML from "yaml";
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
    })),
    note: vi.fn(),
  };
}

function createCommand(result: unknown, render?: Parameters<typeof defineCommand>[0]["render"]) {
  return defineCommand({
    name: "demo",
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

  it("renders objects as YAML by default", () => {
    expect(render({ foo: 1, bar: [1, 2] }).stdout).toMatchInlineSnapshot(`
      "foo: 1
      bar:
        - 1
        - 2

      "
    `);
  });

  it("renders arrays of objects as YAML by default", () => {
    expect(render([{ foo: 1 }, { bar: [1, 2] }]).stdout).toMatchInlineSnapshot(`
      "- foo: 1
      - bar:
          - 1
          - 2

      "
    `);
  });

  it("invokes Command.render.rich and bypasses YAML", () => {
    const stringifyYaml = vi.spyOn(YAML, "stringify");
    const rich = vi.fn();
    const command = createCommand({ foo: 1 }, { rich });
    const primitives = createPrimitives();
    let stdout = "";

    renderResult(command, { foo: 1 }, "rich", primitives, (chunk) => {
      stdout += chunk;
    });

    expect(rich).toHaveBeenCalledWith({ foo: 1 }, primitives);
    expect(stdout).toBe("");
    expect(stringifyYaml).not.toHaveBeenCalled();
  });

  it("uses the markdown renderer for --output md and bypasses YAML", () => {
    const stringifyYaml = vi.spyOn(YAML, "stringify");

    expect(render({ foo: 1, bar: [1, 2] }, "md").stdout).toBe("- foo: 1\n- bar: [1,2]\n");
    expect(stringifyYaml).not.toHaveBeenCalled();
  });

  it("uses the JSON renderer for --output json and bypasses YAML", () => {
    const stringifyYaml = vi.spyOn(YAML, "stringify");

    expect(render({ foo: 1, bar: [1, 2] }, "json").stdout).toBe(
      '{\n  "foo": 1,\n  "bar": [\n    1,\n    2\n  ]\n}\n'
    );
    expect(stringifyYaml).not.toHaveBeenCalled();
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
