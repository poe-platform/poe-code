import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./rotate-defines-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: input.png [options] -rotate 30 PNG32:output.png.
const input = Buffer.from(fixtures.input, "base64");
const cases = [
    ...fixtures.cases,
    ...["blur", "lobes"].map(key => ({
        label: `reset ${key}`,
        options: ["-define", `filter:${key}=2`, "+define", `filter:${key}`],
        rgba: fixtures.cases[0]!.rgba
    }))
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`applies default rotation filter defines: $label (${mode})`, async ({ options, rgba }) => {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...options, "-rotate", "30", "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([12, 11]);
        expect(output.virtualCanvas).toEqual({ width: 12, height: 11, x: -2, y: -3 });
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}
