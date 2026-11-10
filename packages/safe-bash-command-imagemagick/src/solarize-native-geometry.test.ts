import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI: exact raw RGBA destination bytes.
    it.each([
        ["1:2", "7fa9dc9fbf5f5f5f"],
        ["50%+1+2+3", "7f562360405f5f5f"],
        ["1.2.3", "7fa9dc9fbf5f5f5f"],
        ["5 0%", "7fa9dc9fbf5f5f5f"],
        ["-", "7fa9dc9fbf5f5f5f"],
        ["%", "7fa9dc9fbf5f5f5f"],
        ["0x", "7fa9dc9fbf5f5f5f"],
        ["bad", "4b454550"],
        ["50%", "7f562360405f5f5f"],
        ["0", "7fa9dc9fbf5f5f5f"],
    ])(`${mode}: matches native solarize geometry %j and destination bytes`, async (geometry, expected) => {
        const original = Buffer.from("KEEP");
        const files = new Map<string, Uint8Array>([["/out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const argv = ["xc:#80562360", "xc:#40a0a0a0", "+append", "-solarize", geometry!, "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(geometry === "bad" ? 1 : 0);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (geometry === "bad") expect(diagnostic).toContain("invalid argument '-solarize' 'bad'");
        else expect(diagnostic).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
