import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray has one color sample, selected by R.
// Converting back to sRGB exposes the physical samples, not just the Gray tag.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of [["-threshold", "20%"], ["-auto-threshold", "Otsu"]]) {
        it.each([
            { channel: "R", expected: "ffffff80" },
            { channel: "G", expected: "43434380" },
            { channel: "B", expected: "43434380" },
            { channel: "A", expected: "434343ff" },
            { channel: "RGB", expected: "ffffff80" },
            { channel: "RGBA", expected: "ffffffff" },
            { channel: "", expected: "ffffffff" },
        ])(`${mode}: ${operator.join(" ")} preserves Gray samples for $channel`, async ({ channel, expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = ["xc:#34465880", "-colorspace", "Gray",
                ...(channel ? ["-channel", channel] : []), ...operator,
                "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
