import { describe, expect, it, vi } from "vitest";
import { S } from "@poe-code/cmdkit-schema";
import { defineCommand } from "./index.js";
import { renderResult } from "./renderer.js";
import type { OutputMode } from "./renderer.js";
import type { RenderPrimitives } from "./index.js";

function createPrimitives(): {
  primitives: RenderPrimitives;
  renderTable: ReturnType<typeof vi.fn>;
} {
  const renderTable = vi.fn((options: { columns: Array<{ name: string; title: string }>; rows: Record<string, string>[] }) =>
    JSON.stringify({
      columns: options.columns.map((column) => ({ name: column.name, title: column.title })),
      rows: options.rows,
    })
  );

  return {
    primitives: {
      logger: {
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        resolved: vi.fn(),
        errorResolved: vi.fn(),
        message: vi.fn(),
      },
      renderTable,
      getTheme: vi.fn(() => ({
        header: (value: string) => value,
        muted: (value: string) => value,
      })),
    },
    renderTable,
  };
}

function runRender(command: ReturnType<typeof defineCommand>, result: unknown, output: OutputMode): string {
  const { primitives } = createPrimitives();
  let rendered = "";

  renderResult(command, result, output, primitives, (chunk) => {
    rendered += chunk;
  });

  return rendered;
}

describe("renderResult", () => {
  it.each([
    {
      label: "object in rich",
      output: "rich" as const,
      result: { name: "demo", count: 2 },
      expected:
        '{"columns":[{"name":"key","title":"Key"},{"name":"value","title":"Value"}],"rows":[{"key":"name","value":"demo"},{"key":"count","value":"2"}]}\n',
    },
    {
      label: "object in markdown",
      output: "md" as const,
      result: { name: "demo", count: 2 },
      expected: "- name: demo\n- count: 2\n",
    },
    {
      label: "object in json",
      output: "json" as const,
      result: { name: "demo", count: 2 },
      expected: '{\n  "name": "demo",\n  "count": 2\n}\n',
    },
    {
      label: "array of objects in rich",
      output: "rich" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 },
      ],
      expected:
        '{"columns":[{"name":"name","title":"name"},{"name":"count","title":"count"}],"rows":[{"name":"alpha","count":"1"},{"name":"beta","count":"2"}]}\n',
    },
    {
      label: "array of objects in markdown",
      output: "md" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 },
      ],
      expected: "| name | count |\n| :--- | :--- |\n| alpha | 1 |\n| beta | 2 |\n",
    },
    {
      label: "array of objects in json",
      output: "json" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 },
      ],
      expected: '[\n  {\n    "name": "alpha",\n    "count": 1\n  },\n  {\n    "name": "beta",\n    "count": 2\n  }\n]\n',
    },
    {
      label: "string in rich",
      output: "rich" as const,
      result: "hello",
      expected: "hello\n",
    },
    {
      label: "string in markdown",
      output: "md" as const,
      result: "hello",
      expected: "hello\n",
    },
    {
      label: "string in json",
      output: "json" as const,
      result: "hello",
      expected: '{\n  "result": "hello"\n}\n',
    },
    {
      label: "null in rich",
      output: "rich" as const,
      result: null,
      expected: "Done.\n",
    },
    {
      label: "null in markdown",
      output: "md" as const,
      result: null,
      expected: "Done.\n",
    },
    {
      label: "null in json",
      output: "json" as const,
      result: null,
      expected: '{\n  "ok": true\n}\n',
    },
    {
      label: "undefined in rich",
      output: "rich" as const,
      result: undefined,
      expected: "Done.\n",
    },
    {
      label: "undefined in markdown",
      output: "md" as const,
      result: undefined,
      expected: "Done.\n",
    },
    {
      label: "undefined in json",
      output: "json" as const,
      result: undefined,
      expected: '{\n  "ok": true\n}\n',
    },
  ])("auto-renders $label", ({ output, result, expected }) => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => result,
    });

    expect(runRender(command, result, output)).toBe(expected);
  });

  it("renders sparse arrays of objects with merged columns and escaped markdown cells", () => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => [
        { name: "alpha|beta", count: 1 },
        { enabled: true, count: 2 },
      ],
    });

    expect(
      runRender(
        command,
        [
          { name: "alpha|beta", count: 1 },
          { enabled: true, count: 2 },
        ],
        "rich"
      )
    ).toBe(
      '{"columns":[{"name":"name","title":"name"},{"name":"count","title":"count"},{"name":"enabled","title":"enabled"}],"rows":[{"name":"alpha|beta","count":"1","enabled":""},{"name":"","count":"2","enabled":"true"}]}\n'
    );

    expect(
      runRender(
        command,
        [
          { name: "alpha|beta", count: 1 },
          { enabled: true, count: 2 },
        ],
        "md"
      )
    ).toBe(
      "| name | count | enabled |\n| :--- | :--- | :--- |\n| alpha\\|beta | 1 |  |\n|  | 2 | true |\n"
    );
  });

  it("passes design-system primitives to format overrides", () => {
    const rich = vi.fn();
    const markdown = vi.fn(() => "override-md");
    const json = vi.fn(() => ({ override: true }));
    const { primitives } = createPrimitives();

    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => "ignored",
      render: {
        rich,
        markdown,
        json,
      },
    });

    renderResult(command, "value", "rich", primitives, () => undefined);
    renderResult(command, "value", "md", primitives, () => undefined);
    renderResult(command, "value", "json", primitives, () => undefined);

    expect(rich).toHaveBeenCalledWith("value", primitives);
    expect(markdown).toHaveBeenCalledWith("value", primitives);
    expect(json).toHaveBeenCalledWith("value", primitives);
  });

  it("uses format overrides instead of the auto renderer", () => {
    const rich = vi.fn();
    const markdown = vi.fn(() => "override-md");
    const json = vi.fn(() => ({ override: true }));
    const { primitives, renderTable } = createPrimitives();
    const writes: string[] = [];

    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ name: "auto" }),
      render: {
        rich,
        markdown,
        json,
      },
    });

    renderResult(command, { name: "auto" }, "rich", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { name: "auto" }, "md", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { name: "auto" }, "json", primitives, (chunk) => {
      writes.push(chunk);
    });

    expect(rich).toHaveBeenCalledTimes(1);
    expect(renderTable).not.toHaveBeenCalled();
    expect(writes).toEqual(["override-md\n", '{\n  "override": true\n}\n']);
  });

  it("does not write when markdown or json overrides return nothing", () => {
    const writes: string[] = [];
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ ok: true }),
      render: {
        markdown: vi.fn(() => "" as string),
        json: vi.fn(() => undefined),
      },
    });
    const { primitives } = createPrimitives();

    renderResult(command, { ok: true }, "md", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { ok: true }, "json", primitives, (chunk) => {
      writes.push(chunk);
    });

    expect(writes).toEqual([]);
  });

  it("ignores malformed markdown overrides that return undefined", () => {
    const writes: string[] = [];
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ ok: true }),
      render: {
        markdown: vi.fn(() => undefined as unknown as string),
      },
    });
    const { primitives } = createPrimitives();

    expect(() => {
      renderResult(command, { ok: true }, "md", primitives, (chunk) => {
        writes.push(chunk);
      });
    }).not.toThrow();
    expect(writes).toEqual([]);
  });
});
