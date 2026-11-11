import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI discards disassociated alpha even at zero sigma.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const)
for (const geometry of [undefined, "2x1+0", "2x0+0"])
it.each(["disassociate", "deactivate", "off", "associate", "discrete"])(
    `${mode}: reactivates %s alpha after motion blur ${geometry ?? "control"}`,
    async alpha => {
        const args = ["-size", "5x3", "xc:#20406080", "-alpha", alpha,
            ...(geometry ? ["-motion-blur", geometry] : []),
            "-alpha", "activate", "-format", "%[fx:p{2,1}.a]", "info:"];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(
            alpha === "off" || alpha === "disassociate" && geometry !== undefined ? "0" : "0.501961"
        );
    }
);
