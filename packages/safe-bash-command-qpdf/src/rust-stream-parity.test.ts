import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createQpdfCommand, runQpdfCli} from "./index.js";

interface Report {status: number; stdout: string; stderr: string; buffered?: Report}
const {cases} = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/stream-recovery.json", import.meta.url), "utf8")) as {cases: Record<string, {pdf: string}>};
const {cases: reference} = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/qpdf-stream-parity.json", import.meta.url), "utf8")) as {cases: Record<string, {reports: Record<string, Report>; rewritten: {stream: string; dictionary: string}}>};

for (const [name, {pdf}] of Object.entries(cases)) it(`preserves both JavaScript stream recovery routes: ${name}`, async () => {
  const {reports, rewritten} = reference[name]!;
  const bytes = Buffer.from(pdf, "base64"), fs = createMemoryFileSystem();
  const files = new Map<string, Uint8Array>([["in.pdf", bytes]]);
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  for (const [flags, want] of Object.entries(reports)) for (const zero of [false, true]) {
    const args = ["in.pdf", ...flags.split(" "), ...(zero ? ["--warning-exit-0"] : [])];
    const buffered = await runQpdfCli(args, files), bufferedWant = want.buffered ?? want;
    assert.deepEqual([buffered.exitCode, buffered.stderr, Buffer.from(buffered.stdoutBytes ?? buffered.stdout)],
      [zero && bufferedWant.status === 3 ? 0 : bufferedWant.status, bufferedWant.stderr, Buffer.from(bufferedWant.stdout, "base64")], `${flags}/${zero}/buffered`);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({
      command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
      signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
      stdout: {async write(bytes) {stdout.push(bytes.slice());}},
      stderr: {async write(bytes) {stderr.push(bytes.slice());}}
    });
    assert.deepEqual([result.exitCode, Buffer.concat(stderr).toString(), Buffer.concat(stdout)],
      [zero && want.status === 3 ? 0 : want.status, want.stderr, Buffer.from(want.stdout, "base64")], `${flags}/${zero}/streaming`);
    if (flags === "--stream-data=uncompress out.pdf" && !zero) {
      for (const output of [files.get("out.pdf")!, await fs.readFile("/out.pdf")]) {
        const outputFiles = new Map([["out.pdf", output]]);
        const page = await runQpdfCli(["out.pdf", "--show-pages"], outputFiles);
        assert.equal(page.exitCode, 0, page.stderr);
        const stream = page.stdout.split("content:\n")[1]!.trim().split(" ")[0]!;
        const data = await runQpdfCli(["out.pdf", `--show-object=${stream}`, "--raw-stream-data"], outputFiles);
        assert.deepEqual([data.exitCode, data.stderr, Buffer.from(data.stdoutBytes ?? data.stdout)],
          [0, "", Buffer.from(rewritten.stream, "base64")]);
        const dictionary = await runQpdfCli(["out.pdf", `--show-object=${stream}`], outputFiles);
        assert.equal(dictionary.exitCode, 0, dictionary.stderr);
        assert.equal(dictionary.stdout, rewritten.dictionary);
      }
    }
  }
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(bytes));
  assert.deepEqual(files.get("in.pdf"), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
