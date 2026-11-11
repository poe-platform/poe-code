import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Exact TXT output from ImageMagick 7.1.2-35 Q16-HDRI, independent of our TXT reader.
const cases = [
    {
        "name": "srgb",
        "args": [
            "in.ppm"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,255,srgb\n0,0: (32,128,64)  #208040  srgb(32,128,64)\n1,0: (255,34,0)  #FF2200  srgb(255,34,0)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyk",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,255,cmyk\n0,0: (191,0,128,127)  #BF00807F  cmyk(191.25,0,127.5,127)\n1,0: (0,221,255,0)  #00DDFF00  cmyk(0,221,255,0)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyk8",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK",
            "-depth",
            "8"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,255,cmyk\n0,0: (191,0,128,127)  #BF00807F  cmyk(191,0,128,127)\n1,0: (0,221,255,0)  #00DDFF00  cmyk(0,221,255,0)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyk4",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK",
            "-depth",
            "4"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,255,cmyk\n0,0: (187,0,136,119)  #BB008877  cmyk(187,0,136,119)\n1,0: (0,221,255,0)  #00DDFF00  cmyk(0,221,255,0)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyk16",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK",
            "-depth",
            "16"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,65535,cmyk\n0,0: (49151,0,32768,32639)  #BFFF000080007F7F  cmyk(191.25,0,127.5,127)\n1,0: (0,56797,65535,0)  #0000DDDDFFFF0000  cmyk(0,221,255,0)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyka",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK",
            "-alpha",
            "set",
            "-channel",
            "A",
            "-evaluate",
            "set",
            "50%",
            "+channel"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,255,cmyka\n0,0: (191,0,128,127,128)  #BF00807F80  cmyka(191.25,0,127.5,127,0.500008)\n1,0: (0,221,255,0,128)  #00DDFF0080  cmyka(0,221,255,0,0.500008)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "cmyka16",
        "args": [
            "in.ppm",
            "-colorspace",
            "CMYK",
            "-alpha",
            "set",
            "-channel",
            "A",
            "-evaluate",
            "set",
            "50%",
            "+channel",
            "-depth",
            "16"
        ],
        "expected": "# ImageMagick pixel enumeration: 2,1,0,65535,cmyka\n0,0: (49151,0,32768,32639,32768)  #BFFF000080007F7F8000  cmyka(191.25,0,127.5,127,0.500008)\n1,0: (0,56797,65535,0,32768)  #0000DDDDFFFF00008000  cmyka(0,221,255,0,0.500008)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "original inks",
        "args": [
            "xc:cmyk(25,25,25,10)",
            "-depth",
            "8"
        ],
        "expected": "# ImageMagick pixel enumeration: 1,1,0,255,cmyk\n0,0: (25,25,25,10)  #1919190A  cmyk(25,25,25,10)\n",
        "input": "50360a3220310a3235350a208040ff2200"
    },
    {
        "name": "16-bit alpha",
        "args": [
            "-size",
            "1x1",
            "-depth",
            "16",
            "-endian",
            "MSB",
            "rgba:in.ppm",
            "-colorspace",
            "CMYK"
        ],
        "expected": "# ImageMagick pixel enumeration: 1,1,0,65535,cmyka\n0,0: (57825,28913,0,25923,9029)  #E1E170F1000065432345  cmyka(225.002,112.501,0,100.868,0.137774)\n",
        "input": "123456789abc2345"
    }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(cases)(`${mode}: writes $name channel tuples, hex and color names`, async ({ args, expected, input }) => {
    const bytes = Uint8Array.from(Buffer.from(input, "hex"));
    const files = new Map([["in.ppm", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", bytes);
    for (const output of ["txt:out.txt", "txt:-"]) {
        const argv = [...args, output];
        let stdout = "", stderr = "";
        const commandArgs = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        if ("stderr" in result) expect(result.stderr).toBe("");
        const text = output === "txt:-" ? "stdout" in result ? result.stdout : stdout
            : new TextDecoder().decode(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.txt") : files.get("out.txt"));
        expect(text).toBe(expected);
    }
});
