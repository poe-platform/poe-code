import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
// ImageMagick 7.1.2-35 Q16-HDRI, MSB raw RGB output.
const cases = [
    { name: "brightness and contrast", operations: ["-brightness-contrast", "10x30"], depth: "16", expected: "033a6072bdab0618c7b5ffffffffffff4aef" },
    { name: "fractional brightness", operations: ["-brightness-contrast", "0.3x0"], depth: "16", expected: "0fd45115925611d6995de8acc488d1954206" },
    { name: "identity after fractional arithmetic", operations: ["-evaluate", "add", "0.3%", "-brightness-contrast", "0"], depth: "16", expected: "0fd45115925611d6995de8acc488d1954206" },
    { name: "fractional arithmetic control", operations: ["-evaluate", "add", "0.3%"], depth: "16", expected: "0fd45115925611d6995de8acc488d1954206" },
    { name: "8-bit control", operations: ["-brightness-contrast", "10x30"], depth: "8", expected: "0360bd06c7ffffff4b" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves fractional brightness-contrast samples for $name`, async ({ operations, depth, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = ["/a.ppm", ...operations, "-endian", "MSB", "-depth", depth, "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
