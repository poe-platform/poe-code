import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA output.
const cases = [
    { channel: "R", gray: true, expected: "9d9d9d80" },
    { channel: "Gray", gray: true, expected: "9d9d9d80" },
    { channel: "G", gray: true, expected: "6f6f6f80" },
    { channel: "B", gray: true, expected: "6f6f6f80" },
    { channel: "RGB", gray: true, expected: "9d9d9d80" },
    { channel: "A", gray: true, expected: "6f6f6fb3" },
    { channel: "R", gray: false, expected: "3b7ada80" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) it.each(cases)(`${mode} ${format}: keeps brightness-contrast channel $channel correct with grayscale=$gray`, async ({ channel, gray, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = ["xc:#267ada80", ...(gray ? ["-colorspace", "Gray"] : []), "-channel", channel, "-brightness-contrast", "15x25", "+channel", "-colorspace", "sRGB", "-depth", "8", `${format}:/out`];
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
        let bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (format === "PNG32") {
            const encoded = new Map([["/out.png", bytes]]);
            const decoded = runConvertCliSync(["/out.png", "-depth", "8", "rgba:/decoded"], encoded);
            expect(decoded.exitCode).toBe(0);
            expect(decoded.stderr).toBe("");
            bytes = encoded.get("/decoded")!;
        }
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
