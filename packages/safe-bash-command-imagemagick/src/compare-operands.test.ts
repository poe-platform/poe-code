import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli, runConvertCli } from "./index.js";

for (const mode of ["buffered", "sync", "magick", "retained"] as const) {
  it(`${mode} compare reserves the last filename for output and counts input frames`, async () => {
    const files = new Map<string, Uint8Array>();
    for (const [name, color] of [["a", "red"], ["b", "blue"]]) {
      expect((await runConvertCli(["-size", "2x1", `xc:${color}`, `/${name}.png`], files)).exitCode).toBe(0);
    }
    expect((await runConvertCli(["/a.png", "/b.png", "/pair.gif"], files)).exitCode).toBe(0);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const run = (args: string[]) => mode === "retained"
      ? runCompareCli(args, { filesystem: fs, cwd: "/" })
      : mode === "sync" ? runCompareCliSync(args, files)
      : mode === "magick" ? runMagickCli(["compare", ...args], files)
      : runCompareCli(args, files);
    const original = files.get("/b.png")!.slice();
    expect(await run(["/a.png", "/b.png"])).toEqual({
      exitCode: 2, stdout: "", stderr: "compare: missing an image filename\n"
    });
    expect(mode === "retained" ? await fs.readFile("/b.png") : files.get("/b.png")).toEqual(original);
    const explicit = await run(["/a.png", "/b.png", "null:"]);
    expect(explicit.exitCode).toBe(1);
    const frames = await run(["/pair.gif[0]", "/pair.gif[1]", "/expected.png"]);
    expect(frames).toEqual({ exitCode: 1, stdout: "", stderr: "53509.1 (0.816497)" });
    expect(await run(["/pair.gif", "/out.png"])).toEqual(frames);
    const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    const expected = mode === "retained" ? await fs.readFile("/expected.png") : files.get("/expected.png")!;
    expect(decodeImage(output)).toEqual(decodeImage(expected));
    expect(await run(["/pair.gif[0]", "null:"])).toEqual({
      exitCode: 2, stdout: "", stderr: "compare: missing an image filename\n"
    });
  });
}
