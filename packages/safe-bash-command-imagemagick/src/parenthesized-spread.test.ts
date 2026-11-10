import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output for the PPM below.
const cases = [
    { geometry: "1", expected: "7ba048ffe02247ff72973cff587da2ff0b3055ff7ea3baffa25479ff4c7196ffb9de38ffb37398ffab7196ff92b76aff" },
    { geometry: "2", expected: "878e58ff795d82ffd0f51aff587da2ff0b3055ffb7dc37ffcd3358ff587da2ff8bb027ffb03a5fffbc496eff698ea0ff" },
] as const;

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    for (const wrapped of [true, false]) {
        it.each(cases)(`applies spread radius $geometry (${mode}, parentheses=${wrapped})`, async ({ geometry, expected }) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P6\n4 3\n255\n"),
                ...Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256),
            ]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input]]);
            const argv = ["/in.ppm", "-seed", "17", "-spread", wrapped ? `(${geometry})` : geometry, "-depth", "8", "rgba:/out"];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        });
    }
}
