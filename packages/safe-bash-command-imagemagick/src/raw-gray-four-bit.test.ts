import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI truncates the 8-bit luma to its high nibble.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "#124578", depth: "4", interlace: "None", size: "1x1", hex: "30" },
        { color: "#124578", depth: "4", interlace: "Plane", size: "1x1", hex: "30" },
        { color: "#124578", depth: "8", interlace: "None", size: "1x1", hex: "3e" },
        { color: "#3e3e3e", depth: "4", interlace: "None", size: "1x1", hex: "40" },
        { color: "#124578", depth: "4", interlace: "None", size: "3x2", hex: "33303330" },
    ])(`${mode}: writes $color at depth $depth with $interlace interlace ($size)`, async ({ color, depth, interlace, size, hex }) => {
        const fs = new MemoryFileSystem();
        const keep = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", keep);
        const files = new Map([["/out", keep]]);
        const args = ["-size", size, `xc:${color}`, "-depth", depth, "-interlace", interlace, "gray:/out"];
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        const retained = mode === "command" || mode === "retained";
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(hex);
        expect(retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual([retained ? "out" : "/out"]);
    });
}
