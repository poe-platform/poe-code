import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, exported CMYK8 bytes.
const inks = Buffer.from("0a14283c28496b91526c8033a7722431a912903012492786", "hex");
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const coder of ["pam", "cmyk"]) {
    it.each([
        { operation: ["-filter", "point", "-resize", "2x1!"], expected: "a772243112492786" },
        { operation: ["-filter", "point", "-resize", "6x2!"], expected: "0a14283c0a14283c28496b9128496b91526c8033526c8033a7722431a7722431a9129030a91290301249278612492786" },
        { operation: ["-resize", "2x1!"], expected: "6238474546496861" },
        { operation: ["-rotate", "90"], expected: "a77224310a14283ca912903028496b9112492786526c8033" },
    ])(`${mode}, ${coder}: preserves native inks for $operation`, async ({ operation, expected }) => {
        const input = coder === "pam" ? Buffer.concat([
            Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), inks,
        ]) : inks;
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in", input]]);
        await fs.writeFile("/in", input);
        const argv = ["-size", "3x2", "-depth", "8", `${coder}:/in`, ...operation, "-depth", "8", "cmyk:-"];
        const argumentValues = createCommandArguments(argv), stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const coder of ["pam", "cmyka"]) {
    it(`${mode}, ${coder}: resizes 16-bit inks independently of alpha and black`, async () => {
        const inks = Buffer.from("1111222233334444ffff23454567678989ab00005555666677778888ffff123456789abc00008001", "hex");
        const input = coder === "pam" ? Buffer.concat([
            Buffer.from("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 5\nMAXVAL 65535\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"), inks,
        ]) : inks;
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in", input]]);
        await fs.writeFile("/in", input);
        const argv = ["-size", "4x1", "-depth", "16", "-endian", "MSB", `${coder}:/in`, "-filter", "point", "-resize", "2x1!", "cmyka:-"];
        const argumentValues = createCommandArguments(argv), stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
        expect(Buffer.from(output).toString("hex")).toBe("00000000000000000000123456789abc00008001");
    });
}
