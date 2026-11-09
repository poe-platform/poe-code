import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Distinct RGBA pixels in a 5x3 PNG with EXIF RightTop orientation.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAYAAABbNsX4AAAAGmVYSWZJSSoACAAAAAEAEgEDAAEAAAAGAAAAAAAAALdIESkAAABKSURBVHicAT8AwP8ABj51rTdupt1nn9YNl88GPsj/N24A+DBnnihgl89ZkMj/icH4L7nxKGAA6iFZkBpRicBKgrnxe7LqIaviGlG+uB9K4cQBrAAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "sync", "retained", "command"]) {
  it.each([
    ["-strip", "-auto-orient"],
    ["-auto-orient", "-strip"],
    ["-strip", "-auto-orient", "-auto-orient"],
    ["+profile", "exif", "-auto-orient"]
  ])(`preserves stripped orientation for pixel transforms (${mode}): %j`, async (...options) => {
    const files = new Map([["/input.png", input as Uint8Array]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", ...options, "-write", "PNG32:/snapshot.png", "PNG32:/output.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const native = spawnSync("magick", ["-", ...options, "PNG32:-"], { input });
    expect(native.status, native.stderr.toString()).toBe(0);
    const expected = decodeImage(native.stdout);
    expect(expected).toMatchObject({ width: 3, height: 5, orientation: 1 });
    expect(Array.from(expected.data.subarray(0, 4))).toEqual([234, 33, 89, 144]);
    for (const path of ["/snapshot.png", "/output.png"]) {
      const output = mode === "buffered" || mode === "sync" ? files.get(path)! : await fs.readFile(path);
      expect(decodeImage(output)).toMatchObject({ width: 3, height: 5, orientation: 1, data: expected.data });
      if (options.includes("-strip")) expect(new TextDecoder("latin1").decode(output)).not.toContain("eXIf");
    }
  });
}
