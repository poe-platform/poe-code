import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: commas end offset parsing without moving the bands.
const cases = [
    ...["+1", "+1,", "+1,+1", "+1,+2", "(+1),", " +1 , +1"].map(geometry => ({
        geometry, hash: "8ddb05505cd3ec6e2795e0ce79344b25a19dd07f465559eb0f59dacac0ddac9b",
    })),
    ...["-1", "-1,", "-1,-1"].map(geometry => ({
        geometry, hash: "1bb5c978b54991a8a118f2093ab7b73b2c501f732d85b1433515980cd3edd58d",
    })),
    ...["+1+1", "+1+1,"].map(geometry => ({
        geometry, hash: "ef59f17326cb16862384c8ae29f5076bbd07be02e89c3e83a1c455ffaded96e9",
    })),
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: preserves splice offsets before the comma in $geometry`, async ({ geometry, hash }) => {
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from({ length: 36 }, (_, i) => (17 * i + 3) % 256)]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-splice", geometry, "-depth", "8", "rgb:-"];
        const args = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(output).toHaveLength(144);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
