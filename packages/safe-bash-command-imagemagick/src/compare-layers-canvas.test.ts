import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 clips comparisons to the first frame's virtual canvas.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const operation of [["-layers", "CompareAny"], ["-layers", "CompareOverlay"], ["-layers", "CompareClear"], ["-deconstruct"]]) {
        const clearing = operation[1] === "CompareClear";
        it.each([
            { canvas: "4x1", patch: "2x1", offset: "+3+0", frame: "1x1+3+0;", pixels: 1 },
            { canvas: "4x1", patch: "2x1", offset: "+4+0", frame: "", pixels: 0 },
            { canvas: "4x1", patch: "2x1", offset: "-1+0", frame: "1x1+0+0;", pixels: 1 },
            { canvas: "4x1", patch: "2x1", offset: "-2+0", frame: "", pixels: 0 },
            { canvas: "4x1", patch: "2x1", offset: "+1+0", frame: "2x1+1+0;", pixels: 2 },
            { canvas: "1x4", patch: "1x2", offset: "+0+3", frame: "1x1+0+3;", pixels: 1 },
            { canvas: "1x4", patch: "1x2", offset: "+0+4", frame: "", pixels: 0 },
            { canvas: "1x4", patch: "1x2", offset: "+0-1", frame: "1x1+0+0;", pixels: 1 },
            { canvas: "1x4", patch: "1x2", offset: "+0-2", frame: "", pixels: 0 },
            { canvas: "1x4", patch: "1x2", offset: "+0+1", frame: "1x2+0+1;", pixels: 2 },
            { canvas: "4x1", patch: "2x1", offset: "+3+0", frame: "1x1+3+0;", pixels: 1, patchPage: "8x8" },
        ])(`${mode} ${operation.join(" ")} clips $patch at $offset to $canvas`, async ({ canvas, patch, offset, frame, pixels, patchPage }) => {
            for (const output of ["info:", "rgba:-"]) {
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = ["(", "-size", canvas, "xc:red", "-repage", `${canvas}+0+0`, "-set", "dispose", "None", ")",
                    "(", "-size", patch, clearing ? "xc:none" : "xc:blue", "-repage", `${patchPage ?? canvas}${offset}`, "-set", "dispose", "None", ")",
                    ...operation, "-format", "%wx%h%O;", "-depth", "16", "-endian", "MSB", output];
                const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                if (output === "info:") {
                    expect("stdout" in result ? result.stdout : Buffer.concat(chunks).toString()).toBe(`${canvas}+0+0;${frame}`);
                } else {
                    const bytes = mode === "command" ? Buffer.concat(chunks)
                        : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
                    expect(bytes.toString("hex")).toBe("ffff00000000ffff".repeat(4) + (clearing ? "0000000000000000" : "00000000ffffffff").repeat(pixels));
                }
            }
        });
    }
}
