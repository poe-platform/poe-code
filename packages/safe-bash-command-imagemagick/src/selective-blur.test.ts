import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n9 9\n255\n"), Buffer.from(Array.from({ length: 243 }, (_, i) => (i * 71 + 13) % 256))]);
// Complete RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures = [
    {
        "args": [
            "-selective-blur",
            "2x1+10%"
        ],
        "expected": "44488f843b82b7fe457cc36671b89b367dc45e41888f377eb5fc437fc64971b88d337ac1653d8481377eb2f94077be686db49a3178bf3e438a79377eb1f83f76bd656bb2983d74bb6639808f3077aff63d7ac1456bb28d3b72b964377e883077adf43b72b96166ad9a3471b83d3c837d2f76abf23970b75f65ac927a60a79e59a0c71e65a9f03774bb3f65ac87785ea59c579ec51c63a7ee356cb35b60a794356ab1ea458cc11b62a5ec336ab1595fa68c7e59a09f5299ce155ca3ea316eb53e60a7807f579e9b5198cd145ba2e93065ac5b5aa18f3364abf03e85ca11589fe62d64ab5659a08b72559ca04b92c80f569de42b"
    },
    {
        "args": [
            "-blur",
            "2x1"
        ],
        "expected": "576e7e8480788fa36b7fab736c9b945c889c64788c87837c99b06d5f837278888179967d72957b748e876e90866c8a7f7b8b847fa4825e856d73878072917e6e8e7b748a82738f7f728b7b7a8a83799f845c846970857e718d7d70897979867e7e8d7a828a77818881779b83637f6775817a7c8b7880887584847c8989799285758c847d79997e817e63837f788787779083738f80788e87749484718b827b74957da27961927b748c857292826f8e7e768b8373927f6f8a7e77749378af726098766f8c856b8e836a877d76867f7492786e8c7972769271c75868ad6a63948d5581955d71857e7972869a6276a16d668f9a57"
    },
    {
        "args": [
            "-selective-blur",
            "2x1+6553.5"
        ],
        "expected": "44488f843b82b7fe457cc36671b89b367dc45e41888f377eb5fc437fc64971b88d337ac1653d8481377eb2f94077be686db49a3178bf3e438a79377eb1f83f76bd656bb2983d74bb6639808f3077aff63d7ac1456bb28d3b72b964377e883077adf43b72b96166ad9a3471b83d3c837d2f76abf23970b75f65ac927a60a79e59a0c71e65a9f03774bb3f65ac87785ea59c579ec51c63a7ee356cb35b60a794356ab1ea458cc11b62a5ec336ab1595fa68c7e59a09f5299ce155ca3ea316eb53e60a7807f579e9b5198cd145ba2e93065ac5b5aa18f3364abf03e85ca11589fe62d64ab5659a08b72559ca04b92c80f569de42b"
    },
    {
        "args": [
            "-selective-blur",
            "2x1+0"
        ],
        "expected": "0d549be22970b7fe458cd31a61a8ef367dc40b5299e0276eb5fc438ad1185fa6ed347bc2095097de256cb3fa4188cf165da4eb3279c0074e95dc236ab1f83f86cd145ba2e93077be054c93da2168aff63d84cb1259a0e72e75bc034a91d81f66adf43b82c910579ee52c73ba01488fd61d64abf23980c70e559ce32a71b8ff468dd41b62a9f0377ec50c539ae1286fb6fd448bd21960a7ee357cc30a5198df266db4fb4289d0175ea5ec337ac1084f96dd246bb2f94087ce155ca3ea3178bf064d94db2269b0f73e85cc135aa1e82f76bd044b92d92067aef53c83ca11589fe62d74bb024990d71e65acf33a81c80f569de42b"
    },
    {
        "args": [
            "-selective-blur",
            "0x1+10%"
        ],
        "expected": "434990833c83b7fe457cc36671b89b367dc45e41888f377eb5fc437fc64971b88c337ac1643d8482377eb2f94077be676cb39b3178bf3e438a79377eb1f83f76bd646bb29a3c74bb6539808f3178aff63d7ac1446bb28d3c72b963377e893077adf43b72b96066ad9a3471b83d3d847c3077abf23970b75e65ac937960a79d59a0c61e65a9f03774bb3e65ac87785ea59d579ec51c63a7ee356cb35a60a794356ab1ea448bc11b62a5ec336ab1575fa68d7d59a09e5299ce155ca3ea316eb53d60a78080579e9c5198cd145ba2e93066ad5a5ba1903364abf03e85ca11589fe62d64ab56599f8b72559c9f4b92c80f569de42b"
    },
    {
        "args": [
            "-channel",
            "R",
            "-selective-blur",
            "2x1+10%"
        ],
        "expected": "44549b842970b7fe457cd31a71a8ef367dc45e52998f276eb5fc437fd11871a6ed337bc265509781256cb2fa4177cf166da4eb3179c03e4e9579236ab1f83f76cd146ba2e93d77be664c938f2168aff63d7acb126ba0e73b75bc644a91881f66adf43b72c910669ee53473ba3d488f7d1d64abf23970c70e659ce37a71b89e468dc71b62a9f03774c50c659ae1786fb69c448bc51960a7ee356cc30a6098df356db4ea4289c1175ea5ec336ac1085f96dd7e6bb29f4087ce155ca3ea316ebf066094db7f69b09b3e85cd135aa2e82f65bd045a92d93367aef03c83ca11589fe62d64bb025990d77265aca03a81c80f569de42b"
    },
    {
        "args": [
            "-virtual-pixel",
            "tile",
            "-selective-blur",
            "2x1+10%"
        ],
        "expected": "763a81a2337aaef53c80c74669b0915070b7663e859c337aacf33a7cc35f70b795377ac1643d847f3980b2f94078bf666db4994173ba623c8382357cb1f83f76bd656bb2983d74bb66398084337aaff63d75bc5e69b0963b72b964377e883077adf43b72b96166ad993970b762357c862e75abf23970b75f65ac927a60a79e59a0b32269a9f0376fb65863aa90785ea59c579ec51c63a7ee356cb35b60a7936560a79b539ac31a61a5ec336ab1595fa68c7e59a09f5299cb165da3ea3168af585da48b81559c9c5198ca155ca1e82f65ac5c5aa1907f539abb448baf246ba3ea316cb360559cab615aa1984e95a8246ba4eb32"
    }
];

for (const mode of ["command", "buffered", "sync"] as const)
it.each(fixtures)(`matches native $args (${mode})`, async ({ args: operation, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/image.ppm", input]]);
    await fs.writeFile("/image.ppm", input);
    const args = ["/image.ppm", ...operation, "-depth", "8", "rgb:-"];
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    let output: Uint8Array;
    if (mode === "command") {
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
            stderr: { write: async chunk => { errors.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }
        });
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(errors).toString()).toBe("");
        output = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        output = result.stdoutBytes ?? new Uint8Array();
    }
    expect(Buffer.from(output)).toEqual(Buffer.from(expected, "hex"));
});

for (const retained of [false, true])
it(`applies selective blur through mogrify (retained=${retained})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["/image.ppm", input]]);
    await fs.writeFile("/image.ppm", input);
    const result = await runMogrifyCli(["-selective-blur", "2x1+10%", "-depth", "8", "/image.ppm"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = retained ? await fs.readFile("/image.ppm") : files.get("/image.ppm")!;
    expect(Buffer.from(output).subarray(-243)).toEqual(Buffer.from(fixtures[0]!.expected, "hex"));
});

for (const retained of [false, true])
it.each(["garbage", "501x1+10%", "0x10000+10%"])(`rejects invalid or unbounded geometry %s (retained=${retained})`, async geometry => {
    const fs = new MemoryFileSystem(), files = new Map([["/image.ppm", input]]);
    await fs.writeFile("/image.ppm", input);
    const result = await runMagickCli(["/image.ppm", "-selective-blur", geometry, "rgb:-"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(geometry === "garbage" ? "Invalid selective-blur geometry" : "Selective blur radius exceeds 500");
    expect(result.stdoutBytes?.length ?? 0).toBe(0);
});

it("keeps filesystem reads bounded across raster blocks", async () => {
    const pixels = Buffer.concat([Buffer.from("P6\n1031 3\n255\n"), Buffer.from(Array.from({ length: 1031 * 3 * 3 }, (_, i) => (i * 71 + 13) % 256))]);
    const fs = new MemoryFileSystem(), files = new Map([["/image.ppm", pixels]]);
    await fs.writeFile("/image.ppm", pixels);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file selective blur I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = ["/image.ppm", "-selective-blur", "2x1+10%", "-depth", "8", "rgb:-"];
    const buffered = await runMagickCli(args, files);
    const retained = await runMagickCli(args, { filesystem, cwd: "/" });
    expect(buffered.exitCode).toBe(0);
    expect(retained.exitCode).toBe(0);
    expect(retained.stdoutBytes).toEqual(buffered.stdoutBytes);
});

for (const mode of ["command", "buffered", "sync"] as const)
it.each(["2x3+100%", "%[option:radius]x3+100%", "%[fx:w]x3+100%"])(`expands selective blur geometry %s (${mode})`, async geometry => {
    const args = ["xc:#406070", "xc:#809080", "+append", "-set", "option:radius", "2", "-selective-blur", geometry, "-depth", "8", "rgb:-"];
    let output: Uint8Array;
    if (mode === "command") {
        const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
            stderr: { write: async chunk => { errors.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }
        });
        expect(Buffer.concat(errors).toString()).toBe("");
        expect(result.exitCode).toBe(0);
        output = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, new Map()) : await runMagickCli(args, new Map());
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        output = result.stdoutBytes!;
    }
    // Complete RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
    expect(Buffer.from(output).toString("hex")).toBe("597376677d7a");
});
