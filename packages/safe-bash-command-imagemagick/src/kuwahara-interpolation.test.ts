import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/kuwahara-interpolation.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: input -interpolate METHOD -kuwahara 2x1 -depth 8 rgba:-
const cases = [
    { method: "bilinear", expected: "5e90915d7b947f7f78997a7b7b947f7f92438a879a1d7898a41772a8a41772a86e6c75778f5579898f5c78818f5579898f5c78819c237c9ba61c76aaa61c76aa6865936f90706178916d647e9070617892438a87a1348397ab2a7da3ab2a7da36e6c75778f5579898f5c78818f5579898f5c78818d617977935f7d77b977866e7588537a907061787cbf5a657ac65c6380c264647ac65c6380c264649899885a81c2667a7bc5697377cc6c6f76d16e6e77d2726b76d16e6e77d2726b6fb792538ae05a9077cc707675d0747475d5757374d7786f75d5757374d7786f62bf98548ae05a9077cc707675d0747477cc707674d7786f75d5757374d7786f62bf9854" },
    { method: "nearest", expected: "5e90915d7c8e82807a9a7c7e7c8e8280984c8986a41772a8a41772a8a41772a87177607992616b808b6f667192616b808b6f6671a8217aaca8217aaca8217aac6c618b758c8a5068938258738c8a5068984c8986af358299af358299af3582997177607992616b808b6f667192616b808b6f66718a776966996f7570ae8786637899467c8c8a506877cb646977cf69677bcc6e6677cf69677bcc6e667dae8b5279cb6d7875cc737375d3747474d6767174d77a6c74d6767174d77a6c62bf98548ae05a9075cc737375d3747474d6767174d77a6c74d6767174d77a6c62bf98548ae05a9075cc737375d3747475cc737374d77a6c74d6767174d77a6c62bf9854" },
    { method: "integer", expected: "5e90915d7a9a7c7e779878797a9a7c7e8b3e8c878e247f88a41772a8a41772a86c618b758c4b86908f4f858f8c4b86908f4f858f8e247f88a41772a8a41772a8646a9c6a915d6d868d5c6d85915d6d868b3e8c8794338990a8217aaca8217aac6c618b758c4b86908f4f858f8c4b86908f4f858f8e5386849151887fc36a877971776079915d6d8685b051627cbc4d5e7ebe545d7cbc4d5e7ebe545dae8786638ab6627f84ba62767ac3636a77cb646977cf696777cb646977cf69677dae8b528ae05a9079cb6d7875cc737375d3747474d6767175d3747474d6767162bf98548ae05a9079cb6d7875cc737379cb6d7874d6767175d3747474d6767162bf9854" },
    { method: "average", expected: "5e90915d7b947f7f78997a7b7b947f7f92448a87991e7998a41772a8a41772a86e6c7577905679898f5d7781905679898f5d77819b247d9ba61c76aaa61c76aa6866936f90726078916f637e9072607892448a87a1358397ac2b7ea3ac2b7ea36e6c7577905679898f5d7781905679898f5d77818d63777793617c77b879866e7588537a907260787cbf59657ac55b6380c264647ac55b6380c26464959b885a81c2667a7bc5697377cb6b6f76d16e6e77d2726b76d16e6e77d2726b6fb792538ae05a9077cc707675d0747475d5757374d7786f75d5757374d7786f62bf98548ae05a9077cc707675d0747477cc707674d7786f75d5757374d7786f62bf9854" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const { method, expected } of [...cases,
    { method: "default", expected: cases[0]!.expected },
    { method: "reset", expected: cases[0]!.expected },
    { method: "nearest-neighbor", expected: cases[1]!.expected },
]) it(`Kuwahara interpolation ${method} (${mode})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const settings = method === "default" ? [] : method === "reset" ? ["-interpolate", "nearest", "+interpolate"] : ["-interpolate", method];
    // Changing the setting after the filter must not affect retained execution.
    const args = ["/in.png", ...settings, "-kuwahara", "2x1", "-interpolate", "integer", "PNG32:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([8, 8]);
    expect(Buffer.from(output.data).toString("hex")).toBe(expected);
});

it("rejects unsupported mesh interpolation without replacing output", () => {
    const keep = Buffer.from("KEEP");
    const files = new Map([["/in.png", input], ["/out.png", keep]]);
    const result = runMagickCliSync(["/in.png", "-interpolate", "mesh", "-kuwahara", "2x1", "/out.png"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unsupported Kuwahara interpolation: mesh");
    expect(files.get("/out.png")).toBe(keep);
});
