import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array([...new TextEncoder().encode("P5\n5 1\n255\n"), 0, 64, 127, 192, 255]);
// ImageMagick 7.1.2-35 Q16-HDRI: an omitted first field uses the second as a scalar.
const scalar = ["000000000000000000c0c0c0ffffff", "0000004040407f7f7fffffffffffff"];
const zero = ["0000004000407f007fc0c0c0ffffff", "000000ff40ffff7fffffffffffffff"];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const [index, operator] of ["-black-threshold", "-white-threshold"].entries()) {
        it.each([
            ["x50%", scalar[index]],
            [" X 50% ", scalar[index]],
            ["x32768", scalar[index]],
            ["50%", scalar[index]],
            ["0x50%", zero[index]],
        ] as const)(`${mode}: ${operator} %s distinguishes an omitted first field from zero`, async (threshold, expected) => {
            const files = new Map([["in.pgm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", input);
            const argv = ["in.pgm", "-channel", "RGB", operator, threshold, "-depth", "8", "RGB:out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
