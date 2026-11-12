import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete big-endian 16-bit RGBA output.
const cases = [
    { name: "exact half gray", mask: ["xc:gray(50%)"], expected: "ffffffffffffffffffffffffffffffff" },
    { name: "exact half arithmetic", mask: ["xc:white", "-evaluate", "multiply", "0.5"], expected: "ffffffffffffffffffffffffffffffff" },
    { name: "below half", mask: ["xc:#7fff7fff7fff"], expected: "ffffffffffffffffffffffffffffffff" },
    { name: "above half", mask: ["xc:#800080008000"], expected: "3bdc803cab95812e9e0028035893cf91" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases.flatMap(test => [1, 257].map(width => ({ ...test, width }))))(`${mode}: auto-gamma read mask matches native $name ($width pixels per color)`, async ({ mask, expected, width }) => {
        const argv = [...(width === 1 ? ["xc:#205f9060", "xc:#801238bd", "+append"] : ["/input.pam"]),
            "(", "-size", `${width * 2}x1`, ...mask, "-write", "mpr:m", "+delete", ")",
            "-read-mask", "mpr:m", "-auto-gamma", "+read-mask",
            "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        if (width > 1) {
            // File input has no working samples; the fractional mask still needs bounded reads.
            const input = Buffer.concat([
                Buffer.from(`P7\nWIDTH ${width * 2}\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),
                Buffer.from("205f9060".repeat(width) + "801238bd".repeat(width), "hex"),
            ]);
            files.set("/input.pam", input);
            await fs.writeFile("/input.pam", input);
        }
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected.slice(0, 16).repeat(width) + expected.slice(16).repeat(width));
    });
}
