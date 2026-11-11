import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 3\n255\n"),
    ...Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256),
]);
// ImageMagick 7.1.2-35 Q16-HDRI, image first with -quiet -median 3 -depth 8 rgba:-.
const filtered = "355ca5ff5a59a2ffc9377dffa45958ffa4c836ff5aa3a5ff5a7ea2ff7c7b80ff7f597dff7f5658ff7cc533ff5aa3a2ff577ec4ff3259a2ff32569fff";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "empty group", "after input"])(`requires an image at median (%s, ${mode})`, async placement => {
        const operation = ["-median", "3"];
        const args = ["-quiet", ...(placement === "before input" ? [...operation, "/in.ppm"]
            : placement === "after delete" ? ["/in.ppm", "+delete", ...operation, "/in.ppm"]
            : placement === "empty group" ? ["/in.ppm", "(", ...operation, "/in.ppm", ")"]
            : ["/in.ppm", ...operation]), "-depth", "8", "rgba:-"];
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const files = new Map([["/in.ppm", input]]);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        const empty = placement !== "after input";
        expect.soft(exitCode).toBe(empty ? 1 : 0);
        expect.soft(stderr).toBe(empty ? "magick: no images found for operation '-median'\n" : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(empty ? "" : filtered);
    });
}
