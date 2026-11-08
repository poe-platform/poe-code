import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));

async function run(names: string[], target: string, extra: string[] = []) {
  const fs = new MemoryFileSystem();
  for (const name of names) await fs.writeFile(`/${name}`, png);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", ...extra, "-show_packets", "-show_entries", "packet=pts,pts_time:packet_tags", "-of", "json", target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic };
}

it.each(["in%d.png", "/in%d.png", "./in%d.png", "in%03d.png", "in1.png"])("exports actual packet paths for %s", async target => {
  const names = target.includes("03") ? ["in001.png", "in002.png"] : ["in1.png", "in2.png"];
  const result = await run(names, target, ["-f", "image2", "-export_path_metadata", "1"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  const prefix = target.startsWith("./") ? "./" : target.startsWith("/") ? "/" : "";
  expect(JSON.parse(result.output).packets).toEqual(names.slice(0, target === "in1.png" ? 1 : 2).map((name, index) => ({
    pts: index, pts_time: (index / 25).toFixed(6),
    tags: { "lavf.image2dec.source_path": prefix + name, "lavf.image2dec.source_basename": name },
    side_data_list: [{ side_data_type: "Strings Metadata" }]
  })));
});

it("does not export packet paths when explicitly disabled", async () => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "image2", "-export_path_metadata", "0"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual([{ pts: 0, pts_time: "0.000000" }, { pts: 1, pts_time: "0.040000" }]);
});

it("exports literal image packet paths in the synchronous evaluator", () => {
  const output = evalSyncFfprobe(png, ["-f", "image2", "-export_path_metadata", "1", "-show_packets", "-of", "json", "dir/in.png"], () => png);
  expect(output).toBeDefined();
  expect(JSON.parse(output!).packets[0]).toMatchObject({
    tags: { "lavf.image2dec.source_path": "dir/in.png", "lavf.image2dec.source_basename": "in.png" },
    side_data_list: [{ side_data_type: "Strings Metadata" }]
  });
});

it("filters packet tags and side data independently", () => {
  const output = evalSyncFfprobe(png, ["-f", "image2", "-export_path_metadata", "1", "-show_packets",
    "-show_entries", "packet=:packet_tags=lavf.image2dec.source_basename:packet_side_data=", "-of", "json", "dir/in.png"], () => png);
  expect(JSON.parse(output!).packets).toEqual([{ tags: { "lavf.image2dec.source_basename": "in.png" } }]);
});

it.each([{ extra: [] }, { extra: ["-export_path_metadata", "0"] }])("omits literal image metadata with $extra", async ({ extra }) => {
  const result = await run(["in.png"], "in.png", ["-f", "image2", ...extra]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual([{ pts: 0, pts_time: "0.000000" }]);
});

it("keeps packet metadata when only packet fields are selected", () => {
  const output = evalSyncFfprobe(png, ["-f", "image2", "-export_path_metadata", "1", "-show_packets",
    "-show_entries", "packet=pts", "-of", "json", "dir/in.png"], () => png);
  expect(JSON.parse(output!).packets).toEqual([{
    pts: 0, tags: { "lavf.image2dec.source_path": "dir/in.png", "lavf.image2dec.source_basename": "in.png" },
    side_data_list: [{ side_data_type: "Strings Metadata" }]
  }]);
});
