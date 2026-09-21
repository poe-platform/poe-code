import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine, pythonSampleFunctions } from "poe-code/ssconvert";

test("optional capwords shares command/SDK bytes and preserves namespace through checkpoint replay", async () => {
  const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Sheet</Name><Cells><Cell Row="0" Col="0">=PY_CAPWORDS("hELLO world")</Cell></Cells></Sheet></Sheets></Workbook>';
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.xml", new TextEncoder().encode(source));
  const config = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 10000 },
    runtimeFunctions: pythonSampleFunctions };
  const shell = new Shell({ fs }).use(ssconvertCommands(config));
  const absent = new Shell({ fs }).use(ssconvertCommands({ ...config, runtimeFunctions: {} }));
  const engine = createEngine(config);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /input.xml fd://1");
    assert.equal(command.exitCode, 0); assert.equal(command.stderr, "");
    assert.equal(command.stdout, '"Hello World"\n');
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "input.xml", source: [new TextEncoder().encode(source)] },
      exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } },
      { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(command.stdoutBytes, new Uint8Array(Buffer.concat(chunks)));
    assert.equal((await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /input.xml /checkpoint.xml")).exitCode, 0);
    const replay = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /checkpoint.xml fd://1");
    assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, ""); assert.deepEqual(replay.stdoutBytes, command.stdoutBytes);
    const negative = await absent.exec("ssconvert -T Gnumeric_stf:stf_csv /input.xml fd://1");
    assert.equal(negative.exitCode, 0); assert.equal(negative.stderr, ""); assert.equal(negative.stdout, "#NAME?\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/input.xml")), source);
  } finally { await engine.dispose(); await shell.dispose(); await absent.dispose(); }
});
