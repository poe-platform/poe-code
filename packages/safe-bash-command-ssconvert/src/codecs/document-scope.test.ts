import { expect, it } from "vitest";
import { Volume } from "memfs";
import captures from "./latex-roff-scope-golden.json" with { type: "json" };
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";

for (const [name, capture] of Object.entries(captures)) it(`matches native document scope ${name}`, async () => {
  const signal = new AbortController().signal;
  const volume = Volume.fromJSON({ "/input.gnumeric": capture.source, "/keep": "untouched" });
  const path = (uri: string) => uri.startsWith("file:") ? new URL(uri).pathname : uri;
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 }, filesystem: {
    async read(uri) { return [new Uint8Array(volume.readFileSync(path(uri)) as Uint8Array)]; },
    async write(uri, bytes) { volume.writeFileSync(path(uri), bytes); }
  } });
  const stderr: Uint8Array[] = [], stdout: Uint8Array[] = [];
  try {
    const result = await runCommand(["-T", `Gnumeric_html:${capture.format}`, ...capture.args, "/input.gnumeric", "fd://1"], engine, { signal, stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } } });
    expect(result.exitCode).toBe(capture.status);
    expect(Buffer.concat(stderr).toString()).toBe(capture.stderr);
    expect(Buffer.concat(stdout)).toEqual(Buffer.from(capture.base64, "base64"));
    expect(volume.toJSON()).toEqual({ "/input.gnumeric": capture.source, "/keep": "untouched" });
  } finally { await engine.dispose(); }
});
