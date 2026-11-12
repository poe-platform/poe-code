import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, using the PPM below.
const cases = [
    { geometries: ["1,x2", "1,X2", "2,x3", "1,x2+1+1"], size: "8x6", bytes: 144, hash: "bb09c55fcf04c971d18543f8d8f4c42e3199a20bc3f394c6f66a8bc334ccb1fb" },
    { geometries: ["1:x2", "1:X2", "1:x2+1+1", "1:x2%", "1:1"], size: "7x6", bytes: 126, hash: "3027e00009ab76fd6eb0982a9cb62e88dd2aedd2d9d0e89ff4393434f47a22c9" },
    { geometries: ["2:x3"], size: "8x5", bytes: 120, hash: "6d7d0a80a6141d3840206e657f9ca50da99ac004989e280bd78473f8414f0b2d" },
    { geometries: ["1,x2%"], size: "4x3", bytes: 36, hash: "10853965dcfdde77847c9575163f6ee0453bc1cbb568233144b4b0a174587b94" },
    { geometries: ["1x2", "1x2,3"], size: "5x5", bytes: 75, hash: "411af77c3d98b4a260bf926156c2a44723867b7911ff94a40abf3ff1900212d5" },
    { geometries: ["1/x2", "1/X2", "1/2"], size: "", bytes: 0, hash: "" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["rgb", "info"] as const) {
        for (const { geometries, size, bytes, hash } of cases) {
            it.each(geometries)(`handles a separator before splice x: %s (${mode}, ${format})`, async geometry => {
                const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"),
                    ...Array.from({ length: 36 }, (_, i) => (17 * i + 3) % 256)]);
                const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const argv = ["/in.ppm", "-splice", geometry, "-depth", "8", "-format", "%wx%h", `${format}:-`];
                const args = createCommandArguments(argv);
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(size ? 0 : 1);
                const diagnostic = "stderr" in result ? result.stderr : stderr;
                const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
                    : "stdout" in result && typeof result.stdout === "string" ? new TextEncoder().encode(result.stdout)
                    : Buffer.concat(chunks);
                if (!size) {
                    expect(diagnostic).toContain(`invalid geometry: ${geometry}`);
                    expect(output.length).toBe(0);
                } else {
                    expect(diagnostic).toBe("");
                    if (format === "info") expect(new TextDecoder().decode(output)).toBe(size);
                    else {
                        expect(output.length).toBe(bytes);
                        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
                    }
                }
            });
        }
    }
}
