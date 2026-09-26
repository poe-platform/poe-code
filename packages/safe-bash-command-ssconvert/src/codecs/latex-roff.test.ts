import { expect, it } from "vitest";
import { Volume } from "memfs";
import golden from "./latex-roff-golden.json" with { type: "json" };
import currentStyleGolden from "./document-style-current-golden.json" with { type: "json" };
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };
for (const [name, fixture] of Object.entries({ ...golden, ...currentStyleGolden })) for (const [format, capture] of Object.entries(fixture.exports)) {
  it(`matches native ${format} ${name} bytes through the shared memfs command engine`, async () => {
    const volume = Volume.fromJSON({ "/input.gnumeric": fixture.source });
    const path = (uri: string) => uri.startsWith("file:") ? new URL(uri).pathname : uri;
    const engine = createEngine({ codecs: [], limits: context.limits, environment: context.environment, filesystem: {
      async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(path(uri)) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(path(uri), bytes); }
    } });
    const stderr: Uint8Array[] = [];
    try {
      const result = await runCommand(["-T", `Gnumeric_html:${format}`, "/input.gnumeric", "/output"], engine, { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } } });
      expect(result.exitCode).toBe(capture.status);
      expect(Buffer.concat(stderr).toString()).toBe(capture.stderr);
      expect(new Uint8Array(volume.readFileSync("/output") as Uint8Array)).toEqual(new Uint8Array(Buffer.from(capture.base64, "base64")));
      expect(volume.readFileSync("/input.gnumeric", "utf8")).toBe(fixture.source);
      expect(volume.readdirSync("/")).toEqual(["input.gnumeric", "output"]);
    } finally { await engine.dispose(); }
  });
}
