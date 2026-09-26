import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createCsvkitCommands, csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { suppressWarnings: true }
};

async function check(command: string, stdin: string, stdout: string, stderr = "", status = 0): Promise<void> {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/untouched.csv", new TextEncoder().encode("sentinel\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr });
    assert.equal(new TextDecoder().decode(await fs.readFile("/untouched.csv")), "sentinel\n");
  } finally { await shell.dispose(); }
}

test("csvjson stress: skip-lines forces materialization and honors no-header-row", async () => {
  await check("csvjson --stream -I -y0 -K1 -H", "comment\nx,y\nz,w\n",
    '{"a": "x", "b": "y"}\n{"a": "z", "b": "w"}\n');
});

// Exact reference bytes are frozen in docs/csvkit/additional-operation-reference.json.
test("csvjson stress: raw duplicate numeric and prototype-looking names keep insertion order", async () => {
  await check("csvjson --stream -I -y0", "2,1,2,__proto__\na,b,c,d\n",
    '{"2": "c", "1": "b", "__proto__": "d"}\n');
});

test("csvjson stress: raw streaming ignores no-header-row and preserves untyped null spellings", async () => {
  await check("csvjson --stream -I -y0 -H", "a,b\nnull,\nx\n",
    '{"a": "null", "b": ""}\n{"a": "x", "b": null}\n');
});

test("csvjson stress: raw empty input differs from materialized empty input", async () => {
  await check("csvjson --stream -I -y0", "", "", "StopIteration: \n", 1);
  await check("csvjson -I -y0", "", "[]");
});

test("csvjson stress: keyed rows retain their key property and reject duplicate nulls before output", async () => {
  await check("csvjson -I -y0 -k b", "a,b\nx,\n", '{"None": {"a": "x", "b": null}}');
  await check("csvjson -I -y0 -k b", "a,b\nx,\ny,\n", "", "ValueError: Value None is not unique in the key column.\n", 1);
});

// Typed serializer/key bytes are frozen in docs/csvkit/csvjson-reference.json.
test("csvjson stress: Decimal keys normalize independently from their JSON float values", async () => {
  await check("csvjson -y0 -k k", "k,x\n1000.0,a\n0.0000001,b\n-0,c\n",
    '{"1E+3": {"k": 1000.0, "x": "a"}, "1E-7": {"k": 1e-07, "x": "b"}, "-0": {"k": -0.0, "x": "c"}}');
  await check("csvjson -y0 -k k", "k,x\n2.00,a\n2.0,b\n", "", "ValueError: Value 2 is not unique in the key column.\n", 1);
});

test("csvjson stress: inferred stream rejects indent while raw stream accepts it", async () => {
  await check("csvjson --stream -y0 -i2", "a\nx\n", "", "ValueError: newline and indent may not be specified together.\n", 1);
  await check("csvjson --stream -I -y0 -i2", "a\nx\n", '{\n  "a": "x"\n}\n');
});

test("csvjson stress: JSON float serialization preserves nonfinite and negative zero tokens", async () => {
  await check("csvjson -y0", "n\nNaN\nInfinity\n-Infinity\n-0\n",
    '[{"n": NaN}, {"n": Infinity}, {"n": -Infinity}, {"n": -0.0}]');
});

test("csvjson stress: GeoJSON inferred zero coordinates produce null geometry and fail bbox", async () => {
  await check("csvjson -y0 --lat lat --lon lon --no-bbox", "lat,lon\n0,2\n",
    '{"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": null}]}');
  await check("csvjson -y0 --lat lat --lon lon", "lat,lon\n0,2\n", "",
    "TypeError: argument of type 'NoneType' is not a container or iterable\n", 1);
});

test("csvjson stress: GeoJSON streaming retains earlier features when a later row fails", async () => {
  const feature = '{"type": "Feature", "properties": {"name": "Hi"}, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n';
  await check("csvjson --stream -y0 --lat lat --lon lon", "lat,lon,name\n40,-70,Hi\n,-71,There\n", feature,
    "TypeError: float() argument must be a string or a real number, not 'NoneType'\n", 1);
  await check("csvjson --stream -I -y0 --lat lat --lon lon", "lat,lon,name\n40,-70,Hi\n41\n", feature,
    "IndexError: list index out of range\n", 1);
  await check("csvjson --stream -y0 --lat lat --lon lon", "lat,lon,name\n,-71,There\n", "",
    "TypeError: float() argument must be a string or a real number, not 'NoneType'\n", 1);
});

test("csvjson stress: reusable stdin views are owned before advancing the producer", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let returned = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const storage = new Uint8Array(64);
    try {
      for (const fragment of ["a,b\n", "é,雪\n", "x\n"]) {
        const bytes = new TextEncoder().encode(fragment);
        storage.set(bytes);
        yield storage.subarray(0, bytes.length);
        storage.fill(120);
      }
    } finally { returned++; storage.fill(120); }
  } };
  try {
    const result = await shell.exec("csvjson --stream -I -y0", { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: '{"a": "é", "b": "雪"}\n{"a": "x", "b": null}\n', stderr: ""
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvjson stress: raw row output awaits sink backpressure", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  try {
    const execution = shell.exec("csvjson --stream -I -y0", {
      stdin: { async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode("a\nfirst-row\n");
        yield new TextEncoder().encode("y\n");
      } },
      stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); if (writes.length === 1) { entered(); await blocked; } } }
    });
    await writing;
    assert.equal(writes.length, 1);
    assert.ok('{"a": "first-row"}\n'.startsWith(writes[0]!));
    release();
    const result = await execution;
    assert.deepEqual({ status: result.exitCode, stderr: result.stderr }, { status: 0, stderr: "" });
    assert.equal(writes.join(""), '{"a": "first-row"}\n{"a": "y"}\n');
  } finally { release(); await shell.dispose(); }
});

test("csvjson stress: raw streaming refuses a bulk-only injected codec", async () => {
  let decoded = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    ...options,
    codecs: [{
      names: utf8Codec.names,
      async decode(bytes, encoding, signal) { decoded++; return utf8Codec.decode(bytes, encoding, signal); },
      encode: utf8Codec.encode
    }]
  }));
  try {
    const result = await shell.exec("csvjson --stream -I -y0", { stdin: "a\nx\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: incremental JSON input requires a streaming codec\n"
    });
    assert.equal(decoded, 0);
  } finally { await shell.dispose(); }
});

test("csvjson stress: cancellation during raw row backpressure closes stdin once", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let returned = 0;
  const writes: string[] = [];
  try {
    const execution = shell.exec("csvjson --stream -I -y0", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() {
        try { yield new TextEncoder().encode("a\nx\ny\n"); }
        finally { returned++; }
      } },
      stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); entered(); await blocked; } }
    });
    await writing;
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(returned, 1);
    assert.equal(writes.length, 1);
    assert.ok('{"a": "x"}\n'.startsWith(writes[0]!));
  } finally { release(); await shell.dispose(); }
});

// Authenticated csvjson.py cbfe8f90…; CPython 3.14.2 / Agate 1.14.2,
// C locale, UTC, non-TTY UTF-8 pipes. Fresh source differential captures.
test("csvjson stress: geometry bbox compares arbitrary precision integer coordinates exactly", async () => {
  await check("csvjson -I -y0 --lat lat --lon lon --geometry g",
    'lat,lon,g\n0,0,"{""type"":""LineString"",""coordinates"":[[9007199254740993,2],[9007199254740992,1]]}"\n',
    '{"type": "FeatureCollection", "bbox": [9007199254740992, 1, 9007199254740993, 2], "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": [[9007199254740993, 2], [9007199254740992, 1]]}}]}');
});

test("csvjson stress: geometry bbox mixes exact integers with floats and retains nonfinite comparison behavior", async () => {
  for (const [coordinates, rendered, bbox] of [
    ['[[9007199254740993,2],[9007199254740992.0,1]]', '[[9007199254740993, 2], [9007199254740992.0, 1]]', '[9007199254740992.0, 1, 9007199254740993, 2]'],
    ['[[-9007199254740993,2],[-9007199254740992.0,1]]', '[[-9007199254740993, 2], [-9007199254740992.0, 1]]', '[-9007199254740993, 1, -9007199254740992.0, 2]'],
    ['[[1,2],[Infinity,NaN],[-Infinity,-1]]', '[[1, 2], [Infinity, NaN], [-Infinity, -1]]', '[-Infinity, -1, Infinity, 2]'],
    ['[[123456789012345678901234567890,2],[123456789012345678901234567889,1]]', '[[123456789012345678901234567890, 2], [123456789012345678901234567889, 1]]', '[123456789012345678901234567889, 1, 123456789012345678901234567890, 2]']
  ]) {
    await check("csvjson -I -y0 --lat lat --lon lon --geometry g",
      `lat,lon,g\n0,0,"{""type"":""LineString"",""coordinates"":${coordinates}}"\n`,
      `{"type": "FeatureCollection", "bbox": ${bbox}, "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": ${rendered}}}]}`);
  }
});

test("csvjson stress: GeoJSON false IDs survive false properties and temporal properties use ISO", async () => {
  await check("csvjson -y0 --lat lat --lon lon -k id --no-bbox",
    "lat,lon,id,flag,n,date,dt\n40,-70,0,false,0,2020-01-01,2020-01-01T12:34:56\n",
    '{"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"date": "2020-01-01", "dt": "2020-01-01T12:34:56"}, "id": false, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}]}');
});

test("csvjson stress: overlapping type and ID column removes both while numeric GeoJSON selectors start at zero", async () => {
  await check("csvjson --stream -I -y0 --lat 0 --lon 1 --type 2 -k 2",
    "lat,lon,type,x\n40,-70,Polygon,hi\n",
    '{"type": "Feature", "properties": {"x": "hi"}, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n');
  await check("csvjson --stream -I -y0 --zero --lat 1 --lon 2 --type 3 -k 3",
    "lat,lon,type,x\n40,-70,Polygon,hi\n",
    '{"type": "Feature", "properties": {"x": "hi"}, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n');
});

test("csvjson stress: raw GeoJSON ignores false extra cells and fails on truthy extra cells after prior output", async () => {
  await check("csvjson --stream -I -y0 --lat lat --lon lon", "lat,lon\n40,-70,\n40,-70,extra\n",
    '{"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n',
    "IndexError: list index out of range\n", 1);
});

test("csvjson stress: GeoJSON nested three dimensional coordinates ignore altitude in bounds", async () => {
  await check("csvjson -I -y0 --lat lat --lon lon --geometry g",
    'lat,lon,g\n0,0,"{""type"":""Polygon"",""coordinates"":[[[1,2,3],[4,5,6]]]}"\n',
    '{"type": "FeatureCollection", "bbox": [1, 2, 4, 5], "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[1, 2, 3], [4, 5, 6]]]}}]}');
  await check("csvjson -I -y0 --lat lat --lon lon", "lat,lon\n",
    '{"type": "FeatureCollection", "bbox": [null, null, null, null], "features": []}');
});

test("csvjson stress: consumer-owned stdout closure drains a cooperative pending stdin read once", async () => {
  const definition = createCsvkitCommands(options).find(command => command.name === "csvjson")!;
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = { consumerClosed: true };
  let admitted!: () => void;
  const reading = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => resolve({ done: true, value: undefined });
  });
  let reads = 0;
  let returned = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  const write = async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); };
  const execution = Promise.resolve(definition.execute({
    command: "csvjson", args: ["--stream", "-I", "-y0"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      async next() {
        assert.ok(cleanups.length > 0, "cleanup must be registered before input acquisition");
        if (reads++ === 0) return { done: false, value: new TextEncoder().encode("a\nx\n") };
        admitted(); return pending;
      },
      async return() { returned++; release(); return { done: true as const, value: undefined }; }
    }) },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
    stderr: { async write() { assert.fail("consumer closure must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  try {
    await reading;
    const writtenBeforeClosure = writes.join("");
    consumer.abort(reason);
    await rejected;
    assert.equal(writes.join(""), writtenBeforeClosure);
    assert.equal(returned, 1);
    assert.equal(caller.signal.aborted, false);
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(returned, 1);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});
