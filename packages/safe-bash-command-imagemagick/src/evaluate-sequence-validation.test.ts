import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const count of [1, 3]) {
    it.each(["NotReal", "average", "Mean", "mEaN"])(`${mode}: validates %s with ${count} inputs before writing output`, async operation => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const paths: string[] = [];
      for (const pixel of [[36, 104, 172], [176, 76, 40], [64, 48, 32]].slice(0, count)) {
        const path = `/input${paths.length}.png`;
        const bytes = await sharp(Uint8Array.from(pixel), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
        paths.push(path);
      }
      const args = [...paths, "-evaluate-sequence", operation, "/out.png"];
      let stderr = "";
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      if (operation.toLowerCase() === "mean") {
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([...output.data]).toEqual(count === 1 ? [36, 104, 172, 255] : [92, 76, 81, 255]);
      } else {
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain("unrecognized evaluate operator");
        expect(files.has("/out.png")).toBe(false);
        await expect(fs.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
      }
    });
  }
}
