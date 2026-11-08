import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mediaCommands } from "@poe-platform/safe-bash/commands/media";
import { sb, withE2EHarness } from "./harness.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Shell middleware, plugin host, custom filesystems, capabilities, commandLimits, hooks, and extended utilities E2E", () => {
  it("1. Shell.use(middleware) chains in onion order, audits invocations, injects env, and enforces policy short-circuits", async () => {
    const trace: string[] = [];

    await withE2EHarness(async (h) => {
      h.shell.use(async (context, next) => {
        trace.push(`mw1:before:${context.command}`);
        if (context.command === "forbidden_cmd") {
          await sb.writeText(context.stderr, "policy: forbidden_cmd blocked\n");
          trace.push(`mw1:blocked:${context.command}`);
          return { exitCode: 126 };
        }
        const res = await next();
        trace.push(`mw1:after:${context.command}:${res.exitCode}`);
        return res;
      });

      h.shell.use(async (context, next) => {
        trace.push(`mw2:before:${context.command}`);
        const res = await next();
        trace.push(`mw2:after:${context.command}:${res.exitCode}`);
        return res;
      });

      h.shell.register({
        name: "forbidden_cmd",
        async execute() {
          return { exitCode: 0 };
        },
      });

      const okRes = await h.exec(`printf 'hello-mw\\n'`);
      assert.equal(okRes.exitCode, 0);
      assert.equal(okRes.stdout, "hello-mw\n");
      assert.deepEqual(trace, [
        "mw1:before:printf",
        "mw2:before:printf",
        "mw2:after:printf:0",
        "mw1:after:printf:0",
      ]);

      trace.length = 0;
      const blockedRes = await h.exec(`forbidden_cmd`);
      assert.equal(blockedRes.exitCode, 126);
      assert.equal(blockedRes.stderr, "policy: forbidden_cmd blocked\n");
      assert.deepEqual(trace, [
        "mw1:before:forbidden_cmd",
        "mw1:blocked:forbidden_cmd",
      ]);
    });
  });

  it("2. Shell.register custom command with raw binary Uint8Array arguments via getCommandArguments", async () => {
    await withE2EHarness(async (h) => {
      h.shell.register({
        name: "hex_args",
        async execute(context) {
          const cmdArgs = sb.getCommandArguments(context);
          const hexParts: string[] = [];
          for (let i = 0; i < cmdArgs.args.length; i++) {
            const bytes = cmdArgs.bytes(i)!;
            hexParts.push(Buffer.from(bytes).toString("hex"));
          }
          await sb.writeText(context.stdout, hexParts.join("|") + "\n");
          return { exitCode: 0 };
        },
      });

      const res = await h.exec(
        `value='\\377\\001A'; hex_args "\${value@E}" "plain"`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ff0141|706c61696e\n");
    });
  });

  it("3. ShellCommandContext.invoke supports argv0, externalInvocation, replaceEnv, and custom cwd/stdio", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/sub/data.txt": "inside-sub\n",
        },
      },
      async (h) => {
        h.shell.register({
          name: "inspect_argv0",
          async execute(context) {
            const cmdArgs = sb.getCommandArguments(context);
            await sb.writeText(
              context.stdout,
              `argv0=${context.argv0 ?? context.command} cwd=${context.cwd} FOO=${context.env.FOO ?? "unset"} HOME=${context.env.HOME ?? "unset"}\n`,
            );
            return { exitCode: 0 };
          },
        });

        h.shell.register({
          name: "delegate_runner",
          async execute(context) {
            const shellCtx = context as sb.ShellCommandContext;
            return shellCtx.invoke("inspect_argv0", [], {
              argv0: "custom-zeroth-name",
              cwd: "/workspace/sub",
              env: { FOO: "only_foo" },
              replaceEnv: true,
              externalInvocation: true,
              stdout: context.stdout,
              stderr: context.stderr,
            });
          },
        });

        const res = await h.exec(`
inspect_argv0() { echo "SHELL_FUNCTION_SHADOW"; }
delegate_runner
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "argv0=custom-zeroth-name cwd=/workspace/sub FOO=only_foo HOME=unset\n",
        );
      },
    );
  });

  it("4. Shell.registerFileSystem and createFileSystem register custom URI schemes and reject invalid/duplicate schemes", async () => {
    await withE2EHarness(async (h) => {
      h.shell.registerFileSystem("mem+snapshot", async (options) => {
        const fs = new sb.MemoryFileSystem();
        const seed = String(options.seed ?? "default");
        await fs.writeFile("/seed.txt", encoder.encode(seed));
        return fs;
      });

      assert.throws(
        () => h.shell.registerFileSystem("123invalid", () => new sb.MemoryFileSystem()),
        /Invalid filesystem scheme/,
      );
      assert.throws(
        () => h.shell.registerFileSystem("UPPER", () => new sb.MemoryFileSystem()),
        /Invalid filesystem scheme/,
      );
      assert.throws(
        () => h.shell.registerFileSystem("mem+snapshot", () => new sb.MemoryFileSystem()),
        /Filesystem already registered: mem\+snapshot/,
      );
      await assert.rejects(
        () => h.shell.createFileSystem("unknown-scheme"),
        /Unknown filesystem scheme: unknown-scheme/,
      );

      const customFs = await h.shell.createFileSystem("mem+snapshot", {
        seed: "hydrated-from-scheme\n",
      });
      const res = await h.shell.exec(`cat /seed.txt`, { fs: customFs });
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hydrated-from-scheme\n");
    });
  });

  it("5. ShellCapabilities.predicateIdentity governs test -O / -G and [[ -O / -G ]] file ownership predicates", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/owned.txt": "secret\n",
        },
      },
      async (h) => {
        const st = await h.stat("/workspace/owned.txt");
        const uid = st.uid ?? 1000;
        const gid = st.gid ?? 1000;

        const matchRes = await h.shell.exec(
          `
test -O /workspace/owned.txt && echo "test_O_match"
test -G /workspace/owned.txt && echo "test_G_match"
[[ -O /workspace/owned.txt && -G /workspace/owned.txt ]] && echo "cond_match"
`,
          {
            capabilities: {
              predicateIdentity: { effectiveUid: uid, effectiveGid: gid },
            },
          },
        );
        assert.equal(matchRes.exitCode, 0, matchRes.stderr);
        assert.equal(
          matchRes.stdout,
          "test_O_match\ntest_G_match\ncond_match\n",
        );

        const mismatchRes = await h.shell.exec(
          `
if [[ -O /workspace/owned.txt || -G /workspace/owned.txt ]]; then
  echo "UNEXPECTED_MATCH"
else
  echo "ownership_denied"
fi
`,
          {
            capabilities: {
              predicateIdentity: {
                effectiveUid: uid + 999,
                effectiveGid: gid + 999,
              },
            },
          },
        );
        assert.equal(mismatchRes.exitCode, 0);
        assert.equal(mismatchRes.stdout, "ownership_denied\n");
      },
    );
  });

  it("6. CommandFamilyLimits (commandLimits.split and commandLimits.htmlToMarkdown) enforce per-invocation ceilings", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/lines.txt": "line1\nline2\nline3\nline4\nline5\n",
          "/workspace/page.html": "<h1>Title</h1><p>Paragraph text here</p>",
        },
      },
      async (h) => {
        // Split limit: maxGeneratedFiles: 2 fails when splitting 5 lines into 1-line files
        const splitFail = await h.shell.exec(
          `split -n 5 /workspace/lines.txt /workspace/chunk_`,
          {
            limits: {
              commandLimits: {
                split: { maxFiles: 2 },
              },
            },
          },
        );
        assert.notEqual(splitFail.exitCode, 0);

        // html-to-markdown limit: maxInputBytes: 8 fails on 40-byte HTML file
        const htmlFail = await h.shell.exec(
          `html-to-markdown /workspace/page.html`,
          {
            limits: {
              commandLimits: {
                htmlToMarkdown: { maxInputBytes: 8 },
              },
            },
          },
        );
        assert.notEqual(htmlFail.exitCode, 0);
      },
    );
  });

  it("7. ShellSessionHooks (beforeExec, afterExec), onState, and createSession round-trip complex state", async () => {
    const hookEvents: string[] = [];

    await withE2EHarness(async (h) => {
      const session = h.shell.createSession();

      await session.exec(
        `
mkdir -p /workspace/proj/sub
cd /workspace/proj
pushd /workspace/proj/sub >/dev/null
umask 0027
export GLOBAL_TAG="v1.0"
declare -i RETRY_COUNT=3
declare -a ITEMS=([0]="first" [3]="fourth")
declare -A META=([env]="prod" [region]="us-east")
greet() { printf 'hi:%s\\n' "$1"; }
shopt -s nullglob dotglob
set -o pipefail
`,
        {
          hooks: {
            beforeExec({ source }) {
              hookEvents.push(`before:${source.trim().split("\n")[0]}`);
              return undefined;
            },
            afterExec(state, result) {
              hookEvents.push(`after:${ state.cwd }:${result.exitCode}`);
            },
          },
        },
      );

      assert.equal(hookEvents.length, 2);
      assert.ok(session.state);
      assert.equal(session.state.cwd, "/workspace/proj/sub");
      assert.equal(session.state.umask, 0o027);

      const res2 = await session.exec(`
printf 'cwd=%s umask=%s tag=%s retry=%d\\n' "$(pwd)" "$(umask)" "$GLOBAL_TAG" "$RETRY_COUNT"
printf 'items=%s meta=%s\\n' "\${ITEMS[0]},\${ITEMS[3]}" "\${META[env]},\${META[region]}"
greet "world"
dirs -p | tr '\\n' '|'
printf '\\n'
shopt -q nullglob && shopt -q dotglob && echo "shopts_preserved"
`);
      assert.equal(res2.exitCode, 0, res2.stderr);
      assert.equal(
        res2.stdout,
        [
          "cwd=/workspace/proj/sub umask=0027 tag=v1.0 retry=3",
          "items=first,fourth meta=prod,us-east",
          "hi:world",
          "/workspace/proj/sub|/workspace/proj|",
          "shopts_preserved",
        ].join("\n") + "\n",
      );
    });
  });

  it("8. custom streaming ByteSource stdin and ByteSink stdout/stderr on shell.exec", async () => {
    await withE2EHarness(async (h) => {
      const outChunks: Uint8Array[] = [];
      const errChunks: Uint8Array[] = [];

      const customStdin: sb.ByteSource = {
        async *[Symbol.asyncIterator]() {
          yield encoder.encode("first line\n");
          yield encoder.encode("second line\n");
          yield encoder.encode("third line\n");
        },
      };

      const customStdout: sb.ByteSink = {
        async write(chunk) {
          outChunks.push(new Uint8Array(chunk));
        },
      };

      const customStderr: sb.ByteSink = {
        async write(chunk) {
          errChunks.push(new Uint8Array(chunk));
        },
      };

      const res = await h.shell.exec(
        `
nl -ba
printf 'diag-message\\n' >&2
`,
        {
          stdin: customStdin,
          stdout: customStdout,
          stderr: customStderr,
        },
      );

      assert.equal(res.exitCode, 0);
      const streamedOut = decoder.decode(Buffer.concat(outChunks));
      const streamedErr = decoder.decode(Buffer.concat(errChunks));
      assert.match(streamedOut, /1\tfirst line/);
      assert.match(streamedOut, /2\tsecond line/);
      assert.match(streamedOut, /3\tthird line/);
      assert.equal(streamedErr, "diag-message\n");
    });
  });

  it("9. mediaCommands plugin binds custom MediaEngineRequest with VFS discovery (exists, accessible, read)", async () => {
    const observedCalls: {
      command: string;
      args: string[];
      tool: string | undefined;
      resourceCount: number;
    }[] = [];

    await withE2EHarness(
      {
        files: {
          "/workspace/sprite.png": "FAKE_PNG_BYTES_12345",
        },
        plugins: [
          mediaCommands({
            replace: true,
            engine: {
              async execute(req) {
                const args = req.args.map((b) => decoder.decode(b));
                observedCalls.push({
                  command: req.command,
                  args,
                  tool: req.discovery?.tool,
                  resourceCount: (req.discovery as { resources?: unknown[] } | undefined)?.resources?.length ?? 0,
                });
                await sb.writeText(
                  req.stdout,
                  `media-engine:${req.command}:${args.join(",")}\n`,
                );
                return { exitCode: 0 };
              },
            },
          }),
        ],
      },
      async (h) => {
        const res = await h.exec(`
magick sprite.png -resize 16x16 out.png
ffmpeg -i sprite.png out.mp4
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "media-engine:magick:sprite.png,-resize,16x16,out.png\nmedia-engine:ffmpeg:-i,sprite.png,out.mp4\n",
        );
        assert.equal(observedCalls.length, 2);
        assert.equal(observedCalls[0]!.tool, "magick");
        assert.equal(observedCalls[0]!.resourceCount, 2);
        assert.equal(observedCalls[1]!.tool, "ffmpeg");
        assert.deepEqual(observedCalls[1]!.args, ["-i", "sprite.png", "out.mp4"]);
      },
    );
  });

  it("10. pagerCommands (less and more): line numbering (-N), squeeze blank lines (-s), and chop (-S)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/readme.txt": "Line A\n\n\nLine B\n\nLine C\n",
        },
        plugins: [sb.pagerCommands({ replace: true })],
      },
      async (h) => {
        const res = await h.exec(`
less -N -s /workspace/readme.txt
echo "---"
more -s /workspace/readme.txt
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /1\s+Line A/);
        assert.match(res.stdout, /Line B/);
        assert.match(res.stdout, /---/);
      },
    );
  });

  it("11. timeout -k (--kill-after) worker boundary refuses finite shared interpreter quotas with status 125", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.shell.exec(`timeout -k 0.05s 0.05s echo hi`, {
        limits: { maxCommands: 50 },
      });
      assert.equal(res.exitCode, 125);
      assert.match(
        res.stderr,
        /timeout: (worker escalation cannot preserve finite shared interpreter quotas|hard escalation is unavailable on this host)/,
      );
    });
  });

  it("12. ShellLimits enforce maxRedirects, maxPipelineStages, maxExpansionFields, and maxSubstitutionDepth", async () => {
    await withE2EHarness(async (h) => {
      // maxRedirects: 1 rejects a command with 2 redirections
      await assert.rejects(
        () =>
          h.shell.exec(`echo hi > /workspace/a.txt 2> /workspace/b.txt`, {
            limits: { maxRedirects: 1 },
          }),
        (err: unknown) =>
          err instanceof sb.ShellLimitError && err.limit === "maxRedirects",
      );

      // maxPipelineStages: 2 rejects a 3-stage pipeline
      await assert.rejects(
        () =>
          h.shell.exec(`echo hi | cat | wc -c`, {
            limits: { maxPipelineStages: 2 },
          }),
        (err: unknown) =>
          err instanceof sb.ShellLimitError && err.limit === "maxPipelineStages",
      );

      // maxExpansionFields: 3 rejects brace/word expansion into 5 fields
      await assert.rejects(
        () =>
          h.shell.exec(`printf '%s\\n' {1..5}`, {
            limits: { maxExpansionFields: 3 },
          }),
        (err: unknown) =>
          err instanceof sb.ShellLimitError &&
          err.limit === "maxExpansionFields",
      );

      // maxSubstitutionDepth: 1 rejects nested $( $( ... ) )
      await assert.rejects(
        () =>
          h.shell.exec(`echo $(echo $(echo deep))`, {
            limits: { maxSubstitutionDepth: 1 },
          }),
        (err: unknown) =>
          err instanceof sb.ShellLimitError &&
          err.limit === "maxSubstitutionDepth",
      );
    });
  });

  it("13. Shell.dispose() runs plugin dispose hooks and rejects subsequent operations", async () => {
    let pluginDisposed = 0;
    const h = await sb.MemoryFileSystem;
    const fs = new h();
    const shell = new sb.Shell({ fs });

    shell.use({
      name: "disposable-test-plugin",
      setup() {},
      async dispose() {
        pluginDisposed++;
      },
    });

    await shell.dispose();
    assert.equal(pluginDisposed, 1);

    await assert.rejects(() => shell.exec("echo hi"), /Shell is disposed/);
    assert.throws(
      () => shell.use({ name: "p2", setup() {} }),
      /Shell is disposed/,
    );
    assert.throws(
      () =>
        shell.register({
          name: "c2",
          async execute() {
            return { exitCode: 0 };
          },
        }),
      /Shell is disposed/,
    );
    assert.throws(
      () => shell.registerFileSystem("custom", () => fs),
      /Shell is disposed/,
    );
    await assert.rejects(
      () => shell.createFileSystem("custom"),
      /Shell is disposed/,
    );
  });

  it("14. pr multi-column pagination, headers (-h), line numbering (-n), and double spacing (-d)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.txt": [
            "alpha",
            "beta",
            "gamma",
            "delta",
            "epsilon",
            "zeta",
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
pr -2 -t -w 40 /workspace/items.txt
echo "---"
pr -t -n:3 /workspace/items.txt | head -n 3
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /alpha\s+delta/);
        assert.match(res.stdout, /beta\s+epsilon/);
        assert.match(res.stdout, /gamma\s+zeta/);
        assert.match(res.stdout, /1:alpha/);
        assert.match(res.stdout, /2:beta/);
        assert.match(res.stdout, /3:gamma/);
      },
    );
  });

  it("15. csplit context-based file splitting with regex patterns, repeat counts, and custom prefix/digits", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/book.txt": [
            "Preface line",
            "CHAPTER 1",
            "Body 1a",
            "Body 1b",
            "CHAPTER 2",
            "Body 2a",
            "CHAPTER 3",
            "Body 3a",
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
cd /workspace
csplit -s -f chap_ -n 2 book.txt '/^CHAPTER/' '{*}'
ls -1 chap_*
cat chap_01
echo "---"
cat chap_03
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /chap_00\nchap_01\nchap_02\nchap_03/);
        assert.match(res.stdout, /CHAPTER 1\nBody 1a\nBody 1b/);
        assert.match(res.stdout, /CHAPTER 3\nBody 3a/);
      },
    );
  });

  it("16. tsort topological sort and cycle detection on dependency graphs + factor prime factorization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
tsort <<'GRAPH'
core-contracts vfs-layer
vfs-layer shell-parser
shell-parser shell-runtime
shell-runtime e2e-harness
GRAPH
echo "---"
factor 12 97 2310
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "core-contracts",
          "vfs-layer",
          "shell-parser",
          "shell-runtime",
          "e2e-harness",
          "---",
          "12: 2 2 3",
          "97: 97",
          "2310: 2 3 5 7 11",
        ].join("\n") + "\n",
      );
    });
  });

  it("17. iconv character set conversion (UTF-8 <-> ISO-8859-1 / UTF-16LE / ASCII -c) piped to xxd and hexdump", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf 'café' | iconv -f UTF-8 -t ISO-8859-1 | xxd -p
printf 'café' | iconv -f UTF-8 -t UTF-16LE | xxd -p
printf 'café!' | iconv -c -f UTF-8 -t ASCII
printf '\\n'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "636166e9\n630061006600e900\ncaf!\n");
    });
  });

  it("18. file magic classification (--mime-type, -b, -L) across PNG, PDF, GZIP, BZIP2, XZ, SQLite3, and scripts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 8x8 xc:blue /workspace/sample.png
printf 'hello' | gzip -c > /workspace/sample.gz
printf 'hello' | bzip2 -c > /workspace/sample.bz2
printf 'hello' | xz -c > /workspace/sample.xz
sqlite3 /workspace/sample.db "CREATE TABLE t(x INT); INSERT INTO t VALUES (1);"
printf '#!/bin/sh\\necho hi\\n' > /workspace/script.sh
ln -s /workspace/sample.png /workspace/link.png

file -b --mime-type /workspace/sample.png /workspace/sample.gz /workspace/sample.bz2 /workspace/sample.xz /workspace/sample.db /workspace/script.sh
file -b -L --mime-type /workspace/link.png
`);
      assert.equal(res.exitCode, 0, res.stderr);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines[0], "image/png");
      assert.match(lines[1]!, /^application\/(x-)?gzip$/);
      assert.match(lines[2]!, /^application\/(x-)?bzip2$/);
      assert.match(lines[3]!, /^application\/(x-)?xz$/);
      assert.match(lines[4]!, /^application\/(vnd\.sqlite3|x-sqlite3)$/);
      assert.match(lines[5]!, /^text\/x-shellscript$/);
      assert.equal(lines[6], "image/png");
    });
  });

  it("19. tree directory visualization (-a, -d, -L, -J JSON, -I ignore, -P pattern, --dirsfirst)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tree_root/src/index.ts": "export {};\n",
          "/workspace/tree_root/src/util.ts": "export {};\n",
          "/workspace/tree_root/docs/guide.md": "# Guide\n",
          "/workspace/tree_root/.env": "SECRET=1\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
tree -J --dirsfirst -I 'docs' /workspace/tree_root > /workspace/tree.json
jq -r '.[0].contents | map(.name) | join(",")' /workspace/tree.json
tree -a -L 1 --noreport /workspace/tree_root
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /^src\n/);
        assert.match(res.stdout, /\.env/);
      },
    );
  });

  it("20. column table formatting (-t, -s, -o) and expr regex/arithmetic/string operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf 'name:role:score\\nada:architect:99\\ngrace:compiler:100\\n' | column -t -s ':' -o ' | '
echo "---"
expr "release-v2.4.1" : 'release-v\\([0-9.]*\\)'
expr length "safe-bash-rust"
expr substr "safe-bash-rust" 6 4
expr 14 '*' '(' 2 + 3 ')'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "name  | role      | score",
          "ada   | architect | 99",
          "grace | compiler  | 100",
          "---",
          "2.4.1",
          "14",
          "bash",
          "70",
        ].join("\n") + "\n",
      );
    });
  });
});
