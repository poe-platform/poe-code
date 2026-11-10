import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const bytes = Uint8Array.from(Buffer.from(
  "524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000",
  "hex"
));

// Literal expanded JSON from native ffprobe 7.0.2 for this WAV fixture.
const cases = [
  {
    name: "empty program arrays", selection: ["-show_entries", "stream=index"],
    expected: `{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        {
            "index": 0
        }
    ]
}
`
  },
  {
    name: "empty stream object", selection: ["-show_entries", "stream_tags=missing"],
    expected: `{
    "streams": [
        {

        }
    ]
}
`
  },
  {
    name: "empty nested tags", selection: ["-show_entries", "format_tags=missing"],
    expected: `{
    "format": {
        "tags": {

        }
    }
}
`
  },
  {
    name: "empty chapters", selection: ["-show_chapters"],
    expected: `{
    "chapters": [

    ]
}
`
  },
  { name: "no sections", selection: [], expected: "{\n\n}\n" },
  {
    name: "nonempty format", selection: ["-show_entries", "format=size"],
    expected: `{
    "format": {
        "size": "86"
    }
}
`
  }
];

for (const writer of ["json", "json=c=0", "json=compact=0"]) {
  for (const route of ["automatic", "explicit", "stdin", "readFile"] as const) {
    it.each(cases)(`matches native expanded JSON via ${route}, ${writer}: $name`, async ({ name, selection, expected }) => {
      // The size of a pipe is unavailable; native JSON omits that field.
      if (route === "stdin" && name === "nonempty format") expected = '{\n    "format": {\n\n    }\n}\n';
      const base = new MemoryFileSystem();
      await base.writeFile("/input.wav", bytes);
      const fs = route === "readFile" ? new Proxy(base, {
        get(target, key) {
          if (key === "openReadFile" || key === "readStream") return undefined;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) : base;
      const args = ["-v", "error", ...(route === "explicit" ? ["-f", "wav"] : []), "-of", writer, ...selection, route === "stdin" ? "-" : "/input.wav"];
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(expected);
    });
  }
}
