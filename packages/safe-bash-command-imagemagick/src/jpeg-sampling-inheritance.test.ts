import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { readImageMetadata, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

function jpeg(samplingFactor: string): Uint8Array {
  return encodeImage({
    width: 16, height: 12, channels: 3, hasAlpha: false, density: 72,
    format: "png", depth: "uchar", space: "srgb",
    data: Uint8Array.from({ length: 16 * 12 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : i % 4 === 1 ? 0 : (Math.floor(i / 64) * 23 + (i % 4 === 0 ? 0 : 128)) % 256)
  }, { format: "jpeg", quality: 67, samplingFactor }).data;
}

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;

for (const route of ["map", "filesystem", "command"] as const) {
  async function run(args: string[], inputs: Map<string, Uint8Array>) {
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of inputs) await fs.writeFile(path, bytes);
    let result;
    if (route === "command") {
      const argumentValues = createCommandArguments(args);
      let stderr = "";
      result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(stderr).toBe("");
    } else {
      result = await runConvertCli(args, route === "map" ? inputs : { filesystem: fs, cwd: "/" });
      expect(result.stderr).toBe("");
    }
    expect(result.exitCode).toBe(0);
    return async (path: string) => readImageMetadata(route === "map" ? inputs.get(path)! : await fs.readFile(path)).jpegSamplingFactor;
  }

  it.skipIf(!nativeAvailable).each(["4:2:2", "4:4:4", "4:2:0"])(
    `matches native re-encoding of identical %s JPEG bytes (${route})`, async factor => {
      const source = spawnSync("magick", ["-size", "16x12", "gradient:red-blue", "-sampling-factor", factor, "-quality", "67", "jpeg:-"]);
      expect(source.status, source.stderr.toString()).toBe(0);
      const native = spawnSync("magick", ["jpeg:-", "-quality", "67", "jpeg:-"], { input: source.stdout });
      expect(native.status, native.stderr.toString()).toBe(0);
      const sampling = await run(["/in.jpg", "-quality", "67", "/out.jpg"], new Map([["/in.jpg", source.stdout]]));
      expect(await sampling("/out.jpg")).toBe(readImageMetadata(native.stdout).jpegSamplingFactor);
    }
  );

  it.each(["2x1,1x1,1x1", "1x1,1x1,1x1", "2x2,1x1,1x1"])(
    `retains source %s sampling for intermediate and final JPEG writes (${route})`, async factor => {
      const sampling = await run(["/in.jpg", "-quality", "67", "-write", "/copy.jpg", "/out.jpg"], new Map([["/in.jpg", jpeg(factor)]]));
      expect(await sampling("/copy.jpg")).toBe(factor);
      expect(await sampling("/out.jpg")).toBe(factor);
    }
  );

  it(`retains sampling after pixel transforms and a quality change (${route})`, async () => {
    const sampling = await run(["/in.jpg", "-flip", "-quality", "95", "/out.jpg"], new Map([["/in.jpg", jpeg("2x1")]]));
    expect(await sampling("/out.jpg")).toBe("2x1,1x1,1x1");
  });

  it(`honors explicit sampling and restores inheritance after reset (${route})`, async () => {
    const sampling = await run(["/in.jpg", "-quality", "67", "-sampling-factor", "4:2:0", "-write", "/override.jpg", "+sampling-factor", "/out.jpg"], new Map([["/in.jpg", jpeg("2x1")]]));
    expect(await sampling("/override.jpg")).toBe("2x2,1x1,1x1");
    expect(await sampling("/out.jpg")).toBe("2x1,1x1,1x1");
  });

  it(`retains each source sampling in scene outputs (${route})`, async () => {
    const sampling = await run(["/a.jpg", "/b.jpg", "-quality", "67", "-write", "/copy-%d.jpg", "/out-%d.jpg"], new Map([["/a.jpg", jpeg("2x1")], ["/b.jpg", jpeg("1x1")]]));
    for (const prefix of ["copy", "out"]) {
      expect(await sampling(`/${prefix}-0.jpg`)).toBe("2x1,1x1,1x1");
      expect(await sampling(`/${prefix}-1.jpg`)).toBe("1x1,1x1,1x1");
    }
  });
}
