import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the fourth strength blends selected CMYK alpha,
// independently of black; RGB alpha and single-strength CMYK alpha stay unchanged.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each([
        { space: "CMYK", strength: "0", output: "cmyka", channel: "A", expected: "9933005f80" },
        { space: "CMYK", strength: "50", output: "cmyka", channel: "A", expected: "9933005f80" },
        { space: "CMYK", strength: "0,0,0,100", output: "cmyka", channel: "A", expected: "9933005f40" },
        { space: "CMYK", strength: "0,0,0,100", output: "rgba", channel: "A", expected: "4080a040" },
        { space: "sRGB", strength: "0,0,0,100", output: "rgba", channel: "A", expected: "4080a080" },
        { space: "CMYK", strength: "0,0,0,50", output: "cmyka", channel: "A", expected: "9933005f60" },
        { space: "CMYK", strength: "0,0,0,100", output: "cmyka", channel: "C", expected: "9933005f80" },
    ])(`${mode}: $space colorize $strength, channel $channel into $output`, async ({ space, strength, output, channel, expected }) => {
        const fs = new MemoryFileSystem();
        const argv = ["xc:#4080a080", "-colorspace", space, "-channel", channel, "-fill", "#bf605040", "-colorize", strength,
            "+channel", ...(output === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${output}:-`];
        let exitCode: number, stderr = "", stdout: Uint8Array;
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const chunks: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
            stdout = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout = result.stdoutBytes ?? new Uint8Array();
        }
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.from(stdout).toString("hex")).toBe(expected);
    });
}
