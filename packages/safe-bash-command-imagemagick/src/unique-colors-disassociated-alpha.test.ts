import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including retained-alpha controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Disassociate", operations: ["-unique-colors"], format: "%wx%h|%[channels]|%k", text: "2x1|srgb  3.0|2" },
        { alpha: "Disassociate", operations: ["-unique-colors", "-channel", "A", "-separate", "+channel"], coder: "gray", hex: "00000000" },
        { alpha: "Disassociate", operations: ["-unique-colors", "-channel", "R", "-separate", "+channel"], coder: "gray", hex: "8080ffff" },
        { alpha: "Disassociate", operations: ["-unique-colors", "-alpha", "activate"], coder: "rgba", hex: "8080404020200000ffffaaaa55550000" },
        { alpha: "Disassociate", operations: ["-alpha", "activate"], coder: "rgba", hex: "ffffaaaa55556060808040402020ffffffffaaaa55556060" },
        { alpha: "Disassociate", operations: ["-unique-colors"], format: "%w", text: "2" },
        { alpha: "Disassociate", operations: ["-unique-colors", "-unique-colors", "-alpha", "activate"], coder: "rgba", hex: "8080404020200000ffffaaaa55550000" },
        ...[[], ["-evaluate", "multiply", "1"]].map(working => ({
            colors: ["00000060", "000000ff", "00000060"], alpha: "Disassociate", operations: [...working, "-unique-colors"],
            format: "%wx%h|%[channels]|%k", text: "1x1|srgb  3.0|1",
        })),
        { alpha: "Deactivate", operations: ["-unique-colors", "-alpha", "activate"], coder: "rgba", hex: "8080404020206060808040402020ffff" },
    ])(`${mode}: unique colors after $alpha with $operations and $format $coder`, async testCase => {
        const colors = "colors" in testCase ? testCase.colors : ["80402060", "804020ff", "80402060"];
        const argv = [...colors.map(color => `xc:#${color}`), "+append", "-alpha", testCase.alpha,
            ...testCase.operations, ...("text" in testCase ? ["-format", testCase.format!, "info:out"]
                : ["-depth", "16", "-endian", "MSB", `${testCase.coder}:out`])];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        if ("text" in testCase) expect(new TextDecoder().decode(output)).toBe(testCase.text);
        else expect(Buffer.from(output).toString("hex")).toBe(testCase.hex);
    });
}
