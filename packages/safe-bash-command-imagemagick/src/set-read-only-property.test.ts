import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const [key, expected] of [["k", "24"], ["w", "6"], ["h", "4"], ["n", "1"], ["t", "in"], ["custom:key", "77"]] as const) {
    it(`preserves computed ${key} through ${mode}`, async () => {
      const fixture = new Uint8Array([...new TextEncoder().encode("P6\n6 4\n255\n"), ...Array.from({ length: 72 }, (_, i) => i)]);
      const files = new Map([["/in.ppm", fixture]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.ppm", fixture);
      const args = ["/in.ppm", "-set", key, "77", "-format", `%[${key}]`, "info:"];
      let stdout = "", stderr = "";
      if (mode === "command") {
        expect(await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
          stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
        })).toMatchObject({ exitCode: 0 });
      } else {
        const result = await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        stdout = result.stdout;
        stderr = result.stderr;
      }
      expect(stdout).toBe(expected);
      expect(stderr).toBe(key === "custom:key" ? "" : `magick: attempt to set read-only property '${key}'\n`);
    });
  }
  for (const key of ["width", "height", "size", "HEIGHT", "%[note]"]) {
    it(`warns without storing read-only ${key} through ${mode}`, async () => {
      const fixture = spawnSync("magick", ["-size", "3x2", "xc:#c8591e", "-set", "note", "width", "-set", "comment", "hello", "png:-"]);
      expect(fixture.status).toBe(0);
      const value = key === "size" ? "50x40" : "99";
      const edits = ["-set", key, value, "-set", "note", "new"];
      const native = spawnSync("magick", ["png:-", ...edits, "png:-"], { input: fixture.stdout });
      expect(native.status).toBe(0);
      const expandedKey = key === "%[note]" ? "width" : key;
      expect(native.stderr.toString()).toContain(`attempt to set read-only property \`${expandedKey}'`);
      const files = new Map([["/input.png", new Uint8Array(fixture.stdout)], ["/output.png", new TextEncoder().encode("keep")]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["/input.png", ...edits, "/output.png"];
      let stderr = "";
      if (mode === "command") {
        expect(await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} },
          stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
        })).toMatchObject({ exitCode: 0 });
      } else {
        const result = await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        stderr = result.stderr;
      }
      expect(stderr).toBe(`magick: attempt to set read-only property '${expandedKey}'\n`);
      const output = Buffer.from(mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png"));
      const textKeys: string[] = [];
      for (let offset = 8; offset + 12 <= output.length;) {
        const length = output.readUInt32BE(offset);
        const type = output.toString("ascii", offset + 4, offset + 8);
        if (["tEXt", "zTXt", "iTXt"].includes(type)) {
          textKeys.push(output.subarray(offset + 8, offset + 8 + length).toString().split("\0")[0]!.toLowerCase());
        }
        offset += length + 12;
      }
      for (const name of ["width", "height", "size"]) expect(textKeys).not.toContain(name);
      const properties = spawnSync("magick", ["identify", "-quiet", "-format", "%wx%h|%[note]|%[comment]", "-"], { input: output, encoding: "utf8" });
      expect(properties.status).toBe(0);
      expect(properties.stdout).toBe("3x2|new|hello");
      const pixels = spawnSync("magick", ["-", "-depth", "8", "rgb:-"], { input: output });
      expect(pixels.status).toBe(0);
      expect([...pixels.stdout]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
    });
  }
}
