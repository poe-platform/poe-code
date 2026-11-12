import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, including conversion back to sRGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "Lab", channel: "R", operator: "-white-threshold", separate: false, png: true, pixels: "ddffff80" },
        { space: "Lab", channel: "R", operator: "-white-threshold", separate: false, pixels: "ddffff80" },
        { space: "Lab", channel: "R", operator: "-white-threshold", separate: true, pixels: "ff" },
        { space: "HSL", channel: "R", operator: "-white-threshold", separate: true, pixels: "ff" },
        { space: "HSL", channel: "R", operator: "-white-threshold", separate: false, pixels: "9c444480" },
        { space: "Lab", channel: "A", operator: "-black-threshold", separate: false, pixels: "446d9c00" },
        { space: "Lab", channel: "A", operator: "-black-threshold", separate: true, pixels: "00" },
        { space: "HSL", channel: "A", operator: "-black-threshold", separate: false, pixels: "446d9c00" },
        { space: "sRGB", channel: "R", operator: "-white-threshold", separate: false, pixels: "446d9c80" },
        { space: "sRGB", channel: "A", operator: "-black-threshold", separate: false, pixels: "446d9c00" },
    ])(`${mode}: $space $channel $operator separation=$separate`, async ({ space, channel, operator, separate, png = false, pixels }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#446d9c80", "-colorspace", space, "-channel", channel,
            operator, "35%", "+channel",
            ...(separate ? ["-channel", channel, "-separate"] : ["-colorspace", "sRGB"]),
            "-depth", "8", `${png ? "PNG32" : separate ? "gray" : "rgba"}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(pixels);
    });
}
