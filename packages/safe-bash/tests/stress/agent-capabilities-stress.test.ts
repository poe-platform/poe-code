import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../src/index.js";

test("stress: multi-turn session hooks + extglob + process substitution + fd + rg + bc + sponge + backgroundJobs", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/repo/src/modules", { recursive: true });
  await fs.mkdir("/repo/docs", { recursive: true });

  for (let i = 1; i <= 25; i++) {
    await fs.writeFile(
      `/repo/src/modules/mod${i}.ts`,
      Buffer.from(`export const value_${i} = ${i * 10}; // TODO(agent-${i}): verify\n`)
    );
  }
  await fs.writeFile("/repo/docs/guide.md", Buffer.from("# Guide\n"));

  const snapshots: number[] = [];
  const shell = new Shell({
    fs,
    cwd: "/repo",
    backgroundJobs: true,
    hooks: {
      afterExec(state) {
        snapshots.push(Object.keys(state.variables ?? {}).length);
      },
    },
  }).use(agentCommands());

  const session = shell.createSession();
  try {
    // Turn 1: enable extglob, define helper function, cd into src
    const t1 = await session.exec(`
      shopt -s extglob
      cd /repo/src
      normalize_ext() {
        local f="$1"
        printf '%s\\n' "\${f%.@(ts|tsx|js)}"
      }
      export REPO_TAG="stress_v1"
    `);
    assert.equal(t1.exitCode, 0);

    // Turn 2: use persisted cwd (/repo/src), extglob, fd, rg (\d+, \b, *?), process substitution <(...), bc, and sponge
    const t2 = await session.exec(`
      pwd
      normalize_ext "modules/mod1.ts"
      # Compare fd output and rg -l output via process substitution
      comm -12 <(fd -e ts | sort) <(rg -l 'TODO\\(agent-\\d+\\)' | sort) | wc -l | tr -d ' '
      # Sum all value_N constants using rg -o + paste + bc, and write atomically via sponge
      rg -o --no-filename ' = \\d+' modules | rg -o '\\d+' | paste -sd+ - | bc | sponge /repo/sum.txt
      cat /repo/sum.txt
    `);
    assert.equal(t2.stderr, "");
    assert.equal(t2.exitCode, 0);
    // Sum of 10 * (1..25) = 10 * 325 = 3250
    assert.equal(t2.stdout, "/repo/src\nmodules/mod1\n25\n3250\n");

    // Turn 3: run parallel background jobs with $! and wait
    const t3 = await session.exec(`
      (bc -l <<< "scale=10; sqrt(2)" > /repo/sqrt2.txt) &
      p1=$!
      (printf '%s' "$REPO_TAG" | xxd -p > /repo/tag.hex) &
      p2=$!
      wait "$p1" "$p2"
      cat /repo/sqrt2.txt
      xxd -r -p /repo/tag.hex | less -FX
      printf '\\n'
    `);
    assert.equal(t3.stderr, "");
    assert.equal(t3.exitCode, 0);
    assert.equal(t3.stdout, "1.4142135623\nstress_v1\n");
    assert.equal(snapshots.length, 3);
  } finally {
    await shell.dispose();
  }
});

test("stress & performance: 5,000-line ergonomic regex + multiline PikeVM + 300-iteration extglob & bc loop", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/bench", { recursive: true });

  const lines: string[] = [];
  for (let i = 0; i < 5000; i++) {
    if (i % 100 === 0) {
      lines.push(`export async function handler_${i}(req: Request) { return ${i}; }`);
    } else {
      lines.push(`const internal_${i} = "plain line without exported handler";`);
    }
  }
  await fs.writeFile("/bench/large.ts", Buffer.from(lines.join("\n") + "\n"));

  const shell = new Shell({ fs, cwd: "/bench" }).use(agentCommands());
  try {
    const start = performance.now();
    const res = await shell.exec(`
      shopt -s extglob
      # Ergonomic regex with word boundaries, shorthand \\w/\\d, and lazy quantifier *?
      rg -c '\\bexport\\s+async\\s+function\\s+handler_\\d+\\(.*?\\)' /bench/large.ts
      # Tight extglob parameter trim loop
      count=0
      for ((i=0; i<300; i++)); do
        s="   item_123.tsx   "
        trimmed="\${s##+( )}"
        trimmed="\${trimmed%%+( )}"
        stem="\${trimmed%.@(ts|tsx|js)}"
        if [[ "$stem" == item_+([0-9]) ]]; then
          count=$((count + 1))
        fi
      done
      printf 'count=%d\\n' "$count"
      # 1000-iteration bc sum
      bc <<< "s=0; for (i=1; i<=1000; i++) s += i; s"
    `);
    const elapsedMs = performance.now() - start;
    assert.equal(res.stderr, "");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "50\ncount=300\n500500\n");
    assert.ok(elapsedMs < 5000, `Expected benchmark to complete in <5000ms, took ${elapsedMs.toFixed(1)}ms`);
  } finally {
    await shell.dispose();
  }
});

test("differential oracle parity against host bash for extglob case, parameter expansion, and process substitution", async () => {
  const script = `
shopt -s extglob
for w in alpha.ts beta.tsx gamma.js delta.md; do
  case "$w" in
    @(*.ts|*.tsx)) printf 'T:%s\\n' "\${w%.@(ts|tsx)}" ;;
    !(*.md)) printf 'J:%s\\n' "\${w%.js}" ;;
    *) printf 'M:%s\\n' "$w" ;;
  esac
done
v="aaabbbccc12345"
printf 'trim:%s:%s\\n' "\${v##+(a)}" "\${v%%+([0-9])}"
`;
  let hostOut: string | undefined;
  try {
    hostOut = execFileSync("/bin/bash", ["-c", script], { encoding: "utf8" });
  } catch {
    hostOut = undefined;
  }

  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const res = await shell.exec(script);
    assert.equal(res.stderr, "");
    assert.equal(res.exitCode, 0);
    if (hostOut !== undefined) {
      assert.equal(res.stdout, hostOut);
    }
  } finally {
    await shell.dispose();
  }
});
