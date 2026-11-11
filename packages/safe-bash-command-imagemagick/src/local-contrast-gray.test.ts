import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 output for the inline Gray fixture.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["R", "G", "B", "A", "default", "control"])(`matches native Gray local contrast with %s selection via ${mode}`, async channel => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#385060", "xc:#b09070", "xc:#807090", "+append", "-colorspace", "Gray", "-virtual-pixel", "edge",
            ...(["default", "control"].includes(channel) ? [] : ["-channel", channel]),
            ...(channel === "control" ? [] : ["-local-contrast", "100x60"]), "+channel", "-depth", "8", "rgb:/out.raw"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(channel === "control" ? "4c4c4c949494767676" : "7a7a7aeeeeeebcbcbc");
    });
}
