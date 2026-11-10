import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a 6x5 PGM with samples i * 8.
const cases = [
    { geometry: "2x2+1+2+3+4", output: "info", expected: "4x3|4x3+0+0" },
    { geometry: "2x2+1+2+3+4", output: "gray", expected: "0018202830485058c0d8e0e8" },
    { geometry: "2x3+1+1+2+3", output: "gray", expected: "00182028c0d8e0e8" },
    { geometry: "2x2+1+2+3", output: "gray", expected: "0018202830485058c0d8e0e8" },
    { geometry: "2x2+1+2", output: "gray", expected: "0018202830485058c0d8e0e8" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`preserves the chop rectangle for $geometry ($output, ${mode})`, async ({ geometry, output, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n6 5\n255\n"), ...Array.from({ length: 30 }, (_, i) => i * 8)]);
        const files = new Map([["/in.pgm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.pgm", "-chop", geometry, ...(output === "info" ? ["-format", "%wx%h|%g"] : ["-depth", "8"]), `${output}:/out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
