import {readFile, writeFile} from "node:fs/promises";
import {expect, it, vi} from "vitest";

vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  writeFile: vi.fn()
}));

it("reproduces the checked-in portable VM without writing unit-test fixtures", async () => {
  await import("./generate-fengari.mjs");
  const target = new URL("../src/fengari.generated.ts", import.meta.url);
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(target, await readFile(target, "utf8"));
});
