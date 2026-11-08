import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { Volume, createFsFromVolume } from "memfs";
import { Readable } from "node:stream";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../agent-spawn/src/acp/replay.ts", import.meta.url);
const own = await import("../dist/index.js");
const { native } = await import("../dist/native.js");
test("framing batches preserve sparse line locations without per-record host objects", () => {
  const reader = new native.NativeSpawnLogReader();
  assert.deepEqual(reader.push("\n\ufeffone\r"), { text: "one", layout: new Float64Array([3, 2]) });
  assert.deepEqual(reader.push("\ntwo\n\nlast"), { text: "two", layout: new Float64Array([3, 3]) });
  assert.deepEqual(reader.end(), { text: "last", lineNumber: 5 });
  const unicode = new native.NativeSpawnLogReader();
  assert.deepEqual(unicode.push("🌍\r\nx\ud800\n"), {
    text: "🌍x\ud800",
    layout: new Float64Array([2, 1, 4, 2])
  });
});
async function collect(stream) {
  const result = [];
  for await (const update of stream) result.push(update);
  return result;
}
async function withFile(text, run) {
  const volume = new Volume(),
    memory = createFsFromVolume(volume).promises,
    saved = fs.open;
  volume.fromJSON({ "/logs/run.jsonl": text });
  fs.open = memory.open;
  syncBuiltinESMExports();
  try {
    await run("/logs/run.jsonl", volume);
  } finally {
    fs.open = saved;
    syncBuiltinESMExports();
  }
}
test("reader matches session updates, legacy mapping and malformed record diagnostics", async () => {
  assert.equal(typeof own.readSpawnLog, "function");
  const records = [
    "",
    " \t ",
    '\ufeff{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"🌍"}} ',
    '{"event":"tool_start","id":"one","title":"Read","input":{"__proto__":{"value":1}}}',
    '{"event":"tool_complete","id":"one","status":"completed","path":"out"}',
    '{"event":"reasoning","text":"think"}',
    '{"event":"usage","inputTokens":2,"outputTokens":3}',
    '{"event":"unknown"}',
    '{"sessionUpdate":"custom","event":"reasoning","text":"direct wins"}',
    "bad JSON",
    "null",
    "[]",
    '{"sessionUpdate":1}',
    '{"sessionUpdate":"usage_update","used":1,"size":3,"extra":"\\ud800"}'
  ];
  for (const separator of ["\n", "\r\n", "\r"])
    await withFile(records.join(separator), async (filePath) => {
      const results = [];
      for (const api of [reference, own]) {
        const errors = [];
        const updates = await collect(
          api.readSpawnLog(filePath, { onMalformedRecord: (record) => errors.push(record) })
        );
        results.push({ updates, errors });
      }
      assert.deepEqual(results[1], results[0]);
    });
});
test("reader closes streams and handles on return, callback failure and strict rejection", async () => {
  for (const api of [reference, own])
    await withFile(
      '{"sessionUpdate":"custom"}\ninvalid\n{"sessionUpdate":"custom"}',
      async (filePath) => {
        const open = fs.open,
          handles = [],
          streams = [];
        fs.open = async (...args) => {
          const handle = await open(...args),
            create = handle.createReadStream.bind(handle);
          handles.push(handle);
          handle.createReadStream = (...args) => {
            const stream = create(...args);
            streams.push(stream);
            return stream;
          };
          return handle;
        };
        syncBuiltinESMExports();
        try {
          const iterator = api.readSpawnLog(filePath)[Symbol.asyncIterator]();
          assert.deepEqual((await iterator.next()).value, { sessionUpdate: "custom" });
          await iterator.return();
          const failure = new Error("callback failure");
          await assert.rejects(
            collect(
              api.readSpawnLog(filePath, {
                onMalformedRecord: () => {
                  throw failure;
                }
              })
            ),
            (error) => error === failure
          );
          await assert.rejects(
            collect(api.readSpawnLog(filePath, { strict: true })),
            /Malformed spawn log record at \/logs\/run.jsonl:2:/
          );
          assert.ok(streams.every((stream) => stream.destroyed));
          for (const handle of handles) await assert.rejects(handle.stat());
        } finally {
          fs.open = open;
          syncBuiltinESMExports();
        }
      }
    );
});
test("reader preserves option getter receivers, default warnings and missing-file errors", async () => {
  for (const api of [reference, own])
    await withFile('null\n{"sessionUpdate":"custom"}', async (filePath) => {
      const writes = [],
        saved = process.stderr.write;
      process.stderr.write = (chunk) => {
        writes.push(String(chunk));
        return true;
      };
      try {
        assert.deepEqual(await collect(api.readSpawnLog(filePath)), [{ sessionUpdate: "custom" }]);
        assert.deepEqual(writes, [
          `Skipping malformed spawn log record at ${filePath}:1: Unknown spawn log record shape.\n`
        ]);
        class Options {
          #records = [];
          get strict() {
            this.#records.push("strict");
            return false;
          }
          get onMalformedRecord() {
            this.#records.push("callback");
            return (record) => this.#records.push(record.lineNumber);
          }
          get records() {
            return this.#records;
          }
        }
        const options = new Options();
        await collect(api.readSpawnLog(filePath, options));
        assert.deepEqual(options.records, ["strict", "callback", 1]);
        await assert.rejects(collect(api.readSpawnLog("/missing.jsonl")), { code: "ENOENT" });
      } finally {
        process.stderr.write = saved;
      }
    });
});
test("reader preserves prototype observations and live options after yielded updates", async () => {
  for (const api of [reference, own])
    await withFile('{"sessionUpdate":"custom"}\n{}\ninvalid', async (filePath) => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "sessionUpdate");
      Object.defineProperty(Object.prototype, "sessionUpdate", {
        configurable: true,
        value: "inherited"
      });
      try {
        const options = {},
          iterator = api.readSpawnLog(filePath, options)[Symbol.asyncIterator]();
        assert.equal((await iterator.next()).value.sessionUpdate, "custom");
        assert.equal((await iterator.next()).value.sessionUpdate, "inherited");
        options.strict = true;
        await assert.rejects(iterator.next(), /Malformed spawn log record at \/logs\/run.jsonl:3:/);
      } finally {
        if (descriptor) Object.defineProperty(Object.prototype, "sessionUpdate", descriptor);
        else delete Object.prototype.sessionUpdate;
      }
    });
});
test("reader decodes UTF8 across byte-sized IO chunks and accepts deeply nested JSON", async () => {
  const text = JSON.stringify({
    sessionUpdate: "custom",
    text: "🌍\ufffdé",
    payload: JSON.parse("[".repeat(600) + "0" + "]".repeat(600))
  });
  await withFile(text, async (filePath) => {
    const open = fs.open;
    fs.open = async (...args) => {
      const handle = await open(...args),
        create = handle.createReadStream.bind(handle);
      handle.createReadStream = (options) => create({ ...options, highWaterMark: 1 });
      return handle;
    };
    syncBuiltinESMExports();
    try {
      assert.deepEqual(
        await collect(own.readSpawnLog(filePath)),
        await collect(reference.readSpawnLog(filePath))
      );
    } finally {
      fs.open = open;
      syncBuiltinESMExports();
    }
  });
});
test("reader releases its handle when creating or consuming the IO stream fails", async () => {
  const saved = fs.open,
    failure = new Error("IO failure");
  try {
    for (const createReadStream of [
      () => {
        throw failure;
      },
      () =>
        new Readable({
          read() {
            this.destroy(failure);
          }
        })
    ]) {
      let closed = 0;
      fs.open = async () => ({
        createReadStream,
        async close() {
          closed++;
        }
      });
      syncBuiltinESMExports();
      await assert.rejects(collect(own.readSpawnLog("mock")), (error) => error === failure);
      assert.equal(closed, 1);
    }
  } finally {
    fs.open = saved;
    syncBuiltinESMExports();
  }
});
