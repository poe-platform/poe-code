import { describe, expect, it, vi } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { createSandboxPromise, isSandboxGenerator } from "./values.js";
import { generatorIterator } from "./iteration.js";

describe("async generator delegation protocol", () => {
  it.each(["next", "return", "throw"])("preserves a promised value yielded by delegate %s", async method => {
    let promised: Promise<number> | ReturnType<typeof createSandboxPromise> = Promise.resolve(7);
    const iterable = {
      [Symbol.asyncIterator]() {
        let first = true;
        const result = () => Promise.resolve({ done: false, value: promised });
        return {
          next: () => {
            if (first) { first = false; return Promise.resolve({ done: false, value: 1 }); }
            return result();
          },
          return: result,
          throw: result
        };
      }
    };
    const source = `async function* values(){yield* iterable}const iterator=values();await iterator.next();const result=await iterator.${method}(9);return [result.done,result.value===promised];`;
    const expected = await new Function("iterable", "promised", "return async function(){" + source + "}")(iterable, promised)();
    // Host inputs use managed promises; raw Promise property reads are a separate boundary.
    promised = createSandboxPromise(Promise.resolve(7));
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable, promised }
    })).toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves a raw async delegate promise at the generator protocol boundary", async () => {
    const promised = Promise.resolve(7);
    const iterable = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: promised }) })
    };
    const module = parseModule("async function* values(){yield* iterable}return values();");
    const result = await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable }
    });
    if (!result.ok || !isSandboxGenerator(result.returnValue)) throw new Error("Expected a generator");
    const entry = await generatorIterator(result.returnValue).next();
    expect(entry.done).toBe(false);
    expect(entry.value).toBe(promised);
  });

  it.each(["absent", "resolve", "reject", "primitive"])("closes a delegate without throw: %s", async mode => {
    const close = vi.fn(async () => {
      if (mode === "reject") throw 7;
      return mode === "primitive" ? 1 : { done: true, value: undefined };
    });
    const iterable = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 1 }),
        ...(mode === "absent" ? {} : { return: close })
      })
    };
    const source = "async function* values(){yield* iterable}const iterator=values();await iterator.next();try{await iterator.throw(9)}catch(error){return typeof error==='object'?error.name:error}";
    const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const closeCount = close.mock.calls.length;
    close.mockClear();
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable }
    })).toMatchObject({ ok: true, returnValue: expected });
    expect(close).toHaveBeenCalledTimes(closeCount);
  });

  it("cancels a pending delegated pull without cleanup effects", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const iterable = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          queueMicrotask(() => controller.abort());
          return new Promise(() => {});
        },
        return: close
      })
    };
    const module = parseModule("async function* values(){yield* iterable}return await values().next();");
    await expect(interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable }, signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(close).not.toHaveBeenCalled();
  });

  it.each(["next", "return", "throw"])("delegates %s to an async iterable", async method => {
    const source = `async function* values(){yield* iterable}const iterator=values();return [await iterator.next(),await iterator.${method}(9)];`;
    const iterable = {
      [Symbol.asyncIterator]() {
        let first = true;
        return {
          async next(value?: unknown) {
            if (first) { first = false; return { done: false, value: 7 }; }
            return { done: true, value };
          },
          async return(value?: unknown) { return { done: true, value }; },
          async throw(value?: unknown) { return { done: true, value }; }
        };
      }
    };
    const expected = await new Function("iterable", "return async function(){" + source + "}")(iterable)();
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable }
    })).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not unwrap a completed async delegate value inside the generator", async () => {
    const source = "async function* values(){const value=yield* iterable;return value===promised}return await values().next();";
    const promised = Promise.resolve(7);
    const iterable = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: promised })
      })
    };
    const expected = await new Function("iterable", "promised", "return async function(){" + source + "}")(iterable, promised)();
    const module = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: module.body, span: module.span }, {
      bindings: { iterable, promised }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
});
