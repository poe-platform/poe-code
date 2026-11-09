import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

for (const mode of ["sync", "async", "retained", "command"] as const) {
    it.each([
        ["2x1", [], "/input.gray", [0x34, 0x12, 0xcd, 0xab], "65535", [0x12, 0x34, 0xab, 0xcd], "0 (0)", 0],
        ["2x1", ["-depth", "16"], "gray:/input.gray[0]", [0x12, 0x34, 0xab, 0xcd, 0x34, 0x12, 0xcd, 0xab], "65535", [0x12, 0x34, 0xab, 0xcd], "8670 (0.132296)", 1],
        ["2x1", ["-depth", "16"], "gray:/input.gray[1]", [0x12, 0x34, 0xab, 0xcd, 0x34, 0x12, 0xcd, 0xab], "65535", [0x12, 0x34, 0xab, 0xcd], "0 (0)", 0],
        ["2x1+4", [], "/input.gray", [0x12, 0x34, 0xab, 0xcd, 0x34, 0x12, 0xcd, 0xab], "65535", [0x12, 0x34, 0xab, 0xcd], "0 (0)", 0],
        ["2x1", ["-depth", "8"], "gray:/input.gray", [18, 171], "255", [18, 171], "0 (0)", 0],
        ["2x1", ["-depth", "8"], "/input.gray", [18, 171], "255", [18, 171], "0 (0)", 0],
    ] as const)(`reads raw grayscale %s %j %s (${mode})`, async (size, depth, input, samples, max, reference, stderrExpected, exitCode) => {
        const files = new Map([["/input.gray", new Uint8Array(samples)], ["/ref.pgm", new Uint8Array([...new TextEncoder().encode(`P5\n2 1\n${max}\n`), ...reference])]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-metric", "RMSE", "-size", size, ...depth, input, "/ref.pgm", "/diff.pgm"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(["compare", ...argv]);
        const result = mode === "sync" ? runCompareCliSync(argv, files)
            : mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
            : await runCompareCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(mode === "command" ? { ...result, stdout, stderr } : result).toMatchObject({ exitCode, stdout: "", stderr: stderrExpected });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/diff.pgm") : files.get("/diff.pgm");
        expect(output?.length).toBeGreaterThan(10);
    });
}

const fixtures = {
    "a.pgm": "50350a3320320a3235350a1059c5d46981",
    "b.pgm": "50350a3320320a3235350a105928d46981",
    "a.gray": "1059c5d46981",
    "be.gray": "03e820017531a4eed6d8f002",
    "le.gray": "e80301203175eea4d8d602f0",
    "hi.pgm": "50350a3320320a36353533350a03e820017531a4eed6d8f002"
};

for (const mode of ["sync", "async", "retained"] as const) {
    it.each([
    {
        "args": [
            "-metric",
            "RMSE",
            "a.pgm",
            "a.pgm",
            "diff.pgm"
        ],
        "exitCode": 0,
        "stderr": "0 (0)",
        "output": "50350a3320320a3235350acfdef3f6e1e6"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "a.pgm",
            "b.pgm",
            "diff.pgm"
        ],
        "exitCode": 1,
        "stderr": "16472.4 (0.251353)",
        "output": "50350a3320320a3235350acfde3ff6e1e6"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "-depth",
            "8",
            "gray:a.gray",
            "a.pgm",
            "diff.pgm"
        ],
        "exitCode": 0,
        "stderr": "0 (0)",
        "output": "50350a3320320a3235350acfdef3f6e1e6"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "-depth",
            "8",
            "gray:a.gray",
            "b.pgm",
            "diff.pgm"
        ],
        "exitCode": 1,
        "stderr": "16472.4 (0.251353)",
        "output": "50350a3320320a3235350acfde3ff6e1e6"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-depth",
            "8",
            "-size",
            "3x2",
            "a.gray",
            "a.pgm",
            "diff.pgm"
        ],
        "exitCode": 0,
        "stderr": "0 (0)",
        "output": "50350a3320320a3235350acfdef3f6e1e6"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "be.gray",
            "hi.pgm",
            "diff.pgm"
        ],
        "exitCode": 1,
        "stderr": "36085 (0.550621)",
        "output": "50350a3320320a36353533350a467f185221fc47d2437618ae"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "le.gray",
            "hi.pgm",
            "diff.pgm"
        ],
        "exitCode": 0,
        "stderr": "0 (0)",
        "output": "50350a3320320a36353533350acd94d333e43cedc8f7c4fccc"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "-depth",
            "16",
            "be.gray",
            "hi.pgm",
            "diff.pgm"
        ],
        "exitCode": 1,
        "stderr": "36085 (0.550621)",
        "output": "50350a3320320a36353533350a467f185221fc47d2437618ae"
    },
    {
        "args": [
            "-metric",
            "RMSE",
            "-size",
            "3x2",
            "-depth",
            "16",
            "le.gray",
            "hi.pgm",
            "diff.pgm"
        ],
        "exitCode": 0,
        "stderr": "0 (0)",
        "output": "50350a3320320a36353533350acd94d333e43cedc8f7c4fccc"
    }
])(`matches native raw grayscale metrics (${mode}): $args`, async ({ args, exitCode, stderr, output }) => {
        const files = new Map(Object.entries(fixtures).map(([name, hex]) => [name, new Uint8Array(Buffer.from(hex, "hex"))]));
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const result = mode === "sync" ? runCompareCliSync(args, files) : await runCompareCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode, stderr });
        expect(Buffer.from(mode === "retained" ? await fs.readFile("/diff.pgm") : files.get("diff.pgm")!).toString("hex")).toBe(output);
        const control = new Map(files);
        const headered = args.includes("hi.pgm") ? "hi.pgm" : "a.pgm";
        if (exitCode === 0) {
            expect(runCompareCliSync([headered, headered, "control.pgm"], control).exitCode).toBe(0);
            expect(mode === "retained" ? await fs.readFile("/diff.pgm") : files.get("diff.pgm")).toEqual(control.get("control.pgm"));
        }
    });
}

for (const retained of [false, true]) {
    it(`keeps read settings in operand order (${retained})`, async () => {
        const files = new Map([["/byte.gray", new Uint8Array([18])], ["/word.gray", new Uint8Array([18, 18])]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        expect(await runCompareCli(["-size", "1x1", "-depth", "8", "/byte.gray", "-depth", "16", "/word.gray", "null:"], retained ? { filesystem, cwd: "/" } : files))
            .toMatchObject({ exitCode: 0, stderr: "0 (0)" });
    });
    it.each([[], ["-size", "2x1"], ["-size", "1x1", "-depth", "32"], ["-size", "1x1+9"]])(`preserves the destination when raw input cannot be decoded (${retained}): %j`, async (...options) => {
        const files = new Map([["/input.gray", new Uint8Array([1, 2])], ["/diff.pgm", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        expect(await runCompareCli([...options, "/input.gray", "/input.gray", "/diff.pgm"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 2 });
        expect(retained ? await filesystem.readFile("/diff.pgm") : files.get("/diff.pgm")).toEqual(new TextEncoder().encode("KEEP"));
    });
}
