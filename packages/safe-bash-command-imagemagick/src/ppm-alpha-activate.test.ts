import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: PPM has no stored alpha to reactivate.
const inputs = [
    { name: "P3", bytes: Buffer.from("P3\n1 1\n255\n52 86 120\n") },
    { name: "P6", bytes: Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from("345678", "hex")]) },
];
const cases = [
    { options: ["-alpha", "activate"], hex: "34567800" },
    { options: ["-alpha", "set"], hex: "345678ff" },
    { options: ["-alpha", "off"], hex: "345678ff" },
    { options: [], hex: "345678ff" },
    { options: ["-alpha", "set", "-alpha", "deactivate", "-alpha", "activate"], hex: "345678ff" },
];

for (const mode of ["memory", "retained", "command"] as const) {
    for (const input of inputs) {
        it.each(cases)(`${mode} ${input.name}: $options`, async ({ options, hex }) => {
            const files = new Map([["/in.ppm", input.bytes]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input.bytes);
            const args = ["/in.ppm", ...options, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
            if (mode === "command") {
                const output: Uint8Array[] = [], errors: Uint8Array[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args,
                    cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { output.push(bytes.slice()); } },
                    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(errors).toString()).toBe("");
                expect(Buffer.concat(output).toString("hex")).toBe(hex);
            } else {
                expect(await runConvertCli(args, mode === "memory" ? files : { filesystem: fs, cwd: "/" }))
                    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
                expect(Buffer.from(mode === "memory" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(hex);
            }
        });
    }
}
