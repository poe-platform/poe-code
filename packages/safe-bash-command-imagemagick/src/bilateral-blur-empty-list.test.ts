import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects empty lists at -bilateral-blur, before later inputs.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "empty group", "after input", "without filter"])(`requires an image at bilateral-blur (%s, ${mode})`, async placement => {
        const images = ["in.ppm"];
        const args = placement === "before input" ? ["-bilateral-blur", "3x3+64+1", ...images]
            : placement === "after delete" ? ["xc:red", "-delete", "0", "-bilateral-blur", "3x3+64+1", "in.ppm"]
            : placement === "empty group" ? ["xc:red", "(", "-bilateral-blur", "3x3+64+1", "in.ppm", ")", "+append"]
            : placement === "without filter" ? images : [...images, "-bilateral-blur", "3x3+64+1"];
        args.push("-depth", "8", "rgb:-");
        const filesystem = new MemoryFileSystem();
        const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
        const files = new Map([["in.ppm", input]]);
        await filesystem.writeFile("/in.ppm", input);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        const empty = placement !== "after input" && placement !== "without filter";
        expect.soft(exitCode).toBe(empty ? 1 : 0);
        expect.soft(stderr).toBe(empty ? "magick: no images found for operation '-bilateral-blur'\n" : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(empty ? "" : placement === "without filter" ? "0a141e5a6e82" : "14202b506275");
    });
}
