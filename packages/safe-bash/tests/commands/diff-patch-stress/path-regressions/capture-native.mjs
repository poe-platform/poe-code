import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const binding = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
  `import { oraclePath } from ${JSON.stringify(new URL("../gnu-target/oracle.ts", import.meta.url).href)}; console.log(JSON.stringify({ gnuPatch: oraclePath("patch"), gnuDiff: oraclePath("diff"), applePatch: oraclePath("patch", "apple-calibration") }));`],
  { cwd: directory, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65_536 });
assert.ifError(binding.error);
assert.equal(binding.signal, null);
assert.equal(binding.status, 0, binding.stderr);
const paths = {
  ...JSON.parse(binding.stdout),
  git: "/usr/bin/git",
};
const root = await mkdtemp(`${directory}.oracle-`);
const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: root, TMPDIR: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
function execute(binary, args, cwd, input = "") {
  const result = spawnSync(binary, args, { cwd, input, encoding: "utf8", env, shell: false, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const evidence = { captured: new Date().toISOString(), binaries: {}, paths: [], git: [] };
try {
  for (const [name, path] of Object.entries(paths)) {
    const version = execute(path, ["--version"], root);
    assert.equal(version.status, 0);
    evidence.binaries[name] = { path, version: version.stdout.split("\n")[0], sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
  }
  const probes = [
    ["a///dir//leaf", 1, "dir/leaf"], ["./leaf", 1, "leaf"], ["a/./leaf", 2, "leaf"],
    ["a/dir/./leaf", 1, "dir/leaf"], ["a///./dir//leaf", 2, "dir/leaf"],
    ["a/leaf/", 1, "leaf"], ["a/leaf//", 1, "leaf"], ["a/leaf/.", 1, "leaf"],
    ["a/leaf/./", 1, "leaf"], ["a/leaf/./.", 1, "leaf"],
  ];
  for (const binary of ["gnuPatch", "applePatch"]) {
    for (const [index, [header, strip, target]] of probes.entries()) {
      const cwd = `${root}/${binary}-${index}`;
      await mkdir(`${cwd}/dir`, { recursive: true });
      await writeFile(`${cwd}/${target}`, "old\n");
      const patch = `--- ${header}\n+++ ${header}\n@@ -1 +1 @@\n-old\n+new\n`;
      const result = execute(paths[binary], ["--batch", `-p${strip}`], cwd, patch);
      evidence.paths.push({ binary, header, strip, target, ...result, content: await readFile(`${cwd}/${target}`, "utf8") });
    }
  }
  for (const [index, name] of ['café-漢字-🙂', 'tab\tquote"name', "literal $(echo NO);&|[]*?", "e\u0301", " trailing "].entries()) {
    const cwd = `${root}/git-${index}`;
    await mkdir(`${cwd}/left`, { recursive: true });
    await mkdir(`${cwd}/right`);
    await writeFile(`${cwd}/left/${name}`, "old\n");
    await writeFile(`${cwd}/right/${name}`, "new\n");
    const generated = execute(paths.git, ["--no-pager", "-c", "core.quotePath=true", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-prefix", "--", `left/${name}`, `right/${name}`], cwd);
    assert.equal(generated.status, 1, generated.stderr);
    const target = `${cwd}/apply`;
    await mkdir(target);
    await writeFile(`${target}/${name}`, "old\n");
    const applied = execute(paths.gnuPatch, ["--batch", "-p1"], target, generated.stdout);
    const content = await readFile(`${target}/${name}`, "utf8");
    evidence.git.push({ name, generated, applied, content });
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
