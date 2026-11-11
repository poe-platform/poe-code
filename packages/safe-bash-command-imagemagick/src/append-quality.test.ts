import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
  for (const join of [[], ["+append"], ["-append"], ["+smush", "0"], ["-smush", "0"]]) {
    it.each([false, true])(`${mode} ${join.join(" ")} preserves first-image JPEG quality (override: %s)`, async override => {
      const files = new Map([["/in.ppm", input]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.ppm", input);
      const argumentValues = createCommandArguments([
        "-respect-parentheses", "(", "/in.ppm", "-quality", "87", ")",
        ...(join.length ? ["(", "/in.ppm", "-quality", "40", ")", ...join] : []),
        ...(override ? ["-quality", "92"] : []),
        "-write", "/out.jpg", "-format", "%[quality]", "-write", "info:", "/final.jpg",
      ]);
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
        : await runMagickCli(argumentValues.args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect("stdout" in result ? result.stdout : stdout).toBe(override ? "92" : "87");
      for (const path of ["/out.jpg", "/final.jpg"]) {
        const jpeg = Buffer.from(mode === "sync" || mode === "map" ? files.get(path)! : await fs.readFile(path));
        const marker = jpeg.indexOf(Buffer.from([0xff, 0xdb]));
        expect(marker).toBeGreaterThan(0);
        // Native ImageMagick's first eight luminance quantizers, in JPEG file order.
        expect(jpeg.subarray(marker + 5, marker + 13).toString("hex")).toBe(override ? "0302020202020302" : "0403030403030404");
      }
    });
  }
}
