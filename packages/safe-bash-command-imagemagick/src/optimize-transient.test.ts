import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick metadata and RGB playback, including a frame after the restored transition.
for (const trailing of [false, true])
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const disposal of ["Previous", "None"]) {
    for (const options of [[], ["-coalesce", "-layers", "OptimizeFrame"], ["-layers", "Optimize"]]) {
      for (const pixels of [false, true]) {
        if (!pixels && options.length === 0) continue;
        it(`${mode}: transient ${disposal}, ${options.join(" ")}, pixels=${pixels}, trailing=${trailing}`, async () => {
          const filesystem = new MemoryFileSystem();
          const args = ["-size", "1x1", "-delay", "7",
            "(", "xc:red", "-repage", "3x1+0+0", "-set", "dispose", "None", ")",
            "(", "xc:lime", "-repage", "3x1+1+0", "-set", "dispose", disposal, ")",
            "(", "xc:blue", "-repage", "3x1+2+0", "-set", "dispose", "None", ")",
            ...(trailing ? ["(", "xc:yellow", "-repage", "3x1+1+0", "-set", "dispose", "None", ")"] : []),
            ...options, ...(pixels
              ? ["-coalesce", "-background", "white", "-alpha", "remove", "-depth", "8", "rgb:-"]
              : ["-format", "%wx%h:%g:%D:%T;", "info:"])];
          let stdout = "", stderr = "";
          const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += pixels ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
          expect(result.exitCode).toBe(0);
          expect("stderr" in result ? result.stderr : stderr).toBe("");
          if ("stdout" in result && typeof result.stdout === "string") stdout = pixels ? Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()).toString("hex") : result.stdout;
          expect(stdout).toBe(pixels
            ? (disposal === "Previous" ? "ff0000ffffffffffffff000000ff00ffffffff0000ffffff0000ff" : "ff0000ffffffffffffff000000ff00ffffffff000000ff000000ff") + (trailing ? "ff0000ffff000000ff" : "")
            : `3x1:3x1+0+0:None:7;1x1:3x1+1+0:${disposal}:7;1x1:3x1+2+0:${trailing ? "None" : disposal}:7;${trailing ? "1x1:3x1+1+0:None:7;" : ""}`);
        });
      }
    }
  }
}
