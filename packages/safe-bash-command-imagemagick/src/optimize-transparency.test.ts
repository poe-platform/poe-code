import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: 3x1 red, then red/red/blue; delays 8/13 and loop 4.
const input = Buffer.from("R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAANAAAALAAAAAADAAEAgP8AAAAA/wICBFIAOw==", "base64");
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([0, 1, 2, 3])(`${mode} preserves playback and geometry with disposal %i`, async (disposal) => {
    const fixture = Buffer.from(input);
    for (let at = fixture.indexOf(Buffer.from([33, 249, 4])); at !== -1; at = fixture.indexOf(Buffer.from([33, 249, 4]), at + 1)) fixture[at + 3] = disposal << 2;
    const files = new Map<string, Uint8Array>([["in.gif", fixture]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", fixture);
    const args = ["in.gif[0,1,1]", "-layers", "OptimizeTransparency", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const output = decodeImage(bytes, { animated: true });
    const original = decodeImage(fixture, { animated: true });
    expect(output.data).toEqual(new Uint8Array([...original.data, ...original.data.subarray(12)]));
    expect(output.delay).toEqual([80, 130, 130]);
    expect(output.loop).toBe(original.loop);
    for (const page of [0, 1, 2]) {
      expect(decodeImage(bytes, { page, coalesce: false })).toMatchObject({ width: 3, height: 1, virtualCanvas: { x: 0, y: 0 } });
    }
    if (disposal < 2) expect([...decodeImage(bytes, { page: 2, coalesce: false }).data].filter((_, index) => index % 4 === 3)).toEqual([0, 0, 0]);
    expect([...decodeImage(bytes, { page: 1, coalesce: false }).data].map((value, index, data) => data[index - index % 4 + 3] === 0 ? 0 : value)).toEqual(disposal < 2 ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255] : [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  });
}


// Native ImageMagick 7: compare against the canvas after the preceding disposal.
const patches = [
  ["None", "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAoQLACH5BAQDAAAALAEAAAABAAEAgAAA/wAAAAICRAEAIfkEBAMAAAAsAAAAAAMAAQCA/wAAAAD/AgJEUAA7", [0, 0, 0]],
  ["Background", "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAoQLACH5BAgDAAAALAEAAAABAAEAgAAA/wAAAAICRAEAIfkEBAMAAAAsAAAAAAMAAQCA/wAAAAD/AgJEUAA7", [0, 255, 0]],
  ["Previous", "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAoQLACH5BAwDAAAALAEAAAABAAEAgAAA/wAAAAICRAEAIfkEBAMAAAAsAAAAAAMAAQAAAgKECwA7", [0, 0, 0]],
  ["transparent full canvas", "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQEAwAAACwAAAAAAwABAAACAoQLACH5BAUDAAAALAAAAAADAAEAgAAAAAAA/wICRFAAIfkEBAMAAAAsAAAAAAMAAQCA/wAAAAD/AgJEUAA7", [0, 0, 0]],
] as const;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(patches)(`${mode} compares the composed canvas after %s`, async (_name, encoded, alpha) => {
    const fixture = Buffer.from(encoded, "base64");
    const files = new Map<string, Uint8Array>([["in.gif", fixture]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", fixture);
    const args = ["in.gif", "-layers", "OptimizeTransparency", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const original = decodeImage(fixture, { animated: true });
    const output = decodeImage(bytes, { animated: true });
    expect(output.data).toEqual(original.data);
    expect(output.delay).toEqual(original.delay);
    expect(output.loop).toBe(original.loop);
    for (const page of [0, 1, 2]) {
      const before = decodeImage(fixture, { page, coalesce: false });
      const after = decodeImage(bytes, { page, coalesce: false });
      expect(after).toMatchObject({ width: before.width, height: before.height, virtualCanvas: before.virtualCanvas, disposal: before.disposal });
    }
    expect([...decodeImage(bytes, { page: 2, coalesce: false }).data].filter((_, i) => i % 4 === 3)).toEqual(alpha);
  });
}

// Native ImageMagick 7.1.2-35: clearing protection exposes the resulting alpha.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { name: "white write mask", size: "1x1", protection: ["-write-mask", "xc:white"], clear: "+write-mask", optimize: true, expected: "ff0000ffff0000ff" },
    { name: "black write mask", size: "1x1", protection: ["-write-mask", "xc:black"], clear: "+write-mask", optimize: true, expected: "ff0000ffff000000" },
    { name: "active region", size: "2x1", protection: ["-region", "1x1+0+0"], clear: "+region", optimize: true, expected: "ff0000ffff0000ffff000000ff0000ff" },
    { name: "region without optimization", size: "2x1", protection: ["-region", "1x1+0+0"], clear: "+region", optimize: false, expected: "ff0000ffff0000ffff0000ffff0000ff" },
  ])(`${mode} respects $name`, async ({ size, protection, clear, optimize, expected }) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const args = ["-size", size, "xc:red", "(", "xc:red", ...protection, ")", ...(optimize ? ["-layers", "OptimizeTransparency"] : []), clear, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(chunk); } }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks) : Buffer.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
    expect(output.toString("hex")).toBe(expected);
  });
}
