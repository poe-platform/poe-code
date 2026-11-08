import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const bytes = readFileSync(new URL("./fixtures/component-stripes.png", import.meta.url));
for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const reset of [false, true]) it(`sorts component reports by x without changing labels (${mode}, reset=${reset})`, async () => {
  const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["input.png", "-define", "connected-components:sort=x", ...(reset ? ["+define", "connected-components:sort"] : []), "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const rows = result.stdout.trim().split("\n").slice(1).map(row => row.trim().split(": ")[1]);
  const left = "2x1+0+0 0.5,0.0 2 srgb(255,0,0)", middle = "1x1+2+0 2.0,0.0 1 srgb(0,0,255)", right = "2x1+3+0 3.5,0.0 2 srgb(0,128,0)";
  expect(rows).toEqual(reset ? [left, right, middle] : [left, middle, right]);
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 1, 2, 2]);
 });
}
