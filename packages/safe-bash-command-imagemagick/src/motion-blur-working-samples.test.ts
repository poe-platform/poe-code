import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runConvertCli } from "./index.js";

const original = "d02030302050e07030903060c01060e0112233508080804080a080b090102080";
// Reference bytes: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { before: ["-evaluate", "Divide", "7"], blur: true, after: ["-evaluate", "Multiply", "7"], expected: "a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080" },
    { before: ["-evaluate", "Multiply", "3"], blur: true, after: ["-evaluate", "Divide", "3"], expected: "a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080" },
    { before: ["-evaluate", "Subtract", "50%"], blur: true, after: ["-evaluate", "Add", "50%"], expected: "b9394740eaf815872f92306ec01060b73d4552528065806c809f7f9b90102080" },
    { before: [], blur: true, after: [], expected: "a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080" },
    { before: ["-evaluate", "Divide", "7"], blur: false, after: ["-evaluate", "Multiply", "7"], expected: original },
    { before: ["-evaluate", "Multiply", "3"], blur: false, after: ["-evaluate", "Divide", "3"], expected: original }
])(`matches native working samples $before / blur=$blur / $after via ${mode}`, async ({ before, blur, after, expected }) => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", ...before, ...(blur ? ["-motion-blur", "2x1+35"] : []), ...after, "-depth", "8", "rgba:/out"];
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
