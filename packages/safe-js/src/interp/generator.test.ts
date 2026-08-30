import { describe, expect, it } from "vitest";
import type { ParseResult } from "../parse.js";
import { parseModule } from "../parse/parser.js";
import { Budget } from "./budget.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { restoreGeneratorChannel } from "./generator.js";
import { interpret } from "./interpreter.js";

describe("sync generators", () => {
  it("preserves restored continuation metadata across repeated snapshots", async () => {
    const body = async (
      yieldValue: (
        value?: unknown,
        yieldNodeId?: number
      ) => Promise<{ type: "normal" | "return" | "throw"; value: unknown }>
    ) => {
      await yieldValue(1, 10);
      await yieldValue(2, 20);
    };
    const channel = restoreGeneratorChannel(body, {
      yieldNodeId: 10,
      sent: [{ type: "normal", value: undefined }]
    });

    expect(channel.snapshot()).toEqual({
      yieldNodeId: 10,
      sent: [{ type: "normal", value: undefined }]
    });

    await expect(channel.next("sent")).resolves.toEqual({ value: 2, done: false });
    expect(channel.snapshot()).toEqual({
      yieldNodeId: 20,
      sent: [
        { type: "normal", value: undefined },
        { type: "normal", value: "sent" }
      ]
    });
  });

  it("emits a resume breakpoint at each yield", async () => {
    const yieldNodeIds: Array<number | undefined> = [];
    await interpret(
      program(
        "function* values() { yield 1; yield 2; } const gen = values(); gen.next(); gen.next();"
      ),
      {
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "generator-yield") {
            yieldNodeIds.push(yieldPoint.nodeId);
          }
        }
      }
    );

    expect(yieldNodeIds).toHaveLength(2);
    expect(yieldNodeIds.every((nodeId) => nodeId !== undefined)).toBe(true);
  });

  it("does not execute the body until first pull", async () => {
    await expect(
      interpret(
        program(
          "const seen = []; function* values() { seen.push('started'); yield 1; } const gen = values(); const before = [...seen]; const first = gen.next(); return [before, first, seen];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [[], { value: 1, done: false }, ["started"]]
    });
  });

  it("pulls yielded values and returns the final value", async () => {
    await expect(
      interpret(
        program(
          "function* values() { yield 1; return 2; } const gen = values(); return [gen.next(), gen.next()];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: 1, done: false },
        { value: 2, done: true }
      ]
    });
  });

  it("allows bare yield before an array literal closing bracket", async () => {
    await expect(
      interpret(
        program(
          "function* values() { return [yield]; } const gen = values(); return [gen.next(), gen.next(3)];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: undefined, done: false },
        { value: [3], done: true }
      ]
    });
  });

  it("binds parameters at the original call and sends values into yield", async () => {
    await expect(
      interpret(
        program(
          "function* values(value) { value = yield value; return value; } let input = 1; const gen = values(input); input = 2; const first = gen.next(); const second = gen.next(3); return [first, second];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: 1, done: false },
        { value: 3, done: true }
      ]
    });
  });

  it("throws at the yield site where the body can catch it", async () => {
    await expect(
      interpret(
        program(
          "function* values() { try { yield 1; } catch (error) { yield error; } } const gen = values(); return [gen.next(), gen.throw('caught'), gen.next()];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: 1, done: false },
        { value: "caught", done: false },
        { value: undefined, done: true }
      ]
    });
  });

  it("runs finally when return resumes a suspended yield", async () => {
    await expect(
      interpret(
        program(
          "const seen = []; function* values() { try { yield 1; } finally { seen.push('finally'); } } const gen = values(); const first = gen.next(); const last = gen.return(9); return [first, last, seen];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [{ value: 1, done: false }, { value: 9, done: true }, ["finally"]]
    });
  });

  it("delegates yield star and forwards throw and return", async () => {
    await expect(
      interpret(
        program(
          "function* inner() { try { yield 1; } catch (error) { yield error; } finally { yield 'finally'; } } function* outer() { return yield* inner(); } const thrown = outer(); const throwResults = [thrown.next(), thrown.throw('caught'), thrown.next(), thrown.next()]; const returned = outer(); const returnResults = [returned.next(), returned.return(7), returned.next()]; return [throwResults, returnResults];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [
          { value: 1, done: false },
          { value: "caught", done: false },
          { value: "finally", done: false },
          { value: undefined, done: true }
        ],
        [
          { value: 1, done: false },
          { value: "finally", done: false },
          { value: 7, done: true }
        ]
      ]
    });
  });

  it("preserves an immediate return completion through yield star", async () => {
    await expect(
      interpret(
        program(
          "function* inner() { yield 1; } function* outer() { yield* inner(); } const gen = outer(); return [gen.next(), gen.return(7)];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: 1, done: false },
        { value: 7, done: true }
      ]
    });
  });

  it("uses the delegate return value when finally overrides return", async () => {
    await expect(
      interpret(
        program(
          "function* inner() { try { yield 1; } finally { return 8; } } function* outer() { yield* inner(); } const gen = outer(); return [gen.next(), gen.return(7)];"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        { value: 1, done: false },
        { value: 8, done: true }
      ]
    });
  });

  it("delegates yield star to built-in sandbox iterables", async () => {
    const budget = new Budget();
    await expect(
      interpret(
        program(
          "function* values(source) { yield* source; } return [[...values([1, 2])], [...values('ab')], [...values(new Set([3, 4]))], [...values(new Map([['x', 5]]))]];"
        ),
        {
          budget,
          bindings: {
            ...createCollectionGlobals({ budget })
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [[1, 2], ["a", "b"], [3, 4], [["x", 5]]]
    });
  });

  it("closes a generator when for of exits early", async () => {
    await expect(
      interpret(
        program(
          "const seen = []; function* values() { try { yield 1; yield 2; } finally { seen.push('finally'); } } for (const value of values()) { break; } return seen;"
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["finally"] });
  });

  it("spreads generators", async () => {
    await expect(
      interpret(program("function* values() { yield 1; yield 2; } return [...values()];"))
    ).resolves.toMatchObject({ ok: true, returnValue: [1, 2] });
  });

  it("drives generators through Array.from and collection constructors", async () => {
    const budget = new Budget();
    await expect(
      interpret(
        program(
          "function* values() { yield 1; yield 2; } function* entries() { yield ['a', 1]; yield ['b', 2]; } return [Array.from(values()), [...new Set(values())], [...new Map(entries())]];"
        ),
        {
          budget,
          bindings: {
            ...createObjectArrayGlobals({ budget }),
            ...createCollectionGlobals({ budget })
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [1, 2],
        [1, 2],
        [
          ["a", 1],
          ["b", 2]
        ]
      ]
    });
  });

  it("halts infinite generators through the node visit budget", async () => {
    await expect(
      interpret(program("function* values() { while (true) yield 1; } return [...values()];"), {
        budget: new Budget({ maxSteps: 30 })
      })
    ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded" });
  });
});

function program(source: string): ParseResult {
  const module = parseModule(source);
  return {
    type: "BlockStatement",
    body: module.body,
    span: module.span
  };
}
