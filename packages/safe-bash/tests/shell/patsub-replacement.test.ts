import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/index.js";
import { setup } from "./helpers.js";

const replacements = [
  ["[&]", "[a]b[a]", "[&]b[&]"],
  ["$r", "[a]b[a]", "[&]b[&]"],
  ['$(printf "%s" "$r")', "[a]b[a]", "[&]b[&]"],
  ['"[&]"', "[&]b[&]", "[&]b[&]"],
  ["'[&]'", "[&]b[&]", "[&]b[&]"],
  ['"$r"', "[&]b[&]", "[&]b[&]"],
  ['"$(printf "%s" "$r")"', "[&]b[&]", "[&]b[&]"],
  [String.raw`[\&]`, "[&]b[&]", "[&]b[&]"],
  ["$escaped", "&b&", String.raw`\&b\&`],
  ["$slashes", String.raw`\ab\a`, String.raw`\\&b\\&`],
] as const;

for (const mode of ["default", "off", "on"] as const) {
  test(`patsub_replacement ${mode} respects literal, expanded, quoted and escaped replacements`, async t => {
    const { shell } = setup();
    shell.use(standardCommands());
    t.after(() => shell.dispose());
    const setupSource = String.raw`v=aba; r='[&]'; escaped='\&'; slashes='\\&'`;
    const option = mode === "default" ? "" : `shopt -${mode === "on" ? "s" : "u"} patsub_replacement;`;
    for (const [replacement, enabled, disabled] of replacements) {
      const source = `${setupSource}; ${option} printf '%s' "\${v//a/${replacement}}"`;
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, source);
      assert.equal(result.stderr, "", source);
      assert.equal(result.stdout, mode === "off" ? disabled : enabled, source);
    }
  });
}

test("patsub_replacement toggles all substitution operators and array members", async t => {
  const { shell } = setup();
  shell.use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec(String.raw`v=aba; values=(aba aab)
shopt -u patsub_replacement
printf 'off:%s\n' "${'${v/a/[&]}'}" "${'${v//a/[&]}'}" "${'${v/#a/[&]}'}" "${'${v/%a/[&]}'}" "${'${values[@]//a/[&]}'}"
shopt -s patsub_replacement
printf 'on:%s\n' "${'${v/a/[&]}'}" "${'${v//a/[&]}'}" "${'${v/#a/[&]}'}" "${'${v/%a/[&]}'}" "${'${values[@]//a/[&]}'}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "off:[&]ba\noff:[&]b[&]\noff:[&]ba\noff:ab[&]\noff:[&]b[&]\noff:[&][&]b\non:[a]ba\non:[a]b[a]\non:[a]ba\non:ab[a]\non:[a]b[a]\non:[a][a]b\n");
});

test("patsub_replacement persists in snapshots and isolates subshell changes", async t => {
  const { shell } = setup();
  shell.use(standardCommands());
  t.after(() => shell.dispose());
  const initial = await shell.exec("shopt -p patsub_replacement; shopt -u patsub_replacement", { onState() {} });
  assert.equal(initial.exitCode, 0);
  assert.equal(initial.stderr, "");
  assert.equal(initial.stdout, "shopt -s patsub_replacement\n");
  assert.equal(initial.state?.options?.patsub_replacement, false);
  const restored = await shell.exec(String.raw`v=aba
shopt -q patsub_replacement; printf 'off-status:%s\n' "$?"
(shopt -s patsub_replacement; printf 'sub:%s\n' "${'${v//a/[&]}'}")
printf 'cmd:%s\n' "$(shopt -s patsub_replacement; printf '%s' "${'${v//a/[&]}'}")"
printf 'parent:%s\n' "${'${v//a/[&]}'}"
shopt -s patsub_replacement
shopt -q patsub_replacement; printf 'on-status:%s\n' "$?"`, { state: initial.state });
  assert.equal(restored.exitCode, 0);
  assert.equal(restored.stderr, "");
  assert.equal(restored.stdout, "off-status:1\nsub:[a]b[a]\ncmd:[a]b[a]\nparent:[&]b[&]\non-status:0\n");
});

test("virtual bash accepts patsub_replacement startup options", async t => {
  const { shell } = setup();
  shell.use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec(String.raw`bash +O patsub_replacement -c 'v=aba; printf "%s\n" "${'${v//a/[&]}'}"'
bash -O patsub_replacement -c 'v=aba; printf "%s\n" "${'${v//a/[&]}'}"'`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "[&]b[&]\n[a]b[a]\n");
});

test("patsub_replacement remains effective in repeated loop expansions", async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec('v=aba; for mode in -u -s -u; do shopt "$mode" patsub_replacement; for i in 1 2 3; do say "${v//a/[&]}"; done; done');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "[&]b[&]\n".repeat(3) + "[a]b[a]\n".repeat(3) + "[&]b[&]\n".repeat(3));
});

test("extensions cannot shadow patsub_replacement", async t => {
  const { shell } = setup({ extensions: [{ name: "duplicate-option", create: () => ({
    builtins: [],
    shoptOptions: [{ name: "patsub_replacement", enabled: false }],
  }) }] });
  t.after(() => shell.dispose());
  await assert.rejects(shell.exec(":"), /Invalid or duplicate extension shopt option/);
});
