import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, standardCommands } from "../../src/core.js";
import { mmdcCommands, type MmdcSettings } from "../../src/commands/mmdc/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("mmdc is opt-in and not registered by default on Shell", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const res = await shell.exec("mmdc --version");
    assert.equal(res.exitCode, 127);
  } finally {
    await shell.dispose();
  }
});

test("Shell with mmdcCommands renders SVG and binary PNG across VFS files and pipelines with settings isolation", async () => {
  const fs = createMemoryFileSystem();
  const mutableSettings: MmdcSettings = {
    theme: {
      mode: "light"
    }
  };
  const shell = new Shell({ fs }).use(standardCommands()).use(mmdcCommands(mutableSettings));
  (mutableSettings as { theme: { mode: string } }).theme.mode = "dark";

  try {
    const diagram = "flowchart LR\n  Start([Start]) --> Check{Valid?}\n  Check -->|Yes| Done[Ship]\n";
    await fs.writeFile("/diagram.mmd", encoder.encode(diagram));

    const svgRes = await shell.exec("mmdc -i /diagram.mmd -o /out.svg");
    assert.equal(svgRes.exitCode, 0, svgRes.stderr);
    const svgText = decoder.decode(await fs.readFile("/out.svg"));
    assert.ok(svgText.startsWith("<svg"));
    assert.ok(svgText.includes("#f8fafc"));

    const darkRes = await shell.exec("mmdc -i /diagram.mmd -o /dark.svg -t dark");
    assert.equal(darkRes.exitCode, 0, darkRes.stderr);
    const darkText = decoder.decode(await fs.readFile("/dark.svg"));
    assert.ok(darkText.includes("#0b1120"));
    assert.notEqual(svgText, darkText);

    const pipePng = await shell.exec(
      "printf 'flowchart LR\\n  A --> B\\n' | mmdc -i - -o - -e png -t dark -s 2 | cat > /pipe.png"
    );
    assert.equal(pipePng.exitCode, 0, pipePng.stderr);
    const pngBytes = await fs.readFile("/pipe.png");
    assert.deepEqual(Array.from(pngBytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

    // Failed render preserves existing /out.svg
    await fs.writeFile("/broken.mmd", encoder.encode("flowchart LR\n  subgraph Unclosed\n  A --> B\n"));
    const failRes = await shell.exec("mmdc -i /broken.mmd -o /out.svg");
    assert.equal(failRes.exitCode, 1);
    assert.match(failRes.stderr, /E_SYNTAX/);
    assert.equal(decoder.decode(await fs.readFile("/out.svg")), svgText);
  } finally {
    await shell.dispose();
  }
});
