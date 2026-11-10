import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI, complete CMYK bytes after restoring the range.
    it.each([
        { channel: "K", selection: "mask", expected: "7d5f00761e430040000e2535" },
        { channel: "K", selection: "region", expected: "7d5f00761e430040000e2535" },
        { channel: "K", selection: "none", expected: "7d5f00401e430040000e2535" },
        { channel: "C", selection: "mask", expected: "7d5f00761e430076000e2535" },
        { channel: "C", selection: "region", expected: "7d5f00761e430076000e2535" },
        { channel: "C", selection: "none", expected: "405f00761e430076000e2535" },
    ])(`${mode}: clamps $channel ink with $selection selection`, async ({ channel, selection, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const mask = Uint8Array.from(Buffer.from("50350a3320310a3235350aff00ff", "hex"));
        await fs.writeFile("/mask.pgm", mask);
        files.set("/mask.pgm", mask);
        const args = ["xc:#465689", "xc:#796589", "xc:#cabfad", "+append", "-colorspace", "CMYK",
            "-channel", channel, "-evaluate", "multiply", "4",
            ...(selection === "mask" ? ["-write-mask", "/mask.pgm"] : selection === "region" ? ["-region", "1x1+1+0"] : []),
            "-clamp", "+write-mask", "+region", "-evaluate", "divide", "4", "+channel", "-depth", "8", "cmyk:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
