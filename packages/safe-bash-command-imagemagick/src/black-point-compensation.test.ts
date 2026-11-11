import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");
const srgb = new Uint8Array(readFileSync(new URL("./fixtures/icc/srgb.icc", import.meta.url)));
const cmyk = new Uint8Array(readFileSync(new URL("./fixtures/icc/default_cmyk.icc", import.meta.url)));

for (const retained of [false, true]) {
  async function convert(options: string[], output = "cmyk:/out.raw", depth = "8", pixels: Uint8Array = input) {
    const files = new Map<string, Uint8Array>([["/in.ppm", pixels], ["/srgb.icc", srgb], ["/cmyk.icc", cmyk]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const result = await runConvertCli(["/in.ppm", ...options, "-depth", depth, output], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    return retained ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
  }

  it.each(["-black-point-compensation", "+black-point-compensation"])(`accepts %s without a profile, retained=${retained}`, async option => {
    expect(await convert([option], "rgb:/out.raw")).toEqual(new Uint8Array(input.subarray(-9)));
  });

  // ImageMagick 7.1.2-35 Q16-HDRI, Ghostscript default_cmyk.icc
  // SHA256: 8472fa1493a024b800b67dee9424835ec0c41ab79490200ae8ec4a689fd1b9a9.
  it.each([
    [[], "00ffff00e544ff26eccc0000"],
    [["-black-point-compensation"], "00ffff00d942ff20e0c40000"],
    [["-black-point-compensation", "+black-point-compensation"], "00ffff00e544ff26eccc0000"]
  ] as const)(`converts ICC colors with compensation %j, retained=${retained}`, async (options, hex) => {
    expect(await convert(["-intent", "relative", ...options, "-profile", "/srgb.icc", "-profile", "/cmyk.icc"]))
      .toEqual(new Uint8Array(Buffer.from(hex, "hex")));
  });

  it.each([
    ["perceptual", "ee5826fd2ce02aa782b244a940895632a57f"],
    ["relative", "ee361d3d243221ff810b3fcb3b0952f9a4a1"],
    ["saturation", "ee5826fd2ce02aa782b244a940895632a57f"],
    ["absolute", "d0342c132d29219280fe42a83487534290a7"]
  ])(`round trips RGB through CMYK at 16 bits with %s intent, retained=${retained}`, async (intent, hex) => {
    expect(await convert(["-intent", intent, "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/cmyk.icc", "-profile", "/srgb.icc", "-endian", "MSB"], "rgb:/out.raw", "16"))
      .toEqual(new Uint8Array(Buffer.from(hex!, "hex")));
  });

  it(`preserves alpha independently of CMYK black, retained=${retained}`, async () => {
    expect(await convert(["-alpha", "set", "-channel", "A", "-evaluate", "set", "25%", "+channel", "-intent", "relative", "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/cmyk.icc"], "cmyka:/out.raw"))
      .toEqual(new Uint8Array(Buffer.from("00ffff0040d942ff2040e0c4000040", "hex")));
  });

  it(`snapshots compensation at each profile operation, retained=${retained}`, async () => {
    const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/srgb.icc", srgb], ["/cmyk.icc", cmyk]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    expect(await runConvertCli(["/in.ppm", "-depth", "8", "-intent", "relative", "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/cmyk.icc", "-write", "cmyk:/on.raw", "+black-point-compensation", "cmyk:/off.raw"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const path of ["/on.raw", "/off.raw"]) expect(retained ? await fs.readFile(path) : files.get(path))
      .toEqual(new Uint8Array(Buffer.from("00ffff00d942ff20e0c40000", "hex")));
  });

  it(`converts across retained chunk boundaries, retained=${retained}`, async () => {
    const pixels = Buffer.concat([Buffer.from("P6\n600 1\n255\n"), ...Array.from({ length: 200 }, () => input.subarray(-9))]);
    const expected = Buffer.concat(Array.from({ length: 200 }, () => Buffer.from("00ffff00d942ff20e0c40000", "hex")));
    expect(await convert(["-intent", "relative", "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/cmyk.icc"], "cmyk:/out.raw", "8", pixels))
      .toEqual(new Uint8Array(expected));
  });

  it(`leaves the destination untouched when the transform profile is invalid, retained=${retained}`, async () => {
    const invalid = cmyk.slice(0, 128);
    const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/srgb.icc", srgb], ["/bad.icc", invalid], ["/out.png", Uint8Array.of(42)]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const result = await runConvertCli(["/in.ppm", "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/bad.icc", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(Uint8Array.of(42));
  });


  it.each([true, false])(`retains per-image compensation across scoped parentheses, before=%s, retained=${retained}`, async before => {
    const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/srgb.icc", srgb], ["/cmyk.icc", cmyk]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const group = before ? ["-black-point-compensation", "/in.ppm"] : ["/in.ppm", "-black-point-compensation"];
    expect(await runConvertCli(["-respect-parentheses", "(", ...group, ")", "-intent", "relative", "-profile", "/srgb.icc", "-profile", "/cmyk.icc", "-depth", "8", "cmyk:/out.raw"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(retained ? await fs.readFile("/out.raw") : files.get("/out.raw"))
      .toEqual(new Uint8Array(Buffer.from("00ffff00d942ff20e0c40000", "hex")));
  });

}


it.each(["sync", "command"])("honors compensation through the public %s entry point", async mode => {
  const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/srgb.icc", srgb], ["/cmyk.icc", cmyk]]);
  const args = ["/in.ppm", "-intent", "relative", "-black-point-compensation", "-profile", "/srgb.icc", "-profile", "/cmyk.icc", "-depth", "8", "cmyk:/out.raw"];
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  let stderr = "";
  const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result, stderr).toMatchObject({ exitCode: 0 });
  expect(mode === "sync" ? files.get("/out.raw") : await fs.readFile("/out.raw"))
    .toEqual(new Uint8Array(Buffer.from("00ffff00d942ff20e0c40000", "hex")));
});
