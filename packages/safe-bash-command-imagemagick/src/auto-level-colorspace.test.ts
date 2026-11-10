import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI references, including alpha and sRGB controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { space: "HSL", channel: [], hex: "6753d00096131361152c6430" },
        { space: "HSL", channel: ["-channel", "R"], hex: "a8c040209020206070202040" },
        { space: "Lab", channel: [], hex: "d390df00e700a86f825e5338" },
        { space: "Lab", channel: ["-channel", "R"], hex: "cdffff202e0049600b536340" },
        { space: "sRGB", channel: [], hex: "3399ff008000b36600668033" },
        { space: "sRGB", channel: ["-channel", "R"], hex: "6680c020ff20906000607040" },
    ])(`matches native automatic levels via ${mode}: $space $channel`, async ({ space, channel, hex }) => {
        const fs = new MemoryFileSystem();
        const sentinel = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", sentinel);
        const files = new Map([["/out", sentinel]]);
        const input = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("4080c0207020906020607040", "hex")]);
        await fs.writeFile("/in.pam", input);
        files.set("/in.pam", input);
        const args = ["/in.pam", "-colorspace", space, ...channel, "-auto-level", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
