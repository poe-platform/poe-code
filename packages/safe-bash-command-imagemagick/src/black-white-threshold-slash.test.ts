import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const threshold of ["50/20%", "32767.5/13107", "5 0 / 2 0 %", "50x20%", "50X20%", "50%,20%"] as const) {
        it.each([
            ["-black-threshold", "000000004000007f00c0c0c0ffffff"],
            ["-white-threshold", "00000040ff407fff7fffffffffffff"]
        ])(`${mode}: %s ${threshold} uses both channel cutoffs`, async (operator, expected) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI output for the same PGM bytes and argv.
            const input = Uint8Array.from([...new TextEncoder().encode("P5\n5 1\n255\n"), 0, 64, 127, 192, 255]);
            const files = new Map([["/in.pgm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            const argv = ["/in.pgm", "-channel", "RGB", operator, threshold, "-depth", "8", "rgb:/out"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
