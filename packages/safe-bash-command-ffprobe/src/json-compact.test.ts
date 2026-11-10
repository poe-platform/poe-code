import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Literal stdout from native ffprobe 7.0.2 for equivalent 8 kHz mono PCM WAVs.
const cases = [
  {
    name: "one packet", samples: 80, selection: ["-show_entries", "packet=size"],
    expected: '{\n    "packets": [\n        { "size": "160" }\n    ]\n}\n'
  },
  {
    name: "multiple packets", samples: 2500, selection: ["-show_entries", "packet=size"],
    expected: `{
    "packets": [
        { "size": "1024" },
        { "size": "1024" },
        { "size": "1024" },
        { "size": "1024" },
        { "size": "904" }
    ]
}
`
  },
  {
    name: "interleaved packets and frames", samples: 80, selection: ["-show_entries", "packet=size:frame=nb_samples"],
    expected: `{
    "packets_and_frames": [
        { "type": "packet", "size": "160" },
        { "type": "frame", "nb_samples": 80 }
    ]
}
`
  },
  {
    name: "format scalars and escaped tags", samples: 80, selection: ["-show_entries", "format=nb_streams:format_tags=title"],
    expected: '{\n    "format": { "nb_streams": 1,\n        "tags": { "title": "a,b|c\\"d" } }\n}\n'
  },
  {
    name: "stream and nested disposition", samples: 80, selection: ["-show_entries", "stream=index:stream_disposition=forced"],
    expected: `{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        { "index": 0,
            "disposition": { "forced": 0 } }
    ]
}
`
  },
  {
    name: "empty array", samples: 80, selection: ["-show_chapters"],
    expected: '{\n    "chapters": [\n\n    ]\n}\n'
  },
  {
    name: "empty tag object", samples: 80, selection: ["-show_entries", "format_tags=missing"],
    expected: '{\n    "format": {         "tags": {  } }\n}\n'
  },
  {
    name: "absent stream tags", samples: 80, selection: ["-show_entries", "stream_tags"],
    expected: '{\n    "streams": [\n        {  }\n    ]\n}\n'
  },
  {
    name: "missing stream tags", samples: 80, selection: ["-show_entries", "stream_tags=missing"],
    expected: '{\n    "streams": [\n        {  }\n    ]\n}\n'
  },
  { name: "no sections", samples: 80, selection: [], expected: "{\n\n}\n" }
];

for (const writer of ["json=c=1", "json=compact=1"]) {
  for (const route of ["automatic", "explicit", "stdin", "readFile"] as const) {
    it.each(cases)(`matches native compact JSON via ${route}, ${writer}: $name`, async ({ samples, selection, expected }) => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(samples)] }, { tags: { title: 'a,b|c"d' } });
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
