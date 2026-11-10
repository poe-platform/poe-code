import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the unchanged-plane controls.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["HSL", "R", "Associate", 0x04],
        ["HSL", "R", "Disassociate", 0x1f],
        ["Lab", "R", "Associate", 0x21],
        ["Lab", "R", "Disassociate", 0xec],
        ["CMYK", "K", "Associate", 0x30],
        ["CMYK", "K", "Disassociate", 0xff],
        ["HSL", "R", "", 0x0c],
        ["Lab", "R", "", 0x59],
        ["CMYK", "K", "", 0x7f],
        ["sRGB", "R", "Associate", 0x30],
    ] as const)(`${execution}: %s %s alpha %s`, async (space, channel, mode, expected) => {
        const argv = ["xc:#80402860", "-colorspace", space, ...(mode ? ["-alpha", mode] : []),
            "-channel", channel, "-separate", "+channel", "+append", "-depth", "8", "gray:out"];
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["out", keep]]);
        await fs.writeFile("/out", keep);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect([...(execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!)]).toEqual([expected]);
    });
}
