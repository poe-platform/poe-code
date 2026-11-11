import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Float samples captured from ImageMagick 7.1.2-35 Q16-HDRI, without an integer output conversion.
const reported = Buffer.from("50460a3220310a312e300abe8000003e0000003fc000003dcccccd3f00068e3f7ff972", "hex");
const range = Buffer.from("50460a3420310a312e300abe8000003e00000040000000be800000bf000000be000000bf0000000000000000000000be0000003e8000003f000000", "hex");
const color = Buffer.from("50460a3220320a312e300a3e8000003f0000003f4000003f800000000000003e0000003f0000003e8000003f8000003e0000003f40000000000000", "hex");
const gray = Buffer.from("50660a3220320a312e300a3e8000003f0000003f4000003f800000", "hex");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "negative color samples", input: reported, option: "-contrast", expected: "be2aaaab3daaaaab3f8000003dcccf6c3f0008323f7ffcb9" },
        { name: "negative color samples", input: reported, option: "+contrast", expected: "be2aaaab3daaaaab3f8000003dccca2e3f0004ea3f7ff62b" },
        ...["-contrast", "+contrast"].map(option => ({ name: "brightness bounds", input: range, option,
            expected: "be0000003d8000003f800000000000000000000000000000000000000000000000000000be0000003e8000003f000000" })),
        { name: "RGB copy", input: color, option: "", expected: color.subarray(11).toString("hex") },
        { name: "grayscale copy", input: gray, option: "", expected: gray.subarray(11).toString("hex") }
    ])(`${mode}: preserves PFM $name with '$option'`, async ({ input, option, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.pfm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pfm", input);
        const argv = ["/in.pfm", ...(option ? [option] : []), "/out.pfm"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stderr
        } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: option ? `magick: option has been replaced '${option}', use "${option[0]}level"\n` : "" });
        const output = Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out.pfm") : files.get("/out.pfm")!);
        expect(output.subarray(0, 11)).toEqual(input.subarray(0, 11));
        const samples = Buffer.from(expected, "hex");
        expect(output.length).toBe(11 + samples.length);
        for (let offset = 0; offset < samples.length; offset += 4) {
            expect(output.readFloatBE(11 + offset)).toBeCloseTo(samples.readFloatBE(offset), 6);
        }
    });
}
