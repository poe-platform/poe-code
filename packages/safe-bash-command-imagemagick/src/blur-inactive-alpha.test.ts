import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runConvertCli } from "./index.js";

const original = "d02030302050e07030903060c01060e0112233508080804080a080b090102080";
// Reference bytes: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { blur: ["-rotational-blur", "60"], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { blur: ["-rotational-blur", "60"], after: "activate", expected: "842131302050e07030903060b71054e0362232508080804080a080b0a4103a80" },
    { blur: ["-rotational-blur", "60"], after: "on", expected: "842131ff2050e0ff309030ffb71054ff362232ff808080ff80a080ffa4103aff" },
    { blur: ["-motion-blur", "2x1+35"], after: "activate", expected: "a25e5e30546fa67060502860b2104de04352555082877640866d5eb090102080" },
    { blur: ["-motion-blur", "2x1+35"], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { blur: ["-motion-blur", "2x1+35"], after: "on", expected: "a25e5eff546fa6ff605028ffb2104dff435255ff828776ff866d5eff901020ff" },
    { blur: [], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { blur: [], after: "activate", expected: original }
])(`preserves deactivated alpha with $blur / $after via ${mode}`, async ({ blur, after, expected }) => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", "-alpha", "deactivate", ...blur, "-alpha", after, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
    expect(result.exitCode, stderr).toBe(0);
    expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
});
