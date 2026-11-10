import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(["%[label]", "%[option:route]", "r=>g"])(`expands channel-fx properties in ${mode}: %s`, async expression => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI produces RGBA8 202080c0.
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["xc:#204080c0", "-set", "option:route", "r=>g", "-set", "label", "r=>g", "-channel-fx", expression, "-depth", "8", mode === "public" ? "rgba:-" : "rgba:/out.rgba"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "public" ? Buffer.concat(stdout)
            : mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe("202080c0");
    });
}
