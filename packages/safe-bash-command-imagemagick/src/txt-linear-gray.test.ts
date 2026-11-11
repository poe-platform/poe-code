import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = Uint8Array.from(Buffer.from("50360a3220310a3235350a208040ff2200", "hex"));

// ImageMagick 7.1.2-35 Q16-HDRI, using this PPM. Native TXT readback to
// -colorspace sRGB -depth 8 rgb:- yields 707070828282 for LinearGray.
const cases = [
    { name: "default depth", options: [], expected: "# ImageMagick pixel enumeration: 2,1,0,255,lineargray\n0,0: (41)  #292929  lineargray(16.1147%)\n1,0: (57)  #393939  lineargray(22.4096%)\n" },
    { name: "8-bit", options: ["-depth", "8"], expected: "# ImageMagick pixel enumeration: 2,1,0,255,lineargray\n0,0: (41)  #292929  lineargray(41)\n1,0: (57)  #393939  lineargray(57)\n" },
    { name: "16-bit", options: ["-depth", "16"], expected: "# ImageMagick pixel enumeration: 2,1,0,65535,lineargray\n0,0: (10561)  #294129412941  lineargray(16.1147%)\n1,0: (14686)  #395E395E395E  lineargray(22.4096%)\n" },
    { name: "alpha default depth", options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], expected: "# ImageMagick pixel enumeration: 2,1,0,255,lineargraya\n0,0: (41,128)  #29292980  lineargraya(16.1147%,0.500008)\n1,0: (57,128)  #39393980  lineargraya(22.4096%,0.500008)\n" },
    { name: "alpha 8-bit", options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel", "-depth", "8"], expected: "# ImageMagick pixel enumeration: 2,1,0,255,lineargraya\n0,0: (41,128)  #29292980  lineargraya(41,0.501961)\n1,0: (57,128)  #39393980  lineargraya(57,0.501961)\n" },
    { name: "alpha 16-bit", options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel", "-depth", "16"], expected: "# ImageMagick pixel enumeration: 2,1,0,65535,lineargraya\n0,0: (10561,32768)  #2941294129418000  lineargraya(16.1147%,0.500008)\n1,0: (14686,32768)  #395E395E395E8000  lineargraya(22.4096%,0.500008)\n" },
    { name: "separated Gray", options: ["-separate"], expected: "# ImageMagick pixel enumeration: 2,1,0,255,gray\n0,0: (41)  #292929  gray(16.1147%)\n1,0: (57)  #393939  gray(22.4096%)\n" },
];

for (const mode of ["sync", "buffered", "command"] as const) {
    it.each(cases)(`${mode} writes LinearGray TXT with native $name fields`, async ({ options, expected }) => {
        const files = new Map([["/in.ppm", ppm.slice()]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm.slice());
        const args = ["/in.ppm", "-colorspace", "LinearGray", ...options, "txt:/out.txt"];
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "command" ? await fs.readFile("/out.txt") : files.get("/out.txt")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
