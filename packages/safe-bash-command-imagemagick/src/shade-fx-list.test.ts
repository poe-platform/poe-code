import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 for the three-pixel input below.
const elevation30 = "1f1f1f3f3f3f9d9d9d", elevation60 = "969696b0b0b0ececec";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { angle: "30x30", expected: elevation30 + elevation30 },
        { angle: "30x60", expected: elevation60 + elevation60 },
        { angle: "30x%[fx:30*n]", expected: elevation60 + elevation60 },
        { angle: "30x%[fx:30*(t+1)]", expected: elevation30 + elevation60 },
        { angle: "30x%[fx:20*u[1].w]", expected: elevation60 + elevation60 },
        { angle: "30x%[fx:20*w]", expected: elevation60 + elevation60 },
    ])(`${mode}: shades the full image list with $angle`, async ({ angle, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#304050", "xc:#789890", "xc:#987038", "+append", "-duplicate", "1",
            "-shade", angle, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out.rgb"];
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
