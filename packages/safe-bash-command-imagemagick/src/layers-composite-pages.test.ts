import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { runConvertCli, runConvertCliSync, createMagickCommand } from "./index.js";

// Pixel positions verified with native ImageMagick; -1 means fully clipped.
const cases: { name: string; base: string; source: string; gravity: string; geometry: string; pixel: number; second?: string }[] = [
  { name: "sequence uses first canvas for gravity", base: "", source: "3x3+1+1", second: "5x5+0+0", gravity: "East", geometry: "+0+0", pixel: 4 },
  { name: "no pages", base: "", source: "", gravity: "NorthWest", geometry: "+0+0", pixel: 0 },
  { name: "source page northwest", base: "", source: "3x3+1+1", gravity: "NorthWest", geometry: "+0+0", pixel: 4 },
  { name: "source page east", base: "", source: "3x3+1+1", gravity: "East", geometry: "+0+0", pixel: 4 },
  { name: "destination offset clips", base: "5x5+1+1", source: "", gravity: "NorthWest", geometry: "+0+0", pixel: -1 },
  { name: "both pages and southeast geometry", base: "5x5+1+1", source: "3x3+1+1", gravity: "SouthEast", geometry: "+1+1", pixel: 4 },
  { name: "negative page offsets", base: "5x5-1-1", source: "3x3-1-1", gravity: "Center", geometry: "+0+0", pixel: 4 },
  { name: "offset-only page", base: "", source: "+1+1", gravity: "NorthWest", geometry: "+0+0", pixel: 4 },
];

for (const route of ["buffered", "sync", "retained", "command"] as const) {
  it.each(cases)(`${route}: $name`, async ({ base, source, gravity, geometry, pixel, second }) => {
    const argv = ["(", "-size", "3x3", "xc:red", ...(base ? ["-repage", base] : []), ")",
      "null:", "(", "-size", "1x1", "xc:lime", ...(source ? ["-repage", source] : []), ")",
      ...(second ? ["(", "-size", "1x1", "xc:lime", "-repage", second, ")"] : []),
      "-gravity", gravity, "-geometry", geometry, "-layers", "Composite", "-depth", "8", "rgb:/out.rgb"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = createCommandArguments(argv);
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write() {} }
    }) : route === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = route === "retained" || route === "command" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect([...bytes]).toEqual((second ? [pixel, 0] : [pixel]).flatMap(position =>
      Array.from({ length: 9 }, (_, i) => i === position ? [0, 255, 0] : [255, 0, 0]).flat()));
  });
}
