import { expect, it } from "vitest";
import { rewriteModuleSpecifiers } from "./module-specifiers.mjs";

it("rewrites imports in long generated expressions without exhausting the call stack", () => {
  const prefix = 'import "first"; const value = ' + '0 + '.repeat(30000);
  const source = prefix + 'import("second"); export * from "third";';
  const seen: string[] = [];
  const result = rewriteModuleSpecifiers("generated.mjs", source, (specifier: string) => {
    seen.push(specifier);
    return "./" + specifier;
  });
  expect(seen).toEqual(["first", "second", "third"]);
  expect(result).toBe(prefix.replace('"first"', '"./first"') + 'import("./second"); export * from "./third";');
});

it("visits module expressions in source order and leaves ordinary strings alone", () => {
  const source = 'const label = "unchanged"; const values = [require("a"), import("b"), new URL("c", import.meta.url)];';
  const seen: string[] = [];
  const result = rewriteModuleSpecifiers("module.mjs", source, (specifier: string) => {
    seen.push(specifier);
    return "./" + specifier;
  });
  expect(seen).toEqual(["a", "b", "c"]);
  expect(result).toBe('const label = "unchanged"; const values = [require("./a"), import("./b"), new URL("./c", import.meta.url)];');
});
