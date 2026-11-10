import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["3/2+50", "9367654b6a768a9276332475a6103ea05f5f5f5583837082894b479090102080"],
    ["3x2+50", "9367654b6a768a9276332475a6103ea05f5f5f5583837082894b479090102080"],
    ["3:2+50", "a7515938547aab8b6050286eb2104db73b46504a80947f70866d5e9b90102080"]
])(`matches native motion blur geometry %s (${mode})`, async (geometry, expected) => {
    // Native ImageMagick 7.1.2-35 Q16-HDRI output, including alpha.
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["in.pam", input], ["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const argv = ["in.pam", "-motion-blur", geometry, "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
