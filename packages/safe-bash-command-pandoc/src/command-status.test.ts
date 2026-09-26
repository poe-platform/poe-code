import {expect, it} from "vitest";
import {Volume} from "memfs";
import {createPandocCommand} from "./safe-bash.js";

const encode = (value: string) => new TextEncoder().encode(value);

it.each([
  {name: "unknown option", input: encode("Matrix"), extra: ["--not-an-option"], code: "E_OPTION", status: 2},
  {name: "invalid UTF-8", input: Uint8Array.of(0xff), extra: [], code: "E_ENCODING", status: 4},
  {name: "input ceiling", input: encode("Matrix"), extra: [], code: "E_LIMIT", status: 7, limits: {inputBytes: 1}},
  {name: "blocked PDF font", input: encode("Matrix"), extra: ["--pdf-font=serif"], code: "E_CAPABILITY", status: 3, to: "pdf"}
])("preserves typed $name status and existing memfs output", async ({input, extra, code, status, limits, to}) => {
  const volume = Volume.fromJSON({"/result": "keep"});
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createPandocCommand({...(limits === undefined ? {} : {limits})}).execute({
    args: ["-f", "commonmark", "-t", to ?? "plain", ...extra, "-o", "/result"],
    stdin: [input], signal: new AbortController().signal,
    writeFile: async (path, bytes) => {volume.writeFileSync(path, bytes);},
    stdout: {write: async bytes => {stdout.push(bytes);}},
    stderr: {write: async bytes => {stderr.push(bytes);}}
  });
  expect(result.exitCode).toBe(status);
  expect(stdout).toEqual([]);
  expect(new TextDecoder().decode(Buffer.concat(stderr)).startsWith(`${code}:`)).toBe(true);
  expect(volume.readFileSync("/result", "utf8")).toBe("keep");
});
