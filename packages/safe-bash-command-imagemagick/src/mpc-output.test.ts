import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const output of ["saved.mpc", "mpc:saved.mpc"]) for (const write of ["final", "-write", "+write"]) {
    it(`writes a persistent pixel cache in ${mode} using ${output}, ${write}`, async () => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const run = async (args: string[]) => {
        if (mode === "sync") return runMagickCliSync(args, files);
        if (mode !== "command") return runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        return { ...result, stdout, stderr };
      };
      const read = (path: string) => mode === "sync" || mode === "buffered" ? files.get(path)! : filesystem.readFile(`/${path}`);
      expect(await run(["xc:red", "xc:blue", "+append", "-set", "label", "tile", ...(write === "final" ? [output] : [write, output, "null:"])])).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
      const descriptor = new TextDecoder().decode(await read("saved.mpc"));
      expect(descriptor).toMatch(/^id=MagickPixelCache\n/);
      expect(descriptor).toContain("label=tile");
      const cache = await read("saved.cache");
      expect(cache.length).toBe(24);
      const samples = new DataView(cache.buffer, cache.byteOffset, cache.byteLength);
      expect(Array.from({ length: 6 }, (_, i) => samples.getFloat32(i * 4, true))).toEqual([65535, 0, 0, 0, 0, 65535]);
      expect(await run(["mpc:saved.mpc", "-depth", "8", "rgb:result.rgb"])).toMatchObject({ exitCode: 0, stderr: "" });
      expect([...(await read("result.rgb"))]).toEqual([255, 0, 0, 0, 0, 255]);
    });
  }
}

it("preserves alpha and labels when rereading an intermediate cache", async () => {
  for (const retained of [false, true]) {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const result = await runMagickCli(["xc:#12345680", "-set", "label", "tile with spaces", "-write", "MPC:tile.bin", "+delete", "MPC:tile.bin", "-depth", "8", "rgba:out.rgb"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect([...(retained ? await filesystem.readFile("/out.rgb") : files.get("out.rgb")!)]).toEqual([18, 52, 86, 128]);
    const descriptor = retained ? await filesystem.readFile("/tile.bin") : files.get("tile.bin")!;
    expect(new TextDecoder().decode(descriptor)).toContain("label={tile with spaces}");
  }
});

// Native ImageMagick 7.1.2-31 Q16-HDRI, `magick xc:red xc:blue +append -set label tile native.mpc`.
const nativeDescriptor = new TextEncoder().encode("id=MagickPixelCache\nmagick-signature=762599890\nclass=DirectClass colors=0 alpha-trait=Undefined\nnumber-channels=3 number-meta-channels=0 channel-mask=0x0000000007ffffff\ncolumns=2 rows=1 depth=16\ncolorspace=sRGB\npage=1x1+0+0\nrendering-intent=Perceptual\ngamma=0.454545\nred-primary=0.64,0.33 green-primary=0.3,0.6 blue-primary=0.15,0.06\nwhite-point=0.3127,0.329\nlabel=tile\n\f\n:\x1a");
const nativeCache = Uint8Array.from([0, 255, 127, 71, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 127, 71]);
for (const retained of [false, true]) {
  it(`reads native MPC pixels and metadata, retained=${retained}`, async () => {
    const files = new Map([["native.mpc", nativeDescriptor], ["native.cache", nativeCache]]), filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const input = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli(["native.mpc", "-format", "%[label]", "info:"], input)).toMatchObject({ exitCode: 0, stdout: "tile", stderr: "" });
    expect(await runMagickCli(["native.mpc", "-depth", "8", "rgb:out.rgb"], input)).toMatchObject({ exitCode: 0, stderr: "" });
    expect([...(retained ? await filesystem.readFile("/out.rgb") : files.get("out.rgb")!)]).toEqual([255, 0, 0, 0, 0, 255]);
  });
  for (const cache of [undefined, nativeCache.slice(0, 20)]) {
    it(`rejects ${cache ? "truncated" : "missing"} caches, retained=${retained}`, async () => {
      const files = new Map([["native.mpc", nativeDescriptor]]), filesystem = new MemoryFileSystem();
      if (cache) files.set("native.cache", cache);
      for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
      const message = cache ? "Truncated MPC pixel cache" : "Missing MPC pixel cache";
      if (retained) await expect(runMagickCli(["native.mpc", "out.png"], { filesystem, cwd: "/" })).rejects.toThrow(message);
      else {
        const result = await runMagickCli(["native.mpc", "out.png"], files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(message);
      }
    });
  }
}

for (const retained of [false, true]) for (const command of ["montage", "compare"]) {
  it(`writes both files from ${command}, retained=${retained}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = command === "montage" ? [command, "xc:red", "xc:blue", "-geometry", "1x1+0+0", "mpc:out.mpc"] : [command, "xc:red", "xc:red", "mpc:out.mpc"];
    const result = await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const descriptor = retained ? await filesystem.readFile("/out.mpc") : files.get("out.mpc")!;
    expect(new TextDecoder().decode(descriptor)).toMatch(/^id=MagickPixelCache\n/);
    expect((retained ? await filesystem.readFile("/out.cache") : files.get("out.cache")!).length).toBeGreaterThan(0);
  });
}
