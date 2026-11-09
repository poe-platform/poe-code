import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAsAAAAJCAYAAADkZNYtAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDc6MTkrMDA6MDBpWuwQAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ3OjE5KzAwOjAwGAdUrAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0NzoxOSswMDowME8SdXMAAAFoSURBVBjTY2bXC61ZsPn4rXeMoiv2nH/8jW/h1hO33zGJrtx74ckP7vmbzj36yim19uCVl38EFjOdOnXq1I0bN27cvn379r179+7dvXv37vv3799/+vTp09evX79++PDhAxsbGxsnJycnEw8PDw8zMzOzrKysrIKCgoKysrKymJiYmImJiYm5ubm5lZWVlaampqa3t7c3g3ZQ5YLz32RdimcdfGGd1LnhAbteaOuay7+0Aivmf5dzzZl75LWQc9bEHS8FzOMYdj/iNEjq3HCd0yC8bsP1f6rt667+0Q+rXXL9n6pP/bKzX6KbVl5g0Q6qXHvltxLT7NmzZ1+9evUqzN3r1q1b9+bNmzcwdx88ePAgMzMzMxsbGxsTJycn55UrV65ISUlJwdz9/Pnz54aGhoYwd//69euXh4eHB+Oqiz/k10PB/////29AAiwsLCwbkQCjeVzrmk1IgI+Pj28zEhAWFhbeAgUAZE/RXNTRPyoAAAAASUVORK5CYII=", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: input followed by N repetitions of -emboss 2x1,
// saved as PNG32 and decoded with -depth 8 rgba:-. Intermediate pixels stay in memory.
const cases: [number, string[], string][] = [
    [
        1,
        [],
        "000065ff65774b0000416ced00ffff0097beedff000028c60028c600288cb0ffff00008877416500326581ffedff007788dfffff0000005a416ce60065b7dfff000000442b4f7300009ec6ff00ffff00284b7300285aa9ff00ffff00c9edffff072fa5ff00ffff00c6e6ffff005677ff0bffff0088e2ffff005d7eff0000ff00dfffffff000000cd0000ff0073cdedff000b399aff00005377d7edff00000019ff00006c88ac97000000002800ffff004165df006588a5dbffffff00ed00000088acdbff285a77a50000ff007a9adfff5d859ed70007327e480000002f657ab4285377c2ff000073a588a900326581ff000032a2002bff0065d7edff1d4f73ff000000970000ff007797beff002f65ffff00008500284f0097bedfff000073ff00ffff000019440093bbdfff000073ffff00000e00284f0032c2dfff00285aff000000ac000bc60041c6e6ff0b3265ff000041c60000ff004fcdedff006f8cdf0007327e00ffff0065072f004b73a5ff6588ace2ffffff000000c2006f8ce6ffa2d7edff0000005a00ffff00"
    ],
    [
        2,
        [],
        "00008aff4b8a4500000003ff7b93b100c6ffffff000000ff247e930000b4ccffff0000ab2d7b8d002d788affdbff00ffc3ffffffffffff004887bd0093ffffffffffff00127b990000bdd5ff8accd800156f8a001b57bdff458a9300ffffffff0327a8ff7bbacf00ffffffff006f8dff3cb7c30093d2ffff007b99ff276cab00ffffffff000000ff092da8008ad2ffff000000d500ffff007bd5dbff87bdd200ff00002a879ccc00bddbff0093abb7002d788a00933969d21b397800cf060c00999cc3ff0f487bdb780c24008aa2ccff6c4278ff0000008a151b210000000000000f2dffff000060ae879c00307b8dff000000ff3948ab007bffffff216f8aff000000cf000087009cb4ccff00308affff00009312427b00ffffffff00007bff57c3cf000f3c7b00ffffffff00007eff2dd2ff00031b570000ffffff002466ff000000ff213393002acfffff092a75ff000000ff3042ae000fc3d5ff008dabffffffff00001548000c0f0f004887a8ffdb242dab2d698d000f0f4b008193cfffffffd8ffaeffff00065a7b00"
    ],
    [
        3,
        [],
        "0000c5ff61800000000000ffb0d5d500ffffffff000000ff12aab90000d1ffffff0000ff31768f00317389ffc5ff00ffffffffffd1d5d500528fbc00c8ffffffc8d1d500038fa40000d8ffff8fbcd50018738f000f37c5ff52797900ffffffff0021a4ff8fc5d500ffffffff00648fff3db9c20092c2ffff0080a1ff1e52b000ffffffff000000ff0027a40083ffffff000000ff03618c0061d5c8ff498fb00000bcd8008398bc00aa9bb000989ba1004661b000950000ff09122100b90f1b00a47cb0ff00185bff2e0f0f008fa1bcff520021ff000000a71b1b1b0095809b00000000ffff000009b05e8000379295ff000000ff4046a10083ffffff2b8fa7ff000000ff00007c00d5ffffff003198ffff0000c218467300ffffffff000073ff49c5d50012437c00ffffffff000079ff18b9c2000331860000ffffff002152ff000000ff21408f0000ffffff032b6dff000000ff3743a4000098c2ff008fa4ff06d5d500002158000c0c0c004389a4ff00ffff00522b5200120c0c008092bfffffffc8ff80b9b0000c92a700"
    ],
    [
        2,
        [
            "-alpha",
            "off"
        ],
        "000000ff00ffffff000000ffff0000ff0000ffff000000ffffff00ff000000ffff0000ff00ffffff000000ffffff00ff00ffffff000000ffffff00ff00ffffff000000ffffffffff00ffffffff0000ffffffffff0000ffffff0000ffffffffff0000ffffff0000ffffffffff000000ffff0000ff00ffffff000000ffffff00ffffffffff000000ffffff00ff00ffffff000000ffff0000ff00ffffff000000ffff0011ff0000ffff000000ffff0000ffffff00ff210000ff000000ff00ffffff2c0000ff00162cffffff00ff0000ffff270000ff000016ffffffffff000000ff0b2127ffff0000ff00ffffff000000ff000000ffffff00ff00ffffff000000ff000000ffffff00ff000000ff000000ffff0000ffffffffffffffffff0000ffffff0000ffffffffffffffffff0000ffffff0000ffffffffff00ffffff000000ff000000ffffff00ff00ffffff000000ff000000ffffff00ff00ffffff002cffff000000ffff0000ffffffffff0000ffff270000ff000000ffffff00ff0000ffff2c00ffff000000ffff0000ff"
    ],
    [
        2,
        [
            "-evaluate",
            "Multiply",
            "0.37"
        ],
        "00008aff488a450000000fff8490ae00c3ffffff000000ff2484900000b1c9ffff0000b72d7e8d002d788affd8ff00ffc3ffffffffffff00488aba0096ffffffffffff001281960000bad8ff8dc6cf00156f8a001e51b7ff458a8a00ffffffff0327a8ff7eb7c900ffffffff00758dff39b4c00096d2d8ff00879cff2769a800ffffffff000000ff092da8008ad8ffff000000ff00ffff0084d8d8ff87bdc900ff0000458a9cc900bdd8ff0090a5ae002d788a00904278ff1b367800c9060900969cc0ff124887ff780924008aa5c9ff694884ff0000009615181b000000000f001230ffff00007eab8a9900307e8dff000000ff3948a8007effffff216f8aff000000ff000087009cb4c9ff00338affff0000a812427e00ffffffff000084ff51bdcf000f3c7e00ffffffff000087ff2dd8ff00031b4e0000ffffff002463ff000000ff2436900024cfffff092a78ff000000ff3345ae000fc0d8ff008da8ffffffff0000154500090c0f00488aa8ffc93645b730698d000c0f48008793cfffffffd8d8aeffff0006547e00"
    ]
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`preserves working samples across %i emboss operations with %j (${mode})`, async (count, settings, expected) => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", ...settings, ...Array.from({ length: count }, () => ["-emboss", "2x1"]).flat(), "PNG32:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([11, 9]);
    expect(Buffer.from(output.data).toString("hex")).toBe(expected);
});
