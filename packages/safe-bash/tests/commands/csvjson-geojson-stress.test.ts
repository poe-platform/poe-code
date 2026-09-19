import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createCsvkitCommands, csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import bboxReference from "../../../../docs/csvkit/geojson-user-edge-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { suppressWarnings: true }
};

async function check(command: string, stdin: string, stdout: string, stderr = "", status = 0): Promise<void> {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/sentinel", new TextEncoder().encode("unchanged"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr });
    assert.equal(new TextDecoder().decode(await fs.readFile("/sentinel")), "unchanged");
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["sentinel"]);
  } finally { await shell.dispose(); }
}

const geometryCommand = "csvjson -y0 --lat lat --lon lon --geometry g";
const point = '{"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n';

test("csvjson GeoJSON stress: bbox initialization and later comparisons match frozen original", async () => {
  for (const item of bboxReference.cases) {
    await check("csvjson " + item.argv.join(" "), item.stdin, item.stdout, item.stderr, item.status);
  }
});

// Released csvkit 2.2.0 source; CPython 3.14.2 / Agate 1.14.2,
// C locale, UTC, UTF-8 non-TTY pipes. The original native failures are intentional.
test("csvjson GeoJSON stress: empty and null coordinate trees retain native bbox failures", async () => {
  for (const coordinates of ["[]", "[2]", "[[]]"]) {
    await check(geometryCommand, `lat,lon,g\n2,3,"{""type"":""Point"",""coordinates"":${coordinates}}"\n`,
      "", "IndexError: list index out of range\n", 1);
  }
  await check(geometryCommand, 'lat,lon,g\n2,3,"{""type"":""Point"",""coordinates"":null}"\n',
    "", "TypeError: object of type 'NoneType' has no len()\n", 1);
});

test("csvjson GeoJSON stress: empty geometry containers retain unknown collection bounds", async () => {
  for (const [json, rendered] of [["{}", "{}"], ["[]", "[]"], ['""', '""']]) {
    await check(geometryCommand, `lat,lon,g\n2,3,"${json!.replaceAll('"', '""')}"\n`,
      `{"type": "FeatureCollection", "bbox": [null, null, null, null], "features": [{"type": "Feature", "properties": {}, "geometry": ${rendered}}]}`);
  }
});

test("csvjson GeoJSON stress: inferred null geometry fails JSON parsing before bbox", async () => {
  await check(geometryCommand, 'lat,lon,g\n2,3,"null"\n', "",
    "TypeError: the JSON object must be str, bytes or bytearray, not NoneType\n", 1);
  await check(`${geometryCommand} --blanks`, 'lat,lon,g\n2,3,""\n', "",
    "JSONDecodeError: Expecting value: line 1 column 1 (char 0)\n", 1);
});

test("csvjson GeoJSON stress: nested MultiPolygon coordinates determine two dimensional bbox", async () => {
  await check(geometryCommand, 'lat,lon,g\n2,3,"{""type"":""MultiPolygon"",""coordinates"":[[[[2,3],[4,5]]]]}"\n',
    '{"type": "FeatureCollection", "bbox": [2, 3, 4, 5], "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[2, 3], [4, 5]]]]}}]}');
});

test("csvjson GeoJSON stress: numeric offset and type overlap consume the source columns", async () => {
  for (const command of [
    "csvjson --stream -I -y0 --lat 0 --lon 1 --type 0 -k 1",
    "csvjson --stream -I -y0 --zero --lat 1 --lon 2 --type 1 -k 2"
  ]) await check(command, "lat,lon\n40,-70\n", point);
});

test("csvjson GeoJSON stress: raw stream ignores collection bbox and CRS while allowing indent", async () => {
  await check("csvjson --stream -I -y0 --lat lat --lon lon --crs invalid --no-bbox -i0", "lat,lon\n40,-70\n",
    '{\n"type": "Feature",\n"properties": {},\n"geometry": {\n"type": "Point",\n"coordinates": [\n-70.0,\n40.0\n]\n}\n}\n');
  await check("csvjson --stream -I -y0 --lat lat --lon lon --crs invalid", "lat,lon\n40,-70\n", point);
  await check("csvjson -I -y0 --lat lat --lon lon --crs invalid --no-bbox", "lat,lon\n0,-70\n",
    '{"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": null}], "crs": {"type": "name", "properties": {"name": "invalid"}}}');
});

test("csvjson GeoJSON stress: header-only collection keeps native null bbox and optional CRS", async () => {
  await check("csvjson -I -y0 --lat lat --lon lon --crs invalid", "lat,lon\n",
    '{"type": "FeatureCollection", "bbox": [null, null, null, null], "features": [], "crs": {"type": "name", "properties": {"name": "invalid"}}}');
  await check("csvjson -I -y0 --lat lat --lon lon --no-bbox", "lat,lon\n",
    '{"type": "FeatureCollection", "features": []}');
});

test("csvjson GeoJSON stress: raw empty IDs survive while empty properties disappear", async () => {
  await check("csvjson --stream -I -y0 --lat lat --lon lon -k id", "lat,lon,id,n,b,blank\n40,-70,,0,false,\n",
    '{"type": "Feature", "properties": {"n": "0", "b": "false"}, "id": "", "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n');
});

test("csvjson GeoJSON stress: inferred false IDs survive while falsey properties disappear", async () => {
  await check("csvjson --stream -y0 --lat lat --lon lon -k id",
    "lat,lon,id,n,b,blank\n40,-70,false,0,false,\n41,-71,true,2,true,s\n42,-72,,0,false,\n",
    '{"type": "Feature", "properties": {}, "id": false, "geometry": {"type": "Point", "coordinates": [-70.0, 40.0]}}\n' +
    '{"type": "Feature", "properties": {"n": "2", "b": true, "blank": "s"}, "id": true, "geometry": {"type": "Point", "coordinates": [-71.0, 41.0]}}\n' +
    '{"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [-72.0, 42.0]}}\n');
});

test("csvjson GeoJSON stress: stream retains a completed feature before later geometry JSON failure", async () => {
  const stdin = 'lat,lon,g\n40,-70,"{""coordinates"":[-70,40]}"\n41,-71,"{"\n';
  const first = '{"type": "Feature", "properties": {}, "geometry": {"coordinates": [-70, 40]}}\n';
  for (const inference of ["", "-I "])
    await check(`csvjson --stream ${inference}-y0 --lat lat --lon lon --geometry g`, stdin, first,
      "JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)\n", 1);
  await check("csvjson -I -y0 --lat lat --lon lon --geometry g", stdin, "",
    "JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)\n", 1);
});

test("csvjson GeoJSON stress: geometry and type exclusions override a matching feature ID", async () => {
  const stdin = 'lat,lon,g,kind,label\n40,-70,"{""coordinates"":[-70,40]}",Polygon,kept\n';
  for (const key of ["lat", "lon", "g", "kind"])
    await check(`csvjson --stream -I -y0 --lat lat --lon lon --geometry g --type kind -k ${key}`, stdin,
      '{"type": "Feature", "properties": {"label": "kept"}, "geometry": {"coordinates": [-70, 40]}}\n');
});

test("csvjson GeoJSON stress: reusable input views survive GeoJSON sink backpressure", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let returned = 0;
  let advances = 0;
  const writes: string[] = [];
  try {
    // Fill the codec's 8192-byte window; short chunks may correctly prefetch.
    const prefix = "lat,lon,fill\n40,-70,\n41,-71,";
    const execution = shell.exec("csvjson --stream -I -y0 --lat lat --lon lon --type fill", {
      stdin: { async *[Symbol.asyncIterator]() {
        const storage = new Uint8Array(8192);
        try {
          for (const fragment of [prefix + "x".repeat(8192 - prefix.length), "\n"]) {
            advances++;
            const bytes = new TextEncoder().encode(fragment);
            storage.set(bytes);
            yield storage.subarray(0, bytes.length);
            storage.fill(120);
          }
        } finally { returned++; storage.fill(120); }
      } },
      stdout: { async write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
        if (writes.length === 1) { entered(); await blocked; }
      } }
    });
    await writing;
    assert.equal(writes.length, 1);
    assert.equal(advances, 1);
    release();
    const result = await execution;
    assert.deepEqual({ status: result.exitCode, stderr: result.stderr }, { status: 0, stderr: "" });
    assert.equal(writes.join(""), point + point.replace("-70.0, 40.0", "-71.0, 41.0"));
    assert.equal(returned, 1);
  } finally { release(); await shell.dispose(); }
});

for (const cancellation of ["consumer", "caller"]) test(`csvjson GeoJSON stress: ${cancellation} cancellation drains an admitted cooperative read once`, async () => {
  const definition = createCsvkitCommands(options).find(command => command.name === "csvjson")!;
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = { closed: true };
  let admitted!: () => void;
  const reading = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => resolve({ done: true, value: undefined }); });
  let reads = 0;
  let returned = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  const write = async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); };
  const execution = Promise.resolve(definition.execute({
    command: "csvjson", args: ["--stream", "-I", "-y0", "--lat", "lat", "--lon", "lon", "--type", "fill"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      async next() {
        assert.ok(cleanups.length > 0, "cleanup must precede input acquisition");
        if (reads++ === 0) {
          const prefix = "lat,lon,fill\n40,-70,\n41,-71,";
          return { done: false, value: new TextEncoder().encode(prefix + "x".repeat(8192 - prefix.length)) };
        }
        admitted(); return pending;
      },
      async return() { returned++; release(); return { done: true as const, value: undefined }; }
    }) },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
    stderr: { async write() { assert.fail("cancellation must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  try {
    await reading;
    assert.equal(writes.join(""), point);
    (cancellation === "consumer" ? consumer : caller).abort(reason);
    await rejected;
    assert.equal(writes.join(""), point);
    assert.equal(returned, 1);
    assert.equal(caller.signal.aborted, cancellation === "caller");
    assert.equal(consumer.signal.aborted, cancellation === "consumer");
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(returned, 1);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});
