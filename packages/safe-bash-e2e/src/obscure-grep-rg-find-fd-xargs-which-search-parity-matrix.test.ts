import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure grep, rg, find, fd, xargs, and which search parity matrix", () => {
  it("1. grep BRE backreferences vs ERE (-E) vs fixed strings (-F) and POSIX classes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'ab-12\\nabc-12\\nxy-99\\n' | grep '^\\([a-z]\\{2\\}\\)-[0-9]\\+$'
      echo "---"
      printf 'user_123\\nuser_abc\\n' | grep -E '^user_[[:digit:]]+$'
      echo "---"
      printf 'a.*b+c?\\naxbxc\\n' | grep -F 'a.*b+c?'
      printf 'ab-ab\\n' | grep '^\\(ab\\)-\\1$' 2>/dev/null
      echo "BACKREF_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["ab-12", "xy-99", "---", "user_123", "---", "a.*b+c?", "BACKREF_RC=2", ""].join("\n")
    );
  });

  it("2. grep -o (only-matching), -b (byte offset), -n (line number), and -H / -h headers", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'foo=10 bar=20\\nbaz=30\\n' > kv.txt
      grep -H -n -o '[a-z]\\+=[0-9]\\+' kv.txt
      echo "---"
      grep -b -o 'baz=30' kv.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["kv.txt:1:foo=10", "kv.txt:1:bar=20", "kv.txt:2:baz=30", "---", "14:baz=30", ""].join("\n")
    );
  });

  it("3. grep -A, -B, -C context lines with -- group separators across non-contiguous matches", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'L1\\nHIT1\\nL3\\nL4\\nL5\\nHIT2\\nL7\\n' | grep -C 1 'HIT'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["L1", "HIT1", "L3", "--", "L5", "HIT2", "L7", ""].join("\n")
    );
  });

  it("4. grep -c, -l, -L, -m, -v, -w, -x, and -q exit status", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'cat\\ncatapult\\ndog cat\\n' > a.txt
      printf 'bird\\nfish\\n' > b.txt
      grep -w 'cat' a.txt
      echo "---"
      grep -x 'cat' a.txt
      echo "---"
      grep -l 'cat' a.txt b.txt
      grep -L 'cat' a.txt b.txt
      grep -m 1 'cat' a.txt
      grep -v -c 'cat' a.txt
      grep -q 'bird' b.txt && echo "QUIET_HIT"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "cat",
        "dog cat",
        "---",
        "cat",
        "---",
        "a.txt",
        "b.txt",
        "cat",
        "0",
        "QUIET_HIT",
        "",
      ].join("\n")
    );
  });

  it("5. grep -r recursive search with --include, --exclude, --exclude-dir, and -f pattern file", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p src/vendor
      printf 'TOKEN_A\\n' > src/main.ts
      printf 'TOKEN_A\\n' > src/main.bak
      printf 'TOKEN_A\\n' > src/vendor/ignore.ts
      printf 'TOKEN_A\\nTOKEN_B\\n' > pats.txt
      grep -r --include='*.ts' --exclude='*.bak' --exclude-dir='vendor' -f pats.txt src
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "src/main.ts:TOKEN_A\n");
  });

  it("6. grep -z (--null-data) NUL-delimited records and -Z (--null) filename output", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'rec_one\\nmatch\\0rec_two\\nskip\\0rec_three\\nmatch\\0' | grep -z 'match' | tr '\\0' '|'
      echo ""
      printf 'hit\\n' > f1.txt
      grep -l -Z 'hit' f1.txt | tr '\\0' ':'
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "rec_one\nmatch|rec_three\nmatch|\nf1.txt:\n"
    );
  });

  it("7. rg -S (smart-case), -F (fixed-strings), -w, -x, -v, and -n / -N line numbers", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'hello\\nHello\\nHELLO\\n' > case.txt
      rg -N -S 'hello' case.txt | wc -l | tr -d ' '
      rg -N -S 'Hello' case.txt
      printf 'a+b\\naab\\n' | rg -N -F 'a+b'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "3\nHello\na+b\n");
  });

  it("8. rg -o (only-matching) and -r (--replace) with capture groups", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'id=42 name=alice\\nid=99 name=bob\\n' | rg -N 'id=([0-9]+) name=([a-z]+)' -r '$2:$1'
      echo "---"
      printf 'v1.2.3 and v4.5.6\\n' | rg -N -o 'v[0-9]+\\.[0-9]+\\.[0-9]+'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["alice:42", "bob:99", "---", "v1.2.3", "v4.5.6", ""].join("\n")
    );
  });

  it("9. rg -c, --count-matches, -l, --files-without-match, and -m (--max-count)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'hit hit\\nhit\\nmiss\\n' > m.txt
      printf 'none\\n' > n.txt
      rg -c 'hit' m.txt
      rg --count-matches 'hit' m.txt
      rg -l 'hit' m.txt n.txt
      rg --files-without-match 'hit' m.txt n.txt
      rg -N -m 1 'hit' m.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["2", "3", "m.txt", "n.txt", "hit hit", ""].join("\n")
    );
  });

  it("10. rg --files with -g globs, -t/-T type filters, --hidden, and --no-ignore", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p proj/.git
      printf 'ignored.ts\\n' > proj/.gitignore
      printf 'export const a = 1;\\n' > proj/app.ts
      printf 'export const t = 1;\\n' > proj/app.test.ts
      printf 'export const i = 1;\\n' > proj/ignored.ts
      printf 'secret\\n' > proj/.env
      rg --files -g '!*.test.ts' proj | sort
      echo "---"
      rg --files --hidden --no-ignore -g '!.git/*' -g '!.gitignore' proj | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "proj/app.ts",
        "---",
        "proj/.env",
        "proj/app.test.ts",
        "proj/app.ts",
        "proj/ignored.ts",
        "",
      ].join("\n")
    );
  });

  it("11. rg -U (--multiline) cross-line regex matching and -C context", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'header\\nBEGIN\\n  payload\\nEND\\nfooter\\n' | rg -N -U 'BEGIN\\n  payload\\nEND'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "BEGIN\n  payload\nEND\n");
  });

  it("12. find boolean expressions (-a, -o, !, parentheses) with -name, -iname, and -path", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p tree/sub tree/skip
      touch tree/sub/Alpha.TS tree/sub/beta.js tree/sub/gamma.md tree/skip/delta.ts
      find tree -not -path '*/skip/*' -a '(' -iname '*.ts' -o -name '*.js' ')' | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["tree/sub/Alpha.TS", "tree/sub/beta.js", ""].join("\n")
    );
  });

  it("13. find -type f/d/l, -size (+10c, 0), -empty, -perm, and -mindepth / -maxdepth", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p d/empty_dir
      printf '' > d/empty.txt
      printf '0123456789ABCDEF' > d/big.txt
      chmod 755 d/big.txt
      ln -s big.txt d/link.txt
      find d -mindepth 1 -maxdepth 1 -type f -size +10c -perm 755
      find d -mindepth 1 -empty | sort
      find d -type l
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["d/big.txt", "d/empty.txt", "d/empty_dir", "d/link.txt", ""].join("\n")
    );
  });

  it("14. find -prune, -delete, -print0, and -printf (%f, %s, %y)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p p/keep p/node_modules/pkg
      printf 'hello' > p/keep/a.txt
      printf 'skip' > p/node_modules/pkg/b.txt
      find p -name node_modules -prune -o -type f -printf '%f:%s:%y\\n'
      find p/node_modules -type f -delete
      find p/node_modules -type f | wc -l | tr -d ' '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a.txt:5:f\n0\n");
  });

  it("15. find -exec cmd {} ';' single-file vs -exec cmd {} + batched execution", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p ex
      touch ex/1.txt ex/2.txt
      find ex -type f -name '*.txt' -exec echo SINGLE '{}' ';' | sort
      echo "---"
      find ex -type f -name '*.txt' -exec printf '[%s]' '{}' +
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.startsWith("SINGLE ex/1.txt\nSINGLE ex/2.txt\n---\n"));
    assert.ok(res.stdout.includes("[ex/1.txt]") && res.stdout.includes("[ex/2.txt]"));
  });

  it("16. fd -e extension, -t type, -E exclude, -H hidden, -I no-ignore, and -g glob", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p repo/dist
      printf 'dist/\\n' > repo/.gitignore
      touch repo/main.rs repo/lib.rs repo/.secret.rs repo/dist/out.rs repo/readme.md
      fd -e rs . repo | sort
      echo "---"
      fd -H -I -e rs -E dist . repo | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "repo/lib.rs",
        "repo/main.rs",
        "---",
        "repo/.secret.rs",
        "repo/lib.rs",
        "repo/main.rs",
        "",
      ].join("\n")
    );
  });

  it("17. fd -x (--exec) placeholders ({}, {/}, {//}, {.}, {/.}) and -X (--exec-batch)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p pkg/src
      touch pkg/src/mod.ts
      fd -e ts . pkg -x echo '{/}|{//}|{/.}|{.}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "mod.ts|pkg/src|mod|pkg/src/mod\n");
  });

  it("18. xargs -n MAX_ARGS, -L MAX_LINES, -I REPL, and -r (--no-run-if-empty)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a b c d e\\n' | xargs -n 2 echo
      echo "---"
      printf 'f1\\nf2\\n' | xargs -I '{}' echo 'item={}'
      echo "---"
      printf '' | xargs -r echo SHOULD_NOT_RUN
      echo "EMPTY_OK"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "a b",
        "c d",
        "e",
        "---",
        "item=f1",
        "item=f2",
        "---",
        "EMPTY_OK",
        "",
      ].join("\n")
    );
  });

  it("19. xargs -0 (--null), -d custom delimiter, and -E logical EOF marker", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'one two\\0three four\\0' | xargs -0 -n 1 echo
      echo "---"
      printf 'alpha:beta:gamma' | xargs -d ':' -n 2 echo
      echo "---"
      printf 'x y STOP z w\\n' | xargs -E STOP echo
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "one two",
        "three four",
        "---",
        "alpha beta",
        "gamma",
        "---",
        "x y",
        "",
      ].join("\n")
    );
  });

  it("20. which, command -v, and type across builtins, functions, and virtual binaries", async () => {
    const env = createEnv();
    const res = await env.exec(`
      my_fn() { echo "hi"; }
      which grep rg sqlite3
      command -v my_fn
      type -t my_fn
      type -t echo
      which nonexistent_binary_xyz 2>/dev/null
      echo "WHICH_MISS_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "/usr/bin/grep",
        "/usr/bin/rg",
        "/usr/bin/sqlite3",
        "my_fn",
        "function",
        "builtin",
        "WHICH_MISS_RC=1",
        "",
      ].join("\n")
    );
  });
});
