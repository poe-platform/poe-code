import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const fixtures = [
  { name: "duplicate", png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAgMAAADgGo6JAAAADFBMVEW0eDIeKDK0eDIAyIDny/TkAAAADElEQVR4nGOYwKADAAHgAL3vfbPAAAAAAElFTkSuQmCC", third: [180, 120, 50, 255] },
  { name: "distinct", png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAgMAAADgGo6JAAAADFBMVEW0eDIeKDK1eDIAyIAslydBAAAADElEQVR4nGOYwKADAAHgAL3vfbPAAAAAAElFTkSuQmCC", third: [181, 120, 50, 255] },
];
// Source palette slots at each destination, verified against native ImageMagick.
const transforms = [
  { args: [], indices: [2, 1, 0, 0, 2, 3] },
  { args: ["-flip"], indices: [0, 2, 3, 2, 1, 0] },
  { args: ["-flop"], indices: [0, 1, 2, 3, 2, 0] },
  { args: ["-rotate", "90"], indices: [0, 2, 2, 1, 3, 0] },
  { args: ["-rotate", "180"], indices: [3, 2, 0, 0, 1, 2] },
  { args: ["-rotate", "270"], indices: [0, 3, 1, 2, 2, 0] },
  { args: ["-transpose"], indices: [2, 0, 1, 2, 0, 3] },
  { args: ["-transverse"], indices: [3, 0, 2, 1, 0, 2] },
  { args: ["-crop", "2x2+1+0"], indices: [1, 0, 2, 3] },
  { args: ["-roll", "+1+1"], indices: [3, 0, 2, 0, 2, 1] },
  { args: ["-sample", "2x2!"], indices: [2, 0, 0, 3] },
  { args: ["-chop", "1x0+0+0"], indices: [1, 0, 2, 3] },
];

for (const retained of [false, true]) for (const fixture of fixtures) for (const transform of transforms) {
  it(`cycles ${fixture.name} slots through ${transform.args.join(" ") || "identity"} (retained=${retained})`, async () => {
    const colors = [[180, 120, 50, 255], [30, 40, 50, 255], fixture.third, [0, 200, 128, 255]];
    for (const before of [false, true]) {
      const input = Uint8Array.from(Buffer.from(fixture.png, "base64"));
      const args = ["in.png", ...(before ? ["-cycle", "1", ...transform.args] : [...transform.args, "-cycle", "1"]), "-depth", "8", "rgba:out.rgba"];
      const filesystem = new MemoryFileSystem(), files = new Map([["in.png", input]]);
      await filesystem.writeFile("/in.png", input);
      const result = retained ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
      }) : await runConvertCli(args, files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = retained ? await filesystem.readFile("/out.rgba") : files.get("out.rgba")!;
      expect(Array.from(output), `cycle before=${before}`).toEqual(transform.indices.flatMap(index => colors[(index + 1) % 4]!));
    }
  });
}

// Two-bit indices, duplicate colors and transparency span raster chunks and storage tiles.
const packedPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAABAcAAAADAgMAAACSdI7UAAAADFBMVEX/AAAA/wD/AAAAAP/sfQRUAAAABHRSTlP/gP8AH4eGmQAAABdJREFUeJxjkB7pQIIhZ8QDho0jHWwAAE1jOnxDdRcuAAAAAElFTkSuQmCC", "base64"));
for (const retained of [false, true]) for (const args of [
  ["-flip"], ["-flop"], ["-rotate", "90"], ["-transpose"], ["-transverse"],
  ["-crop", "1001x2+17+1"], ["-roll", "+37+1"], ["-sample", "1027x2!"], ["-chop", "17x1+35+1"],
]) {
  it(`preserves packed transparent slots across chunks for ${args.join(" ")} (retained=${retained})`, async () => {
    const outputs: Uint8Array[] = [];
    for (const before of [true, false]) {
      const files = new Map([["in.png", packedPng]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.png", packedPng);
      const result = await runConvertCli(["in.png", ...(before ? ["-cycle", "1", ...args] : [...args, "-cycle", "1"]), "-depth", "8", "rgba:out.rgba"], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      outputs.push(retained ? await filesystem.readFile("/out.rgba") : files.get("out.rgba")!);
    }
    expect(outputs[1]).toEqual(outputs[0]);
  });
}
