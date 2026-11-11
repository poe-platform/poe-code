import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => (i * 41 + 17) % 256))]);

// Raw RGB references from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "Gaussian width-only", args: ["/in.ppm", "-filter", "Gaussian", "-resize", "4x3!", "-depth", "16", "-endian", "MSB"], expected: "3f425ff4891d5de6760a9f2c647a6fc398e4d0694eda77f492c870c499b4a9c160fe7f8ba5075c4479439541733d888bb72b359c5cee9642a18b72fc8ffba81f6cb4a611c6c34bc5" },
    { name: "Gaussian height-only", args: ["/in.ppm", "-filter", "Gaussian", "-resize", "5x2!", "-depth", "16", "-endian", "MSB"], expected: "4db1622e8b56981f745b9c674f5c63f884ea9e156b6f925fbf1a587f7876ad8646eb70099a9667f0811aa20db6a9699d91aa6de67711a3d7b8545d28" },
    { name: "Gaussian both axes", args: ["/in.ppm", "-filter", "Gaussian", "-resize", "3x2!", "-depth", "16", "-endian", "MSB"], expected: "6da76a0b926a715569358d15acb761098407a4fc594e771c9cd094b071c79bfa985e68b9" },
    { name: "Point width-only", args: ["/in.ppm", "-filter", "Point", "-resize", "4x3!", "-depth", "16", "-endian", "MSB"], expected: "11113a3a63638c8cb5b5dede8282ababd4d4fdfd26264f4f7878a1a1cacaf3f31c1c4545e9e912123b3b64648d8db6b6dfdf080831315a5a8383acac50507979a2a2cbcbf4f41d1d" },
    { name: "Triangle width-only", args: ["/in.ppm", "-filter", "Triangle", "-resize", "4x3!", "-depth", "16", "-endian", "MSB"], expected: "2ff05919824254ea7e13a73c4f0f7838a161df1e478770b097578040a969bc514f8f78b8b67649b472dd85c56eae97d7be7e26e750108dcdb6f6750a87f2b11b6f2facecd6153e7e" },
    { name: "Gaussian morph", args: ["-filter", "Gaussian", "/in.ppm", "(", "+clone", "-sample", "2x2!", "-flop", ")", "-morph", "2", "-delete", "0,2,3", "-depth", "8"], expected: "5478a16a87b06f85aeb86f98857ca595729493709189809c964d758096847e9b828db16d" },
];

describe.each(["command", "retained", "buffered", "sync"] as const)("resize filter boundaries (%s)", mode => {
    it.each(cases)("matches every raw sample for $name", async ({ args, expected }) => {
        const argv = [...args, "rgb:-"], fs = new MemoryFileSystem();
        const files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
    });
});
