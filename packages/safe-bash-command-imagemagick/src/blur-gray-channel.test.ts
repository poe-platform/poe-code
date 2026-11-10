import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, cropped to the first 8-bit RGBA pixel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { blur: "-rotational-blur", amount: "60", channel: "R", expected: "37373730" },
        { blur: "-rotational-blur", amount: "60", channel: "G", expected: "47474730" },
        { blur: "-rotational-blur", amount: "60", channel: "B", expected: "47474730" },
        { blur: "-rotational-blur", amount: "60", channel: "", expected: "37373739" },
        { blur: "-motion-blur", amount: "2x1+35", channel: "R", expected: "6d6d6d30" },
        { blur: "-motion-blur", amount: "2x1+35", channel: "G", expected: "47474730" },
        { blur: "-motion-blur", amount: "2x1+35", channel: "B", expected: "47474730" },
        { blur: "-motion-blur", amount: "2x1+35", channel: "A", expected: "47474740" },
        { blur: "-rotational-blur", amount: "60", channel: "R", rgb: true, expected: "37474730" },
        { blur: "-motion-blur", amount: "2x1+35", channel: "R", rgb: true, expected: "6d474730" }
    ])(`${mode}: $blur respects the logical gray channel ($channel, rgb=$rgb)`, async ({ blur, amount, channel, rgb, expected }) => {
        const files = new Map<string, Uint8Array>([["in.pam", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["in.pam", "-colorspace", "Gray", ...(rgb ? ["-colorspace", "sRGB"] : []), ...(channel ? ["-channel", channel] : []), blur, amount,
            "+channel", "-colorspace", "sRGB", "-crop", "1x1+0+0", "+repage", "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
