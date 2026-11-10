import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Exact output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "Copy exports opaque RGBA", options: ["-alpha", "Copy", "-depth", "8"], target: "rgba:/out", hex: "805020ff" },
    { name: "Extract recovers the copied mask", options: ["-alpha", "Copy", "-alpha", "extract", "-endian", "MSB", "-depth", "16"], target: "gray:/out", hex: "5715" },
    { name: "Activate exports the copied mask", options: ["-alpha", "Copy", "-alpha", "Activate", "-depth", "8"], target: "rgba:/out", hex: "80502057" },
    { name: "Shape exports its active mask", options: ["-alpha", "Shape", "-depth", "8"], target: "rgba:/out", hex: "ffffff57" },
    { name: "unchanged alpha is exported", options: ["-depth", "8"], target: "rgba:/out", hex: "80502080" },
    { name: "raw write preserves the copied mask for Extract", options: ["-alpha", "Copy", "-endian", "MSB", "-depth", "16", "-write", "rgba:/opaque", "-alpha", "extract"], target: "gray:/out", hex: "5715" },
    { name: "raw write preserves the copied mask for Activate", options: ["-alpha", "Copy", "-depth", "8", "-write", "rgba:/opaque", "-alpha", "Activate"], target: "rgba:/out", hex: "80502057" },
];

for (const mode of ["memory", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ options, target, hex }) => {
        const files = new Map([["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["xc:#80502080", ...options, target];
        if (mode === "command") {
            const errors: Uint8Array[] = [], output: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args,
                cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { output.push(bytes.slice()); } },
                stderr: { async write(bytes) { errors.push(bytes.slice()); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(errors).toString()).toBe("");
            expect(Buffer.concat(output).toString()).toBe("");
        } else {
            expect(await runConvertCli(args, mode === "memory" ? files : { filesystem: fs, cwd: "/" }))
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        expect(Buffer.from(mode === "memory" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(hex);
        if (options.includes("-write")) {
            expect(Buffer.from(mode === "memory" ? files.get("/opaque")! : await fs.readFile("/opaque")).toString("hex")).toBe(options.includes("16") ? "808050502020ffff" : "805020ff");
        }
    });
}
