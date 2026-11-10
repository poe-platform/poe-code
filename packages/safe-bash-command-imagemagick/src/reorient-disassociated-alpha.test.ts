import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: reorientation drops disassociated
// alpha, including its stored sample; identity rotation preserves it.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each<{ alpha?: string; depth?: string; operations: string[]; coder?: string; format?: string; expected: string }>([
        ...[["-flip"], ["-flop"], ["-transverse"], ["-rotate", "180"], ["-rotate", "270"],
            ["-orient", "TopRight", "-auto-orient"], ["-orient", "BottomRight", "-auto-orient"],
            ["-orient", "BottomLeft", "-auto-orient"], ["-orient", "LeftTop", "-auto-orient"],
            ["-orient", "RightBottom", "-auto-orient"], ["-orient", "LeftBottom", "-auto-orient"]]
            .map(operations => ({ operations: [...operations, "-alpha", "Activate"], coder: "rgba", expected: "ffaa5500" })),
        ...[["-rotate", "0"], ["-rotate", "360"], ["-rotate", "90>"], ["-auto-orient"],
            ["-orient", "TopLeft", "-auto-orient"]]
            .map(operations => ({ operations: [...operations, "-alpha", "Activate"], coder: "rgba", expected: "ffaa5560" })),
        ...["On", "Discrete", "Deactivate"].flatMap(alpha =>
            [["-flip"], ["-transverse"], ["-rotate", "90"], ["-orient", "RightTop", "-auto-orient"]]
                .map(operations => ({ alpha, operations: [...operations, "-alpha", "Activate"], coder: "rgba", expected: "80402060" }))),
        { operations: ["-transpose", "-alpha", "Activate"], depth: "16", coder: "rgba", expected: "ffffaaaa55550000" },
        { operations: ["-transpose", "-alpha", "Activate"], coder: "rgba", expected: "ffaa5500" },
        { operations: ["-transverse"], format: "%[channels]", expected: "srgb  3.0" },
        { operations: ["-rotate", "37", "-channel", "A", "-separate", "+channel"], coder: "gray", expected: "000000000000000000" },
        { operations: ["-rotate", "37"], format: "%[channels]", expected: "srgb  3.0" },
        { operations: ["-rotate", "90", "-channel", "A", "-separate", "+channel"], coder: "gray", expected: "00" },
        { operations: ["-orient", "RightTop", "-auto-orient", "-alpha", "Activate"], coder: "rgba", expected: "ffaa5500" },
        { operations: ["-transpose", "-channel", "A", "-separate", "+channel"], coder: "gray", expected: "00" },
        { operations: ["-rotate", "0", "-channel", "A", "-separate", "+channel"], coder: "gray", expected: "60" },
        { alpha: "On", operations: ["-transpose", "-alpha", "Activate"], coder: "rgba", expected: "80402060" },
    ])(`${mode}: reorientation $operations ($alpha, $depth)`, async ({ alpha = "Disassociate", depth = "8", operations, coder, format, expected }) => {
        const argv = ["xc:#80402060", "-alpha", alpha, ...operations,
            ...(format ? ["-format", format, "info:out"] : ["-depth", depth, "-endian", "MSB", `${coder}:out`])];
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
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(format ? "utf8" : "hex")).toBe(expected);
    });
}
