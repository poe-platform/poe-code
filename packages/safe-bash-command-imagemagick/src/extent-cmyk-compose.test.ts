import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw CMYKA samples before RGB conversion (16-bit little-endian).
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { compose: "Multiply", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "00000000ff" },
        { compose: "Screen", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2aff" },
        { compose: "SrcIn", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2a70" },
        { compose: "Difference", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2a8f" },
        { compose: "Plus", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2aff" },
        { compose: "Dissolve", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2aff" },
        { compose: "Over", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "004e2d2aff" },
        { compose: "Dst", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "00000000ff" },
        { compose: "Copy", background: "white", geometry: "1x1", depth: "8", channel: "", expected: "00b3665f70" },
        { compose: "Multiply", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c8604d4b7e7ca6ee00c2c860" },
        { compose: "Screen", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c8608a79a2a1a6ee00c2c860" },
        { compose: "SrcIn", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c860001e11102aee00c2c860" },
        { compose: "Difference", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c8608a79828410ee00c2c860" },
        { compose: "Plus", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c8605a4e7675d0ee00c2c860" },
        { compose: "Dissolve", background: "#20804060", geometry: "3x1-1+0", depth: "8", channel: "", expected: "ee00c2c8604d798481a6ee00c2c860" },
        { compose: "Screen", background: "white", geometry: "1x1", depth: "8", channel: "CMY", expected: "004e2d00ff" },
        { compose: "Screen", background: "white", geometry: "1x1", depth: "8", channel: "K", expected: "0000002aff" },
        { compose: "Screen", background: "#20804060", geometry: "1x1", depth: "16", channel: "", expected: "478a06794da29aa17ca6" },
        { compose: "Dissolve", background: "#20804060", geometry: "1x1", depth: "16", channel: "", expected: "8b4d0679868493817ca6" },
    ])(`${mode}: CMYK $compose onto $background at $geometry ($depth bits, $channel)`, async ({ compose, background, geometry, depth, channel, expected }) => {
        const argv = ["xc:#a0306070", "-colorspace", "CMYK", "-background", background,
            "-compose", compose, ...(channel ? ["-channel", channel] : []), "-extent", geometry, "-depth", depth, "cmyka:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
