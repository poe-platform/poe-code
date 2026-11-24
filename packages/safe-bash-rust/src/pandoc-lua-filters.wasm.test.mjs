import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname} from "node:path";
import test from "node:test";
import {createRustWasmBash} from "./index.js";
import lua from "../../safe-bash-command-pandoc/dist/fengari.generated.js";

const cases = JSON.parse(readFileSync(new URL("../tests/fixtures/pandoc-lua-filters.json", import.meta.url), "utf8"));
for (const fixture of cases) {
  test(`Pandoc Lua filters match JavaScript: ${fixture.id}`, async () => {
    const path = fixture.path ?? "/upper.lua", cwd = fixture.cwd ?? "/";
    const bash = await createRustWasmBash({forceNative: true, cwd});
    const fs = bash.fs;
    try {
      await fs.mkdir(dirname(path), {recursive: true});
      await fs.mkdir(cwd, {recursive: true});
      await fs.writeFile("/a.md", new TextEncoder().encode("a"));
      await fs.writeFile(path, typeof fixture.script === "string" ? new TextEncoder().encode(fixture.script) : Uint8Array.from(fixture.script));
      await fs.writeFile("/saved", new TextEncoder().encode("KEEP"));
      const control = await bash.exec("pandoc -f markdown -t plain /a.md");
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(control.stdout, "a\n");
      for (const output of ["", "-o /saved"]) {
        const flags = fixture.flags.map(flag => `'${flag.replaceAll("'", "'\\''")}'`).join(" ");
        const result = await bash.exec(`pandoc -f markdown -t plain /a.md ${output} ${flags}`);
        assert.equal(result.exitCode, fixture.status, result.stderr);
        assert.equal(result.stdout, fixture.status === 0 && output === "" ? (fixture.stdout ?? "A\n") : "");
        assert.equal(result.stderr, fixture.stderr ?? "");
        assert.deepEqual(await fs.readFile("/saved"), new TextEncoder().encode(fixture.status === 0 && output !== "" ? (fixture.stdout ?? "A\n") : "KEEP"));
        if (Object.hasOwn(fixture, "dumpResult")) {
          const hex = output === "" ? result.stdout : new TextDecoder().decode(await fs.readFile("/saved"));
          const bytes = Uint8Array.from(Buffer.from(hex.trim(), "hex"));
          const state = lua.lauxlib.luaL_newstate();
          try {
            lua.lauxlib.luaL_requiref(state, new TextEncoder().encode("_G"), lua.lualib.luaopen_base, true);
            lua.lua.lua_pop(state, 1);
            assert.equal(lua.lauxlib.luaL_loadbuffer(state, bytes, bytes.length, new TextEncoder().encode("dump")), lua.lua.LUA_OK);
            lua.lua.lua_pushinteger(state, 7);
            lua.lua.lua_pushinteger(state, 9);
            assert.equal(lua.lua.lua_pcall(state, 2, 1, 0), lua.lua.LUA_OK);
            const value = lua.lua.lua_isnil(state, -1) ? null : lua.lua.lua_isnumber(state, -1) ? lua.lua.lua_tonumber(state, -1) : new TextDecoder().decode(lua.lua.lua_tolstring(state, -1));
            assert.equal(value, fixture.dumpResult);
          } finally { lua.lua.lua_close(state); }
        }
      }
    } finally { await bash.dispose(); }
  });
}

test("Pandoc invalid Lua document bytes match JavaScript output errors", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    await bash.fs.writeFile("/a.md", "a");
    for (const source of [
      "function Str(el) return pandoc.Str(string.char(255)) end",
      "function Meta(m) m[string.char(255)]=pandoc.MetaString('value'); return m end",
    ]) {
      await bash.fs.writeFile("/filter.lua", source);
      for (const [output, exitCode, stderr] of [
        ["", 4, "E_AST: Invalid UTF-8 Lua string\n"],
        ["-o -", 4, "E_AST: Invalid UTF-8 Lua string\n"],
        ["-o /saved", 9, "E_IO: Capability failed\n"],
      ]) {
        await bash.fs.writeFile("/saved", "KEEP");
        const result = await bash.exec(`pandoc -f markdown -t plain /a.md -L /filter.lua ${output}`);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stderr, stderr);
        assert.equal(result.stdout, "");
        assert.deepEqual(await bash.fs.readFile("/saved"), new TextEncoder().encode("KEEP"));
      }
    }
  } finally { await bash.dispose(); }
});

test("Pandoc Lua metadata and binary writers use the filtered document", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    await bash.fs.writeFile("/a.json", JSON.stringify({
      "pandoc-api-version": [1, 23, 1, 2],
      meta: {title: {t: "MetaString", c: "Before"}},
      blocks: [{t: "Para", c: [{t: "Str", c: "hello"}]}],
    }));
    await bash.fs.writeFile("/filter.lua", "function Meta(m) assert(m.title == 'Before'); m.title = 'After'; m.empty = pandoc.MetaMap({}); return m end function Str(el) return pandoc.Str(el.text:upper()) end");
    const metadata = await bash.exec("pandoc /a.json -t json -L /filter.lua");
    assert.equal(metadata.exitCode, 0, metadata.stderr);
    assert.deepEqual(JSON.parse(metadata.stdout).meta, {
      title: {t: "MetaString", c: "After"}, empty: {t: "MetaMap", c: {}},
    });
    for (const format of ["plain", "html", "markdown", "docx", "pdf"]) {
      const result = await bash.exec(`pandoc /a.json -t ${format} -M title=Before -L /filter.lua -o /result.${format}`);
      assert.equal(result.exitCode, 0, `${format}: ${result.stderr}`);
      if (format === "docx" || format === "pdf") {
        const text = await bash.exec(format === "pdf" ? "pdftotext /result.pdf -" : "pandoc /result.docx -t plain");
        assert.equal(text.exitCode, 0, text.stderr);
        assert.match(text.stdout, /HELLO/);
        if (format === "pdf") {
          const info = await bash.exec("pdfinfo /result.pdf");
          assert.equal(info.exitCode, 0, info.stderr);
          assert.match(info.stdout, /Title:\s+After/);
        }
      } else {
        assert.match(new TextDecoder().decode(await bash.fs.readFile(`/result.${format}`)), /HELLO/);
      }
    }
  } finally { await bash.dispose(); }
});
