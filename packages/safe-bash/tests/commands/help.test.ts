import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/core.js";

const gnuUtilities = "base32 base64 basename chmod cksum comm cp cut dirname env expand fold head join ln ls md5sum mkdir mktemp mv nl od paste readlink realpath rm rmdir seq sha1sum sha224sum sha256sum sha384sum sha512sum sort split stat tac tail tee touch tr unexpand uniq wc".split(" ");

test("all 46 reported utilities preserve binary fixtures and stdin on version requests", async () => {
  const fs = createMemoryFileSystem();
  const bytes = Uint8Array.of(67, 254, 0, 10);
  await fs.writeFile("/info-fixture", bytes);
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const command of ["cat", "du", ...gnuUtilities]) {
      const stdin = (async function* () { assert.fail("version must not read stdin"); yield bytes; })();
      const result = await shell.exec(`${command} --version -- info-fixture /missing`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${command} (safe-bash virtual implementation)\n`);
      assert.deepEqual(await fs.readFile("/info-fixture"), bytes);
      assert.deepEqual(await fs.readdir("/"), [{ name: "info-fixture", type: "file" }]);
    }
  } finally { await shell.dispose(); }
});

for (const command of gnuUtilities) {
  test(`${command} admits help and truthful version requests before file processing`, async () => {
    const fs = createMemoryFileSystem();
    const bytes = Uint8Array.of(254, 0, 10);
    await fs.writeFile("/info-fixture", bytes);
    const shell = new Shell({ fs }).use(agentCommands());
    const stdin = (async function* () { assert.fail("information must not read stdin"); yield bytes; })();
    try {
      for (const flag of ["--help", "--version"]) {
        const result = await shell.exec(`${command} ${flag} -- info-fixture /missing`, { stdin });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        if (flag === "--help") {
          assert.ok(result.stdout.startsWith(`Usage: ${command} `), result.stdout);
          assert.ok(result.stdout.includes("--help"));
          assert.ok(result.stdout.includes("--version"));
        } else {
          assert.ok(result.stdout.includes("safe-bash"), result.stdout);
          assert.ok(!result.stdout.includes("GNU coreutils"));
        }
        assert.deepEqual(await fs.readFile("/info-fixture"), bytes);
      }
    } finally { await shell.dispose(); }
  });
}

test("GNU information options respect terminators, option values and env child arguments", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/--help", new TextEncoder().encode("literal\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    assert.equal((await shell.exec("head -- --help")).stdout, "literal\n");
    assert.equal((await shell.exec("basename -s --help name--help")).stdout, "name\n");
    assert.equal((await shell.exec("env echo --help")).stdout, "--help\n");
    assert.equal((await shell.exec("env A=value echo --version")).stdout, "--version\n");
    assert.equal((await shell.exec("head -n 2 --help /missing")).exitCode, 0);
    assert.equal((await shell.exec("head --lines=2 --version /missing")).exitCode, 0);
    assert.equal((await shell.exec("mktemp --tmpdir --help")).exitCode, 0);
    assert.equal((await shell.exec("head --unknown --help")).exitCode, 2);
    assert.equal((await shell.exec("head -n --help")).exitCode, 2);
    assert.equal((await shell.exec("head --lines --help")).exitCode, 2);
    for (const command of gnuUtilities) {
      for (const flag of ["--help=yes", "--version=yes"]) {
        const result = await shell.exec(`${command} ${flag}`);
        assert.notEqual(result.exitCode, 0, `${command} ${flag}`);
        assert.equal(result.stdout, "");
      }
    }
  } finally { await shell.dispose(); }
});

test("GNU information requests require no filesystem operations or backend capabilities", async () => {
  const fs = createMemoryFileSystem();
  const unavailable = new Proxy(fs, {
    get(target, key) {
      if (key === "capabilities") return { readOnly: true };
      const member = Reflect.get(target, key);
      if (typeof member === "function") return () => { assert.fail(`information accessed filesystem ${String(key)}`); };
      return member;
    },
  });
  const shell = new Shell({ fs: unavailable }).use(agentCommands());
  try {
    for (const command of ["cat", "du", ...gnuUtilities]) {
      for (const flag of command === "cat" || command === "du" ? ["--version"] : ["--help", "--version"]) {
        const result = await shell.exec(`${command} ${flag} -- /missing`);
        assert.equal(result.exitCode, 0, result.stderr);
      }
    }
  } finally { await shell.dispose(); }
});

for (const [command, option] of [["cat", "--number"], ["grep", "--regexp"], ["rg", "--glob"], ["tar", "--files-from"]]) {
  test(`${command} --help succeeds without accessing input files`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const stdin = (async function* () {
        assert.fail("help must not consume standard input");
        yield new Uint8Array();
      })();
      for (const args of ["--help", "--help /missing"]) {
        const result = await shell.exec(`${command} ${args}`, { stdin });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.ok(result.stdout.startsWith(`Usage: ${command} `), result.stdout);
        assert.ok(result.stdout.includes(option!), result.stdout);
        assert.ok(result.stdout.includes("--help"), result.stdout);
      }
    } finally { await shell.dispose(); }
  });
}

test("help remains a literal filename or pattern when passed as an operand", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/--help", new TextEncoder().encode("--help\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const command of ["cat -- --help", "grep -e --help -- --help", "rg -F -e --help -- --help"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "--help\n");
    }
    assert.equal((await shell.exec("tar cf /archive -- --help")).exitCode, 0);
    assert.equal((await shell.exec("tar tf /archive")).stdout, "--help\n");
  } finally { await shell.dispose(); }
});

test("help rejects attached values", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    for (const command of ["cat", "grep", "rg", "tar"]) {
      const result = await shell.exec(`${command} --help=yes`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
    }
  } finally { await shell.dispose(); }
});
