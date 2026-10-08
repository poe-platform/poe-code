import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure yq deep parity matrix (20 complex cases)", () => {
  it("1. yq --version, -V, --help, -h, eval --help, and eval-all --help CLI flags", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
yq --version
yq -V
yq --help | head -n 1
yq -h | head -n 1
yq eval --help | head -n 1
yq eval-all --help | head -n 1
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "yq (safe-bash; bounded Mike Farah v4.53.3 profile)",
        "yq (safe-bash; bounded Mike Farah v4.53.3 profile)",
        "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) ",
        "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) ",
        "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) ",
        "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) ",
        "",
      ].join("\n")
    );
  });

  it("2. yq eval-all (ea) multi-document aggregation and document-index filtering", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a: 1\n---\na: 2\n---\na: 3\n" | yq eval-all -o=json -I=0 '[.a]'
printf "x: 1\n---\ny: 2\n" | yq ea -o=json -I=0 'select(di == 1)'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[1,2,3]\n{\"y\":2}\n");
  });

  it("3. document and file metadata builtins: documentIndex, di, document_index, fileIndex, fi, file_index, filename", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f1.yaml": "name: alpha\n---\nname: beta\n",
        "/workspace/f2.yaml": "name: gamma\n",
        "/workspace/filter.yq": "[.name, fileIndex, fi, file_index, documentIndex, di, document_index, filename]",
      },
    });
    const r = await h.exec(String.raw`
yq --from-file /workspace/filter.yq -o=json -I=0 /workspace/f1.yaml /workspace/f2.yaml
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '["alpha",0,0,0,0,0,0,"/workspace/f1.yaml"]',
        '["beta",0,0,0,1,1,1,"/workspace/f1.yaml"]',
        '["gamma",1,1,1,0,0,0,"/workspace/f2.yaml"]',
        "",
      ].join("\n")
    );
  });

  it("4. yq node introspection builtins: kind, tag, and type across scalar, seq, and map nodes", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "s: hi\ni: 42\nf: 3.5\nb: true\nn: null\narr: [1, 2]\nmap: {k: v}\n" | yq -o=json -I=0 '[(.s | kind), (.arr | kind), (.map | kind), (.s | tag), (.i | tag), (.f | tag), (.b | tag), (.n | tag), (.arr | tag), (.map | tag), (.s | type)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '["scalar","seq","map","!!str","!!int","!!float","!!bool","!!null","!!seq","!!map","!!str"]\n'
    );
  });

  it("5. yq string case builtins: upcase and downcase", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a: Hello World\n" | yq -o=json -I=0 '[(.a | upcase), (.a | downcase)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '["HELLO WORLD","hello world"]\n');
  });

  it("6. yq pick builtin on maps and arrays preserving requested key/index order and omitting missing entries", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a: 1\nb: 2\nc: 3\n" | yq -o=json -I=0 'pick(["c", "a", "missing"])'
printf "[10, 20, 30]\n" | yq -o=json -I=0 'pick([2, 0, 99])'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, '{"c":3,"a":1}\n[30,10]\n');
  });

  it("7. yq glob matching in == and != with * and ? wildcards", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "name: foobar\n" | yq -o=json -I=0 '[(.name == "foo*"), (.name == "f?obar"), (.name == "*bar"), (.name == "baz*"), (.name != "baz*")]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[true,true,true,false,true]\n");
  });

  it("8. yq recursive descent .. (values only) vs ... (values and map keys)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a:\n  b: 1\n" | yq -o=json -I=0 '[..]'
printf "a:\n  b: 1\n" | yq -o=json -I=0 '[...]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '[{"a":{"b":1}},{"b":1},1]\n[{"a":{"b":1}},"a",{"b":1},"b",1]\n'
    );
  });

  it("9. yq INI format decoding (-p=ini) and encoding (-o=ini) with sections and comments", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "# header\n[db]\nhost = localhost\nport: 5432\n; comment\n" | yq -p=ini -o=json -I=0 '.'
printf '{"db":{"host":"localhost","port":5432}}' | yq -p=json -o=ini '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '{"db":{"host":"localhost","port":"5432"}}\n\n[db]\nhost = localhost\nport = 5432\n'
    );
  });

  it("10. yq Lua table encoding (-o=lua) with nested maps, booleans, numbers, strings, and nil", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a: 1\nb: true\nc: null\nd:\n  e: hi\n" | yq -o=lua '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'return {\n\t["a"] = 1;\n\t["b"] = true;\n\t["c"] = nil;\n\t["d"] = {\n\t\t["e"] = "hi";\n\t};\n};\n'
    );
  });

  it("11. yq Base64 format decoding (-p=base64) and encoding (-o=base64) with UTF-8 strings", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"héllo😀"' | yq -o=base64 '.'
printf "\n"
printf 'aMOpbGxv8J+YgA==' | yq -p=base64 -o=json -I=0 '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'aMOpbGxv8J+YgA==\n"héllo😀"\n');
  });

  it("12. yq URI format decoding (-p=uri) and encoding (-o=uri) with + space and RFC3986 escaping", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"hello world!()*"' | yq -o=uri '.'
printf "\n"
printf 'hello+world%%21%%28%%29%%2A' | yq -p=uri -o=json -I=0 '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'hello+world%21%28%29%2A\n"hello world!()*"\n');
  });

  it("13. yq XML format decoding (-p=xml) and encoding (-o=xml) with +@ attributes and +content text", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '<root id="1"><item code="a">alpha</item><item code="b">beta</item></root>' | yq -p=xml -o=json -I=0 '.'
printf '{"root":{"+@id":"1","item":{"+@code":"a","+content":"alpha"}}}' | yq -p=json -o=xml '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '{"root":{"+@id":"1","item":[{"+@code":"a","+content":"alpha"},{"+@code":"b","+content":"beta"}]}}\n<root id="1">\n  <item code="a">alpha</item>\n</root>\n'
    );
  });

  it("14. yq properties (-p=props / -o=props) and shell variable (-o=shell) formats", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "app.name = demo\napp.port = 8080\n" | yq -p=props -o=json -I=0 '.'
printf '{"app":{"name":"demo","msg":"hi there"}}' | yq -p=json -o=props '.'
printf '{"app":{"name":"demo","msg":"hi there"}}' | yq -p=json -o=shell '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '{"app":{"name":"demo","port":"8080"}}\napp.name = demo\napp.msg = hi there\napp_name=demo\napp_msg=\'hi there\'\n'
    );
  });

  it("15. yq CSV and TSV decoding and encoding (-p=csv, -o=csv, -p=tsv, -o=tsv) with auto-parsed scalars", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "name,count,active\nalpha,10,true\nbeta,20,false\n" | yq -p=csv -o=json -I=0 '.'
printf '[{"name":"a,b","count":1},{"name":"c","count":2}]' | yq -p=json -o=csv '.'
printf '[{"name":"a","count":1},{"name":"b","count":2}]' | yq -p=json -o=tsv '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '[{"name":"alpha","count":10,"active":true},{"name":"beta","count":20,"active":false}]\nname,count\n"a,b",1\nc,2\nname\tcount\na\t1\nb\t2\n'
    );
  });

  it("16. yq TOML format decoding (-p=toml) and encoding (-o=toml) with nested tables and arrays", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '[pkg]\nname = "demo"\nver = 1\n' | yq -p=toml -o=json -I=0 '.'
printf '{"pkg":{"name":"demo","ver":1,"tags":["a","b"]}}' | yq -p=json -o=toml '.'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '{"pkg":{"name":"demo","ver":1}}\n\n[pkg]\nname = "demo"\nver = 1\ntags = ["a", "b"]\n'
    );
  });

  it("17. yq front-matter extraction (-f=extract) and processing (-f=process) preserving document body", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf -- "---\ntitle: Guide\ncount: 1\n---\n# Heading\nBody text\n" | yq -f=extract -o=json -I=0 '.'
printf -- "---\ntitle: Guide\ncount: 1\n---\n# Heading\nBody text\n" | yq -f=process '.count = 2'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '{"title":"Guide","count":1}\n---\ntitle: Guide\ncount: 2\n---\n# Heading\nBody text\n'
    );
  });

  it("18. yq output flags: -N (--no-doc), -0 (--nul-output), -n (--null-input), and -e (--exit-status)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf "a: 1\n---\na: 2\n" | yq -N '.a'
printf "a: 1\nb: 2\n" | yq -0 '.a, .b' | od -An -tx1 | tr -s ' '
yq -n -o=json -I=0 '.x = 42'
printf "a: false\n" | yq -e '.a' >/dev/null 2>&1; echo "exit:$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "1\n2\n 31 00 32 00\n{\"x\":42}\nexit:1\n");
  });

  it("19. yq --expression and -s (--split-exp) splitting documents into dynamically named files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f2.yaml": "name: gamma\n",
      },
    });
    const r = await h.exec(String.raw`
yq --expression '.name' /workspace/f2.yaml
printf "id: one\n---\nid: two\n" | yq -s '"/workspace/out_" + .id' -o=json -I=0 '.'
cat /workspace/out_one.json
cat /workspace/out_two.json
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'gamma\n{"id":"one"}\n{"id":"two"}\n');
  });

  it("20. yq head_comment, anchor, alias, style introspection, and security disable flags", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '# header comment\na: &anc '\''single'\''\nb: *anc\nc: "double"\nd: [1, 2]\n' | yq -o=json -I=0 '[(head_comment), (.a | anchor), (.b | alias), (.a | style), (.c | style), (.d | style)]'
FOO=bar yq --security-disable-env-ops -n 'strenv(FOO)' 2>/dev/null; echo "env_disabled:$?"
yq --security-disable-file-ops -n 'load("/workspace/f.yaml")' 2>/dev/null; echo "file_disabled:$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      '["header comment","anc","anc","single","double","flow"]\nenv_disabled:1\nfile_disabled:1\n'
    );
  });
});
