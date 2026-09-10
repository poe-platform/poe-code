import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { copyCompressionAssets } from "./copy-compression-assets.mjs";

const directory = "src/commands/bytes/compression/native";
const output = "/package/dist/commands/bytes/compression/native";

function fixture() {
  const volume = new Volume();
  const files = createFsFromVolume(volume);
  const artifacts = ["bz2", "xz", "zstd"].map(name => {
    const bytes = Buffer.from(`export default function ${name}() { return {}; }\n`);
    const path = `generated/${name}.mjs`;
    files.mkdirSync(`/package/${directory}/generated`, { recursive: true });
    files.writeFileSync(`/package/${directory}/${path}`, bytes);
    files.writeFileSync(`/package/${directory}/generated/${name}.d.mts`, "export default function create(): object;\n");
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  files.writeFileSync(`/package/${directory}/sources.json`, JSON.stringify({ artifacts }));
  files.writeFileSync(`/package/${directory}/LICENSES.txt`, "Native codec licenses\n");
  files.mkdirSync("/package/dist", { recursive: true });
  return { files, artifacts };
}

test("copies authenticated codec modules, declarations and licenses into dist", async () => {
  const { files } = fixture();
  const copied = await copyCompressionAssets({ root: "/package", fileSystem: files });
  assert.equal(copied.length, 8);
  for (const path of copied) assert.deepEqual(files.readFileSync(`${output}/${path}`), files.readFileSync(`/package/${directory}/${path}`));
});

test("authenticates all generated modules before replacing any output", async () => {
  const { files } = fixture();
  files.mkdirSync(`${output}/generated`, { recursive: true });
  files.writeFileSync(`${output}/generated/bz2.mjs`, "previous");
  files.writeFileSync(`/package/${directory}/generated/zstd.mjs`, "corrupt");
  await assert.rejects(copyCompressionAssets({ root: "/package", fileSystem: files }), /artifact (size|digest)/);
  assert.equal(files.readFileSync(`${output}/generated/bz2.mjs`, "utf8"), "previous");
});

test("refuses unlisted and duplicate artifact paths", async () => {
  for (const path of ["generated/extra.mjs", "../outside.mjs", "generated/bz2.mjs"]) {
    const { files, artifacts } = fixture();
    artifacts[2].path = path;
    files.writeFileSync(`/package/${directory}/sources.json`, JSON.stringify({ artifacts }));
    await assert.rejects(copyCompressionAssets({ root: "/package", fileSystem: files }), /artifact paths/);
    assert.equal(files.existsSync(output), false);
  }
});

test("refuses source and output symlinks without modifying their targets", async () => {
  for (const location of ["source", "output"]) {
    const { files } = fixture();
    files.writeFileSync("/protected", "protected");
    const path = location === "source" ? `/package/${directory}/generated/bz2.mjs` : `${output}/generated/bz2.mjs`;
    if (location === "source") files.unlinkSync(path);
    else files.mkdirSync(`${output}/generated`, { recursive: true });
    files.symlinkSync("/protected", path);
    await assert.rejects(copyCompressionAssets({ root: "/package", fileSystem: files }));
    assert.equal(files.readFileSync("/protected", "utf8"), "protected");
  }
});
