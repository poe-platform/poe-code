import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const execution of ["sync", "buffered", "retained", "command"]) {
    it.each(["12xyz", "bad", "", "%", "NaN", "Infinity", "12%%", "0", "0%", "1e0%"])(`${execution}: validates fuzz %j before replacing a GIF`, async fuzz => {
        const base = decodeImage(await sharp({ create: { width: 1, height: 1, channels: 4, background: "gray" } }).png().toBuffer());
        const input = encodeImage({ ...base, width: 1, height: 2, pageHeight: 1, pages: 2,
            data: new Uint8Array([100, 100, 100, 255, 110, 110, 110, 255]),
            delay: [30, 50], disposal: 1 }, { format: "gif", pageHeight: 1 }).data;
        const keep = new TextEncoder().encode("keep");
        const files = new Map([["in.gif", input], ["out.gif", keep]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["in.gif", "-fuzz", fuzz, "-layers", "RemoveDups", "out.gif"];
        let stderr = "";
        const arguments_ = createCommandArguments(args);
        const result = execution === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {},
                signal: new AbortController().signal, fs: filesystem,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {},
            } as unknown as CommandContext)
            : execution === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        const valid = ["0", "0%", "1e0%"].includes(fuzz);
        const output = execution === "retained" || execution === "command"
            ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
        expect(result.exitCode).toBe(valid ? 0 : 1);
        if (valid) {
            expect(decodeImage(output, { animated: true }).delay).toEqual([30, 50]);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-fuzz'");
            expect(output).toEqual(keep);
        }
    });
}
