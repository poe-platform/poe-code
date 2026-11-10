import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, SHA-256 of decoded RGBA8 PNG32 output.
const inputs = {
    "in.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64"),
    "alpha.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC", "base64"),
    "mask.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAAAAAD/8Di8AAAAHElEQVR4nGNggAFGBob/DAyMDAwMTHAxBAs/AAA6MwEGXzAFcwAAAABJRU5ErkJggg==", "base64"),
};
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { input: "in.png", operation: "-swirl", amount: "105", masked: true, hash: "fd3f7b91659df12082f62a474058a5fbd653a00933e69fed044abfd203795dad" },
    { input: "in.png", operation: "-implode", amount: "1.25", masked: true, hash: "2b948b521c925ffd21ebf5fa7d420a05d63985e318d528c911cc49d461e5acf3" },
    { input: "alpha.png", operation: "-swirl", amount: "105", masked: true, hash: "78406afdc8582093bafdc5e3d6b62b411436e64cd019a798a184abe06f0e6d04" },
    { input: "alpha.png", operation: "-implode", amount: "1.25", masked: true, hash: "7e802ea2703e6ea67a844c58bb9cb77d0fb1e6933d0001d1aac037f6d29d1e10" },
    { input: "in.png", operation: "-swirl", amount: "105", masked: false, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" },
    { input: "alpha.png", operation: "-implode", amount: "1.25", masked: false, hash: "8d5660580f7802072ad7b5289179be577e926dd8b99e810bb2e525a5e4878fa7" },
])(`${mode}: matches native $input $operation with masked=$masked`, async ({ input, operation, amount, masked, hash }) => {
    const files = new Map(Object.entries(inputs).map(([name, bytes]) => [`/${name}`, bytes]));
    files.set("/out.png", Buffer.from("KEEP"));
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
    const args = [`/${input}`, ...(masked ? ["-write-mask", "/mask.png"] : []), operation, amount, "PNG32:/out.png"];
    const commandArgs = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: commandArgs.args, argumentValues: commandArgs, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([9, 7]);
    expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
});
