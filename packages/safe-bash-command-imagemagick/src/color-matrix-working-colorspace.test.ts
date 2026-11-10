import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("123456ab674580a0e0", "hex")]);
const swap = ["-color-matrix", "0 0 1 0 1 0 1 0 0"];
// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 output in file order.
const cases = [
    { space: "HSL", swaps: 1, expected: "bbda4f0814127160d8" },
    { space: "Lab", swaps: 1, expected: "0094efbf86956c500d" },
    { space: "RGB", swaps: 1, expected: "5634124567abe0a080" },
    ...["HSL", "Lab"].flatMap(space => [0, 2].map(swaps => ({ space, swaps, expected: "123456ab674580a0e0" }))),
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $space with $swaps channel swaps matches native RGB output`, async ({ space, swaps, expected }) => {
        const files = new Map([["/pic.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/pic.ppm", "-colorspace", space, ...Array.from({ length: swaps }, () => swap).flat(), "-colorspace", "sRGB", "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
