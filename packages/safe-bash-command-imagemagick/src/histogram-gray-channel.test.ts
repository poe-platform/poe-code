import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: R selects Gray's single color sample; G/B are absent.
// Convert back to sRGB so the raw output exposes inconsistent backing samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of [["-equalize"], ["-normalize"], ["-contrast-stretch", "0x0"]]) {
        const equalize = operator[0] === "-equalize";
        it.each([
            { space: "Gray", channel: "R", expected: equalize ? "555555aaaaaaffffff" : "000000808080ffffff" },
            { space: "Gray", channel: "G", expected: "404040808080c0c0c0" },
            { space: "Gray", channel: "B", expected: "404040808080c0c0c0" },
            { space: "Gray", channel: "RGB", expected: equalize ? "555555aaaaaaffffff" : "000000808080ffffff" },
            { space: "Gray", channel: "", expected: equalize ? "555555aaaaaaffffff" : "000000808080ffffff" },
            { space: "sRGB", channel: "R", expected: equalize ? "554040aa8080ffc0c0" : "004040808080ffc0c0" },
        ])(`${mode}: ${operator.join(" ")} respects $space channel $channel`, async ({ space, channel, expected }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", "-colorspace", space,
                ...(space === "sRGB" ? ["-type", "TrueColor"] : []),
                ...(channel ? ["-channel", channel] : []), ...operator,
                "+channel", "-colorspace", "sRGB", "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
            const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(chunks)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
