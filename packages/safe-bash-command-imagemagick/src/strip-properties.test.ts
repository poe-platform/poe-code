import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 retains these scalar properties but removes comments.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const montage of [false, true]) {
    it.each([
      { key: "label", value: "label123", strip: true },
      { key: "caption", value: "caption123", strip: true },
      { key: "custom", value: "abc", strip: true },
      { key: "comment", value: "comment123", strip: true },
      { key: "label", value: "label123", strip: false }
    ])(`handles $key with strip=$strip (${mode}, montage=${montage})`, async ({ key, value, strip }) => {
      const files = new Map<string, Uint8Array>();
      if (montage) files.set("/input.png", encodeImage({
        width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png",
        space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
        properties: { [key]: value }
      }, { format: "png" }).data);
      const args = [
        ...(montage ? ["montage", "/input.png"] : ["xc:red", "-set", key, value]),
        ...(strip ? ["-strip"] : []), "-format", `%[${key}]`,
        ...(montage ? ["-identify", "/out.png"] : ["info:"])
      ];
      const fs = new MemoryFileSystem();
      for (const [name, bytes] of files) await fs.writeFile(name, bytes);
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
        .toEqual({
          exitCode: 0,
          stdout: key === "comment" && strip ? "" : value,
          stderr: key === "comment" && strip && !montage ? "magick: unknown image property '%[comment]'\n" : ""
        });
    });
  }
}
