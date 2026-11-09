import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native 3×2 PNG64 with a TopLeft orientation tag and nontrivial 16-bit samples.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACEAYAAADN5LpZAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTk6MTcrMDA6MDBUMAIsAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjU5OjE3KzAwOjAwJW26kAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1OToxNyswMDowMHJ4m08AAAABb3JOVAHPoneaAAAAJUlEQVQI12PkZOfzEu79/1+UR5RHlIeBAUaz2KvYq9irIARgNAC/RQXBdZLiBQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "command"]) {
  it.each(["RightTop", "right-top", "right_top", "6", "bad"])(`handles orientation %s without changing pixels or invalid destinations (${mode})`, async name => {
    const fs = new MemoryFileSystem();
    const sentinel = Uint8Array.of(1, 2, 3);
    const files = new Map([["/input.png", new Uint8Array(input)], ["/output.png", sentinel]]);
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/input.png", "-orient", name, "PNG64:/output.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    if (name === "6" || name === "bad") {
      expect(result).toMatchObject({ exitCode: 1 });
      expect(output).toEqual(sentinel);
      return;
    }
    expect(result).toMatchObject({ exitCode: 0 });
    expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, orientation: 6,
      data16: decodeImage(input).data16 });
    const native = spawnSync("magick", ["-", "-orient", name, "PNG64:-"], { input });
    expect(native.status, native.stderr.toString()).toBe(0);
    expect(decodeImage(output).data16).toEqual(decodeImage(native.stdout).data16);
    const tag = spawnSync("magick", ["identify", "-format", "%wx%h %[orientation]", "-"], { input: output, encoding: "utf8" });
    expect(tag.status, tag.stderr).toBe(0);
    expect(tag.stdout).toBe("3x2 RightTop");
  });
}
