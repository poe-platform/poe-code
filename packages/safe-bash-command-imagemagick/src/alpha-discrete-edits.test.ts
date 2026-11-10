import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete big-endian 16-bit output.
const operations = [
    { operation: ["-solarize", "30%"], extracted: "40407f7f3f3f", activated: "80802020c0c040402020e0e050507f7fd0d0303070703f3f" },
    { operation: ["-negate"], extracted: "bfbf7f7f3f3f", activated: "80802020c0c0bfbf2020e0e050507f7fd0d0303070703f3f" },
    { operation: ["-evaluate", "multiply", "2"], extracted: "8080ffffffff", activated: "80802020c0c080802020e0e05050ffffd0d030307070ffff" },
    { operation: ["-threshold", "50%"], extracted: "0000ffffffff", activated: "80802020c0c000002020e0e05050ffffd0d030307070ffff" },
    { operation: ["-black-threshold", "50%"], extracted: "000000000000", activated: "80802020c0c000002020e0e050500000d0d0303070700000" },
    { operation: ["-gamma", "2"], extracted: "8040b55fde22", activated: "80802020c0c080402020e0e05050b55fd0d030307070de22" },
    { operation: ["-level", "25%,75%"], extracted: "00818101ffff", activated: "80802020c0c000812020e0e050508101d0d030307070ffff" },
    { operation: ["+level", "25%,75%"], extracted: "60208040a060", activated: "80802020c0c060202020e0e050508040d0d030307070a060" },
    { operation: ["-function", "polynomial", "2,0"], extracted: "8080ffffffff", activated: "80802020c0c080802020e0e05050ffffd0d030307070ffff" },
    { operation: ["-sigmoidal-contrast", "4x50%"], extracted: "329780a8ce71", activated: "80802020c0c032972020e0e0505080a8d0d030307070ce71" },
    { operation: ["-brightness-contrast", "10x20"], extracted: "5050a0a0f0f0", activated: "80802020c0c050502020e0e05050a0a0d0d030307070f0f0" },
    { operation: ["-equalize"], extracted: "5555aaaaffff", activated: "80802020c0c055552020e0e05050aaaad0d030307070ffff" },
    { operation: ["-ordered-dither", "o2x2"], extracted: "ffff0000ffff", activated: "80802020c0c0ffff2020e0e050500000d0d030307070ffff" },
    { operation: [], extracted: "40408080c0c0", activated: "80802020c0c040402020e0e050508080d0d030307070c0c0" },
    { operation: ["-channel", "R", "-solarize", "30%"], extracted: "40408080c0c0", activated: "7f7f2020c0c040402020e0e0505080802f2f30307070c0c0" },
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const { alpha, finish } of [
        { alpha: "Discrete", finish: "extract" },
        { alpha: "Discrete", finish: "activate" },
        { alpha: "Deactivate", finish: "extract" },
        { alpha: "On", finish: "extract" },
    ]) {
        it.each(operations)(`${execution}: ${alpha} $operation then ${finish}`, async ({ operation, extracted, activated }) => {
            const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-alpha", alpha,
                "-channel", "A", ...operation, "+channel", "-alpha", finish, "-depth", "16", "-endian", "MSB",
                `${finish === "extract" ? "gray" : "rgba"}:${execution === "command" ? "-" : "/out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const hex = execution === "command" ? stdout
                : Buffer.from(execution === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
            expect(hex).toBe(alpha === "Deactivate" ? "40408080c0c0" : finish === "extract" ? extracted : activated);
        });
    }
}
