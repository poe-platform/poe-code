import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI outputs for xc:#446d9c80.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) {
        it.each([
            ["-black-threshold", "20x40+60+80%", false, "446d0000"],
            ["-black-threshold", "20%,40%,60%,80%", false, "446d0000"],
            ["-white-threshold", "20x40+60+80%", false, "ffff9c80"],
            ["-white-threshold", "20%,40%,60%,80%", false, "ffff9c80"],
            ["-black-threshold", "20x40+60+10%", true, "446d9c80"],
            ["-black-threshold", "20%,40%,60%,10%", true, "446d9c80"],
            ["-white-threshold", "35%", false, "ffffff80"],
        ] as const)(`${mode} ${format}: %s %s RGBA=%s`, async (operator, threshold, selected, expected) => {
            const filesystem = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = ["xc:#446d9c80", ...(selected ? ["-channel", "RGBA"] : []), operator, threshold,
                "+channel", "-depth", "8", `${format}:/out`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "rgba" ? output : decodeImage(output).data).toString("hex")).toBe(expected);
        });
    }
}
