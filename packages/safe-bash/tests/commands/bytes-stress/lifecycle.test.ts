import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { FsError, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createByteCommands } from "../../../src/commands/bytes/index.js";
import { bytes, chunks, run } from "./helpers.js";

// Native -c captures of "payload\n" repeated 8193 times: decoding crosses 64 KiB.
const nativeFrames = {
  bzip2: "425a683931415926535944441e2f007003418000102404c020200070430014a81a6e000ec001e8003b00064001900064001c8003e2ee48a70a12088883c5e0",
  xz: "fd377a585a000004e6d6b44604c05d88800421011600000000000000cb99400be1000700555d0038184b99750f4607d3d8636bdebdfa9910f157d097e73817fe277ea4ae784c8fbac8145ddc5a421918a718a31909d7ee918209e34fe88ae69a0a70575e1d4d47607d6759a94b06220b3d280f5f45036dc2dfbd5f000000000028a17c1669edeee70001798880040000606dbe84b1c467fb020000000004595a",
  zstd: "28b52ffd0458850000407061796c6f61640a0100fdffe9850b61ae952d",
} as const;
const decoderFormats: Readonly<Record<string, keyof typeof nativeFrames>> = {
  bunzip2: "bzip2", bzcat: "bzip2", unxz: "xz", xzcat: "xz", unzstd: "zstd", zstdcat: "zstd",
};

function inputFor(name: string, payload: Buffer): Buffer {
  if (name === "gunzip" || name === "zcat") return gzipSync(payload);
  const format = decoderFormats[name];
  return format === undefined ? payload : Buffer.from(nativeFrames[format], "hex");
}

for (const name of createByteCommands().map(command => command.name)) {
  test(`${name}: quota-rejecting byte sink fails without draining further output`, { timeout: 3000 }, async () => {
    const payload = bytes(65537);
    const input = inputFor(name, payload);
    let closed = false;
    const source = (async function* () { try { yield* chunks(input, 1024); } finally { closed = true; } })();
    let attempted = 0;
    const result = await run(name, [], source, {}, {
      stdout: { async write(data) { attempted++; assert(data.length > 8); throw new FsError("EFBIG", { message: "independent stdout quota" }); } },
    });
    assert.equal(result.exitCode, 1, name); assert.match(result.stderr.toString(), /quota/u);
    assert.equal(attempted, 1); assert.equal(closed, true);
  });

  for (const waiting of ["source", "sink"] as const) test(`${name}: independent ${waiting} cancellation and late rejection`, { timeout: 3000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("independent byte cancellation");
    let reject!: (reason: unknown) => void;
    const blocked = new Promise<never>((_, failure) => { reject = failure; });
    const source: ByteSource = { [Symbol.asyncIterator]() { return { next: () => blocked, return: async () => ({ done: true as const, value: undefined }) }; } };
    const payload = inputFor(name, Buffer.from("payload"));
    const overrides: Partial<CommandContext> = { signal: controller.signal, ...(waiting === "sink" ? { stdout: { write: () => blocked } } : {}) };
    const task = run(name, [], waiting === "source" ? source : payload, {}, overrides);
    const timer = setTimeout(() => controller.abort(reason), 15);
    try {
      await assert.rejects(task, error => error === reason);
      reject(new Error("late uncooperative failure"));
      await new Promise<void>(resolve => setImmediate(resolve));
    } finally { clearTimeout(timer); reject(new Error("cleanup")); }
  });
}

for (const [name, args] of [["gzip", ["-c"]], ["gzip", ["-dfc"]], ["gunzip", ["-c"]], ["zcat", []]] as const) test(`${name} ${args.join(" ")}: long empty-only source remains timer-cancellable`, { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("empty chunks should not starve cancellation");
  const source = (async function* () { for (let count = 0; count < 100000; count++) yield new Uint8Array(); throw new Error("input limit reached before timer"); })();
  const timer = setTimeout(() => controller.abort(reason), 10);
  try { await assert.rejects(run(name, args, source, {}, { signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
});
