import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete raw gray output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each<{ name: string; selection: string[]; expected: string; operation?: string[]; plane?: string[]; extra?: boolean; output?: string; size?: string; depth?: string }>([
        { name: "default channels", selection: [], expected: "00ffff" },
        { name: "selected Meta0", selection: ["-channel", "Meta0"], expected: "00ffff" },
        { name: "reset channels", selection: ["-channel", "R", "+channel"], expected: "00ffff" },
        { name: "explicit Default", selection: ["-channel", "Default"], expected: "00ffff" },
        { name: "red preserves Meta0", selection: ["-channel", "R"], expected: "2080c0" },
        { name: "no filter preserves Meta0", selection: [], operation: [], expected: "2080c0" },
        { name: "percentage offset", selection: ["-channel", "Meta0"], operation: ["-lat", "3x1+10%"], expected: "000000" },
        { name: "Meta1 preserves Meta0", selection: ["-channel", "Meta1"], extra: true, expected: "2080c0" },
        { name: "selected Meta1", selection: ["-channel", "Meta1"], extra: true, output: "Meta1", expected: "000000" },
        ...["white", "gray", "background", "transparent"].map(method => ({ name: `${method} virtual pixels`, selection: ["-channel", "Meta0"],
            plane: ["-size", "3x1", "xc:#808080"], operation: ["-background", "#ffffff", "-virtual-pixel", method, "-lat", "3x1"], expected: "ff00ff" })),
        { name: "16-bit precision", selection: ["-channel", "Meta0"], depth: "16",
            plane: ["(", "+size", "xc:#800080008000", "xc:#800180018001", "xc:#800080008000", "+append", ")"], expected: "0000ffff0000" },
        { name: "chunk and row boundaries", selection: ["-channel", "Meta0"], size: "1025x2", plane: ["xc:#808080"],
            operation: ["-virtual-pixel", "white", "-lat", "3x1"], expected: ("ff" + "00".repeat(1023) + "ff").repeat(2) },
        { name: "Meta0 preserves red", selection: ["-channel", "Meta0"], output: "R", expected: "404040" },
    ])(`${mode}: local threshold $name`, async ({ selection, operation = ["-lat", "3x1"], extra = false, output = "Meta0", size = "3x1", depth = "8",
        plane = ["(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")"], expected }) => {
        const argv = ["-size", size, "xc:#404040", "-duplicate", "3", ...plane,
            ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), "-combine", ...selection, ...operation,
            "+channel", "-channel", output, "-separate", "+channel", "-depth", depth, "-endian", "MSB", "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
