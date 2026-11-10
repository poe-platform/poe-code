import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

// Native ImageMagick 7.1.2-35: 24x16 PPM inputs, RMSE 16011.7 (0.244323).
function ppm(changed: boolean): Uint8Array {
  return Uint8Array.from([...new TextEncoder().encode("P6\n24 16\n255\n"),
    ...Array.from({ length: 24 * 16 * 3 }, (_, index) => {
      const x = Math.floor(index / 3) % 24, y = Math.floor(index / 72), channel = index % 3;
      return (x * 13 + y * 29 + channel * 83 + (changed && (x + y) % 4 === 0 ? 97 : 0)) % 256;
    })]);
}

function frameMarker(bytes: Uint8Array): number {
  expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  for (let offset = 2; offset + 3 < bytes.length;) {
    expect(bytes[offset]).toBe(0xff);
    const marker = bytes[offset + 1]!;
    if (marker === 0xc0 || marker === 0xc2) return marker;
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes[offset + 2]! * 256 + bytes[offset + 3]!;
    expect(length).toBeGreaterThanOrEqual(2);
    offset += 2 + length;
  }
  throw new Error("JPEG has no baseline or progressive frame header");
}

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  async function run(options: string[], equal = false, format = "jpg") {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["a.ppm", ppm(false)], ["b.ppm", ppm(true)], [`diff.${format}`, keep]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = ["-metric", "RMSE", "a.ppm", equal ? "a.ppm" : "b.ppm", ...options, `diff.${format}`];
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
    const output = mode === "sync" || mode === "buffered" ? files.get(`diff.${format}`)! : await filesystem.readFile(`/diff.${format}`);
    return { result: { ...result, stderr: result.stderr.trim() }, output };
  }

  for (const [format, coder] of [["png", "PNG"], ["gif", "GIF"], ["jpg", "JPEG"]] as const) {
    it(`${mode} compare encodes ${coder} interlace modes and explicit None`, async () => {
      for (const options of [[], ["-interlace", coder], ["-interlace", coder.toLowerCase()],
        ["-interlace", "Plane"], ["-interlace", "Line"], ["-interlace", "None"],
        ["-interlace", coder, "-interlace", "None"]]) {
        const { result, output } = await run(options, true, format);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
        const metadata = await sharp(output).metadata();
        expect(metadata).toMatchObject({ width: 24, height: 16,
          isProgressive: options.length > 0 && options.at(-1) !== "None" });
      }
    });
  }

  for (const quality of [undefined, 30, 95]) {
    it(`${mode} compare preserves JPEG pixels and metrics across interlace modes at quality ${quality ?? "default"}`, async () => {
      const options = quality === undefined ? [] : ["-quality", String(quality)];
      const baseline = await run(options);
      expect(baseline.result).toEqual({ exitCode: 1, stdout: "", stderr: "16011.7 (0.244323)" });
      expect(frameMarker(baseline.output)).toBe(0xc0);
      const decoded = decodeImage(baseline.output);
      expect([decoded.width, decoded.height]).toEqual([24, 16]);
      for (const [setting, marker] of [
        [["-interlace", "None"], 0xc0],
        [["-interlace", "Plane"], 0xc2],
        [["-interlace", "pLaNe"], 0xc2],
        [["-interlace", "Line"], 0xc2],
        [["-interlace", "Plane", "+interlace"], 0xc0],
        [["-interlace", "Plane", "-interlace", "None"], 0xc0]
      ] as const) {
        const { result, output } = await run([...options, ...setting]);
        expect(result).toEqual(baseline.result);
        expect(frameMarker(output)).toBe(marker);
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([24, 16]);
        expect(image.data).toEqual(decoded.data);
      }
    });
  }

  it(`${mode} compare retains zero status for identical images with progressive output`, async () => {
    const { result, output } = await run(["-interlace", "Plane"], true);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    expect(frameMarker(output)).toBe(0xc2);
    expect(decodeImage(output)).toMatchObject({ width: 24, height: 16 });
  });

  it(`${mode} compare rejects invalid interlace without overwriting the destination`, async () => {
    const { result, output } = await run(["-interlace", "invalid"]);
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: "compare: unrecognized interlace type 'invalid'" });
    expect(new TextDecoder().decode(output)).toBe("KEEP");
  });
}

it("rejects a missing interlace argument before reading or writing images", async () => {
  const args = ["a.ppm", "b.ppm", "-interlace"];
  const expected = { exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-interlace'\n" };
  expect(runCompareCliSync(args, new Map())).toEqual(expected);
  expect(await runCompareCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
