import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const attribute of ["i", "u", "l", "n"]) {
  test(`arithmetic with declare -${attribute} applies each mutation once`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const declaration = attribute === "n" ? "target=0; declare -n x=target" : `declare -${attribute} x=0`;
      const result = await shell.exec(`${declaration}; i=0; printf '%s\\n' "$((i++, x += 1))"; y=$((i++, x += 1)); ((i++, x += 1)); printf '%s %s %s\\n' "$i" "$x" "$y"`);
      assert.equal(result.stdout, "1\n3 3 2\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("read and printf output-variable prefixes match Bash 5 behavior", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec('x=initial; x=temp read x <<< from_read; printf "%s\\n" "$x"; REPLY=initial; REPLY=temp read <<< from_read; printf "%s\\n" "$REPLY"; x=temp printf -v x from_printf; printf "%s\\n" "$x"');
    assert.equal(result.stdout, "initial\ninitial\nfrom_printf\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("associative array keys work without global Buffer", async () => {
  const { shell } = setup();
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as unknown as typeof Buffer;
    const result = await shell.exec('declare -A items; items[k]=value; items[é]=unicode; args "${items[k]}" "${items[é]}"');
    assert.equal(result.stdout, '["value","unicode"]');
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.Buffer = saved;
    await shell.dispose();
  }
});

for (const [name, source, expected] of [
  [
    "redirected loop",
    'for i in {1..3}; do echo "hi_$i"; done > /out.txt; printf "%s" "$(</out.txt)"',
    "hi_1\nhi_2\nhi_3"
  ],
  [
    "append loop",
    'echo before > /out.txt; for i in {1..3}; do echo "hi_$i"; done >> /out.txt; printf "%s" "$(</out.txt)"',
    "before\nhi_1\nhi_2\nhi_3"
  ],
  [
    "scalar substitution status",
    'f(){ local x=1; ((0)); }; res=$(f); echo "$? ${PIPESTATUS[0]}"',
    "1 1\n"
  ],
  [
    "local builtin status",
    'f(){ local x=1; ((0)); }; g(){ local y=$(f); echo "$? ${PIPESTATUS[0]}"; }; g',
    "0 0\n"
  ],
  [
    "subshell last argument",
    'f(){ local x=inside_sub; printf "%s\\n" "$x"; }; true keep_me; [[ "$(f)" == inside_sub ]]; echo "last=$_"',
    "last=keep_me\n"
  ],
  [
    "arbitrary substitution status",
    'f(){ local x=1; return 7; }; res=$(f); echo "$? ${PIPESTATUS[0]}"; res=plain; echo "$? ${PIPESTATUS[0]}"',
    "7 7\n0 0\n"
  ],
  [
    "UTF-8 and BOM substitution",
    'f(){ local x=1; printf "%s\\n" "\ufeffé世界"; }; res=$(f); printf "%s" "$res"',
    "\ufeffé世界"
  ],
  [
    "local restoration",
    'x=outer; f(){ local x=inner; printf "%s" "$x"; }; y=$(f); echo "$x $y"',
    "outer inner\n"
  ]
] as const)
  test(name, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

test("pure function substitution decodes UTF-8 without global Buffer", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as unknown as typeof Buffer;
    const result = await shell.exec(
      'f(){ local x=1; printf "%s\\n" "é世界"; }; res=$(f); printf "%s" "$res"'
    );
    assert.equal(result.stdout, "é世界");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.Buffer = saved;
    await shell.dispose();
  }
});
