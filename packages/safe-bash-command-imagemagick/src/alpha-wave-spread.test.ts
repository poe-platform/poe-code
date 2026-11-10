import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI separated alpha bytes.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operator: ["-wave", "1x4"], alpha: "Disassociate", expected: "00".repeat(20) },
        { operator: ["-wave", "0x4"], alpha: "Disassociate", expected: "00".repeat(12) },
        { operator: ["-seed", "17", "-spread", "2"], alpha: "Disassociate", expected: "00".repeat(12) },
        { operator: [], alpha: "Disassociate", expected: "66".repeat(12) },
        { operator: ["-roll", "+1+1"], alpha: "Disassociate", expected: "00".repeat(12) },
        { operator: ["-wave", "0x4"], alpha: "On", expected: "66".repeat(12) },
        { operator: ["-seed", "17", "-spread", "2"], alpha: "On", expected: "66".repeat(12) },
    ])(`${execution}: alpha $alpha through $operator`, async ({ operator, alpha, expected }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"),
            ...Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256)]);
        const argv = ["in.ppm", "-alpha", "set", "-channel", "A", "-evaluate", "set", "40%", "+channel",
            "-alpha", alpha, ...operator, "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:out"];
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["out", keep], ["in.ppm", input]]);
        await fs.writeFile("/out", keep);
        await fs.writeFile("/in.ppm", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(Buffer.from(execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(expected);
    });
}
