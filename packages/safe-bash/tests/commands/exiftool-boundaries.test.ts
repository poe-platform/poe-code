import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, standardCommands } from "../../src/core.js";
import { exiftoolCommands } from "../../src/commands/exiftool/index.js";

test("ExifTool public command composes with Shell argv, pipelines and VFS scripts", async () => {
  const fs = createMemoryFileSystem();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i p1sAAAAASUVORK5CYII=".split(" ").join(""), "base64");
  await fs.writeFile("/image.png", png);
  const shell = new Shell({ fs }).use(standardCommands()).use(exiftoolCommands());
  try {
    const write = await shell.exec("exiftool -overwrite_original -Title=1e999 /image.png");
    assert.equal(write.exitCode, 0, write.stderr);
    const pipeline = await shell.exec("exiftool -b -Title /image.png | cat");
    assert.equal(pipeline.exitCode, 0, pipeline.stderr); assert.equal(pipeline.stdout, "1e999");
    const stdin = await shell.exec("cat /image.png | exiftool -j -Title -");
    assert.equal(stdin.exitCode, 0, stdin.stderr);
    assert.equal(stdin.stdout, '[{\n  "SourceFile": "-",\n  "Title": 1e999\n}]\n');
    const csv = await shell.exec("exiftool -csv -Title /image.png /image.png | cat");
    assert.equal(csv.exitCode, 0, csv.stderr);
    assert.equal(csv.stdout, "SourceFile,Title\n/image.png,1e999\n/image.png,1e999\n");
    assert.equal(csv.stderr, "    2 image files read\n");
    await fs.writeFile("/inspect.sh", new TextEncoder().encode("exiftool -j -Title /image.png\n"));
    const script = await shell.exec("sh /inspect.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.equal(script.stdout, '[{\n  "SourceFile": "/image.png",\n  "Title": 1e999\n}]\n');
    const unicode = await shell.exec("exiftool -overwrite_original '-Title=café 水😀' '-ModifyDate=2024-02-29T12:34:56.789+05:30' /image.png");
    assert.equal(unicode.exitCode, 0, unicode.stderr);
    const date = await shell.exec("exiftool -b -ModifyDate /image.png | cat");
    assert.equal(date.exitCode, 0, date.stderr);
    assert.equal(date.stdout, "2024:02:29 12:34:56");
    const title = await shell.exec("exiftool -s3 -Title /image.png");
    assert.equal(title.exitCode, 0, title.stderr);
    assert.equal(title.stdout, "café 水😀\n");
    await fs.writeFile("/args", new TextEncoder().encode("\uFEFF# comment\n-s3\n-Title\n/image.png\n"));
    const argfile = await shell.exec("exiftool -@ /args | cat");
    assert.equal(argfile.exitCode, 0, argfile.stderr);
    assert.equal(argfile.stdout, title.stdout);
    await fs.writeFile("/write-args", new TextEncoder().encode("-Title = from file\n/image.png\n"));
    const argWrite = await shell.exec("exiftool -overwrite_original -@ /write-args '-Title=from argv'");
    assert.equal(argWrite.exitCode, 0, argWrite.stderr);
    assert.equal((await shell.exec("exiftool -b -Title /image.png | cat")).stdout, "from argv");
  } finally { await shell.dispose(); }
});
