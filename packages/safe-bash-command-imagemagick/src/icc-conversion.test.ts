import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createIccConversion } from "./icc-conversion.js";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runCompareCli } from "./index.js";
import fixtures from "./icc-conversion-fixtures.json" with { type: "json" };

// Ghostscript profiles; expected pixels from ImageMagick 7 with Little CMS.
for (const mode of ["buffered", "sync", "retained", "command"]) {
  for (const [target, expected] of [["srgb.icc", "ff00002080400000ff"], ["a98.icc", "db00004d7f460000fa"], ["default_gray.icc", "828282707070464646"]]) {
    it(`converts ICC pixels and embeds ${target}, ${mode}`, async () => {
      const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, new Uint8Array(Buffer.from(bytes, "base64"))]));
      files.set("in.ppm", new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex")));
      const filesystem = new MemoryFileSystem();
      for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
      const args = ["in.ppm", "-profile", "srgb.icc", "-profile", target!, "out.png"];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
      const image = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
      // Normalize Q16 samples as ImageMagick does when exporting at depth 8.
      const rgb = image.data16 ? Uint8Array.from(image.data16, value => Math.round(value / 257)) : image.data;
      expect(Buffer.from(rgb.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(expected);
      expect(image.icc).toEqual(files.get(target!));
      if (target === "default_gray.icc") expect(image.space).toBe("b-w");
    });
  }
}

it("preserves alpha and uses high-depth samples without modifying the source", () => {
  const source = new Uint8Array(Buffer.from(fixtures["srgb.icc"], "base64"));
  const target = new Uint8Array(Buffer.from(fixtures["a98.icc"], "base64"));
  const decoded = decodeImage(new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex")));
  const input = { ...decoded, hasAlpha: true, data16: Uint16Array.from(decoded.data, value => value * 257) };
  input.data[3] = 73;
  input.data16[3] = 18700;
  const original = input.data.slice();
  const conversion = createIccConversion(source, target)!;
  const steps = conversion.apply(input);
  let step = steps.next();
  try { while (!step.done) step = steps.next(); } finally { conversion.close(); }
  expect(step.value.data[3]).toBe(73);
  expect(step.value.data16![3]).toBe(18700);
  expect(step.value.data.slice(0, 3)).toEqual(Uint8Array.of(219, 0, 0));
  expect(input.data).toEqual(original);
});

it("rejects out-of-bounds ICC tags", () => {
  const source = new Uint8Array(Buffer.from(fixtures["srgb.icc"], "base64"));
  const target = new Uint8Array(Buffer.from(fixtures["a98.icc"], "base64"));
  new DataView(target.buffer).setUint32(136, target.length);
  expect(() => createIccConversion(source, target)).toThrow("invalid or unsupported ICC");
});

for (const mode of ["buffered", "retained"]) {
  it(`converts profiles in compare's image stack, ${mode}`, async () => {
    const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, new Uint8Array(Buffer.from(bytes, "base64"))]));
    files.set("in.ppm", new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex")));
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const result = await runCompareCli(["-metric", "AE", "in.ppm", "in.ppm", "-profile", "srgb.icc", "-profile", "a98.icc", "diff.png"], mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr.trim()).toBe("0 (0)");
    const output = decodeImage(mode === "buffered" ? files.get("diff.png")! : await filesystem.readFile("/diff.png"));
    expect(output.icc).toEqual(files.get("a98.icc"));
  });

  it(`keeps the existing output when profile conversion fails, ${mode}`, async () => {
    const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, new Uint8Array(Buffer.from(bytes, "base64"))]));
    files.set("in.ppm", new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex")));
    files.set("out.png", Uint8Array.of(42));
    new DataView(files.get("a98.icc")!.buffer).setUint32(136, 0xffffffff);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const result = await runConvertCli(["in.ppm", "-profile", "srgb.icc", "-profile", "a98.icc", "out.png"], mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(mode === "buffered" ? files.get("out.png") : await filesystem.readFile("/out.png")).toEqual(Uint8Array.of(42));
  });
}
