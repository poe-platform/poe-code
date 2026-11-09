import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, standardCommands, agentCommands } from "../../src/index.js";

const setup = `
base=$PWD
mkdir -p retarget/one retarget/two
echo one > retarget/one/marker
echo two > retarget/two/marker
ln -s one retarget/alias
`;
const retarget = `
rm "$base/retarget/alias"
ln -s two "$base/retarget/alias"
`;

for (const middleware of [false, true]) {
  for (const mode of ["", "-L", "-P"]) {
    test(`cd ${mode || "default"} retains relative I/O after symlink retargeting (middleware=${middleware})`, async t => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      if (middleware) shell.use(async (_context, next) => next());
      t.after(() => shell.dispose());
      const result = await shell.exec(`${setup}
cd ${mode} retarget/alias
${retarget}
cat marker
echo changed > marker
cat "$base/retarget/one/marker" "$base/retarget/two/marker"
printf '%s\\n' "$PWD"
pwd -L
pwd -P
printf '%s\\n' "$(pwd)"
`);
      const logical = mode === "-P" ? "/retarget/one" : "/retarget/alias";
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `one\nchanged\ntwo\n${logical}\n${logical}\n/retarget/one\n${logical}\n`);
    });
  }
}

for (const middleware of [false, true]) {
  test(`relative expansion, predicates and child execution retain the entered directory (middleware=${middleware})`, async t => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    if (middleware) shell.use(async (_context, next) => next());
    shell.register({ name: "read-marker", execute: context => context.invoke!("cat", ["marker"]) });
    t.after(() => shell.dispose());
    const result = await shell.exec(`${setup}
echo original > retarget/one/only-one
echo 'cat marker' > retarget/one/read.sh
chmod +x retarget/one/read.sh
cd retarget/alias
${retarget}
printf '%s\\n' only-*
[[ -f only-one ]] && test -f only-one && echo found
cat < marker
printf '%s\\n' "$(cat marker)"
(cat marker)
bash -c 'cat marker'
sh read.sh
. ./read.sh
PATH=.:$PATH read.sh
read-marker
pwd | cat
PWD=elsewhere pwd
printf '%s\\n' "$(PWD=elsewhere pwd)"
`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `only-one\nfound\n${"one\n".repeat(8)}${"/retarget/alias\n".repeat(3)}`);
  });
}

test("removing the cd symlink preserves relative reads and writes", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec(`${setup}
cd retarget/alias
rm "$base/retarget/alias"
cat marker
echo changed > marker
cat "$base/retarget/one/marker"
pwd -L
pwd -P
`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "one\nchanged\n/retarget/alias\n/retarget/one\n");
});

test("serialized sessions preserve logical and physical directories after retargeting", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const session = shell.createSession();
  const entered = await session.exec(`${setup}\ncd retarget/alias\n${retarget}`);
  assert.equal(entered.exitCode, 0);
  assert.equal(entered.stderr, "");
  assert.equal(entered.state?.cwd, "/retarget/alias");
  const state = JSON.parse(JSON.stringify(entered.state));
  const result = await shell.exec('cat marker; echo changed > marker; pwd -L; pwd -P', { state });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "one\n/retarget/alias\n/retarget/one\n");
  const overridden = await shell.exec('cat marker; pwd', { state, cwd: "/retarget/two" });
  assert.equal(overridden.exitCode, 0);
  assert.equal(overridden.stderr, "");
  assert.equal(overridden.stdout, "two\n/retarget/two\n");
});

test("logical cd and directory stacks retain their spelling while physical cd uses the entered directory", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec(`${setup}
cd retarget/alias
${retarget}
dirs -l
printf '%s\\n' "\${DIRSTACK[0]}"
(cd -P .; cat marker; pwd)
(cd -L .; cat marker; pwd)
pushd / >/dev/null
printf '%s\\n' "$OLDPWD"
dirs -l
popd >/dev/null
cat marker
pwd
`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "/retarget/alias\n/retarget/alias\none\n/retarget/one\ntwo\n/retarget/alias\n/retarget/alias\n/ /retarget/alias\ntwo\n/retarget/alias\n");
});

test("warm invocations do not retain the previous logical directory", async t => {
  const fs = new MemoryFileSystem();
  await fs.symlink("/", "/alias");
  const shell = new Shell({ fs }).use(standardCommands());
  t.after(() => shell.dispose());
  const first = await shell.exec("cd /alias; pwd");
  assert.equal(first.exitCode, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, "/alias\n");
  assert.equal((await shell.exec("pwd")).stdout, "/\n");
});

test("middleware preserves logical cd changes between aliases of the same directory", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  shell.use(async (_context, next) => next());
  t.after(() => shell.dispose());
  const result = await shell.exec(`
mkdir /dir
ln -s /dir /first
ln -s /dir /second
echo 'cd /first' > /change.sh
cd /first
command cd /second
printf '%s\\n' "$PWD"
pwd
. /change.sh
printf '%s\\n' "$PWD"
pwd
`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "/second\n/second\n/first\n/first\n");
});
