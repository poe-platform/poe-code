import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runConvertCli } from "./index.js";

// Reference bytes: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { operation: ["-rotational-blur", "60"], channel: "K", separate: true, expected: "6e6e6eff" },
    { operation: ["-rotational-blur", "60"], channel: "K", separate: false, expected: "911622302050e07030903060b70f5ce01b3651508080804080a080b0a4122480" },
    { operation: ["-rotational-blur", "60"], channel: "R", separate: false, expected: "992030302050e07030903060c01060e0182233508080804080a080b090102080" },
    { operation: ["-motion-blur", "2x1+35"], channel: "K", separate: true, expected: "565656ff" },
    { operation: ["-motion-blur", "2x1+35"], channel: "K", separate: false, expected: "a91a27301b43bd7030903060b20f59e01e3d5b50949494407b9a7bb090102080" },
    { operation: ["-motion-blur", "2x1+35"], channel: "R", separate: false, expected: "c62030307150e07060903060c01060e01e223350728080408ba080b090102080" },
    { operation: ["-motion-blur", "2x1+35"], channel: "All", separate: false, expected: "a26c6a406076a0876050286eb2104ab7364a58528387786c866a5c9b90102080" },
    { operation: ["-rotational-blur", "60"], channel: "All", separate: false, expected: "6a344e392050e07030903060b71052c5262e45478080804080a080b0a410379b" },
    { operation: [], channel: "K", separate: true, expected: "2f2f2fff" }
])(`blurs CMYK $channel with $operation, separate=$separate via ${mode}`, async ({ operation, channel, separate, expected }) => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", "-colorspace", "CMYK", "-channel", channel, ...operation, "+channel", ...(separate ? ["-channel", "K", "-separate", "-crop", "1x1+0+0", "+repage"] : ["-colorspace", "sRGB"]), "-depth", "8", "rgba:/out"];
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
