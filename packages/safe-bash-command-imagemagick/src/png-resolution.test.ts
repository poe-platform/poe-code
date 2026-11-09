import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { encodePngImage } from "@poe-code/image-ast";
import { createMagickCommand, runConvertCli } from "./index.js";

function chunks(bytes: Uint8Array): { name: string; data: Uint8Array; bytes: Uint8Array }[] {
  const result = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
    result.push({ name: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)),
      data: bytes.slice(offset + 8, offset + 8 + length), bytes: bytes.slice(offset, offset + length + 12) });
    offset += length + 12;
  }
  return result;
}

const tagged = encodePngImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
  format: "png", space: "srgb", channels: 4, depth: "uchar", density: 144, hasAlpha: false,
  resolution: { x: 5669, y: 2835, unit: "meter" } });
const untagged = new Uint8Array(Buffer.concat([tagged.subarray(0, 8), ...chunks(tagged).filter(chunk => chunk.name !== "pHYs").map(chunk => chunk.bytes)]));

for (const mode of ["buffered", "command"] as const) {
  it.each(["control", "duplicate", "bad-crc"])(`keeps the first accepted PNG resolution (%s, ${mode})`, async variant => {
    const physical = (x: number, y: number) => chunks(encodePngImage({
      width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false,
      resolution: { x, y, unit: "meter" }
    })).find(chunk => chunk.name === "pHYs")!;
    const first = physical(1000, 2000), second = physical(3000, 4000);
    if (variant === "bad-crc") second.bytes[second.bytes.length - 1]! ^= 1;
    const additions = variant === "control" ? [first.bytes]
      : variant === "duplicate" ? [first.bytes, second.bytes] : [second.bytes, first.bytes];
    const input = new Uint8Array(Buffer.concat([untagged.subarray(0, 33), ...additions, untagged.subarray(33)]));
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "/output.png"];
    let stderr = "";
    const result = mode === "buffered" ? await runConvertCli(args, files)
      : await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } });
    const warning = "stderr" in result ? result.stderr : stderr;
    expect(result.exitCode, String(warning)).toBe(0);
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    expect(chunks(output).filter(chunk => chunk.name === "pHYs").map(chunk => chunk.data)).toEqual([first.data]);
    if (variant === "duplicate") expect(warning).toContain("pHYs: duplicate");
    else if (variant === "bad-crc") expect(warning).toContain("PNG pHYs CRC mismatch");
    else expect(warning).toBe("");
  });
}

for (const mode of ["buffered", "retained", "command"]) {
  for (const present of [false, true]) {
    it.each([[], ["-strip"], ["-define", "png:exclude-chunk=pHYs"], ["-define", "png:exclude-chunk=tEXt,pHYs"]])(
      `writes only applicable PNG resolution (${mode}, present=${present}, %j)`, async (...operation) => {
        const input = present ? tagged : untagged, fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map([["/input.png", input]]);
        const args = ["/input.png", ...operation, "/output.png"];
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
          args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
        expect(chunks(output).filter(chunk => chunk.name === "pHYs").map(chunk => chunk.data))
          .toEqual(present && operation.length === 0 ? chunks(tagged).filter(chunk => chunk.name === "pHYs").map(chunk => chunk.data) : []);
      });
  }
}

it("writes an explicit encoder density even without input resolution", () => {
  const output = encodePngImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255),
    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { density: 144 });
  const physical = chunks(output).find(chunk => chunk.name === "pHYs")!.data;
  expect(new DataView(physical.buffer).getUint32(0)).toBe(5669);
  expect(new DataView(physical.buffer).getUint32(4)).toBe(5669);
  expect(physical[8]).toBe(1);
});

for (const retained of [false, true]) {
  it(`captures chunk exclusion for intermediate and numbered writes (retained=${retained})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", tagged]]);
    await fs.writeFile("/input.png", tagged);
    const result = await runConvertCli(["/input.png", "-define", "png:exclude-chunk=pHYs", "-write", "/excluded.png",
      "-define", "png:exclude-chunk=", "-write", "/preserved.png", "-strip", "/frame-%d.png"],
      retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    for (const [path, present] of [["/excluded.png", false], ["/preserved.png", true], ["/frame-0.png", false]] as const) {
      const output = retained ? await fs.readFile(path) : files.get(path)!;
      expect(chunks(output).some(chunk => chunk.name === "pHYs"), path).toBe(present);
    }
  });
}
