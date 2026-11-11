import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rejects scalar modifiers before offsets, except percent.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const output of ["info:", "info:/out"]) {
        it.each([
            ...["!", "@", "<", ">", "^", "#"].map(modifier => ({ geometry: `1${modifier}+1+1`, expected: undefined })),
            { geometry: "1!", expected: "6x5" },
            { geometry: "1x1!+1+1", expected: "6x5" },
            { geometry: "1%+1+1", expected: "10x9" },
        ])(`${mode}: -border $geometry with ${output}`, async ({ geometry, expected }) => {
            const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.ppm", input], ["/out", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            await filesystem.writeFile("/out", keep);
            const argv = ["/in.ppm", "-border", geometry, "-format", "%wx%h", output];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            stdout = "stdout" in result ? result.stdout : stdout;
            stderr = "stderr" in result ? result.stderr : stderr;
            expect(result.exitCode, stderr).toBe(expected === undefined ? 1 : 0);
            expect(stdout).toBe(output === "info:" ? expected ?? "" : "");
            if (expected === undefined) expect(stderr).toContain(`invalid argument for option '-border': ${geometry}`);
            else expect(stderr).toBe("");
            const contents = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(contents).toEqual(output === "info:/out" && expected !== undefined ? new TextEncoder().encode(expected) : keep);
        });
    }
}
