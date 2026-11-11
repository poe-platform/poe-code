import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI observations, including the passing controls.
describe.each(["command", "retained", "buffered", "sync"] as const)("explicit option properties (%s)", mode => {
  it.each([
    { options: ["-compose", "Screen"], property: "option:compose", expected: "Screen" },
    { options: ["-gravity", "West"], property: "option:gravity", expected: "West" },
    { options: ["-filter", "Box"], property: "filter", expected: "Box" },
    { options: ["-background", "blue"], property: "background", expected: "blue" },
    { options: ["-interpolate", "Nearest"], property: "interpolate", expected: "Nearest" },
    { options: ["-virtual-pixel", "Mirror"], property: "virtual-pixel", expected: "Mirror" },
    { options: ["-compose", "Screen"], property: "compose", expected: "Screen" },
    { options: ["-interlace", "Line"], property: "interlace", expected: "Line" },
    { options: ["-set", "filter", "Box"], property: "filter", expected: "Box" },
    { options: ["-filter", "Box", "-set", "filter", "Point"], property: "filter", expected: "Point" },
    { options: ["-filter", "Box", "-set", "filter", "Point"], property: "option:filter", expected: "Box" },
    { options: ["-filter", "Box", "-set", "label", "%[filter]", "-filter", "Point"], property: "label", expected: "Box" },
    { options: ["-filter", "Box", "-filter", "Point"], property: "option:filter", expected: "Point" },
    { options: ["-define", "filter=Point", "-filter", "Box"], property: "filter", expected: "Box" },
    { options: ["-filter", "Box", "-define", "filter=Point"], property: "filter", expected: "Point" },
    ...[
      ["compose", "sCrEeN"], ["gravity", "wEsT"], ["filter", "bOx"],
      ["background", "bLuE"], ["interpolate", "nEaReSt"],
      ["virtual-pixel", "mIrRoR"], ["interlace", "lInE"]
    ].flatMap(([setting, value]) => [
      { options: [`-${setting}`, value!], property: `OPTION:${setting!.toUpperCase()}`, expected: value! },
      { options: [`-${setting}`, value!], property: `option:${setting}`, expected: value!, beforeInput: true },
      { options: [`-${setting}`, value!, `+${setting}`], property: `option:${setting}`, expected: setting === "interlace" ? "undefined" : setting === "gravity" ? "none" : "", missing: setting !== "interlace" && setting !== "gravity" }
    ])
  ])("resolves $property with $options", async ({ options, property, expected, beforeInput = false, missing = false }) => {
    const argv = [...(beforeInput ? [...options, "xc:red"] : ["xc:red", ...options]), "-format", `%[${property}];`, "info:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: `${expected};`, stderr: missing ? `magick: unknown image property '%[${property}]'\n` : "" });
  });
});
