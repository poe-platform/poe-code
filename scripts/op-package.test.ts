import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const manifest = (filename: string) => JSON.parse(readFileSync(new URL(filename, import.meta.url), "utf8"));

it("ships the opt-in op plugin through poe-code without a public op package or bin", () => {
  const root = manifest("../package.json");
  const shell = manifest("../packages/safe-bash/package.json");
  const op = manifest("../packages/op/package.json");
  const lock = manifest("../package-lock.json");
  expect(root.exports["./safe-bash/commands/op"]).toEqual({
    types: "./packages/safe-bash/dist/commands/op/index.d.ts",
    workerd: "./packages/safe-bash/dist/commands/op/index.browser.js",
    browser: "./packages/safe-bash/dist/commands/op/index.browser.js",
    import: "./packages/safe-bash/dist/commands/op/index.js"
  });
  expect(shell.exports["./commands/op"]).toEqual({
    types: "./dist/commands/op/index.d.ts",
    workerd: "./dist/commands/op/index.browser.js",
    browser: "./dist/commands/op/index.browser.js",
    import: "./dist/commands/op/index.js"
  });
  expect(shell.devDependencies[op.name]).toBe("*");
  expect(root.dependencies["@kayahr/text-encoding"]).toBe(op.dependencies["@kayahr/text-encoding"]);
  expect(root.dependencies[op.name]).toBeUndefined();
  expect(root.exports["./op"]).toBeUndefined();
  expect(root.bin.op).toBeUndefined();
  expect(op.private).toBe(true);
  expect(op.bin).toBeUndefined();
  expect(op.scripts.prepack).toBeUndefined();
  expect(root.files).toContain("packages/op/dist/**/*.d.ts");
  expect(lock.packages[""].dependencies["@kayahr/text-encoding"]).toBe(root.dependencies["@kayahr/text-encoding"]);
  expect(lock.packages["packages/safe-bash"].devDependencies[op.name]).toBe("*");
  expect(lock.packages["packages/op"].bin).toBeUndefined();
});
