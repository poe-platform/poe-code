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

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const property of [false, true])
it.each([
    ["0x2", "163cbf2668b9348fb33eacae44bcac6b7c9c7b5396897a9093978b99a789c06779d03e73de656de88268ee9266"],
    ["0x2+0", "163cbf2668b9348fb33eacae44bcac6b7c9c7b5396897a9093978b99a789c06779d03e73de656de88268ee9266"],
    ["x2", "163cbf2668b9348fb33eacae44bcac6b7c9c7b5396897a9093978b99a789c06779d03e73de656de88268ee9266"],
    ["0x0", "0000c8112fc1225eba338db344bcac55eba5661a9e77499788789099a789aad682bb057bcc3474dd636dee9266"],
    ["2", "0918c41a47bd2b76b63aa1b044bcac5e95a16f329a8061938f8c8d99a789b3807ec41d77d54c70e4776aee9266"]
])(`matches native automatic-radius motion blur %s (${mode}, property=${property})`, async (geometry, expected) => {
    // Native ImageMagick 7.1.2-35 Q16-HDRI RGB output.
    const input = Buffer.concat([
        Buffer.from("P6\n5 3\n255\n"),
        Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())
    ]);
    const files = new Map([["/in.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", ...(property ? ["-set", "option:blur", geometry] : []), "-motion-blur", property ? "%[option:blur]" : geometry, "-depth", "8", "rgb:/out"];
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
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
