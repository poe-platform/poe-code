import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { setup } from "./helpers.js";
import { getCommandArguments } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { mapfileExtension } from "../../src/shell/extensions/mapfile/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const extension of [false, true]) {
  for (const command of ["mapfile", "readarray"]) {
    for (const [origin, next, callbacks, errors] of [
      [3, 4, [["3", "ONE"], ["4", "TWO"]], 0],
      [2147483647, 2147483648, [["2147483647", "ONE"]], 1],
      [2147483648, 2147483649, [], 2],
      [3294967296, 3294967297, [["-999999999", "TWO"]], 1],
      [3294967297, 3294967298, [["-999999999", "ONE"], ["-999999998", "TWO"]], 0],
      [4294967294, 4294967295, [["-2", "ONE"], ["-1", "TWO"]], 0],
      [4294967295, 0, [["-1", "ONE"], ["0", "TWO"]], 0],
    ] as const) test(`${command} renders signed callback indexes: origin=${origin}, extension=${extension}`, async () => {
      const { shell, fs } = setup({ extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])] });
      try {
        await fs.writeFile("/records", new TextEncoder().encode("ONE\nTWO\nTHREE\n"));
        const result = await shell.exec(`cb() { args "$1" "$2"; }; ${command} -O${origin} -n2 -tc1 -C cb A </records; code=$?; args "$code" "\${A[${origin}]}" "\${A[${next}]}" "\${!A[@]}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, callbacks.map(args => JSON.stringify(args)).join("") + JSON.stringify(["0", "ONE", "TWO", ...(next === 0 ? ["0", String(origin)] : [String(origin), String(next)])]));
        assert.equal(result.stderr.split("unexpected EOF while looking for matching `''").length - 1, errors, result.stderr);
        if (!errors) assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
    for (const flags of ["-u9 -u0", "-u 9 -u 0", "-u0 -u9 -u0", "-u9 -x", "-u 9 -x"]) {
      test(`${command} validates each descriptor before later options: ${flags}, extension=${extension}`, async () => {
        const { shell, fs } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          await fs.writeFile("/data", new TextEncoder().encode("one\ntwo\nthree\n"));
          const result = await shell.exec(`A=(old); { ${command} -t ${flags} A; code=$?; read rest; args "$code" "\${A[@]}" "$rest"; } </data`);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stdout, '["1","old","one"]');
          assert.equal(result.stderr, `shell: line 1: ${command}: 9: invalid file descriptor: Bad file descriptor\n`);
        } finally { await shell.dispose(); }
      });
    }
    test(`${command} uses the last valid descriptor, extension=${extension}`, async () => {
      const { shell, fs } = setup({ extensions: extension ? [mapfileExtension()] : [] });
      try {
        await fs.writeFile("/data", new TextEncoder().encode("other\n"));
        const result = await shell.exec(`exec 3</data; ${command} -t -u3 -u0 A; read -u3 rest; args "\${A[@]}" "$rest"`, { stdin: "one\ntwo\n" });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, '["one","two","other"]');
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
    for (const options of ["--help", "-t --help", "-d : --help", "--help -Q"]) {
      test(`${command} prints help without reading or clearing arrays: ${options}, extension=${extension}`, async () => {
        const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", `${command} ${options}`], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" } });
        assert.equal(expected.status, 2);
        assert.equal(expected.stderr, "");
        assert.ok(expected.stdout.startsWith(`${command}: ${command} `));
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        let pulls = 0;
        try {
          const result = await shell.exec(`MAPFILE=(old); ${command} ${options}; code=$?; args "\${MAPFILE[@]}"; exit "$code"`, {
            stdin: { async *[Symbol.asyncIterator]() { pulls++; yield new TextEncoder().encode("one\ntwo\n"); } },
          });
          assert.equal(result.exitCode, 2);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, expected.stdout + '["old"]');
          assert.equal(pulls, 0);
        } finally { await shell.dispose(); }
      });
    }
    for (const options of ["-Q --help", "-- --help"]) {
      test(`${command} does not treat ${options} as help, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`${command} ${options}`);
          assert.notEqual(result.exitCode, 0);
          assert.equal(result.stdout, "");
          assert.notEqual(result.stderr, "");
        } finally { await shell.dispose(); }
      });
    }
    for (const options of ["-d --help -t A", "-t A --help", "-t -- A --help"]) {
      test(`${command} preserves operand parsing for ${options}, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`${command} ${options}; code=$?; args "\${A[@]}"; exit "$code"`, { stdin: options.startsWith("-d") ? "one-two-" : "one\ntwo\n" });
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, '["one","two"]');
        } finally { await shell.dispose(); }
      });
    }
    for (const declaration of ["export A=old", "declare -ax A=(old tail stale)"]) {
      for (const preserve of [false, true]) test(`${command} populates ${declaration}, preserve=${preserve}, extension=${extension}`, async () => {
        const { shell, fs } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          await fs.writeFile("/records", new TextEncoder().encode("ONE\nTWO\n"));
          const result = await shell.exec(`${declaration}; ${command} -t ${preserve ? "-O 1" : ""} A < /records; code=$?; args "$code" "\${A@a}" "\${A[@]}"; envget A; exit "$code"`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, JSON.stringify(["0", "ax", ...(preserve ? ["old"] : []), "ONE", "TWO"]) + "<unset>");
        } finally { await shell.dispose(); }
      });
    }
    for (const flag of ["n", "s", "c"]) {
      test(`${command} rejects overflowing -${flag} before array or input changes, extension=${extension}`, async () => {
        const { shell, fs } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          await fs.writeFile("/data", new TextEncoder().encode("ONE\nTWO\n"));
          const result = await shell.exec(`A=(old); exec 3</data; ${command} -u3 -t -${flag} 4294967296 A; code=$?; IFS= read -ru3 next; args "$code" "\${A[@]}" "$next"`);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stdout, '["1","old","ONE"]');
          assert.notEqual(result.stderr, "");
        } finally { await shell.dispose(); }
      });

      test(`${command} accepts maximum -${flag} count, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`A=(old); ${command} -t -${flag} 4294967295 A; code=$?; args "$code" "\${A[@]}"`, { stdin: "ONE\nTWO\n" });
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, flag === "s" ? '["0"]' : '["0","ONE","TWO"]');
        } finally { await shell.dispose(); }
      });
    }
    for (const alias of [false, true]) {
      for (const redirect of ["exec 3</other", "exec 3<&5", "exec 3<&-"]) {
        for (const count of [1, 2]) test(`${command} callback redirects input: extension=${extension}, alias=${alias}, ${redirect}, count=${count}`, async () => {
          const { shell, fs } = setup({ extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])] });
          try {
            await fs.writeFile("/record", new TextEncoder().encode("one\ntwo\nthree\n"));
            await fs.writeFile("/other", new TextEncoder().encode("alpha\nbeta\n"));
            const closed = redirect === "exec 3<&-";
            const result = await shell.exec(`exec 3</record; exec 5</other; ${alias ? "exec 4<&3;" : ""}
              cb() { if [[ $1 == 0 ]]; then ${redirect}; fi; }
              ${command} -t -u 3 -C cb -c 1 -n ${count} A; code=$?; args "\${A[@]}"; say "rc=$code";
              ${closed ? "" : 'IFS= read -r -u 3 tail; say "tail=<$tail>:$?";'}
              ${alias ? 'IFS= read -r -u 4 old; say "old=<$old>:$?";' : ""}`);
            assert.equal(result.exitCode, 0);
            assert.equal(result.stderr, "");
            assert.equal(result.stdout, `${JSON.stringify(count === 1 || closed ? ["one"] : ["one", "alpha"])}rc=0\n${closed ? "" : `tail=<${count === 1 ? "alpha" : "beta"}>:0\n`}${alias ? "old=<two>:0\n" : ""}`);
          } finally { await shell.dispose(); }
        });
      }
    }
    for (const [attribute, input, expected] of [
      ["i", "2+3\nA[1]+2", ["5", "7"]],
      ["u", "MiXeD\nCaSe", ["MIXED", "CASE"]],
      ["l", "MiXeD\nCaSe", ["mixed", "case"]],
      ["", "2+3\nMiXeD", ["2+3", "MiXeD"]],
    ] as const) {
      for (const callback of [false, true]) test(`${command} stores ${attribute || "plain"} array values with origin and callback=${callback}, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`declare -a${attribute} A=(11); cb() { args "$1" "$2" "\${A[@]}"; }; ${command} -t -O 1 ${callback ? "-C cb -c 1" : ""} A; args "\${A[@]}"`, { stdin: input });
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          const lines = input.split("\n");
          const callbacks = callback ? JSON.stringify(["1", lines[0], "11"]) + JSON.stringify(["2", lines[1], "11", expected[0]]) : "";
          assert.equal(result.stdout, callbacks + JSON.stringify(["11", ...expected]));
        } finally { await shell.dispose(); }
      });
      test(`${command} clears and transforms ${attribute || "plain"} array values in a loop, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`declare -a${attribute} A=(99 88 77); for round in 1 2; do ${command} -t A <<< "$input"; args "\${A[@]}"; done`, { env: { input: attribute === "i" ? "2+3\nA[0]+2" : input } });
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, JSON.stringify(expected).repeat(2));
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const command of ["mapfile", "readarray"]) {
  for (const [callback, expected] of [
    ["A=(changed); local A=temp", ["changed", "two", "three"]],
    ["local A=temp; A=(hidden)", ["one", "two", "three"]],
  ] as const) {
    test(`${command} preserves callback mutations across shadowing: ${callback}`, async () => {
      const { shell } = setup({ extensions: [arraysExtension()] });
      try {
        const result = await shell.exec(`cb() { if [[ $1 == 1 ]]; then ${callback}; fi; }; ${command} -tc1 -C cb A; args "$?" "\${A[@]}"`, { stdin: "one\ntwo\nthree\n" });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, JSON.stringify(["0", ...expected]));
      } finally { await shell.dispose(); }
    });
  }

  for (const seed of ["", "A=(seed);"]) {
    for (const local of ["local A", "local A=temp", "local other"]) {
      test(`${command} retains records across ${local}, seed=${seed}`, async () => {
        const { shell } = setup({ extensions: [arraysExtension()] });
        try {
          const result = await shell.exec(`${seed} cb() { ${local}; }; ${command} -tc1 -C cb A; args "$?" "\${A[@]}"`, { stdin: "one\ntwo\nthree\n" });
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, '["0","one","two","three"]');
        } finally { await shell.dispose(); }
      });
    }
  }

  for (const [flag, diagnostic] of [
    ["n", "invalid line count"],
    ["s", "invalid line count"],
    ["O", "invalid array origin"],
    ["c", "invalid callback quantum"],
    ["u", "invalid file descriptor specification"],
  ]) {
    const operands = ["-1", "nope", "", "2x", "9007199254740992", ...(flag === "c" ? ["000", "+0", "-0", " 000 "] : [])];
    for (const operand of operands) {
      for (const attached of operand === "" ? [false] : [false, true]) test(`${command} numeric diagnostic: -${flag}, ${JSON.stringify(operand)}, attached=${attached}`, async () => {
        const { shell, fs } = setup();
        try {
          await fs.writeFile("/data", new TextEncoder().encode("ONE\nTWO\n"));
          const option = attached ? `'-${flag}${operand}'` : `-${flag} '${operand}'`;
          const result = await shell.exec(`A=(old); exec 3</data; ${command} -u3 ${option} A; code=$?; IFS= read -ru3 next; args "\${A[@]}" "$next"; exit "$code"`);
          assert.equal(result.exitCode, 1);
          assert.equal(result.stdout, '["old","ONE"]');
          assert.equal(result.stderr, `shell: line 1: ${command}: ${operand}: ${diagnostic}\n`);
        } finally { await shell.dispose(); }
      });
    }
  }

  for (const [declaration, name, diagnostic] of [
    ["export A=old; readonly A", "A", "readonly variable"],
    ["declare -arx A=(old)", "A", "readonly variable"],
    ["export IFS=old", "IFS", "control"],
  ] as const) test(`${command} refuses ${declaration} before reading or changing the destination`, async () => {
    const { shell } = setup();
    let pulls = 0;
    const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97, 10); } };
    try {
      const result = await shell.exec(`${declaration}; ${command} -t ${name}; code=$?; args "\${${name}}"; exit "$code"`, { stdin });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '["old"]');
      assert.ok(result.stderr.includes(diagnostic));
      assert.equal(pulls, 0);
    } finally { await shell.dispose(); }
  });
  for (const origin of [3, 2147483647, 4294967295]) {
    for (const callback of [false, true]) test(`${command} uses unsigned origins and wraps indexes: origin=${origin}, callback=${callback}`, async () => {
      const { shell } = setup();
      const next = origin === 4294967295 ? 0 : origin + 1;
      try {
        const result = await shell.exec(`A=([0]=old [9]=keep); cb() { :; }; ${command} -t -O ${origin} ${callback ? "-C cb -c 1" : ""} A; code=$?; args "\${!A[@]}"; args "\${A[${origin}]}" "\${A[${next}]}" "\${A[9]}" "\${A[0]}"; exit "$code"`, { stdin: "ONE\nTWO\n" });
        assert.equal(result.exitCode, 0, result.stderr);
        if (callback && origin === 2147483647) assert.ok(result.stderr.includes("unexpected EOF while looking for matching `''"), result.stderr);
        else assert.equal(result.stderr, "");
        const keys = origin === 3 ? ["0", "3", "4", "9"] : origin === 2147483647 ? ["0", "9", "2147483647", "2147483648"] : ["0", "9", "4294967295"];
        assert.equal(result.stdout, JSON.stringify(keys) + JSON.stringify(["ONE", "TWO", "keep", next === 0 ? "TWO" : "old"]));
      } finally { await shell.dispose(); }
    });
  }

  test(`${command} succeeds when its callback closes the input descriptor`, async () => {
    const { shell, fs } = setup();
    try {
      await fs.writeFile("/data", new TextEncoder().encode("one\ntwo\n"));
      const result = await shell.exec(`exec 3</data; stop() { exec 3<&-; }; ${command} -t -u 3 -C stop -c 1 A; code=$?; args "\${A[@]}"; exit "$code"`);
      assert.equal(result.stdout, '["one"]');
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });

  for (const flags of ["-u 0 -t", "-u0 -t", "-tu0"]) {
    for (const redirected of [false, true]) test(`${command} explicit stdin: ${flags}, redirected=${redirected}`, async () => {
      const { shell, fs } = setup();
      try {
        if (redirected) await fs.writeFile("/data", new TextEncoder().encode("one\ntwo\n"));
        const result = await shell.exec(`${command} ${flags} values${redirected ? " < /data" : ""}; code=$?; args "\${values[@]}"; exit "$code"`, { stdin: redirected ? "wrong\n" : "one\ntwo\n" });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, '["one","two"]');
      } finally { await shell.dispose(); }
    });
  }

  for (const operand of ["9", "-1", "nope"]) test(`${command} refuses unavailable or invalid descriptor ${operand} before input or array mutation`, async () => {
    const { shell } = setup();
    let pulls = 0;
    const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97, 10); } };
    try {
      const result = await shell.exec(`values=(old); ${command} -u '${operand}' values; code=$?; args "\${values[@]}"; exit "$code"`, { stdin });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '["old"]');
      assert.notEqual(result.stderr, "");
      assert.equal(pulls, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [label, source, stdin, expected] of [
  ["default destination", 'mapfile; args "${MAPFILE[@]}"', "a\nb\n", '["a\\n","b\\n"]'],
  ["strip delimiter", 'mapfile -t A; args "${A[@]}"', "a\nb", '["a","b"]'],
  ["alias", 'readarray -t A; args "${A[@]}"', "a\n", '["a"]'],
  ["count", 'mapfile -t -n 1 A; args "${A[@]}"; pass', "a\nb\n", '["a"]b\n'],
  ["skip", 'mapfile -t -s 1 -n 1 A; args "${A[@]}"; pass', "a\nb\nc\n", '["b"]c\n'],
  ["origin", 'A=(old keep tail); mapfile -t -O 1 A; args "${A[@]}"', "new\n", '["old","new","tail"]'],
  ["empty clears", 'A=(old); mapfile A; args "${A[@]}"', "", '[]'],
  ["custom delimiter", 'mapfile -t -d : A; args "${A[@]}"', "a:b:", '["a","b"]'],
  ["NUL truncates record", 'mapfile A; args "${A[@]}"', "a\0b\nc\n", '["a","c\\n"]'],
  ["NUL delimiter", 'mapfile -d "" A; args "${A[@]}"', "a\0b\0c", '["a","b","c"]'],
  ["callbacks", 'cb() { say "$1:$2:${#A[@]}"; return 7; }; mapfile -t -C cb -c 2 A; args "${A[@]}"', "a\nb\nc\nd\n", '1:b:1\n3:d:3\n["a","b","c","d"]'],
  ["callback consumes input", 'cb() { read skipped; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\nc\nd\n", '["a","c"]'],
  ["callback replaces contents", 'cb() { A=(changed); }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["changed","b"]'],
  ["callback unsets target", 'cb() { unset A; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '[]'],
  ["callback recreates target", 'cb() { unset A; A=(new); }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["new"]'],
  ["callback freezes admitted target", 'cb() { readonly A; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["a","b"]'],
  ["callback script prefix", 'cb() { say "$1:$2"; }; mapfile -t -C "say prefix; cb" -c 1 A', "a\n", 'prefix\n0:a\n'],
  ["callback prefix comment", 'mapfile -t -C "say prefix # comment" -c 1 A; args "${A[@]}"', "a\n", 'prefix\n["a"]'],
  ["callback origin and skip", 'cb() { say "$1:$2"; }; mapfile -t -O 5 -s 1 -C cb -c 2 A; args "${A[5]}" "${A[6]}"', "skip\na\nb\n", '6:b\n["a","b"]'],
] as const) test(`mapfile: ${label}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source, { stdin });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const callback of ["return 7", "exit 7"]) test(`mapfile callback control retains errexit: ${callback}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`set -e; cb() { ${callback}; }; mapfile -t -C cb -c 1 A; say WRONG`, { stdin: "a\n" });
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("mapfile readonly and invalid options refuse before pulling input", async () => {
  for (const source of ['A=(old); readonly A; mapfile A', 'mapfile -c 0 A', 'mapfile -n -1 A', 'mapfile -O nope A']) {
    const { shell } = setup();
    let pulls = 0;
    const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97, 10); } };
    try {
      assert.equal((await shell.exec(source, { stdin })).exitCode, 1);
      assert.equal(pulls, 0);
    } finally { await shell.dispose(); }
  }
});

test("mapfile default callback quantum is 5000", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { say "$1:${#A[@]}"; }; mapfile -t -C cb A; say "${#A[@]}"', { stdin: "x\n".repeat(5001) });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "4999:4999\n5001\n");
  } finally { await shell.dispose(); }
});

test("mapfile input records cannot execute callback-source syntax", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { args "$2"; }; mapfile -t -C cb -c 1 A', { stdin: "$(say WRONG); 'quoted'\n" });
    assert.equal(result.stdout, JSON.stringify(["$(say WRONG); 'quoted'"]));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [limits, limit] of [
  [{ maxLoopIterations: 1 }, "maxLoopIterations"],
  [{ maxOutputBytes: 1 }, "maxOutputBytes"],
] as const) test(`mapfile preserves ${limit}`, async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('mapfile -t A', { stdin: "a\nb\n", limits }), error => error instanceof ShellLimitError && error.limit === limit);
  } finally { await shell.dispose(); }
});

for (const source of [
  'mapfile -t A; raw "${A[@]}" "${A[0]}" "$A"',
  'mapfile -t A; B=("${A[@]}"); raw "${B[@]}" "${A[0]}" "$A"',
  'mapfile -t A; (A[0]=changed); raw "${A[@]}" "${A[0]}" "$A"',
]) test(`mapfile raw values survive expansion and copying: ${source}`, async () => {
  const { shell } = setup();
  shell.register({ name: "raw", async execute(context) {
    const args = getCommandArguments(context);
    for (let index = 0; index < args.values.length; index++) await context.stdout.write(args.bytes(index)!);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(source, { stdin: Uint8Array.of(255, 10) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 255, 255));
  } finally { await shell.dispose(); }
});

for (const [name, payload] of [
  ["raw byte", Uint8Array.of(255)],
  ["UTF8", new TextEncoder().encode("café")],
  ["short ASCII", new TextEncoder().encode("record")],
  ["ASCII fast boundary", new TextEncoder().encode("a".repeat(512))],
  ["ASCII fallback", new TextEncoder().encode("a".repeat(513))],
] as const) for (const maxExpansionBytes of [undefined, 32768]) {
  test(`mapfile fallback preserves ordered records: ${name}, budget=${maxExpansionBytes ?? "default"}`, async () => {
    const { shell } = setup();
    shell.register({ name: "raw", async execute(context) {
      const args = getCommandArguments(context);
      for (let index = 0; index < args.values.length; index++) {
        await context.stdout.write(args.bytes(index)!);
        await context.stdout.write(Uint8Array.of(0));
      }
      return { exitCode: 0 };
    } });
    try {
      const stdin = Uint8Array.from([...new TextEncoder().encode("before\n"), ...payload, 10, ...new TextEncoder().encode("after\n")]);
      const result = await shell.exec('mapfile -t A; raw "${A[@]}"', { stdin, ...(maxExpansionBytes === undefined ? {} : { limits: { maxExpansionBytes } }) });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.from([...new TextEncoder().encode("before\0"), ...payload, 0, ...new TextEncoder().encode("after\0")]));
    } finally { await shell.dispose(); }
  });
}

test("mapfile raw element zero survives scalar-style append", async () => {
  const { shell } = setup();
  shell.register({ name: "raw", async execute(context) { await context.stdout.write(getCommandArguments(context).bytes(0)!); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('mapfile -t A; A+=z; raw "$A"', { stdin: Uint8Array.of(255, 10) });
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 122));
  } finally { await shell.dispose(); }
});

for (const length of [3, 512, 513]) {
  for (const finiteBudget of [false, true]) test(`mapfile retains ${length}-byte records with finite expansion budget=${finiteBudget}`, async () => {
    const { shell } = setup();
    const record = "x".repeat(length);
    try {
      const result = await shell.exec('mapfile -t -n 1 A; args "${A[@]}"; pass', {
        stdin: `${record}\nnext\n`,
        limits: finiteBudget ? { maxExpansionBytes: 65536 } : {},
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${JSON.stringify([record])}next\n`);
    } finally { await shell.dispose(); }
  });
}

test("mapfile callback source inherits caller loop flow", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('for x in 1 2; do mapfile -t -C "break; :" -c1 A; say WRONG; done; say end', { stdin: "a\nb\n" });
    assert.equal(result.stdout, "end\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const count of ['-0', ' +2 ', '2 ', ' 2']) test(`mapfile accepts decimal count ${JSON.stringify(count)}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`mapfile -t -n '${count}' A; args "${'${A[@]}'}"`, { stdin: 'a\nb\n' });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '["a","b"]');
  } finally { await shell.dispose(); }
});

test('mapfile defers direct callback flow while retaining every record', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('for x in 1 2; do mapfile -t -C "say callback; break; :" -c 1 A; say WRONG; done; args "${A[@]}"; pass', { stdin: 'a\nb\n' });
    assert.equal(result.stdout, 'callback\n["a","b"]');
    assert.equal(result.stderr, '');
  } finally { await shell.dispose(); }
});

test('mapfile function callback retains its own loop scope', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { say callback; break; }; for x in 1 2; do mapfile -t -C cb -c 1 A; say after; done', { stdin: 'a\nb\n' });
    assert.equal(result.stdout, 'callback\ncallback\nafter\nafter\n');
    assert.equal(result.stderr, "shell: line 1: break: only meaningful in a `for', `while', or `until' loop\n".repeat(2));
  } finally { await shell.dispose(); }
});

test('mapfile admits cumulative input before retaining records or running later effects', async () => {
  for (const streaming of [false, true]) {
    const { shell } = setup();
    let effects = 0;
    shell.register({ name: 'effect', execute() { effects++; return { exitCode: 0 }; } });
    const stdin = streaming ? { async *[Symbol.asyncIterator]() { yield Uint8Array.of(97, 10); yield Uint8Array.of(98, 10); } } : 'abc\n';
    try {
      await assert.rejects(shell.exec('mapfile -t A; effect', { stdin, limits: { maxInputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === 'maxInputBytes');
      assert.equal(effects, 0);
      assert.equal((await shell.exec('effect')).exitCode, 0);
      assert.equal(effects, 1);
    } finally { await shell.dispose(); }
  }
});
