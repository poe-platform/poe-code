import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const prompts = vi.hoisted(() => ({ text: vi.fn() }));
vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  promptText: prompts.text,
  select: vi.fn(async () => { throw new Error("Unexpected selector prompt in an explicitly selected fixture"); })
}));

const previousExitCode = process.exitCode;
const streams: PassThrough[] = [];
beforeEach(() => { process.exitCode = 0; prompts.text.mockReset().mockResolvedValue(""); });
afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  process.exitCode = previousExitCode;
});

interface DefaultCase {
  name: string;
  create(): {
    schema: AnySchema;
    original: unknown;
    items(value: unknown): string[];
    tokens(prefix: string): string[];
  };
}

const cases: DefaultCase[] = [
  { name: "array", create() {
    const original = ["seed"];
    return {
      original, schema: S.Array(S.String(), { default: original }),
      items: (value) => value as string[], tokens: (prefix) => [`--${prefix}`, "explicit"]
    };
  } },
  { name: "json", create() {
    const original = { nested: { items: ["seed"] } };
    return {
      original, schema: { ...S.Json(), default: original },
      items: (value) => (value as typeof original).nested.items,
      tokens: (prefix) => [`--${prefix}`, JSON.stringify({ nested: { items: ["explicit"] } })]
    };
  } },
  { name: "record", create() {
    const original = { items: ["seed"] };
    return {
      original, schema: { ...S.Record(S.Array(S.String())), default: original },
      items: (value) => (value as typeof original).items,
      tokens: (prefix) => [`--${prefix}.items`, "explicit"]
    };
  } },
  { name: "array of objects", create() {
    const original = [{ items: ["seed"] }];
    return {
      original, schema: S.Array(S.Object({ items: S.Array(S.String()) }), { default: original }),
      items: (value) => (value as typeof original)[0]!.items,
      tokens: (prefix) => [`--${prefix}.0.items`, "explicit"]
    };
  } }
];

describe.each(["plain", "oneOf", "union"] as const)("CLI %s default isolation", (placement) => {
  describe.each([false, true])("optional=%s", (optional) => {
    describe.each([false, true])("interactive=%s", (interactive) => {
      describe.each(["default", "explicit"] as const)("%s value", (source) => {
        it.each(cases)("isolates $name values across repeated calls", async (testCase) => {
          const fixture = testCase.create();
          const body = S.Object({ present: S.String(), value: optional ? S.Optional(fixture.schema) : fixture.schema });
          const params = placement === "plain" ? body : S.Object({ payload: placement === "oneOf"
            ? S.OneOf({ discriminator: "kind", branches: { selected: body } }) : S.Union([body]) });
          const received: unknown[] = [];
          const before: string[][] = [];
          const handler = vi.fn(({ params }: { params: Record<string, unknown> }) => {
            const value = placement === "plain" ? params.value : (params.payload as Record<string, unknown>).value;
            before.push([...fixture.items(value)]);
            fixture.items(value).push("changed");
            received.push(value);
            return "done";
          });
          const root = defineGroup({ name: "audit", children: [defineCommand({ name: "check", params, handler })] });
          const prefix = placement === "plain" ? "value" : "payload.value";
          const selector = placement === "oneOf" ? ["--payload.kind", "selected"]
            : placement === "union" ? ["--payload-kind", optional ? "present" : "present+value"] : [];
          const input = Object.assign(new PassThrough(), { isTTY: interactive });
          const output = Object.assign(new PassThrough(), { isTTY: interactive });
          streams.push(input, output);
          for (let attempt = 0; attempt < 2; attempt++) {
            await runCLI(root, {
              argv: ["node", "audit", "check", ...selector, placement === "plain" ? "--present" : "--payload.present", "ready",
                ...(source === "explicit" ? fixture.tokens(prefix) : []), ...(!interactive ? ["--yes"] : [])],
              controls: { yes: true }, promptInput: input, promptOutput: output,
              errorReports: false, outputEmitter: () => {}
            });
            expect(process.exitCode).toBe(0);
          }
          expect(handler).toHaveBeenCalledTimes(2);
          expect(before).toEqual([[source === "default" ? "seed" : "explicit"], [source === "default" ? "seed" : "explicit"]]);
          expect(received[0]).not.toBe(received[1]);
          expect(fixture.items(received[0])).not.toBe(fixture.items(received[1]));
          expect(fixture.items(fixture.original)).toEqual(["seed"]);
          if (placement === "plain" && interactive && !optional && source === "default" && ["array", "json"].includes(testCase.name)) {
            expect(prompts.text).toHaveBeenCalledTimes(2);
          } else expect(prompts.text).not.toHaveBeenCalled();
        });
      });
    });
  });
});

it.each([false, 0, "", null])("preserves the falsy default %s", async (value) => {
  const received: unknown[] = [];
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "check", params: S.Object({ value: { ...S.Json(), default: value } }),
    handler: ({ params }) => { received.push(params.value); return "done"; }
  })] });
  for (let attempt = 0; attempt < 2; attempt++) {
    await runCLI(root, { argv: ["node", "audit", "check", "--yes"], controls: { yes: true }, errorReports: false, outputEmitter: () => {} });
  }
  expect(received).toEqual([value, value]);
  expect(process.exitCode).toBe(0);
});
