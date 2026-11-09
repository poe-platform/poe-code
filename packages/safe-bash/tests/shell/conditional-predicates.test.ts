import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { predicateCommands } from "../../src/commands/predicates.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { basicCommands } from "../../src/commands/basic.js";
import { FsError } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

test("conditional file comparisons follow metadata, aliases and missing-file rules", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/old file", new Uint8Array([1]));
  await fs.writeFile("/new", new Uint8Array([2]));
  await fs.utimes("/old file", 1, 1);
  await fs.utimes("/new", 2, 2);
  await fs.link("/old file", "/alias");
  for (const expression of ['"old file" -ef alias', 'new -nt "old file"', '"old file" -ot new', 'new -nt missing', 'missing -ot new']) {
    const result = await shell.exec(`[[ ${expression} ]]`);
    assert.equal(result.exitCode, 0, expression);
    assert.equal(result.stderr, "", expression);
  }
  for (const expression of ['new -ef "old file"', 'missing -ef missing', 'missing -nt new', 'new -ot missing', 'new -nt new']) {
    const result = await shell.exec(`[[ ${expression} ]]`);
    assert.equal(result.exitCode, 1, expression);
    assert.equal(result.stderr, "", expression);
  }
});

test("conditional nameref checks inspect attributes rather than dereferencing", async () => {
  const { shell } = setup();
  const result = await shell.exec('declare -n ref=missing; [[ -R ref ]] && say reference; [[ -R missing ]] || say absent; [[ -t 1 ]] || say virtual');
  assert.equal(result.stdout, "reference\nabsent\nvirtual\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("conditional special-file and mode predicates use reported metadata", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/file", new Uint8Array([1]));
  const stat = await fs.stat("/file");
  for (const [operator, mode] of [["-b", 0o060600], ["-p", 0o010600], ["-S", 0o140600], ["-u", 0o104600], ["-g", 0o102600], ["-k", 0o101600]] as const) {
    fs.stat = async () => ({ ...stat, mode });
    const result = await shell.exec(`[[ ${operator} file ]]`);
    assert.equal(result.exitCode, 0, operator);
    assert.equal(result.stderr, "", operator);
    fs.stat = async () => ({ ...stat, mode: 0o100600 });
    assert.equal((await shell.exec(`[[ ${operator} file ]]`)).exitCode, 1, operator);
  }
});

test("conditional ownership uses explicit caller identity", async () => {
  for (const id of [0, 123]) {
    const { fs, shell } = setup({ capabilities: { predicateIdentity: { effectiveUid: id, effectiveGid: id } } });
    await fs.writeFile("/file", new Uint8Array([1]));
    for (const definition of predicateCommands()) shell.commands.register(definition);
    for (const operator of ["-O", "-G"]) {
      const result = await shell.exec(`[[ ${operator} file ]]`);
      assert.equal(result.exitCode, id === 0 ? 0 : 1, operator);
      assert.equal(result.stderr, "", operator);
      const bracket = await shell.exec(`[ ${operator} file ]`);
      assert.equal(bracket.exitCode, result.exitCode);
      assert.equal(bracket.stderr, "");
      assert.equal((await shell.exec(`[[ ${operator} missing ]]`)).exitCode, 1);
      const empty = await shell.exec(`[[ ${operator} "" ]]`);
      assert.equal(empty.exitCode, 1);
      assert.equal(empty.stderr, "");
    }
  }
});

test("conditional ownership refuses unknown identity without treating it as false", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/file", new Uint8Array([1]));
  for (const operator of ["-O", "-G"]) {
    const result = await shell.exec(`[[ ${operator} file ]]`);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /ownership predicate requires caller and filesystem identity/u);
    const missing = await shell.exec(`[[ ${operator} missing ]]`);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "");
  }
});

test("conditional file predicates do not swallow cancellation", async () => {
  const { fs, shell } = setup();
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  fs.stat = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(shell.exec('[[ a -ef b ]]', { signal: controller.signal }), error => error === reason);
});

test("conditional virtual terminal predicates match native bash", async () => {
  const { shell } = setup();
  for (const definition of basicCommands()) shell.commands.register(definition);
  const source = '[[ -t 1 ]]; a=$?; [[ -t invalid ]]; b=$?; [[ -t -1 ]]; c=$?; printf "%s\\n" "$a" "$b" "$c"';
  const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "/dev/null" } });
  assert.equal(oracle.error, undefined);
  assert.equal(oracle.signal, null);
  assert.equal(oracle.status, 0);
  const result = await shell.exec(source);
  assert.equal(result.exitCode, oracle.status);
  assert.equal(result.stdout, oracle.stdout);
  assert.equal(result.stderr, oracle.stderr);
});

test("conditional file predicates preserve short circuiting", async () => {
  const { fs, shell } = setup();
  fs.stat = async () => { throw new Error("unexpected metadata read"); };
  const result = await shell.exec('[[ yes || missing -ef other ]] && [[ "" && -p missing ]] || say done');
  assert.equal(result.stdout, "done\n");
  assert.equal(result.stderr, "");
});

for (const [command, closing] of [["[[", " ]]"], ["test", ""], ["[", " ]"]] as const) {
  const expression = (operand: string) => `${command} ${operand}${closing}`;

  test(`${command} compares virtual descriptor identity and modification times`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of predicateCommands()) shell.commands.register(definition);
    await fs.writeFile("/sample", new Uint8Array([1]));
    await fs.writeFile("/newer", new Uint8Array([2]));
    await fs.utimes("/sample", 1000, 1000);
    await fs.utimes("/newer", 2000, 2000);
    await fs.link("/sample", "/alias");
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.link("/sample", "/dev/fd/9");
    const cases: [string, number][] = [
      ["/dev/fd/3 -ef sample", 0], ["sample -ef /dev/fd/3", 0],
      ["/dev/fd/4 -ef /dev/fd/3", 0], ["/dev/fd/3 -ef alias", 0],
      ["/dev/fd/3 -ef newer", 1], ["/dev/fd/3 -ot sample", 1],
      ["sample -nt /dev/fd/3", 1], ["/dev/fd/3 -nt sample", 1],
      ["/dev/fd/3 -ot newer", 0], ["newer -nt /dev/fd/3", 0],
      ["/dev/stdin -ef sample", 0], ["/dev/stdout -ef sample", 0],
      ["/dev/stderr -ef sample", 0],
      ["/dev/fd/9 -ef /dev/fd/9", 1], ["/dev/fd/9 -ef sample", 1],
      ["/dev/fd/9 -ot sample", 0], ["sample -nt /dev/fd/9", 0],
      ["/dev/fd/9 -nt sample", 1], ["sample -ot /dev/fd/9", 1],
      ["/dev/fd/9 -nt /dev/fd/9", 1], ["/dev/fd/9 -ot /dev/fd/9", 1],
    ];
    for (const [operand, expected] of cases) {
      const source = `exec 3<sample 4<&3 9<&-; ${expression(operand)} <sample 1<>sample${operand.includes("/dev/stderr") ? " 2<>sample" : ""}`;
      const result = await shell.exec(source);
      assert.equal(result.exitCode, expected, source);
      assert.equal(result.stderr, "", source);
      assert.deepEqual(await fs.readFile("/sample"), new Uint8Array([1]), source);
    }
    // Descriptor metadata belongs to the open file even after its name is replaced.
    shell.commands.register({ name: "replace", async execute() {
      await fs.rename("/sample", "/retained");
      await fs.writeFile("/sample", new Uint8Array([3]));
      return { exitCode: 0 };
    } });
    const replaced = await shell.exec(`exec 3<sample; replace; ${expression("/dev/fd/3 -ef retained")}; say $?; ${expression("/dev/fd/3 -ef sample")}; say $?; exec 3<&-; ${expression("/dev/fd/3 -ef retained")}; say $?`);
    assert.equal(replaced.stdout, "0\n1\n1\n");
    assert.equal(replaced.stderr, "");
  });

  test(`${command} evaluates file predicates on symlink cycles without diagnostics`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of predicateCommands()) shell.commands.register(definition);
    await fs.symlink("loop", "/loop");
    await fs.symlink("cycle-b", "/cycle-a");
    await fs.symlink("cycle-a", "/cycle-b");
    await fs.symlink("missing", "/dangling");
    for (const path of ["loop", "cycle-a", "loop/child", "dangling"]) {
      for (const operator of ["-e", "-a", "-f", "-d", "-c", "-s", "-L", "-h", "-r", "-w", "-x", "-N"]) {
        const isLink = (operator === "-L" || operator === "-h") && path !== "loop/child";
        const source = expression(`${operator} ${path}`);
        const result = await shell.exec(source);
        assert.equal(result.exitCode, isLink ? 0 : 1, source);
        assert.equal(result.stdout, "", source);
        assert.equal(result.stderr, "", source);
        const negatedSource = expression(`! ${operator} ${path}`);
        const negated = await shell.exec(`${negatedSource} && say OK`);
        assert.equal(negated.exitCode, isLink ? 1 : 0, negatedSource);
        assert.equal(negated.stdout, isLink ? "" : "OK\n", negatedSource);
        assert.equal(negated.stderr, "", negatedSource);
      }
    }
  });

  test(`${command} treats EPERM access failures as false`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of predicateCommands()) shell.commands.register(definition);
    fs.access = async () => { throw new FsError("EPERM"); };
    for (const operator of ["-r", "-w", "-x"]) {
      const source = expression(`${operator} file`);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 1, source);
      assert.equal(result.stderr, "", source);
      const negated = await shell.exec(`${expression(`! ${operator} file`)} && say OK`);
      assert.equal(negated.exitCode, 0, source);
      assert.equal(negated.stdout, "OK\n", source);
      assert.equal(negated.stderr, "", source);
    }
  });

  for (const code of ["ELOOP", "EPERM"] as const) {
    for (const [operator, method] of [["-e", "stat"], ["-L", "lstat"], ["-r", "access"]] as const) {
      test(`${command} ${operator} preserves cancellation with ${code}`, async t => {
        const { fs, shell } = setup();
        t.after(() => shell.dispose());
        for (const definition of predicateCommands()) shell.commands.register(definition);
        const controller = new AbortController();
        const reason = new FsError(code);
        fs[method] = async () => { controller.abort(reason); throw reason; };
        await assert.rejects(shell.exec(expression(`${operator} file`), { signal: controller.signal }), error => error === reason);
      });
    }
  }

  test(`${command} -N uses filesystem modification and access times`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of predicateCommands()) shell.commands.register(definition);
    await fs.writeFile("/file", new Uint8Array([1]));
    await fs.symlink("file", "/link");
    for (const [access, modified, expected] of [[1000, 2000, 0], [2000, 2000, 1], [3000, 2000, 1]] as const) {
      await fs.utimes("/file", access, modified);
      for (const path of ["file", "link"]) {
        const source = expression(`-N ${path}`);
        const result = await shell.exec(source);
        assert.equal(result.exitCode, expected, source);
        assert.equal(result.stdout, "", source);
        assert.equal(result.stderr, "", source);
      }
    }
  });
}

for (const [command, closing] of [["[[", " ]]"], ["test", ""], ["[", " ]"]] as const) {
  test(`${command} tests open file descriptors without consuming their input`, async t => {
    const { fs, shell } = setup();
    shell.use(async (_context, next) => next());
    t.after(() => shell.dispose());
    for (const definition of predicateCommands()) shell.commands.register(definition);
    await fs.writeFile("/sample", new TextEncoder().encode("data\n"));
    const result = await shell.exec(`
      exec 3<sample
      ${command} -f /dev/fd/3${closing}; say "file=$?"
      ${command} -s /dev/fd/3${closing}; say "size=$?"
      ${command} /dev/fd/3 -ef sample${closing}; say "same=$?"
      exec 4<&3
      exec 3<&-
      ${command} -e /dev/fd/3${closing}; say "closed=$?"
      ${command} -f /dev/fd/4${closing}; say "copy=$?"
      IFS= read -r line <&4; say "$line"
      exec 4<&-
      exec 0<sample
      ${command} -f /dev/stdin${closing}; say "stdin=$?"
      IFS= read -r line; say "$line"
    `);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "file=0\nsize=0\nsame=0\nclosed=1\ncopy=0\ndata\nstdin=0\ndata\n");
  });
}

for (const [command, closing] of [["[[", " ]]"], ["test", ""], ["[", " ]"]] as const) {
  test(`${command} retains descriptor metadata after rename, replacement and unlink`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of [...predicateCommands(), ...filesystemCommands()]) shell.commands.register(definition);
    await fs.writeFile("/sample", new TextEncoder().encode("data\n"));
    const result = await shell.exec(`
      exec 3<>sample
      mv sample moved
      : >sample
      ${command} -f /dev/fd/3${closing}; say "file=$?"
      ${command} -s /dev/fd/3${closing}; say "size=$?"
      ${command} /dev/fd/3 -ef moved${closing}; say "moved=$?"
      ${command} /dev/fd/3 -ef sample${closing}; say "replacement=$?"
      rm moved
      ${command} -s /dev/fd/3${closing}; say "unlinked=$?"
      IFS= read -r line <&3; say "$line"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "file=0\nsize=0\nmoved=0\nreplacement=1\nunlinked=0\ndata\n");
  });

  test(`${command} descriptor aliases match native bash without accessing virtual /dev`, async t => {
    const { fs, shell } = setup();
    t.after(() => shell.dispose());
    for (const definition of [...predicateCommands(), ...basicCommands()]) shell.commands.register(definition);
    const fixture = fileURLToPath(new URL("./helpers.ts", import.meta.url));
    await fs.writeFile("/sample", readFileSync(fixture));
    const source = `
      exec 3<"$1"
      ${command} -f /dev/fd/3${closing}; echo "file=$?"
      ${command} -s /dev/fd/3${closing}; echo "size=$?"
      ${command} -d /dev/fd/3${closing}; echo "directory=$?"
      ${command} -e /dev/fd/99${closing}; echo "missing=$?"
      ${command} -f /dev/stdout${closing} 1<&3; echo "stdout=$?"
      ${command} -f /dev/stderr${closing} 2<&3; echo "stderr=$?"
      ${command} -f /dev/stdin${closing} <&3; echo "stdin=$?"
      IFS= read -r line <&3; echo "$line"
      exec 3<&-
      ${command} -e /dev/fd/3${closing}; echo "closed=$?"
    `;
    const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", source, "bash", fixture], {
      encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "/dev/null" },
    });
    assert.equal(oracle.error, undefined);
    assert.equal(oracle.signal, null);
    assert.equal(oracle.status, 0);
    assert.equal(oracle.stderr, "");
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => {
      assert.ok(!path.startsWith("/dev/"), `unexpected filesystem lookup: ${path}`);
      return stat(path, options);
    };
    const result = await shell.exec(`set -- /sample\n${source}`);
    assert.equal(result.exitCode, oracle.status);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.stdout, oracle.stdout);
  });
}
