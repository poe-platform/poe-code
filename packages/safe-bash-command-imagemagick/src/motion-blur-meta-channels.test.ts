import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for the 5x3 red ramp.
const original = "00112233445566778899aabbccddee";
const blurred = "091a2b3a445e6f808f99b3c4d5e4ee";
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(
    Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat(),
)]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "unmodified Meta0", operations: [], output: "Meta0", expected: original },
        { name: "explicit Meta0", operations: ["-channel", "Meta0", "-motion-blur", "2x1+0"], output: "Meta0", expected: blurred },
        { name: "default channels", operations: ["-motion-blur", "2x1+0"], output: "Meta0", expected: blurred },
        { name: "reset channels", operations: ["-channel", "R", "+channel", "-motion-blur", "2x1+0"], output: "Meta0", expected: blurred },
        { name: "red preserves Meta0", operations: ["-channel", "R", "-motion-blur", "2x1+0"], output: "Meta0", expected: original },
        { name: "Meta1 preserves Meta0", operations: ["-channel", "Meta1", "-motion-blur", "2x1+0"], output: "Meta0", expected: original },
        { name: "Meta0 preserves Meta1", operations: ["-channel", "Meta0", "-motion-blur", "2x1+0"], output: "Meta1", expected: "002f5e8dbceb1a4978a7d605346392" },
        { name: "Meta0 preserves red", operations: ["-channel", "Meta0", "-motion-blur", "2x1+0"], output: "R", expected: original },
    ])(`${mode}: motion blur $name`, async ({ operations, output, expected }) => {
        const argv = ["/in.ppm", "-channel-fx", "red=>meta0,green=>meta1", ...operations,
            "-channel", output, "-separate", "-depth", "8", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
