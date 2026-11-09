import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe, formatFfprobeSourceChunks } from "./media.js";

const bytes = new TextEncoder().encode(";FFMETADATA1\ntitle=Control\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=400\ntitle=c0\n");
const chapter = {
  id: 0, time_base: "1/1000", start: 0, start_time: "0.000000",
  end: 400, end_time: "0.400000", tags: { title: "c0" }
};

for (const route of ["file", "stdin", "sync"]) {
  for (const writer of ["json", "json=c=1"]) {
    it.each([
      [["-show_entries", "chapter=id"], { chapters: [{ id: 0 }] }],
      [["-show_entries", "chapter=start,end_time"], { chapters: [{ start: 0, end_time: "0.400000" }] }],
      [["-show_entries", "chapter=id:chapter_tags=title"], { chapters: [{ id: 0, tags: { title: "c0" } }] }],
      [["-show_entries", "chapter=id:chapter_tags="], { chapters: [{ id: 0 }] }],
      [["-show_entries", "chapter=missing"], { chapters: [{}] }],
      [["-show_entries", "chapter="], {}],
      [["-show_entries", "chapter"], { chapters: [chapter] }],
      [["-show_chapters"], { chapters: [chapter] }],
      [["-show_chapters", "-show_entries", "chapter=id"], { chapters: [{ id: 0 }] }]
    ])(`selects chapter fields via ${route} with ${writer}: %j`, async (selection, expected) => {
      const args = ["-v", "error", ...selection, "-of", writer, route === "file" ? "/single.ffmeta" : "-"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/single.ffmeta", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}

it("filters asynchronous chapters without reading excluded tag values", async () => {
  const chapters = (async function* () {
    yield { ...chapter, tags: { title: { kind: "text" as const, chunks() {
      throw new Error("Excluded tag must not be read");
    } } } };
  })();
  let output = "";
  for await (const chunk of formatFfprobeSourceChunks({ streams: [], chapters }, {
    printFormat: "json", showEntries: "chapter=id", showFormat: false, showStreams: false,
    showPackets: false, showFrames: false, showChapters: false, showPrograms: false
  })) output += chunk;
  expect(JSON.parse(output)).toEqual({ chapters: [{ id: 0 }] });
});
