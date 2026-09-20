import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, standardCommands } from "../../src/core.js";
import { wkhtmltopdfCommands, wkhtmltopdfLimits, type StaticRenderer } from "../../src/commands/wkhtmltopdf/index.js";

const encoder = new TextEncoder();

test("actual Shell pipelines, redirects and sh VFS invocation preserve binary output and dispose", async () => {
  const fs = createMemoryFileSystem();
  let opened = 0;
  let closed = 0;
  const renderer: StaticRenderer = {
    profile: { id: "memory-boundary-control", features: [] },
    async open(request) {
      opened++;
      assert.equal(new TextDecoder().decode(request.inputs[0]), "<p>chunked</p>");
      return { success: true, errorCode: 0,
        chunks: (async function* () { yield Uint8Array.of(37, 80); yield Uint8Array.of(0, 255); })(),
        async close() { closed++; },
      };
    },
  };
  const shell = new Shell({ fs }).use(wkhtmltopdfCommands({ limits: wkhtmltopdfLimits, renderer }));
  shell.use(standardCommands());
  try {
    const pipeline = await shell.exec("printf '<p>chunked</p>' | wkhtmltopdf - - | cat > /pipe.pdf");
    assert.equal(pipeline.exitCode, 0, pipeline.stderr);
    assert.deepEqual(await fs.readFile("/pipe.pdf"), Uint8Array.of(37, 80, 0, 255));
    await fs.writeFile("/input.html", encoder.encode("<p>chunked</p>"));
    await fs.writeFile("/convert.sh", encoder.encode("wkhtmltopdf /input.html /script.pdf\n"));
    const script = await shell.exec("sh /convert.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.deepEqual(await fs.readFile("/script.pdf"), Uint8Array.of(37, 80, 0, 255));
  } finally { await shell.dispose(); }
  assert.equal(opened, 2);
  assert.equal(closed, opened);
});

test("Shell redirects have partial effects independently of PDF staging", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/existing.pdf", encoder.encode("old"));
  const shell = new Shell({ fs }).use(wkhtmltopdfCommands());
  try {
    const result = await shell.exec("wkhtmltopdf /missing.html - > /existing.pdf");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /UNSUPPORTED_CAPABILITY/);
    assert.equal((await fs.readFile("/existing.pdf")).length, 0);
  } finally { await shell.dispose(); }
});

test("actual Shell preserves distinct single-job loader statuses and failed-output isolation", async () => {
  for (const [errorCode, expected] of [[404, 2], [401, 3], [500, 1]] as const) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.html", encoder.encode("html"));
    await fs.writeFile("/output.pdf", encoder.encode("old"));
    let closed = 0;
    const shell = new Shell({ fs }).use(wkhtmltopdfCommands({ limits: wkhtmltopdfLimits,
      renderer: { profile: { id: "loader-status-control", features: [] }, async open() {
        return { success: true, errorCode, chunks: [encoder.encode("must not publish")], async close() { closed++; } };
      } },
    }));
    try {
      const result = await shell.exec("wkhtmltopdf /input.html /output.pdf");
      assert.equal(result.exitCode, expected);
      assert.ok(result.stderr.includes(`http error: ${errorCode}`));
      assert.equal(new TextDecoder().decode(await fs.readFile("/output.pdf")), "old");
    } finally { await shell.dispose(); }
    assert.equal(closed, 1);
  }
});
