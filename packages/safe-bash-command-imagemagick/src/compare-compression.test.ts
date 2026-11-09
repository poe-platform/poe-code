import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: 8x6 PPMs, with one changed RGB pixel.
const plain = Buffer.from("UDYKOCA2CjI1NQoAMuYRW/0ihBQzrStE1kJV/1lmKHB3UYeIep6Zo7WqzMy79ePMHvrdRxHucCj/mT8QwlYh620yFIRDPZtUZrJlj8l2uOCH4feYCg6pMyW6XDzLhVPcrmrt14H+AJgPKa8gUsYxe91CpPRTzQtk9iJ1HzmGSFCXcWeomn65w5XK7KzbFcPsPtr9Z/EOkAgfuR8=", "base64");
const edit = Uint8Array.from(plain);
edit.set([42, 12, 235], 11 + 11 * 3);

function compression(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0) === 0x4949;
  expect(view.getUint16(2, little)).toBe(42);
  const ifd = view.getUint32(4, little);
  for (let index = 0; index < view.getUint16(ifd, little); index++) {
    const offset = ifd + 2 + index * 12;
    if (view.getUint16(offset, little) === 259) return view.getUint16(offset + 8, little);
  }
}

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  async function run(options: string[], equal = false) {
    const files = new Map([["plain.ppm", Uint8Array.from(plain)], ["edit.ppm", edit], ["diff.tif", new TextEncoder().encode("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = ["-metric", "RMSE", ...options, "plain.ppm", equal ? "plain.ppm" : "edit.ppm", "diff.tif"];
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
    const output = mode === "sync" || mode === "buffered" ? files.get("diff.tif")! : await filesystem.readFile("/diff.tif");
    return { result: { ...result, stderr: result.stderr.trim() }, output };
  }

  it.each([["None", 1], ["LZW", 5], ["Zip", 8], ["RLE", 32773]] as const)(`${mode} compare writes %s TIFF without changing pixels or distortion`, async (method, tag) => {
    const { result, output } = await run(["-compress", method]);
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "5879.96 (0.0897224)" });
    expect(compression(output)).toBe(tag);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([8, 6]);
    const rgb = image.data.filter((_, index) => index % 4 !== 3);
    expect(createHash("sha256").update(rgb).digest("hex")).toBe("31f5631eae0d58e29781680128a6148e06eab0437b5233697326240d87823fc8");
  });

  it(`${mode} compare handles compression defaults, resets and case-insensitive settings`, async () => {
    for (const [options, tag] of [[[], 1], [["-compress", "lZw"], 5], [["-compress", "LZW", "+compress"], 1], [["-compress", "LZW", "-compress", "None"], 1]] as const) {
      const { result, output } = await run([...options], true);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
      expect(compression(output)).toBe(tag);
      expect(decodeImage(output)).toMatchObject({ width: 8, height: 6 });
    }
  });

  it(`${mode} compare rejects invalid compression without replacing output`, async () => {
    const { result, output } = await run(["-compress", "invalid"]);
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: "compare: unrecognized compression type 'invalid'" });
    expect(new TextDecoder().decode(output)).toBe("KEEP");
  });
}

it("rejects a missing compression value before accessing images", async () => {
  const args = ["plain.ppm", "edit.ppm", "-compress"];
  const expected = { exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-compress'\n" };
  expect(runCompareCliSync(args, new Map())).toEqual(expected);
  expect(await runCompareCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
