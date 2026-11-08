import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, validate, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const previousExitCode = process.exitCode;
beforeEach(() => {
  process.exitCode = 0;
  vol.reset();
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vol.reset();
});

async function invoke(
  schema: ObjectSchema<any>,
  preset: Record<string, unknown>,
  args: string[] = []
) {
  vol.fromJSON({ "/presets/values.json": JSON.stringify(preset) });
  const handler = vi.fn(({ params }: { params: unknown }) => params);
  const output: string[] = [];
  await runCLI(defineGroup({
    name: "audit",
    children: [defineCommand({ name: "check", params: schema, handler })]
  }), {
    argv: ["node", "audit", "check", "--yes", "--preset", "/presets/values.json", ...args],
    controls: { yes: true },
    presets: true,
    approvals: false,
    errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });
  return { handler, output };
}

describe.each(["required", "optional", "nested", "defaulted"])(
  "%s nullable-array preset",
  (placement) => {
    const scenarios = [
      { name: "nullable null", nullable: true, bounded: false, value: null, valid: true },
      { name: "bounded nullable null", nullable: true, bounded: true, value: null, valid: true },
      { name: "nonnullable null", nullable: false, bounded: false, value: null, valid: false },
      { name: "bounded array", nullable: true, bounded: true, value: ["ready"], valid: true },
      { name: "bounded empty array", nullable: true, bounded: true, value: [], valid: false },
      { name: "invalid array item", nullable: true, bounded: false, value: [42], valid: false }
    ];

    it.each(scenarios)("validates $name consistently with its schema", async (scenario) => {
      const array = S.Array(S.String(), {
        nullable: scenario.nullable,
        ...(scenario.bounded ? { minItems: 1, maxItems: 2 } : {}),
        ...(placement === "defaulted" ? { default: ["fallback"] } : {})
      });
      const field = placement === "optional" ? S.Optional(array) : array;
      const schema = placement === "nested"
        ? S.Object({ container: S.Object({ values: field }) })
        : S.Object({ values: field });
      const preset = placement === "nested"
        ? { container: { values: scenario.value } }
        : { values: scenario.value };

      expect(validate(schema, preset).ok).toBe(scenario.valid);
      const { handler, output } = await invoke(schema, preset);

      expect(process.exitCode, output.join("\n")).toBe(scenario.valid ? 0 : 1);
      if (scenario.valid) {
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]?.[0].params).toEqual(preset);
      } else {
        expect(handler).not.toHaveBeenCalled();
        expect(output.join("\n")).toContain('Preset file "/presets/values.json"');
      }
    });

    it("allows an explicit flag to override a valid null preset", async () => {
      const array = S.Array(S.String(), {
        nullable: true,
        ...(placement === "defaulted" ? { default: ["fallback"] } : {})
      });
      const field = placement === "optional" ? S.Optional(array) : array;
      const nested = placement === "nested";
      const schema = nested
        ? S.Object({ container: S.Object({ values: field }) })
        : S.Object({ values: field });
      const { handler, output } = await invoke(
        schema,
        nested ? { container: { values: null } } : { values: null },
        [nested ? "--container.values" : "--values", "chosen"]
      );

      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0].params).toEqual(
        nested ? { container: { values: ["chosen"] } } : { values: ["chosen"] }
      );
    });
  }
);

describe("nullable preset controls", () => {
  it.each<AnySchema>([
    S.String({ nullable: true }),
    S.Number({ nullable: true }),
    S.Boolean({ nullable: true }),
    S.Enum(["ready"], { nullable: true })
  ])("preserves null for nullable scalar $kind", async (field) => {
    const { handler, output } = await invoke(S.Object({ value: field }), { value: null });

    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler.mock.calls[0]?.[0].params).toEqual({ value: null });
  });

  it("validates nullable items in a nonnullable array", async () => {
    const { handler, output } = await invoke(
      S.Object({ values: S.Array(S.String({ nullable: true })) }),
      { values: [null, "ready"] }
    );

    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler.mock.calls[0]?.[0].params).toEqual({ values: [null, "ready"] });
  });
});
