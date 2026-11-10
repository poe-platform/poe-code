import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the PPM below.
const cases = [
    { operation: "-splice", length: 75, hash: "c6c38c7bd1edd359650855837658a8d69298439db892dc14389a74d2f6341f69" },
    { operation: "-chop", length: 9, hash: "59564cb00503f0e3404442f41265cfd04802eff32c7c89553fd2c65a6eae807c" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const geometry of ["1x2,3", "1x2"]) {
        it.each(cases)(`preserves both dimensions for $operation ${geometry} (${mode})`, async ({ operation, length, hash }) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P6\n4 3\n255\n"),
                ...Array.from({ length: 36 }, (_, i) => (i * 53 + 9) % 256),
            ]);
            const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["/in.ppm", operation, geometry, "-depth", "8", "rgb:/out"];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(output.length).toBe(length);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        });
    }
}
