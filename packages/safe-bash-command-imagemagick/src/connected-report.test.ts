import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const bytes = readFileSync(new URL("./fixtures/component-stripes.png", import.meta.url));
const rows = ["2x1+0+0 0.5,0.0 2 srgb(255,0,0)", "2x1+3+0 3.5,0.0 2 srgb(0,128,0)", "1x1+2+0 2.0,0.0 1 srgb(0,0,255)"];
for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const excludeHeader of [false, true]) for (const excludeIds of [false, true]) for (const reset of [false, true]) {
  it(`formats component reports (${mode}, header=${excludeHeader}, ids=${excludeIds}, reset=${reset})`, async () => {
   const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
   await fs.writeFile("/input.png", bytes);
   const args = ["input.png", "-define", `connected-components:exclude-header=${excludeHeader}`, "-define", `connected-components:exclude-ids=${excludeIds}`, ...(reset ? ["+define", "connected-components:exclude-header", "+define", "connected-components:exclude-ids"] : []), "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"];
   const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   const ids = excludeIds && !reset, header = excludeHeader && !reset ? "" : `Objects (${ids ? "" : "id: "}bounding-box centroid area mean-color):\n`;
   expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + rows.map((row, i) => `  ${ids ? "" : `${[0, 2, 1][i]}: `}${row}\n`).join("") });
   expect((mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png"))?.length).toBeGreaterThan(0);
  });
 }
}
