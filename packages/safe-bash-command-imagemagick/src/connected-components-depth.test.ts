import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const channel of [0, 1, 2, 3, "rgb"] as const) it(`distinguishes sub-byte Q16 ${channel} differences (${mode})`, async () => {
  const data16 = Uint16Array.of(0x4000, 0x4000, 0x4000, 65535, 0x4000, 0x4000, 0x4000, 65535, 0x4000, 0x4000, 0x4000, 65535);
  for (const c of channel === "rgb" ? [0, 1, 2] : [channel]) {
   data16[c] = 0x4000;
   data16[4 + c] = data16[8 + c] = 0x4020;
  }
  const bytes = encodeImage({ width: 3, height: 1, format: "png", density: 72, channels: channel === 3 ? 4 : 3, hasAlpha: channel === 3, space: "srgb", depth: "ushort", data16, data: Uint8Array.from(data16, v => Math.round(v / 257)) }, { format: "png" }).data;
  expect(decodeImage(bytes).data16).toEqual(data16);
  const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["input.png", "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.split("\n").slice(1, 3).map(line => line.slice(0, line.indexOf(" srgb")))).toEqual([
   "  1: 2x1+1+0 1.5,0.0 2", "  0: 1x1+0+0 0.0,0.0 1"
  ]);
 });
}
