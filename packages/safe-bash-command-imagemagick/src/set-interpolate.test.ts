import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 7x5 raw 8-bit RGB output.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from({ length: 36 }, (_, i) => i)]);
const bilinear = "dff0568b08a60eac00ca8c53c8ed2c2e1d5c6be137a1dab614d190c121e9cd8d";
const nearest = "b5b5f76667477fa606ee5c615c6e91f3e73c5b1d3f4c207634607ed594535482";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default", inputs: ["in.ppm"], hashes: [bilinear] },
        { name: "explicit", inputs: ["in.ppm", "-interpolate", "nearest"], hashes: [nearest] },
        { name: "image property", inputs: ["in.ppm", "-set", "interpolate", "nearest"], hashes: [nearest] },
        { name: "option property", inputs: ["in.ppm", "-set", "option:interpolate", "nearest"], hashes: [nearest] },
        { name: "option before read", inputs: ["-set", "option:interpolate", "nearest", "in.ppm"], hashes: [nearest] },
        { name: "image scope", inputs: ["in.ppm", "-set", "interpolate", "nearest", "in.ppm"], hashes: [nearest, bilinear] },
        { name: "option scope", inputs: ["in.ppm", "-set", "option:interpolate", "nearest", "in.ppm"], hashes: [nearest, nearest] },
        { name: "explicit precedence", inputs: ["in.ppm", "-interpolate", "bilinear", "-set", "interpolate", "nearest"], hashes: [bilinear] },
        { name: "option removal", inputs: ["in.ppm", "-set", "option:interpolate", "nearest", "+set", "option:interpolate", "in.ppm"], hashes: [nearest, bilinear] },
        { name: "explicit reset", inputs: ["in.ppm", "-set", "option:interpolate", "nearest", "+interpolate", "in.ppm"], hashes: [bilinear, bilinear] },
        { name: "image property removal", inputs: ["in.ppm", "-set", "interpolate", "nearest", "+set", "interpolate"], hashes: [nearest] },
        { name: "invalid image property", inputs: ["in.ppm", "-set", "interpolate", "nearest", "-set", "interpolate", "bogus"], hashes: [nearest] },
        { name: "invalid option property", inputs: ["in.ppm", "-set", "option:interpolate", "bogus"], hashes: [bilinear] },
        { name: "undefined image property", inputs: ["in.ppm", "-set", "interpolate", "nearest", "-set", "interpolate", "undefined"], hashes: [bilinear] },
        { name: "property prefix", inputs: ["in.ppm", "-set", "property:interpolate", "nearest"], hashes: [nearest] },
        { name: "expanded image property", inputs: ["in.ppm", "-set", "method", "nearest", "-set", "interpolate", "%[method]"], hashes: [nearest] },
        { name: "expanded option property", inputs: ["in.ppm", "-set", "method", "nearest", "-set", "option:interpolate", "%[method]"], hashes: [nearest] },
        { name: "case and alias", inputs: ["in.ppm", "-set", "INTERPOLATE", "Nearest-Neighbor"], hashes: [nearest] },
        { name: "later explicit override", inputs: ["in.ppm", "-set", "interpolate", "nearest", "-interpolate", "bilinear"], hashes: [bilinear] },
        { name: "defined option", inputs: ["in.ppm", "-define", "interpolate=nearest"], hashes: [nearest] }
    ])(`${mode}: resize uses $name interpolation`, async ({ inputs, hashes }) => {
        const files = new Map([["in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = [...inputs, "-interpolative-resize", "7x5", "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(output.length).toBe(105 * hashes.length);
        expect(hashes.map((_, i) => createHash("sha256").update(output.subarray(i * 105, (i + 1) * 105)).digest("hex"))).toEqual(hashes);
    });
}
