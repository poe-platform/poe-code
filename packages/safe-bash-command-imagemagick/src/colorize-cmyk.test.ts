import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: C,M,Y,K,A bytes, or R,G,B,A after sRGB conversion.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["K", "0", false, "9933005f80"],
        ["K", "50", false, "9933003080"],
        ["K", "0,0,0,100", false, "9933000080"],
        ["K", "0,0,0,100", true, "66ccff80"],
        ["A", "50", false, "9933005f80"],
    ] as const)(`${mode}: colorize channel %s by %s (sRGB=%s)`, async (channel, strength, rgb, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#4080a080", "-colorspace", "CMYK", "-channel", channel,
            "-fill", "#bf605040", "-colorize", strength, "+channel",
            ...(rgb ? ["-colorspace", "sRGB"] : []), "-depth", "8",
            `${rgb ? "rgba" : "cmyka"}:${mode === "command" ? "-" : "/out"}`];
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? stdout : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
