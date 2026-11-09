import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { decodeImage, encodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { createMagickCommand, runConvertCli } from "./index.js";

const base = Buffer.from("R0lGODlhAgABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwAAAAAAgABAAACAgQKACH5BAANAAAALAAAAAACAAEAgAAA/wAAAAICBAoAOw==", "base64");
const profiles = [0, 1].map(frame => Uint8Array.from({ length: 588 }, (_, i) => (i + frame) % 256));
const extension = (profile: Uint8Array) => {
  const bytes = [33, 255, 11, ...new TextEncoder().encode("ICCRGBG1012")];
  for (let at = 0; at < profile.length; at += 255) {
    const part = profile.subarray(at, at + 255);
    bytes.push(part.length, ...part);
  }
  return Uint8Array.of(...bytes, 0);
};
const second = base.indexOf(Buffer.from([33, 249]), base.indexOf(Buffer.from([33, 249])) + 1);
const input = Uint8Array.of(...base.subarray(0, 19), ...extension(profiles[0]!), ...base.subarray(19, second), ...extension(profiles[1]!), ...base.subarray(second));

for (const mode of ["buffered", "retained", "command"]) {
  for (const selected of [false, true]) {
    it.each([false, true])(`preserves per-frame GIF ICC (${mode}, selected=${selected}, strip=%s)`, async strip => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", input);
      const files = new Map([["/in.gif", input]]);
      const args = [selected ? "/in.gif[1]" : "/in.gif", ...(strip ? ["-strip"] : []), "/out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
      for (let page = 0; page < (selected ? 1 : 2); page++) {
        expect(readImageMetadata(output, { page }).icc).toEqual(strip ? undefined : profiles[selected ? 1 : page]);
      }
      if (!selected) expect(readImageMetadata(output).loop).toBe(4);
      expect(readImageMetadata(output).delay).toEqual(selected ? [130] : [70, 130]);
      expect(decodeImage(output, { animated: true }).data).toEqual(decodeImage(base, selected ? { page: 1 } : { animated: true }).data);
      const native = spawnSync("magick", ["identify", "-quiet", "-format", "%[profiles]|", "-"], { input: output, encoding: "utf8" });
      expect(native.status, native.stderr).toBe(0);
      expect(native.stdout).toBe((strip ? "|" : "icc|").repeat(selected ? 1 : 2));
      if (!strip) {
        const extracted = spawnSync("magick", ["-[0]", "icc:-"], { input: output });
        expect(extracted.status).toBe(0);
        expect(new Uint8Array(extracted.stdout)).toEqual(profiles[selected ? 1 : 0]);
      }
    });
  }
}

it("preserves an image-level ICC profile without frame rectangles", () => {
  const image = decodeImage(input, { page: 1 });
  const { data: output } = encodeImage(image, { format: "gif" });
  expect(readImageMetadata(output).icc).toEqual(profiles[1]);
});

it("does not copy the first frame ICC profile onto an unprofiled frame", async () => {
  const bytes = Uint8Array.of(...base.subarray(0, 19), ...extension(profiles[0]!), ...base.subarray(19));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.gif", bytes);
  expect(await runConvertCli(["/in.gif", "/out.gif"], { filesystem: fs, cwd: "/" })).toMatchObject({ exitCode: 0 });
  const output = await fs.readFile("/out.gif");
  expect(readImageMetadata(output, { page: 0 }).icc).toEqual(profiles[0]);
  expect(readImageMetadata(output, { page: 1 }).icc).toBeUndefined();
});
