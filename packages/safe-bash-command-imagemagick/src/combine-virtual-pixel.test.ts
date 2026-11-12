import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI samples missing rows, but leaves missing columns unchanged.
for (const mode of ["command", "buffered", "sync"] as const)
for (const depth of [8, 16]) {
    it.each([
        { size: "1x2", middle: "1x1", method: "Edge", hex: "2244ee2244ee" },
        { size: "1x2", middle: "1x1", method: "White", hex: "2244ee22ffee" },
        { size: "1x2", middle: "1x1", method: "Black", hex: "2244ee2200ee" },
        { size: "2x1", middle: "1x1", method: "White", hex: "2244ee2222ee" },
        { size: "1x2", middle: "1x2", method: "White", hex: "2244ee2244ee" },
        { size: "2x2", middle: "1x1", method: "White", hex: "2244ee2222ee22ffee2222ee" },
    ])(`${mode}: combines $middle into $size using $method at depth ${depth}`, async ({ size, middle, method, hex }) => {
        const files = new Map([["/dest", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/dest", Buffer.from("KEEP"));
        const argv = ["-size", size, "xc:#222", "-size", middle, "xc:#444", "-size", size, "xc:#eee",
            "-virtual-pixel", method, "-combine", "-depth", String(depth), "-endian", "MSB", "rgb:/dest"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/dest") : files.get("/dest")!;
        const expected = Buffer.from(hex, "hex");
        expect(Buffer.from(output)).toEqual(depth === 8 ? expected : Buffer.from([...expected].flatMap(value => [value, value])));
    });
}
