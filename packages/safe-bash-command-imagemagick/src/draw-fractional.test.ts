import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps the middle blue sample at 32767.5.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const draw of ["", "point 1,0", "point 3,3", "rectangle 1,0 1,0"])
for (const filtered of [false, true])
it(`${mode}: preserves fractional samples with '${draw}' (filtered=${filtered})`, async () => {
    const argv = ["-size", "2x3", "gradient:#334411-#77aaee", "-fill", "red",
        ...(draw ? ["-draw", draw] : []),
        ...(filtered ? ["-statistic", "Gradient", "1x2", "-depth", "8", "rgb:-"]
            : ["-precision", "14", "-format", "%[fx:p{0,1}.b*65535]", "info:"])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    if (filtered) {
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(draw && draw !== "point 3,3"
            ? "00000000000022336faa778022336f22336f" : "00000000000022336f22336f22336f22336f");
    } else {
        expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe("32767.5");
    }
});
