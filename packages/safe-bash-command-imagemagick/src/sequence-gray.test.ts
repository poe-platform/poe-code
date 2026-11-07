import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: xc:gray50 -colorspace gray, and xc:#b04c28 PNG24:.
const gray = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000a4944415408d763a8070000810080791a4b080000000049454e44ae426082", "hex");
const rgb = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763d8e0a3010002d40125b382becd0000000049454e44ae426082", "hex");

const deepGray = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000110000000006aee47160000000b4944415408d763a8af0700018000ffaf0c0a380000000049454e44ae426082", "hex");

for (const mode of ["map", "sync", "command"])
for (const inputs of [[gray, rgb], [rgb, gray], [gray, gray], [rgb, rgb], [deepGray, rgb], [rgb, deepGray], [deepGray, deepGray]])
it(`matches native sequence Mean channels (${mode}, ${inputs.map(input => input === gray ? "gray" : input === deepGray ? "gray16" : "rgb").join("/")})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const [index, input] of inputs.entries()) {
        files.set(`/in${index}.png`, input);
        await fs.writeFile(`/in${index}.png`, input);
    }
    const argv = ["/in0.png", "/in1.png", "-evaluate-sequence", "Mean", "/out.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
        : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const expected = inputs[0] === inputs[1] ? inputs[0] !== rgb ? [127, 127, 127, 255] : [176, 76, 40, 255] : inputs.includes(deepGray) ? [152, 38, 20, 255] : [152, 102, 20, 255];
    expect(Array.from(output.data)).toEqual(expected);
});
