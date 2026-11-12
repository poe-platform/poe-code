import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output, with raw CMYKA preserving separate ink and alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["A", "10%,20%,30%,40%,80%", "904d006300", "904d006380"],
        ["A", "10%,20%,30%,40%,40%", "904d006380", "904d0063ff"],
        ["K", "10%,20%,30%,40%,80%", "904d000080", "904d006380"],
        ["K", "10%,20%,30%,40%,40%", "904d000080", "904d006380"],
        ["CMYKA", "10%,20%,30%,40%,80%", "904d000000", "ffff006380"],
        ["CMYKA", "10%,20%,30%,40%,40%", "904d000080", "ffff0063ff"],
        ["A", "10%,20%,30%,80%", "904d006300", "904d006380"],
        ["A", "35%", "904d006300", "904d006380"],
        ["A", "20000,30000,40000,50000,10000", "904d006300", "904d006380"],
    ] as const)(`${mode}: CMYK %s thresholds %s`, async (channel, threshold, black, white) => {
        for (const [operator, expected] of [["-black-threshold", black], ["-white-threshold", white]] as const) {
            const argv = ["xc:#446d9c80", "-colorspace", "CMYK", "-channel", channel, operator, threshold, "+channel", "-depth", "8", "cmyka:/out"];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
