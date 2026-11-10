import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
]);

// ImageMagick 7.1.2-35 Q16-HDRI outputs for the same PAM bytes and arguments.
const cases = [
    {
        name: "disabled alpha followed by on",
        operations: ["-alpha", "off", "-motion-blur", "2x1+35", "-alpha", "on"],
        rgba: "ae4c52ff4b66afff595929ffab1045ff414d54ff818278ff876257ff901020ff"
    },
    {
        name: "disabled alpha followed by activate",
        operations: ["-alpha", "off", "-motion-blur", "2x1+35", "-alpha", "activate"],
        rgba: "ae4c52004b66af0059592900ab104500414d5400818278008762570090102000"
    },
    {
        name: "opaque alpha",
        operations: ["-alpha", "opaque", "-motion-blur", "2x1+35", "-alpha", "on"],
        rgba: "ae4c52ff4b66afff595929ffab1045ff414d54ff818278ff876257ff901020ff"
    },
    {
        name: "disabled alpha without blur",
        operations: ["-alpha", "off", "-alpha", "on"],
        rgba: "d02030ff2050e0ff309030ffc01060ff112233ff808080ff80a080ff901020ff"
    }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const)
it.each(cases)(`preserves motion-blur colors with $name (${mode})`, async ({ operations, rgba }) => {
    const files = new Map<string, Uint8Array>([["in.pam", input], ["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
    const args = ["in.pam", ...operations, "-depth", "8", "rgba:out"];
    let stdout = "", stderr = "";
    const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(rgba);
});
