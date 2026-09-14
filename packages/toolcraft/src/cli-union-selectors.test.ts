import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, validate, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { runCLI } from "./cli.js";

const prompts = vi.hoisted(() => ({ select: vi.fn(), text: vi.fn() }));
vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  select: prompts.select,
  promptText: prompts.text
}));

const previousExitCode = process.exitCode;
const streams: PassThrough[] = [];
beforeEach(() => {
  process.exitCode = 0;
  prompts.select.mockReset().mockImplementation(() => { throw new Error("Unexpected selector prompt"); });
  prompts.text.mockReset().mockImplementation(() => { throw new Error("Unexpected text prompt"); });
});
afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  process.exitCode = previousExitCode;
});

function collidingUnion(defaulted = false) {
  return S.Union([
    S.Object({ "first+second": S.String() }),
    S.Object({ first: S.String(), second: S.String(), ...(defaulted ? { note: S.Optional(S.String({ default: "chosen" })) } : {}) })
  ]);
}

async function invoke(
  schema: ObjectSchema<any>,
  args: string[],
  options: { casing: "kebab" | "snake"; stream: boolean; interactive?: boolean; outputMode?: "json" | "rich" }
) {
  const received: unknown[] = [];
  const config = { name: "read", scope: ["cli"] as const, params: schema };
  const command = options.stream
    ? defineStreamCommand({ ...config, event: S.Json(), async *handler({ params }) { received.push(params); yield params; } })
    : defineCommand({ ...config, handler: ({ params }) => { received.push(params); return params; } });
  const root = defineGroup({ name: "audit", children: [command] });
  const input = Object.assign(new PassThrough(), { isTTY: options.interactive === true });
  const output = Object.assign(new PassThrough(), { isTTY: options.interactive === true });
  streams.push(input, output);
  const emitted: string[] = [];
  await runCLI(root, {
    argv: ["node", "audit", "read", ...args, ...(!options.interactive ? ["--yes"] : []), "--output", options.outputMode ?? "json"],
    casing: options.casing,
    controls: { yes: true, output: true },
    promptInput: input,
    promptOutput: output,
    errorReports: false,
    outputEmitter: (entry) => emitted.push(entry)
  });
  for (const value of received) expect(validate(schema, value).ok, JSON.stringify(value)).toBe(true);
  return { received, emitted, input, output, exit: process.exitCode ?? 0 };
}

describe.each(["kebab", "snake"] as const)("%s union selectors", (casing) => {
  describe.each([false, true])("stream=%s", (stream) => {
    const options = { casing, stream };
    const control = casing === "snake" ? "--payload_kind" : "--payload-kind";
    const first = ["--payload.first+second", "literal"];
    const second = ["--payload.first", "one", "--payload.second", "two"];

    it("preserves the existing first selector", async () => {
      const result = await invoke(S.Object({ payload: collidingUnion() }), [control, "first+second", ...first], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { "first+second": "literal" } }]);
    });

    it("makes the second colliding branch selectable", async () => {
      const result = await invoke(S.Object({ payload: collidingUnion() }), [control, "first+second (branch 2)", ...second], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { first: "one", second: "two" } }]);
    });

    it.each(["first+second", "first+second (branch 2)"])("rejects mixed fields when selecting %s", async (selector) => {
      const result = await invoke(S.Object({ payload: collidingUnion() }), [control, selector, ...first, ...second], options);
      expect(result.exit).toBe(1);
      expect(result.received).toEqual([]);
      expect(result.emitted.join("\n")).toContain("Unknown parameter");
    });

    it("checks the selected second branch's required fields", async () => {
      const result = await invoke(S.Object({ payload: collidingUnion() }), [control, "first+second (branch 2)", "--payload.first", "one"], options);
      expect(result.exit).toBe(1);
      expect(result.received).toEqual([]);
      expect(result.emitted.join("\n")).toContain("Missing required parameter");
      expect(result.emitted.join("\n")).toContain("payload.second");
    });

    it("keeps inactive defaults out of the first branch", async () => {
      const result = await invoke(S.Object({ payload: collidingUnion(true) }), [control, "first+second", ...first], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { "first+second": "literal" } }]);
    });

    it("applies defaults from the selected second branch", async () => {
      const result = await invoke(S.Object({ payload: collidingUnion(true) }), [control, "first+second (branch 2)", ...second], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { first: "one", second: "two", note: "chosen" } }]);
    });

    it("leaves an absent optional union inactive", async () => {
      const result = await invoke(S.Object({ payload: S.Optional(collidingUnion(true)) }), [], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{}]);
    });

    it.each(["left", "right"])("preserves the non-colliding %s selector", async (selector) => {
      const schema = S.Object({ payload: S.Union([S.Object({ left: S.String() }), S.Object({ right: S.String() })]) });
      const result = await invoke(schema, [control, selector, `--payload.${selector}`, "given"], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { [selector]: "given" } }]);
    });

    it("continues rejecting mixed non-colliding fields", async () => {
      const schema = S.Object({ payload: S.Union([S.Object({ left: S.String() }), S.Object({ right: S.String() })]) });
      const result = await invoke(schema, [control, "left", "--payload.left", "one", "--payload.right", "two"], options);
      expect(result.exit).toBe(1);
      expect(result.received).toEqual([]);
      expect(result.emitted.join("\n")).toContain("Unknown parameter");
    });

    it.each([
      { selector: "a+b+c+d", value: { "a+b+c+d": "one" } },
      { selector: "a+b+c+d (branch 2)", value: { "a+b": "one", "c+d": "two" } },
      { selector: "a+b+c+d (branch 3)", value: { a: "one", "b+c": "two", d: "three" } }
    ])("selects $selector among three colliding fingerprints", async ({ selector, value }) => {
      const schema = S.Object({ payload: S.Union([
        S.Object({ "a+b+c+d": S.String() }),
        S.Object({ "a+b": S.String(), "c+d": S.String() }),
        S.Object({ a: S.String(), "b+c": S.String(), d: S.String() })
      ]) });
      const args = Object.entries(value).flatMap(([name, entry]) => [`--payload.${name}`, entry]);
      const result = await invoke(schema, [control, selector, ...args], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: value }]);
    });

    it("keeps a colliding selector usable inside a selected parent variant", async () => {
      const schema = S.Object({ outer: S.OneOf({ discriminator: "kind", branches: {
        chosen: S.Object({ payload: collidingUnion() }),
        other: S.Object({ other: S.String() })
      } }) });
      const result = await invoke(schema, ["--outer.kind", "chosen", `--outer.${control.slice(2)}`, "first+second (branch 2)", "--outer.payload.first", "one", "--outer.payload.second", "two"], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ outer: { kind: "chosen", payload: { first: "one", second: "two" } } }]);
    });

    it("preserves the first branch's dynamic record fields", async () => {
      const schema = S.Object({ payload: S.Union([
        S.Object({ "first+second": S.Record(S.String()) }),
        S.Object({ first: S.String(), second: S.String() })
      ]) });
      const result = await invoke(schema, [control, "first+second", "--payload.first+second.key", "given"], options);
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { "first+second": { key: "given" } } }]);
    });

    it("rejects dynamic fields from a different colliding branch", async () => {
      const schema = S.Object({ payload: S.Union([
        S.Object({ "first+second": S.Record(S.String()) }),
        S.Object({ first: S.String(), second: S.String() })
      ]) });
      const result = await invoke(schema, [control, "first+second (branch 2)", ...second, "--payload.first+second.key", "extra"], options);
      expect(result.exit).toBe(1);
      expect(result.received).toEqual([]);
      expect(result.emitted.join("\n")).toContain("Unknown parameter");
    });

    it("offers distinct interactive choices and runs the selected second branch", async () => {
      prompts.select.mockResolvedValue("first+second (branch 2)");
      const result = await invoke(S.Object({ payload: collidingUnion() }), second, { ...options, interactive: true });
      expect(result.exit, result.emitted.join("\n")).toBe(0);
      expect(result.received).toEqual([{ payload: { first: "one", second: "two" } }]);
      expect(prompts.select).toHaveBeenCalledOnce();
      expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({
        input: result.input,
        output: result.output,
        options: [
          { label: "first+second", value: "first+second" },
          { label: "first+second (branch 2)", value: "first+second (branch 2)" }
        ]
      }));
      expect(prompts.text).not.toHaveBeenCalled();
    });

    it("publishes the distinct choices in human help", async () => {
      const help: string[] = [];
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { help.push(String(chunk)); return true; });
      try {
        const result = await invoke(S.Object({ payload: collidingUnion() }), ["--help"], { ...options, outputMode: "rich" });
        expect(result.exit).toBe(0);
        expect(result.received).toEqual([]);
        expect(help.join("").split("\n").map((line) => line.trim()).join(" ")).toContain("first+second (branch 2)");
      } finally {
        stdout.mockRestore();
      }
    });
  });
});
