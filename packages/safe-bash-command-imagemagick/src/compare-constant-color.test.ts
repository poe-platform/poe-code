import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Scores and statuses verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "public"] as const) {
    for (const metric of ["NCC", "DPC", "PHASE"]) {
        it(`reports constant selected channels for ${metric} (${mode})`, async () => {
            for (const { options, warn, regard } of [
                { options: ["-channel", "R"], warn: true, regard: false },
                { options: ["-channel", "R", "-regard-warnings"], warn: true, regard: true },
                { options: ["-channel", "R", "-quiet"], warn: false, regard: false },
                { options: ["-channel", "R", "-quiet", "-regard-warnings"], warn: false, regard: true },
                { options: ["-channel", "R", "-quiet", "+quiet", "-regard-warnings", "+regard-warnings"], warn: true, regard: false },
                { options: [], warn: false, regard: false },
                { options: ["-channel", "R", "+channel"], warn: false, regard: false },
            ]) {
                const filesystem = new MemoryFileSystem();
                const args = ["-metric", metric, ...options, "xc:#203040", "xc:#204060", "null:"];
                let stdout = "", stderr = "";
                const argumentValues = createCommandArguments(["compare", ...args]);
                let exitCode: number;
                if (mode === "public") {
                    const result = await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                    });
                    exitCode = result.exitCode;
                } else {
                    const result = mode === "sync" ? runCompareCliSync(args, new Map())
                        : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
                    ({ exitCode, stdout, stderr } = result);
                }
                const score = metric === "PHASE" ? "0 (0)" : "32767.5 (0.5)";
                expect(exitCode, args.join(" ")).toBe(regard ? 2 : metric === "PHASE" ? 0 : 1);
                expect(stdout).toBe("");
                if (warn) {
                    expect(stderr).toContain(`${score}compare: search metric is unreliable for constant-color images (${metric})`);
                } else expect(stderr).toBe(score);
            }
        });
    }
}

it("checks the candidate's selected range, including pixels excluded by a read mask", async () => {
    const constant = new TextEncoder().encode("P3\n2 1\n255\n32 48 64 32 64 96\n");
    const varying = new TextEncoder().encode("P3\n2 1\n255\n32 48 64 64 64 96\n");
    for (const [reference, candidate, warning] of [
        [constant, varying, false], [varying, constant, true]
    ] as const) {
        const result = await runCompareCli(["-metric", "NCC", "-channel", "R", "-read-mask", "xc:black", "a.ppm", "b.ppm", "null:"],
            new Map([["a.ppm", reference], ["b.ppm", candidate]]));
        expect(result.stderr.includes("unreliable for constant-color images")).toBe(warning);
    }
});

it("preserves search positions when warning about constant selected channels", async () => {
    const result = await runCompareCli(["-metric", "DPC", "-channel", "R", "-subimage-search", "-regard-warnings",
        "xc:#203040", "xc:#204060", "null:"], new Map());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("32767.5 (0.5) @ 0,0 [0]compare: search metric is unreliable for constant-color images (DPC)");
});
