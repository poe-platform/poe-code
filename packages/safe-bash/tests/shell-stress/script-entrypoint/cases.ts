import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { FsError, toByteSource } from "../../../src/contracts/index.js";
import { ShellLimitError } from "../../../src/shell/index.js";
import { setup } from "../../shell/helpers.js";

type Fixture = ReturnType<typeof setup>;
const encoder = new TextEncoder();

async function script(fixture: Fixture, path: string, body: string): Promise<void> {
  await fixture.fs.writeFile(path, encoder.encode(body), { mode: 0o755 });
}

function limitIs(limit: string): (error: unknown) => boolean {
  return error => error instanceof ShellLimitError && error.limit === limit;
}

export const cases: Record<string, () => Promise<void>> = {
  async "literal-paths-and-option-boundary"() {
    const fixture = setup();
    for (const path of ["/+flag", "/two words;$(say injected)"]) {
      await script(fixture, path, '#!/bin/bash\nargs "$0" "$@"');
    }
    const result = await fixture.shell.exec("bash -- +flag -c ''; './two words;$(say injected)' '--' '*' 'a;b'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["+flag","-c",""]["./two words;$(say injected)","--","*","a;b"]');
    const denied = await fixture.shell.exec("bash +flag");
    assert.equal(denied.exitCode, 2);
    assert.equal(denied.stdout, "");
  },

  async "builtin-function-registry-shadow"() {
    const fixture = setup();
    const seen: string[] = [];
    fixture.commands.register({ name: "true", execute() { seen.push("registry-true"); return { exitCode: 91 }; } });
    fixture.commands.register({ name: "bash", execute() { seen.push("registry-bash"); return { exitCode: 12 }; } });
    await script(fixture, "/shadow", '#!/bin/bash\nbash; args "$?"');
    const result = await fixture.shell.exec('true() { say function-true; status 7; }; true; args "$?"; command true; args "$?"; bash; args "$?"; bash() { status 13; }; bash; args "$?"; command bash; args "$?"; ./shadow');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, 'function-true\n["7"]["0"]["12"]["13"]["12"]["12"]');
    assert.deepEqual(seen, ["registry-bash", "registry-bash", "registry-bash"]);
  },

  async "nested-function-argv0-and-positional-restore"() {
    const fixture = setup();
    await script(fixture, "/inner", '#!/bin/bash\nargs "$0" "$1"; exit 6');
    await script(fixture, "/outer", '#!/bin/bash\nwork() { local LOCAL=private; args "$0" "$1"; ./inner child; args "$?" "$0" "$1" "$LOCAL"; }; work function; args "$0" "$1" "${LOCAL-absent}"');
    const result = await fixture.shell.exec('set -- parent; ./outer outer; args "$0" "$1"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["./outer","function"]["./inner","child"]["6","./outer","function","private"]["./outer","outer","absent"]["virtual-bash","parent"]');
  },

  async "descriptor-cursor-across-nested-scripts"() {
    const fixture = setup();
    await fixture.fs.writeFile("/input", encoder.encode("first\nsecond\nthird\n"));
    await script(fixture, "/inner", '#!/bin/bash\nread -r value <&3; args "$value"; : 3<&-');
    await script(fixture, "/outer", '#!/bin/bash\nbash inner; read -r value <&3; args "$value"');
    const result = await fixture.shell.exec('{ ./outer; read -r value <&3; args "$value"; } 3<input');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["first"]["second"]["third"]');
  },

  async "invoke-replacement-input-and-exhausted-origin"() {
    const fixture = setup();
    const origins: (boolean | undefined)[] = [];
    fixture.commands.register({ name: "origin", execute(context) { origins.push(context.stdinIsDefault); return { exitCode: 0 }; } });
    fixture.commands.register({ name: "delegate", execute(context) {
      assert.ok(context.invoke);
      return context.invoke("bash", ["inner"], { stdin: toByteSource("replacement\n") });
    } });
    await script(fixture, "/inner", '#!/bin/bash\nread -r value; args "$value"; pass; origin');
    await script(fixture, "/outer", '#!/bin/bash\ndelegate; read -r value; args "$value"; pass; origin');
    const result = await fixture.shell.exec('./outer; origin', { stdin: "parent\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["replacement"]["parent"]');
    assert.deepEqual(origins, [false, false, false]);
  },

  async "parse-before-effects-with-caller-redirections"() {
    const fixture = setup();
    await fixture.fs.writeFile("/caller", encoder.encode("old"));
    await script(fixture, "/bad", '#!/bin/bash\nsay bad >body\nfor item in one; do\n');
    const result = await fixture.shell.exec('bash bad >caller 2>diagnostic; args "$?"');
    assert.equal(result.stdout, '["2"]');
    assert.equal(result.stderr, "");
    assert.equal((await fixture.fs.readFile("/caller")).byteLength, 0);
    await assert.rejects(fixture.fs.stat("/body"), error => error instanceof FsError && error.code === "ENOENT");
    assert.match(new TextDecoder().decode(await fixture.fs.readFile("/diagnostic")), /bad: line \d+: syntax error:/u);
  },

  async "vfs-traversal-and-symlink-permission-boundary"() {
    const fixture = setup();
    await fixture.fs.mkdir("/work");
    await script(fixture, "/program", '#!/bin/bash\nargs "$0" "$PWD"');
    await fixture.fs.symlink("../../program", "/work/link");
    const result = await fixture.shell.exec('cd /work; ../../program; ./link');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '["../../program","/work"]["./link","/work"]');
    await fixture.fs.chmod("/program", 0o000);
    await assert.rejects(fixture.fs.access("/work/link", 4), error => error instanceof FsError && error.code === "EACCES");
    for (const entry of ["./link", "bash ./link"]) {
      const denied = await fixture.shell.exec(entry, { cwd: "/work" });
      assert.equal(denied.exitCode, 126);
      assert.equal(denied.stdout, "");
      assert.match(denied.stderr, /link.*Permission denied/u);
    }
    await fixture.fs.symlink("/etc/passwd", "/escape");
    const absent = await fixture.shell.exec("../../escape");
    assert.equal(absent.exitCode, 127);
    assert.equal(absent.stdout, "");
    assert.match(absent.stderr, /escape.*No such file/u);
  },

  async "strict-header-and-utf8-boundaries"() {
    const fixture = setup();
    const prefix = encoder.encode("#!/bin/bash\nsay forbidden\n");
    for (const tail of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
      await fixture.fs.writeFile("/invalid", Uint8Array.from([...prefix, ...tail]), { mode: 0o755 });
      for (const entry of ["./invalid", "bash invalid"]) {
        const result = await fixture.shell.exec(entry);
        assert.equal(result.exitCode, 126);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /UTF-8|binary/u);
      }
    }
    for (const header of ["#!/bin/bash\r", "#!/bin/bashx", "#!/bin/bash --"]) {
      await script(fixture, "/invalid", `${header}\nsay forbidden`);
      const result = await fixture.shell.exec("./invalid");
      assert.equal(result.exitCode, 126);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /unsupported interpreter/u);
    }
    await script(fixture, "/supported", '#!/usr/bin/env -S bash\nargs "$0" "$@"');
    const supported = await fixture.shell.exec("./supported 'literal argument'");
    assert.equal(supported.exitCode, 0);
    assert.equal(supported.stdout, '["./supported","literal argument"]');
    assert.equal(supported.stderr, "");
  },

  async "repeated-invoke-source-utf8-byte-budget"() {
    const fixture = setup();
    const body = '#!/bin/bash\nargs "é🙂"';
    await script(fixture, "/program", body);
    fixture.commands.register({ name: "twice", async execute(context) {
      assert.ok(context.invoke);
      await context.invoke("bash", ["program"]);
      return context.invoke("./program", []);
    } });
    const exact = Buffer.byteLength("twice") + 2 * Buffer.byteLength(body);
    const accepted = await fixture.shell.exec("twice", { limits: { maxSourceBytes: exact } });
    assert.equal(accepted.stdout, '["é🙂"]["é🙂"]');
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    await assert.rejects(fixture.shell.exec("twice", { limits: { maxSourceBytes: exact - 1 } }), limitIs("maxSourceBytes"));
  },

  async "mixed-invoke-script-loop-command-budgets"() {
    const fixture = setup();
    await script(fixture, "/program", '#!/bin/bash\nfor item in a b; do true; done');
    fixture.commands.register({ name: "twice", async execute(context) {
      assert.ok(context.invoke);
      await context.invoke("bash", ["program"]);
      return context.invoke("./program", []);
    } });
    await assert.rejects(fixture.shell.exec("twice", { limits: { maxLoopIterations: 3 } }), limitIs("maxLoopIterations"));
    await assert.rejects(fixture.shell.exec("twice", { limits: { maxCommands: 4 } }), limitIs("maxCommands"));
    const accepted = await fixture.shell.exec("twice", { limits: { maxLoopIterations: 4 } });
    assert.equal(accepted.exitCode, 0, accepted.stderr);
  },

  async "mixed-invoke-script-recursion"() {
    const fixture = setup();
    await script(fixture, "/program", '#!/bin/bash\nrelay');
    fixture.commands.register({ name: "relay", execute(context) {
      assert.ok(context.invoke);
      return context.invoke("bash", ["program"]);
    } });
    await assert.rejects(fixture.shell.exec("./program", { limits: { maxSubstitutionDepth: 7, maxCommands: 100 } }), limitIs("maxSubstitutionDepth"));
  },

  async "cancel-access-fserror-identity-and-late-rejection"() {
    const fixture = setup();
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { path: "/caller-abort" });
    await script(fixture, "/program", '#!/bin/bash\nsay forbidden');
    let reads = 0;
    const readFile = fixture.fs.readFile.bind(fixture.fs);
    fixture.fs.readFile = async (...args) => { reads++; return readFile(...args); };
    fixture.fs.access = async (_path, _mode, options) => {
      assert.ok(options?.signal);
      controller.abort(reason);
      await delay(20);
      throw new Error("late access rejection");
    };
    await assert.rejects(fixture.shell.exec("./program", { signal: controller.signal }), error => error === reason);
    await delay(40);
    assert.equal(reads, 0);
  },

  async "typed-budget-identity-at-source-boundary"() {
    const fixture = setup();
    await script(fixture, "/program", '#!/bin/bash\nsay forbidden');
    const reason = new ShellLimitError("maxSourceBytes");
    fixture.fs.readFile = async () => { throw reason; };
    await assert.rejects(fixture.shell.exec("bash program"), error => error === reason);
  },

  async "abort-wins-successful-stat-and-read"() {
    for (const boundary of ["stat", "readFile"] as const) {
      const fixture = setup();
      const controller = new AbortController();
      const reason = new FsError("ENOENT", { path: `/${boundary}-abort` });
      await script(fixture, "/program", '#!/bin/bash\nsay forbidden');
      if (boundary === "stat") {
        const stat = fixture.fs.stat.bind(fixture.fs);
        fixture.fs.stat = async (path, options) => {
          const result = await stat(path, options);
          controller.abort(reason);
          return result;
        };
      } else {
        const readFile = fixture.fs.readFile.bind(fixture.fs);
        fixture.fs.readFile = async (path, options) => {
          const result = await readFile(path, options);
          controller.abort(reason);
          return result;
        };
      }
      await assert.rejects(fixture.shell.exec("./program", { signal: controller.signal }), error => error === reason);
    }
  },

  async "cancel-nested-invoke-body-identity"() {
    const fixture = setup();
    const controller = new AbortController();
    const reason = new FsError("EACCES", { path: "/body-abort" });
    await script(fixture, "/program", '#!/bin/bash\nrelay; say forbidden');
    fixture.commands.register({ name: "relay", execute(context) {
      assert.ok(context.invoke);
      return context.invoke("cancel", []);
    } });
    fixture.commands.register({ name: "cancel", execute(context) {
      controller.abort(reason);
      assert.equal(context.signal.reason, reason);
      return new Promise(() => {});
    } });
    await assert.rejects(fixture.shell.exec("bash program", { signal: controller.signal }), error => error === reason);
  },

  async "post-stat-disappearance-is-completed-failure"() {
    const fixture = setup();
    await script(fixture, "/program", '#!/bin/bash\nsay forbidden');
    const reason = new FsError("ENOENT", { path: "/program" });
    fixture.fs.readFile = async () => { throw reason; };
    await assert.rejects(fixture.fs.readFile("/program"), error => error === reason);
    for (const entry of ["./program", "bash program"]) {
      const result = await fixture.shell.exec(entry);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /program.*No such file/u);
    }
    const continued = await fixture.shell.exec('bash program; args "$?"; say parent');
    assert.equal(continued.stdout, '["127"]parent\n');
    assert.equal(continued.exitCode, 0);
  },

  async "middleware-literal-invoke-and-body-denial"() {
    const fixture = setup();
    await script(fixture, "/program", '#!/bin/bash\nsay forbidden; args "$?" "$1"');
    const seen: string[] = [];
    fixture.shell.use(async (context, next) => {
      seen.push(context.command);
      if (context.command === "entry") {
        assert.ok(context.invoke);
        return context.invoke("bash", ["program", "$(literal);*"]);
      }
      if (context.command === "say") return { exitCode: 41 };
      return next();
    });
    const result = await fixture.shell.exec("entry");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["41","$(literal);*"]');
    assert.deepEqual(seen, ["entry", "bash", "say", "args"]);
  },
};
