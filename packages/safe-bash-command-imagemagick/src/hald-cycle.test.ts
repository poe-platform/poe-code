import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGB8 output.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { level: 2, before: true, amount: "1", expected: "550000aa0000ff0000005500" },
    { level: 2, before: false, amount: "1", expected: "550000aa0000ff0000005500" },
    { level: 3, before: true, amount: "1", expected: "200000400000600000800000" },
    { level: 3, before: false, amount: "1", expected: "200000400000600000800000" },
    { level: 4, before: false, amount: "1", expected: "110000220000330000440000" },
    { level: 6, before: false, amount: "1", expected: "0700000f00001600001d0000" },
    { level: 2, before: false, amount: "-1", expected: "ffffff000000550000aa0000" },
    { level: 2, before: false, amount: "65", expected: "550000aa0000ff0000005500" },
    { level: 2, before: false, amount: undefined, expected: "000000550000aa0000ff0000" },
])(`${mode}: hald:$level cycle=$amount before crop=$before`, async ({ level, before, amount, expected }) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const cycle = amount === undefined ? [] : ["-cycle", amount];
    const args = [`hald:${level}`, ...(before ? cycle : []), "-crop", "4x1+0+0", "+repage",
        ...(!before ? cycle : []), "-depth", "8", "-endian", "MSB", "rgb:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
    expect(Buffer.from(actual).toString("hex")).toBe(expected);
});
