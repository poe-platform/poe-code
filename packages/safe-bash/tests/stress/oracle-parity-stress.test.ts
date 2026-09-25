import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Shell, createMemoryFileSystem, agentCommands } from "../../src/index.js";

test("differential oracle parity: safe-bash bc vs /usr/bin/bc", async (t) => {
  if (!existsSync("/usr/bin/bc")) {
    t.skip("/usr/bin/bc not available on host");
    return;
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands());

  const programs = [
    "scale=6; 355/113",
    "scale=4; (12.345 + 67.8901) * 2.5 / 3.1",
    "ibase=16; FF + A0",
    "obase=16; 255; 4095",
    "obase=2; 42",
    "define fact(n) { if (n <= 1) return (1); return (n * fact(n-1)); }\nfact(10)",
    "s=0; for (i=1; i<=20; i++) { if (i%2==0) continue; s += i*i; }; s",
    "a[0]=10; a[5]=25; a[0]+a[5]",
    "length(123456); scale(12.3450)",
    "sqrt(2025)",
  ];

  for (const prog of programs) {
    const hostOut = execFileSync("/usr/bin/bc", ["-q"], { input: prog + "\n", encoding: "utf8" });
    const sbRes = await shell.exec(`bc -q <<'EOF'\n${prog}\nEOF`);
    assert.equal(sbRes.exitCode, 0, `bc failed on ${prog}: ${sbRes.stderr}`);
    assert.equal(sbRes.stdout, hostOut, `bc mismatch on ${prog}`);
  }
});

test("differential oracle parity: safe-bash xxd & od vs host /usr/bin/xxd & /bin/bash", async (t) => {
  if (!existsSync("/usr/bin/xxd") || !existsSync("/bin/bash")) {
    t.skip("/usr/bin/xxd or /bin/bash not available on host");
    return;
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands());

  const scripts = [
    "printf 'Hello, safe-bash!\\x00\\xff\\x7f\\n' | xxd",
    "printf 'Hello, safe-bash!\\x00\\xff\\x7f\\n' | xxd -p",
    "printf 'Hello, safe-bash!\\x00\\xff\\x7f\\n' | xxd -p | xxd -r -p",
    "printf '0123456789abcdef0123456789abcdef' | xxd -c 8 -g 2",
  ];

  for (const script of scripts) {
    const hostOut = execFileSync("/bin/bash", ["-c", script], { encoding: "utf8" });
    const sbRes = await shell.exec(script);
    assert.equal(sbRes.exitCode, 0);
    assert.equal(sbRes.stdout, hostOut, `xxd mismatch on: ${script}`);
  }
});

test("differential oracle parity: bash extglob, case fallthrough, heredoc, here-string, and process substitution", async (t) => {
  if (!existsSync("/bin/bash")) {
    t.skip("/bin/bash not available on host");
    return;
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands());

  const scripts = [
    `shopt -s extglob
for w in foo.ts bar.js baz.py qux.tsx; do
  case "$w" in
    *.@(ts|tsx)) printf "TS:%s\n" "\${w%.@(ts|tsx)}" ;;
    !(*.py)) printf "OTHER:%s\n" "$w" ;;
    *) printf "PY:%s\n" "$w" ;;
  esac
done`,
    `shopt -s extglob
v="___hello___world___"
printf "1:%s\n" "\${v#+(_)}"
printf "2:%s\n" "\${v%+(_)}"
printf "3:%s\n" "\${v//+(_)/-}"`,
    `cat <<-'EOF' | tr "a-z" "A-Z"
	alpha_line
	beta_line
EOF`,
    `read -r a b c <<< "100 200 300"
printf "%s-%s-%s\n" "$c" "$b" "$a"`,
    `comm -12 <(printf "a\nb\nc\nd\n") <(printf "b\nd\ne\n")`,
  ];

  for (const script of scripts) {
    const hostOut = execFileSync("/bin/bash", ["-c", script], { encoding: "utf8" });
    const sbRes = await shell.exec(script);
    assert.equal(sbRes.exitCode, 0, `safe-bash failed on script: ${sbRes.stderr}`);
    assert.equal(sbRes.stdout, hostOut, `bash oracle mismatch on script:\n${script}`);
  }
});
