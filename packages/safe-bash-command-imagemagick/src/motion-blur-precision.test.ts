import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, with no intermediate export between operations.
const cases = [
    {
        name: "16-bit blur output",
        operations: ["-motion-blur", "2x1+35", "-depth", "16", "-endian", "MSB"],
        rgba: "a2bb5ebd5e3d407e54546f53a6528802607b502c28236e2db24010104d0ab77842de51ff55b752d18218877376f26c86862f6d755e639bfc9090101020208080"
    },
    {
        name: "arithmetic after blur",
        operations: ["-motion-blur", "2x1+35", "-evaluate", "Multiply", "2", "-depth", "8"],
        rgba: "ffbdbc80a8deffffc0a050dbff2099ff85a3aba5ffffedd8ffdabcffff2040ff"
    },
    {
        name: "zero-sigma blur retains previous fractional samples",
        operations: ["-motion-blur", "2x1+35", "-motion-blur", "2x0+35", "-evaluate", "Multiply", "2", "-depth", "8"],
        rgba: "ffbdbc80a8deffffc0a050dbff2099ff85a3aba5ffffedd8ffdabcffff2040ff"
    },
    {
        name: "8-bit blur output",
        operations: ["-motion-blur", "2x1+35", "-depth", "8"],
        rgba: "a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080"
    },
    {
        name: "16-bit unblurred output",
        operations: ["-depth", "16", "-endian", "MSB"],
        rgba: "d0d020203030303020205050e0e070703030909030306060c0c010106060e0e0111122223333505080808080808040408080a0a08080b0b09090101020208080"
    }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const)
it.each(cases)(`preserves generated motion-blur precision: $name (${mode})`, async ({ operations, rgba }) => {
    const files = new Map<string, Uint8Array>([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
    const args = ["in.pam", ...operations, "rgba:out"];
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
