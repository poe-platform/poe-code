import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import type { CommandContext } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { jobsExtension } from "../../src/shell/extensions/jobs/index.js";
import { builtInDirectContextExecutors, RESOLVED_EXIT_ZERO } from "../../src/commands/internal.js";
import { Capture, MemoryRedirectSink, type IO } from "../../src/shell/runtime.js";

test("fast redirected commands share effective IO on new and reused contexts", async t => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  const contexts: CommandContext[] = [];
  const execute = (context: CommandContext) => {
    contexts.push(context);
    const io = (context as unknown as { _io: IO })._io;
    assert.equal(io.stdout, context.stdout);
    if (context.args[0] === "plain") {
      assert.ok(context.stdout instanceof Capture);
      context.stdout.writeSync(new TextEncoder().encode("visible\n"));
      return RESOLVED_EXIT_ZERO;
    }
    assert.ok(io.descriptors);
    assert.equal(io.descriptors, Reflect.get(context, "descriptors"));
    assert.equal(io.descriptors.get(0)?.input, io.stdin);
    assert.equal(io.descriptors.get(1)?.output, context.stdout);
    assert.equal(io.descriptors.get(2)?.output, io.stderr);
    // Synchronous completion exercises context pooling as well as first construction.
    assert.ok(context.stdout instanceof MemoryRedirectSink);
    context.stdout.writeSync(new TextEncoder().encode("direct\n"));
    assert.ok(io.stdout instanceof MemoryRedirectSink);
    io.stdout.writeSync(new TextEncoder().encode("bound\n"));
    const output = io.descriptors.get(1)!.output;
    assert.ok(output instanceof MemoryRedirectSink);
    output.writeSync(new TextEncoder().encode("descriptor\n"));
    return RESOLVED_EXIT_ZERO;
  };
  builtInDirectContextExecutors.add(execute);
  shell.commands.register({ name: "awk", execute });
  t.after(async () => {
    builtInDirectContextExecutors.delete(execute);
    await shell.dispose();
  });
  const result = await shell.exec("awk > /out; awk >> /out; awk plain");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "visible\n");
  assert.equal(result.stderr, "");
  assert.equal(contexts.length, 3);
  assert.equal(contexts[0], contexts[1], "the second invocation must exercise pooled reuse");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "direct\nbound\ndescriptor\n".repeat(2));
});

for (const [name, source, expected] of [
  ["named varredir_close enabled", 'shopt -s varredir_close; say "enable=$?"; : {out}>log; say "assigned=${out-unset}"; (printf sample >&"$out") 2>/dev/null; say "write=$?"; pass <log', 'enable=0\nassigned=10\nwrite=1\n'],
  ["named varredir_close disabled", 'shopt -u varredir_close; say "enable=$?"; : {out}>log; say "assigned=${out-unset}"; (printf sample >&"$out") 2>/dev/null; say "write=$?"; pass <log', 'enable=0\nassigned=10\nwrite=0\nsample'],
  ["named varredir_close exec persists", 'shopt -s varredir_close; exec {out}>log; printf sample >&"$out"; exec {out}>&-; pass <log', 'sample'],
  ["named varredir_close command lifetime", 'shopt -s varredir_close; f(){ say inside >&"$out"; }; f {out}>log; (say outside >&"$out") 2>/dev/null; say "$?"; pass <log; : {next}>other; say "$out/$next"', '1\ninside\n10/10\n'],
  ["named varredir_close input lifetime", 'shopt -s varredir_close; read -r -u 10 value {input}<<<hello; say "$value/$input"; (read -r -u "$input" value) 2>/dev/null; say "$?"', 'hello/10\n1\n'],
  ["named varredir_close failure cleanup", 'shopt -s varredir_close; status 7 {out}>log; say "$?"; (say bad >&"$out") 2>/dev/null; say "$?"; pass <log', '7\n1\n'],
  ["named varredir_close compound lifetime", 'shopt -s varredir_close; { say inside >&"$out"; } {out}>log; (say outside >&"$out") 2>/dev/null; say "$?"; pass <log', '1\ninside\n'],
  ["named varredir_close redirect failure cleanup", 'shopt -s varredir_close; : 2>/dev/null {out}>log </missing; say "$?"; (say bad >&"$out") 2>/dev/null; say "$?"; pass <log', '1\n1\n'],
  ["named varredir_close keeps duplicate", 'shopt -s varredir_close; { exec 3>&"$out"; } {out}>log; say kept >&3; exec 3>&-; (say bad >&"$out") 2>/dev/null; say "$?"; pass <log', '1\nkept\n'],
  ["named exec input", 'printf "first\\nsecond\\n" > rows; exec {input}<rows; IFS= read -r a <&"$input"; IFS= read -r b <&"$input"; exec {input}<&-; printf "%s/%s\\n" "$a" "$b"', 'first/second\n'],
  ["named output skips occupied descriptors", 'exec 10>occupied; : {out}>log; say "$out"; printf sample >&"$out"; exec {out}>&-; pass <log', '11\nsample'],
  ["named close releases descriptor", ': {out}>log; exec {out}>&-; : {next}>other; say "$out/$next"; say reused >&"$next"; exec {next}>&-; pass <other', '10/10\nreused\n'],
  ["named command close restores descriptor", ': {out}>log; : {out}>&-; : {next}>other; say "$out/$next"; say restored >&"$out"; exec {out}>&-; pass <log', '10/11\nrestored\n'],
  ["named allocations follow redirection order", ': {first}>first {second}>&"$first"; say "$first/$second"; say shared >&"$second"; exec {first}>&- {second}>&-; pass <first', '10/11\nshared\n'],
  ["named reassignment keeps previous descriptor open", ': {out}>first; old=$out; : {out}>second; say "$old/$out"; say first >&"$old"; say second >&"$out"; exec {old}>&- {out}>&-; pass <first; pass <second', '10/11\nfirst\nsecond\n'],
  ["named allocation failure leaves variable unchanged", 'out=old; : 2>/dev/null {out}</missing; say "$?:$out"; : {next}>log; say "$next"', '1:old\n10\n'],
  ["named readonly assignment does not leak descriptor", 'readonly out=old; : 2>/dev/null {out}>log; say "$?:$out"; : {next}>other; say "$next"', '1:old\n10\n'],
  ["named input assignment prefix", 'prefix=old; prefix=new : {input}<<<hello; read -r value <&"$input"; exec {input}<&-; say "$prefix/$value"', 'old/hello\n'],
  ["named input substitution does not read the file", 'say data >rows; value=$({input}<rows); say "<$value>/${input-unset}"', '<>/unset\n'],
  ["named function serialization", 'f(){ : {out}>log; }; eval "$(declare -f f)"; f; say saved >&"$out"; exec {out}>&-; pass <log', 'saved\n'],
  ["named append", 'say first >log; : {out}>>log; say second >&"$out"; exec {out}>&-; pass <log', 'first\nsecond\n'],
  ["named readwrite", 'say abcdef >log; : {both}<>log; printf xy >&"$both"; read -r value <&"$both"; exec {both}>&-; say "$value"', 'cdef\n'],
  ["named nameref", 'declare -n ref=out; : {ref}>log; say "$ref/$out"; say saved >&"$out"; exec {ref}>&-; pass <log', '10/10\nsaved\n'],
  ["named duplicate survives original close", 'exec 3>log; : {out}>&3; exec 3>&-; say kept >&"$out"; : {out}>&-; pass <log', 'kept\n'],
  ["named here string", ': {input}<<<hello; read -r value <&"$input"; : {input}<&-; say "$value"', 'hello\n'],
  ["named output on external command", 'say visible {out}>log; say saved >&"$out"; : {out}>&-; pass <log', 'visible\nsaved\n'],
  ["named compound output", '{ say "$out"; } {out}>log; say saved >&"$out"; : {out}>&-; pass <log', '10\nsaved\n'],
  ["quoted descriptor name stays an argument", 'args "{out}">log; pass <log; say "${out-unset}"', '["{out}"]unset\n'],
  ["spaced descriptor name stays an argument", 'args {out} >log; pass <log; say "${out-unset}"', '["{out}"]unset\n'],
  ["subshell substitution", 'say $((say a); (say b))', 'a b\n'],
  ["quoted arithmetic substitution", 'say $(( $(say "))" >/dev/null; say 5) + 1 ))', '6\n'],
  ["read descriptor", 'say first > in; say second >> in; { read -r -u 3 a; read -r -u 3 b; } 3< in; say "$a|$b"', 'first|second\n'],
  ["read timeout", 'say first > in; read -t 1 a < in; say "$a"', 'first\n'],
  ["exec output", '(exec > out; say first; say second); pass < out', 'first\nsecond\n'],
  ["exec output ordering", '(exec > out; say first; say second); say before; pass < out', 'before\nfirst\nsecond\n'],
  ["exec input", 'say first > in; say second >> in; exec 3< in; read -u3 a; read -u3 b; exec 3<&-; say "$a|$b"', 'first|second\n'],
  ["exec duplicate survives close", 'exec 3> out; exec 4>&3; exec 3>&-; say saved >&4; exec 4>&-; pass < out', 'saved\n'],
  ["exec temporary redirect", 'exec 3> out; say other > other; say kept >&3; exec 3>&-; pass < other; pass < out', 'other\nkept\n'],
  ["exec output restored in compound", 'exec 3>&1; { exec > out; say hidden; } > temporary; say visible; exec 1>&3; pass < out', 'visible\nhidden\n'],
  ["exec in function", 'f(){ exec 3> out; }; f; say kept >&3; exec 3>&-; pass < out', 'kept\n'],
  ["exec expanded function restores redirected descriptor", 'exec 3>out; f(){ exec 3>other; }; name=f; "$name" 3>temp; say expected >&3; exec 3>&-; say OUT; pass <out; say OTHER; pass <other', 'OUT\nexpected\nOTHER\n'],
  ["exec command substitution descriptor isolation", 'exec 3>out; say "$(exec 3>other; say child >&3; say ok)"; say parent >&3; exec 3>&-; say OUT; pass <out; say OTHER; pass <other', 'ok\nOUT\nparent\nOTHER\nchild\n'],
  ["exec unrelated descriptor preserves compound output", 'exec 5>&1; exec >out; { exec 4>&1; say temp; } >temp; say main; exec 1>&5; pass <out; pass <temp', 'main\ntemp\n'],
  ["exec unrelated descriptor preserves function output", 'exec 5>&1; exec >out; f(){ exec 4>&1; say temp; }; f >temp; say main; exec 1>&5; pass <out; pass <temp', 'main\ntemp\n'],
  ["exec subshell isolation", '(exec 3> out; say child >&3); say "$?"; pass < out', '0\nchild\n'],
  ["read zero timeout does not consume", 'say first > in; { read -t0 -u3 a; say "$?:${a-unset}"; read -u3 a; say "$a"; } 3< in', '0:unset\nfirst\n'],
  ["exec descriptor", 'exec 3> out; say first >&3; say second >&3; exec 3>&-; pass < out', 'first\nsecond\n'],
  ["exec replacement", '(exec say replaced; say unreachable)', 'replaced\n'],
  ["exec replacement status", '(exec status 7; say unreachable); say "$?"', '7\n'],
  ["exec builtin eval restores descriptor", 'exec 3>out; f(){ exec 3>other; }; builtin eval "f" 3>temp; say expected >&3; exec 3>&-; pass <out; pass <other', 'expected\n'],
  ["nested temporary redirects", 'exec 5>&1; exec >out; { say inner >inner; exec 4>&1; say temp; } >temp; say main; exec 1>&5; pass <out; pass <temp; pass <inner', 'main\ntemp\ninner\n'],
  ["noclobber device", 'set -C; say hello > /dev/null; say "$?"', '0\n'],
  ["shell process variable", 'say "$BASHPID:${BASHPID}:${BASHPID:-missing}"', '1:1:1\n'],
  ["empty background pid", 'say "<$!>"', '<>\n'],
  ["quoted greeting", 'USER=world; say $\'hello \'"$USER"', 'hello world\n'],
  ["subshell depth", 'say "$BASH_SUBSHELL"; (say "$BASH_SUBSHELL"); say "$(say "$BASH_SUBSHELL")"', '0\n1\n1\n'],
  ["implicit both output", 'both >& out; pass < out', 'out\nerr\n'],
  ["append both output", 'say first > out; both &>> out; pass < out', 'first\nout\nerr\n'],
  ["readwrite input", 'say data > out; pass <> out', 'data\n'],
  ["readwrite creates", '{ say data >&3; } 3<> out; pass < out', 'data\n'],
  ["readwrite preserves tail", 'say abcdef > out; { say xy >&3; } 3<> out; pass < out', 'xy\ndef\n'],
  ["shared readwrite position", 'say abcdef > out; { say xy >&3; pass <&3; } 3<> out', 'def\n'],
  ["numeric duplication", 'say out 3> out >&3; pass < out', 'out\n'],
  ["array prefix restores after failure", 'a=(10 20); a=override status 7; say "${a[@]}"', '10 20\n'],
  ["array prefix nested function", 'a=(10 20); f(){ envget a; }; a=override f; say "${a[@]}"', 'override10 20\n'],
  ["array prefix", 'a=(10 20); a=override envget a; say "${a[@]}"', 'override10 20\n'],
  ["bare array arithmetic", 'a=(10 20); say "$((a+5))"; say "$((a=5)):${a[@]}"', '15\n5:5 20\n'],
] as const) test(`standard shell: ${name}`, async () => {
  const { shell } = setup(name === "empty background pid" ? { extensions: [jobsExtension()] } : {});
  if (name.startsWith("named")) shell.use(standardCommands());
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [source, expected, stderr = ""] of [
  ['echo $((echo hello) | tr a-z A-Z)', 'HELLO\n'],
  ['echo $((echo a); (echo b))', 'a b\n'],
  ['echo $((echo out; echo err >&2) 3>&1 1>&2 2>&3)', 'err\n', 'out\n'],
  ['echo $(( $(echo ")" >/dev/null; echo 5) + 1 ))', '6\n'],
  ['echo $(( $(echo "))" >/dev/null; echo 5) + 1 ))', '6\n'],
  ['echo "$BASHPID:${BASHPID}:${BASHPID:-missing}"; for i in 1 2; do echo "$BASHPID"; done', '1:1:1\n1\n1\n'],
  ['RANDOM=42; a=$RANDOM; RANDOM=42; b=$RANDOM; [[ $a == "$b" && $a -ge 0 && $a -le 32767 ]]; echo "$?"; SECONDS=123; echo "$SECONDS"', '0\n123\n'],
  ['(exec echo replaced; echo unreachable); echo parent', 'replaced\nparent\n'],
  ['(exec bash -c \'printf "%s\\n" "$1"\' ignored "two words"; echo unreachable); echo parent', 'two words\nparent\n'],
] as const) test(`standard shell reported parity: ${source}`, async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stderr, stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.exitCode, 0);
});

for (const source of ['say wrong 1>& out', 'say wrong >&9', 'say wrong 2>& out']) {
  test(`standard shell rejects invalid descriptor: ${source}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(source);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("Bad file descriptor"), result.stderr);
    } finally { await shell.dispose(); }
  });
}

test("named descriptors respect the descriptor bound and can close when full", async () => {
  const { shell } = setup();
  try {
    const occupied = Array.from({ length: 246 }, (_, index) => `${index + 10}>/dev/null`).join(" ");
    const result = await shell.exec(`exec ${occupied}; fd=10; : 2>/dev/null {out}>log; say "$?:\${out-unset}"; exec {fd}>&-; : {out}>log; say "$out"`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:unset\n10\n");
  } finally { await shell.dispose(); }
});

test("readwrite redirection drains short descriptor writes", async () => {
  const { shell, fs } = setup();
  const open = fs.open.bind(fs);
  fs.open = async (path, options) => {
    const descriptor = await open(path, options);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = (bytes, position, forwarded) => write(bytes.subarray(0, 2), position, forwarded);
    return descriptor;
  };
  try {
    const result = await shell.exec('{ say abcdef >&3; } 3<> out; pass < out');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "abcdef\n");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const extraRedirect of ["", " 2>/dev/null"]) {
  for (const [source, expected] of [
    ['sed -e "w /out" -e "s/longer-first-line/short/" /input', "short\n-first-line\n"],
    ['awk \'{ print "from-file-longer-text" >> "/out"; print "short" }\' /input', "short\nile-longer-text\n"],
  ]) {
    test(`output redirect preserves trailing bytes written independently: ${source}${extraRedirect}`, async t => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands()).use(textProgramCommands());
      t.after(() => shell.dispose());
      await fs.writeFile("/input", new TextEncoder().encode("longer-first-line\n"));
      const result = await shell.exec(`${source} > /out${extraRedirect}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), expected);
    });
  }
}

for (const operator of [">", ">>"]) {
  test(`output redirect ${operator} retains its opened file after a rename`, async t => {
    const { shell, fs, commands } = setup();
    t.after(() => shell.dispose());
    await fs.writeFile("/out", new TextEncoder().encode("before\n"));
    commands.register({ name: "sed", async execute(context) {
      await context.fs.rename("/out", "/moved");
      await context.fs.writeFile("/out", new TextEncoder().encode("replacement\n"));
      await context.stdout.write(new TextEncoder().encode("after\n"));
      return { exitCode: 0 };
    } });
    const result = await shell.exec(`sed ${operator} /out`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/moved")), operator === ">>" ? "before\nafter\n" : "after\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "replacement\n");
  });
}

for (const name of ["fd-writer", "wc"]) {
  for (const grouped of [false, true]) {
    test(`redirected ${name} shares direct and admitted stdout, grouped=${grouped}`, async t => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs });
      t.after(() => shell.dispose());
      let admission: CommandContext["admittedHandles"];
      shell.register({ name, async execute(context) {
        await context.stdout.write(new TextEncoder().encode("direct\n"));
        admission = context.admittedHandles;
        assert.ok(admission);
        const lease = await admission.acquire(1, ["write"], context.signal);
        try { await lease.write!(new TextEncoder().encode("lease\n"), context.signal); }
        finally { await lease.close(); }
        return { exitCode: 0 };
      } });
      const command = `${name} > /out`;
      const result = await shell.exec(grouped ? `{ ${command}; }` : command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "direct\nlease\n");
      assert.ok(admission);
      await assert.rejects(admission.acquire(1, ["write"], new AbortController().signal), { code: "EBADF" });
    });
  }
}

test("middleware around a stock command observes the redirected descriptor", async t => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  t.after(() => shell.dispose());
  shell.use(async (context, next) => {
    if (context.command === "wc") {
      await context.stdout.write(new TextEncoder().encode("direct\n"));
      assert.ok(context.admittedHandles);
      const lease = await context.admittedHandles.acquire(1, ["write"], context.signal);
      try { await lease.write!(new TextEncoder().encode("lease\n"), context.signal); }
      finally { await lease.close(); }
    }
    return next();
  });
  const result = await shell.exec("{ wc -c > /out; }", { stdin: "four" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "direct\nlease\n4\n");
});

for (const name of ["fd-writer", "sed"]) {
  for (const operator of [">", ">>"]) {
    test(`redirected ${name} ${operator} retains admitted file identity and retires leases`, async t => {
      const { shell, fs } = setup();
      t.after(() => shell.dispose());
      await fs.writeFile("/out", new TextEncoder().encode("before\n"));
      const original = await fs.stat("/out");
      let retainedStat: (() => Promise<unknown>) | undefined;
      shell.register({ name, async execute(context) {
        assert.ok(context.admittedHandles);
        const first = await context.admittedHandles.acquire(1, ["write", "stat"], context.signal);
        const second = await context.admittedHandles.acquire(1, ["write", "stat"], context.signal);
        retainedStat = () => first.stat!(new AbortController().signal);
        assert.equal(first.identity, second.identity);
        const opened = await first.stat!(context.signal);
        assert.equal(opened.ino, original.ino);
        assert.equal(opened.size, operator === ">>" ? 7 : 0);
        await context.fs.rename("/out", "/moved");
        await context.fs.writeFile("/out", new TextEncoder().encode("replacement\n"));
        await context.stdout.write(new TextEncoder().encode("direct\n"));
        await first.write!(new TextEncoder().encode("lease\n"), context.signal);
        await second.close();
        await first.write!(new TextEncoder().encode("after\n"), context.signal);
        const moved = await first.stat!(context.signal);
        assert.equal(moved.ino, original.ino);
        assert.equal(moved.size, operator === ">>" ? 26 : 19);
        // Keep one lease open: command cleanup must retire it without a caller close.
        return { exitCode: 0 };
      } });
      const result = await shell.exec(`{ ${name} ${operator} /out; }`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/moved")), `${operator === ">>" ? "before\n" : ""}direct\nlease\nafter\n`);
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "replacement\n");
      assert.ok(retainedStat);
      await assert.rejects(retainedStat(), { code: "EBADF" });
    });
  }
}

for (const name of ["fd-writer", "wc"]) for (const registration of ["shell", "registry", "plugin"]) {
  test(`redirected ${name} finalizes a caught file-write failure via ${registration}`, async t => {
    const fs = new MemoryFileSystem({ maxFileBytes: 3 });
    const shell = new Shell({ fs });
    t.after(() => shell.dispose());
    let rejected = false;
    const command = { name, async execute(context: CommandContext) {
      try { await context.stdout.write(new Uint8Array(4)); }
      catch (error) {
        assert.equal((error as { code?: string }).code, "EFBIG");
        rejected = true;
      }
      return { exitCode: 0 };
    } };
    if (registration === "shell") shell.register(command);
    else if (registration === "registry") shell.commands.register(command);
    else shell.use({ name: "registered-output", setup(host) { host.commands.register(command); } });
    const result = await shell.exec(`${name} > /out`);
    assert.equal(rejected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /[Ff]ile too large/u);
    assert.equal((await fs.stat("/out")).size, 0);
  });
}

for (const maxExpansionBytes of [undefined, 4096]) {
  for (const [name, redirect, expected] of [
    ["unquoted here-string", '<<<${arr[*]}', 'a:b:c'],
    ["quoted here-string", '<<<"${arr[*]}"', 'a:b:c'],
    ["expanded here-document", '<<EOF\n${arr[*]}\nEOF', 'a:b:c'],
    ["literal here-document", "<<'EOF'\n${arr[*]}\nEOF", '${arr[*]}'],
  ] as const) {
    test(`temporary IFS outside ${name}, expansion limit=${maxExpansionBytes}`, async t => {
      const { shell } = setup(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } });
      t.after(() => shell.dispose());
      shell.use(standardCommands());
      const result = await shell.exec(`arr=(a b c); IFS=:; IFS= read -r x ${redirect}\nprintf '<%s>' "$x"; printf '|%s' "$IFS"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `<${expected}>|:`);
      assert.equal(result.stderr, "");
    });
  }
}

for (const maxExpansionBytes of [undefined, 4096]) {
  for (const command of ['pass', 'eval "pass"', 'f']) {
    for (const redirect of ['<<<"${arr[*]}"', '<<EOF\n${arr[*]}\nEOF']) {
      test(`temporary assignments outside ${command} ${redirect}, expansion limit=${maxExpansionBytes}`, async t => {
        const { shell } = setup(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } });
        t.after(() => shell.dispose());
        const result = await shell.exec(`arr=(a b c); IFS=:; f(){ pass; }; IFS= ${command} ${redirect}\nsay "$IFS"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, 'a:b:c\n:\n');
        assert.equal(result.stderr, "");
      });
    }
  }
}

for (const [name, source, expected] of [
  ['input path', 'file=outer; say input >outer; file=inner read -r x <"$file"; say "$x:$file"', 'input:outer\n'],
  ['output path', 'file=outer; file=inner say output >"$file"; pass <outer; say "$file"', 'output\nouter\n'],
  ['assignment-only output path', 'file=outer; file=inner >"$file"; say "$file"; [[ -f outer ]]', 'inner\n'],
  ['command substitution receives prefix', 'V=outer; V=child read -r x <<<"$(say "$V")"; say "$x:$V"', 'child:outer\n'],
  ['assignment only', 'V=outer; V=inner <<<"${V:=made}"; say "$V"', 'inner\n'],
  ['builtin receives temporary IFS', 'IFS=:; IFS= read -r x <<<"a:b"; say "$x:$IFS"', 'a:b::\n'],
  ['redirection assignment effect', 'unset V; V=child read -r x <<<"${V:=made}"; say "$x:$V"', 'made:made\n'],
  ['array assignment effect', 'arr=(1); arr=child read -r x <<<"$((arr[1]=2))"; say "$x:${arr[*]}"', '2:1 2\n'],
  ['array binding outside prefix', 'arr=(a b c); IFS=:; arr=child read -r x <<<"${arr[*]}"; say "$x:${arr[*]}"', 'a:b:c:a:b:c\n'],
] as const) {
  test(`redirection assignment boundary: ${name}`, async t => {
    const { shell } = setup({ limits: { maxExpansionBytes: 4096 } });
    t.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

for (const redirect of ['<<<"${arr[*]}"', '<<EOF\n${arr[*]}\nEOF']) {
  test(`redirection retains raw IFS and saved array bytes: ${redirect}`, async t => {
    const { shell } = setup({ limits: { maxExpansionBytes: 4096 } });
    shell.use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`arr=($'\\377' b); IFS=$'\\376'; IFS= arr=child read -r x ${redirect}\nprintf '%s|%s' "$x" "\${arr[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...result.stdoutBytes], [255, 254, 98, 124, 255, 254, 98]);
    assert.equal(result.stderr, "");
  });
}
