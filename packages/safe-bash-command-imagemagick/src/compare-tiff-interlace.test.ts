import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

function ppm(): Uint8Array {
  return Uint8Array.from([...new TextEncoder().encode("P6\n3 9\n255\n"),
    ...Array.from({ length: 81 }, (_, i) => (7 * i + 1) % 256)]);
}

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  async function run(options: string[]) {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["a.ppm", ppm()], ["diff.tiff", keep]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = ["-metric", "RMSE", "a.ppm", "a.ppm", ...options, "diff.tiff"];
    let result;
    if (mode === "compare" || mode === "magick") {
      const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
      const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
      let stdout = "", stderr = "";
      result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }), stdout, stderr };
    } else result = mode === "sync" ? runCompareCliSync(args, files)
      : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    const output = mode === "sync" || mode === "buffered" ? files.get("diff.tiff")! : await filesystem.readFile("/diff.tiff");
    return { result: { ...result, stderr: result.stderr.trim() }, output };
  }

  it(`${mode} compare writes TIFF planes while preserving pixels and status`, async () => {
    const baseline = await run([]);
    expect(baseline.result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    const decoded = decodeImage(baseline.output);
    for (const [options, planar] of [
      [[], 1],
      [["-interlace", "Plane"], 2],
      [["-interlace", "pLaNe"], 2],
      [["-interlace", "Line"], 1],
      [["-interlace", "None"], 1],
      [["-interlace", "Plane", "+interlace"], 1],
      [["-interlace", "Plane", "-interlace", "None"], 1]
    ] as const) {
      const { result, output } = await run([...options]);
      expect(result).toEqual(baseline.result);
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      const little = output[0] === 73, ifd = view.getUint32(4, little);
      const tags = new Map<number, number>();
      for (let i = 0; i < view.getUint16(ifd, little); i++) {
        const offset = ifd + 2 + i * 12;
        tags.set(view.getUint16(offset, little), view.getUint16(offset + 8, little));
      }
      expect(tags.get(284)).toBe(planar);
      expect(decodeImage(output)).toEqual(decoded);
    }
  });
}
