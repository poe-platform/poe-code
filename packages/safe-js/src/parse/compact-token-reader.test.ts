import { expect, it, vi } from "vitest";
import { parseSourceModule } from "./parser.js";
import { CompactSourcePositions } from "./compact-spans.js";
import { compactTokenReader } from "./compact-tokens.js";
import * as tokenizer from "./tokenizer.js";

it.each([
  "export const alpha = beta;",
  "export const alpha = ((beta) => beta);",
  "export const alpha = ((beta));"
])("reads compiler tokens without converting parser indices to property keys: %s", source => {
  const tokenizeCompact = tokenizer.tokenizeCompact;
  let parsing = false;
  const tokenize = vi.spyOn(tokenizer, "tokenizeCompact").mockImplementation((...args) => {
    const tokens = tokenizeCompact(...args);
    parsing = true;
    return tokens;
  });
  const NativeNumber = Number;
  let convertedIndices = 0;
  globalThis.Number = new Proxy(NativeNumber, {
    apply(target, receiver, args) {
      if (parsing) convertedIndices++;
      return Reflect.apply(target, receiver, args);
    }
  });
  let result;
  try {
    result = parseSourceModule(source, "entry", undefined, {
      sharedPositions: true, compactAst: true
    });
  } finally {
    globalThis.Number = NativeNumber;
    tokenize.mockRestore();
  }
  expect(result.module.body).toHaveLength(1);
  expect(result.requests).toEqual([]);
  expect(convertedIndices).toBe(0);
});

it.each([false, true])("shares bounded token identity and annotations through both read paths (lazy=%s)", lazy => {
  const source = "'\\1';`a${name}b`;" + "alpha;".repeat(800);
  const tokens = tokenizer.tokenizeCompact(source, { allowLegacyEscapes: true }, new CompactSourcePositions(source), lazy);
  const read = compactTokenReader(tokens)!;
  expect(typeof read).toBe("function");
  const first = read(0)!;
  expect(first.legacyEscape).toBe(true);
  expect(read(2)!.templateExpressions).toHaveLength(1);
  for (let index = 1; index < 256; index++) read(index);
  expect(read(0)).toBe(first);
  expect(tokens[0]).toBe(first);
  read(256);
  const restored = read(0)!;
  expect(restored).not.toBe(first);
  expect(restored.type).toBe(first.type);
  expect(restored.start).toEqual(first.start);
  expect(restored.end).toEqual(first.end);
  expect(restored.legacyEscape).toBe(true);
  for (let index = 0; index < tokens.length; index++) expect(read(index)).toBe(tokens[index]);
  expect(read(tokens.length - 1)?.type).toBe("eof");
  for (const index of [-1, 0.5, NaN, Infinity, tokens.length]) expect(read(index)).toBeUndefined();
});

it("does not certify ordinary arrays or foreign proxies by inspecting their properties", () => {
  const source = "alpha;";
  const tokens = tokenizer.tokenizeCompact(source, {}, new CompactSourcePositions(source));
  const foreign = new Proxy(tokens, { get() { throw new Error("Unexpected foreign token read"); } });
  expect(compactTokenReader(foreign)).toBeUndefined();
  expect(compactTokenReader(tokenizer.tokenize(source))).toBeUndefined();
  const read = compactTokenReader(tokens);
  const get = WeakMap.prototype.get;
  const hook = vi.spyOn(WeakMap.prototype, "get").mockImplementation(function (this: WeakMap<object, unknown>, key: object) {
    return key === tokens || key === foreign ? () => undefined : get.call(this, key);
  });
  let known, unknown;
  try {
    known = compactTokenReader(tokens);
    unknown = compactTokenReader(foreign);
  } finally {
    hook.mockRestore();
  }
  expect(known).toBe(read);
  expect(unknown).toBeUndefined();
});
