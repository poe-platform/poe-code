import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runConvertCli } from "./index.js";

const original = "d02030302050e07030903060c01060e0112233508080804080a080b090102080";
// Reference bytes: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { alpha: "deactivate", blur: ["-rotational-blur", "60"], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { alpha: "deactivate", blur: ["-rotational-blur", "60"], after: "activate", expected: "842131302050e07030903060b71054e0362232508080804080a080b0a4103a80" },
    { alpha: "deactivate", blur: ["-rotational-blur", "60"], after: "on", expected: "842131ff2050e0ff309030ffb71054ff362232ff808080ff80a080ffa4103aff" },
    { alpha: "deactivate", blur: ["-motion-blur", "2x1+35"], after: "activate", expected: "a25e5e30546fa67060502860b2104de04352555082877640866d5eb090102080" },
    { alpha: "deactivate", blur: ["-motion-blur", "2x1+35"], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { alpha: "deactivate", blur: ["-motion-blur", "2x1+35"], after: "on", expected: "a25e5eff546fa6ff605028ffb2104dff435255ff828776ff866d5eff901020ff" },
    { alpha: "deactivate", blur: [], after: "extract", expected: "303030ff707070ff606060ffe0e0e0ff505050ff404040ffb0b0b0ff808080ff" },
    { alpha: "deactivate", blur: [], after: "activate", expected: original },
    { alpha: "off", blur: ["-rotational-blur", "60"], after: "activate", expected: "992131002050e00030903000b2104e00482132008080800080a080009e103200" },
    { alpha: "opaque", blur: ["-rotational-blur", "60"], after: "activate", expected: "992131ff2050e0ff309030ffb2104eff482132ff808080ff80a080ff9e1032ff" },
    { alpha: "off", blur: ["-rotational-blur", "0"], after: "activate", expected: "d02030002050e00030903000c0106000112233008080800080a0800090102000" },
    { alpha: "off", blur: [], after: "activate", expected: "d02030002050e00030903000c0106000112233008080800080a0800090102000" }
])(`preserves inactive alpha ($alpha) with $blur / $after via ${mode}`, async ({ alpha, blur, after, expected }) => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", "-alpha", alpha, ...blur, "-alpha", after, "-depth", "8", "rgba:/out"];
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
