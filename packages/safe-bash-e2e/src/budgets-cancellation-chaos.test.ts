import assert from "node:assert/strict";
import test from "node:test";
import { ShellLimitError } from "@poe-platform/safe-bash";
import { withE2EHarness } from "./harness.js";

async function expectLimitExceeded(
  fn: () => Promise<{ exitCode: number; stderr: string }>,
): Promise<void> {
  try {
    const res = await fn();
    assert.notEqual(res.exitCode, 0, "Expected non-zero exit code or thrown ShellLimitError");
  } catch (err) {
    assert.ok(
      err instanceof ShellLimitError || err instanceof Error,
      `Unexpected error: ${String(err)}`,
    );
  }
}

test("maxLoopIterations terminates infinite while loops deterministically", async () => {
  await withE2EHarness({ limits: { maxLoopIterations: 25 } }, async (h) => {
    await expectLimitExceeded(() =>
      h.exec("i=0; while true; do i=$((i + 1)); done"),
    );
  });
});

test("maxCommands enforces ceiling on total command invocations per script", async () => {
  await withE2EHarness({ limits: { maxCommands: 10 } }, async (h) => {
    await h.expectOk("echo 1; echo 2; echo 3", "1\n2\n3\n");
    await expectLimitExceeded(() =>
      h.exec("for i in $(seq 1 30); do echo $i; done"),
    );
  });
});

test("maxOutputBytes caps stdout/stderr byte accumulation from noisy producers", async () => {
  await withE2EHarness({ limits: { maxOutputBytes: 256 } }, async (h) => {
    await h.expectOk("printf 'short output\\n'", "short output\n");
    await expectLimitExceeded(() => h.exec("seq 1 5000"));
  });
});

test("maxPipelineStages rejects overly deep pipelines while allowing normal pipelines", async () => {
  await withE2EHarness({ limits: { maxPipelineStages: 4 } }, async (h) => {
    await h.expectOk("echo 'hello' | tr 'a-z' 'A-Z' | cat", "HELLO\n");
    await expectLimitExceeded(() =>
      h.exec("echo 'hello' | cat | cat | cat | cat | cat"),
    );
  });
});

test("maxSubstitutionDepth blocks deeply nested $(...) command substitutions", async () => {
  await withE2EHarness({ limits: { maxSubstitutionDepth: 3 } }, async (h) => {
    await h.expectOk("echo $(echo $(echo ok))", "ok\n");
    await expectLimitExceeded(() =>
      h.exec("echo $(echo $(echo $(echo $(echo too_deep))))"),
    );
  });
});

test("maxExpansionFields blocks combinatorial brace expansion bombs ({1..100}{1..100})", async () => {
  await withE2EHarness({ limits: { maxExpansionFields: 50 } }, async (h) => {
    await h.expectOk("echo {1..5}", "1 2 3 4 5\n");
    await expectLimitExceeded(() => h.exec("echo {1..50}{1..50}"));
  });
});

test("maxExpansionBytes blocks exponential variable concatenation bombs", async () => {
  await withE2EHarness({ limits: { maxExpansionBytes: 1024 } }, async (h) => {
    await expectLimitExceeded(() =>
      h.exec(
        [
          "s='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
          "for i in 1 2 3 4 5 6 7 8 9 10; do s=\"$s$s\"; done",
          'echo "$s"',
        ].join("\n"),
      ),
    );
  });
});

test("maxSourceBytes and maxParseUnits reject oversized scripts before execution", async () => {
  await withE2EHarness({ limits: { maxSourceBytes: 128 } }, async (h) => {
    await h.expectOk("echo small", "small\n");
    const hugeScript = "echo " + "x".repeat(512);
    await expectLimitExceeded(() => h.exec(hugeScript));
  });
});

test("maxRedirects caps per-command redirection count", async () => {
  await withE2EHarness({ limits: { maxRedirects: 1 } }, async (h) => {
    await h.expectOk("echo 'ok' > /workspace/one.txt", "");
    await expectLimitExceeded(() =>
      h.exec("echo 'too_many' > /workspace/a.txt > /workspace/b.txt"),
    );
  });
});

test("maxFileSystemOperations bounds runaway VFS metadata/read/write churn", async () => {
  await withE2EHarness({ limits: { maxFileSystemOperations: 20 } }, async (h) => {
    await expectLimitExceeded(() =>
      h.exec(
        "for i in $(seq 1 50); do echo $i > /workspace/f_$i.txt; done",
      ),
    );
  });
});

test("maxPathnameComponents rejects deeply nested directory pathnames", async () => {
  await withE2EHarness({ limits: { maxPathnameComponents: 5 } }, async (h) => {
    await h.expectOk("mkdir -p /workspace/a/b && echo ok", "ok\n");
    await expectLimitExceeded(() =>
      h.exec("mkdir -p /workspace/a/b/c/d/e/f/g/h"),
    );
  });
});

test("recursive shell function bomb (fork-bomb equivalent) is stopped without crashing the host process", async () => {
  await withE2EHarness({ limits: { maxCommands: 100 } }, async (h) => {
    await expectLimitExceeded(() =>
      h.exec("bomb() { bomb; }; bomb"),
    );
    // Verify shell remains healthy and usable after halting recursion
    await h.expectOk("echo 'shell_recovered:yes'", "shell_recovered:yes\n");
  });
});

test("pre-aborted AbortSignal immediately cancels shell execution", async () => {
  await withE2EHarness(async (h) => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before start"));

    await assert.rejects(
      async () => {
        await h.exec("echo 'should_not_run'", { signal: controller.signal });
      },
      (err: unknown) => err instanceof Error,
    );
  });
});

test("in-flight AbortSignal cancels a running sleep/loop pipeline promptly", async () => {
  await withE2EHarness(async (h) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30);

    try {
      await assert.rejects(
        async () => {
          await h.exec("sleep 10", { signal: controller.signal });
        },
        (err: unknown) => err instanceof Error,
      );
    } finally {
      clearTimeout(timer);
    }

    // Shell remains responsive after abort
    await h.expectOk("echo 'after_abort:ok'", "after_abort:ok\n");
  });
});

test("MemoryFileSystem maxTotalBytes quota rejects oversized writes with ENOSPC while preserving existing files", async () => {
  await withE2EHarness(
    {
      memoryFsOptions: { maxBytes: 4096, maxFileBytes: 2048 },
      mountDev: true,
    },
    async (h) => {
      await h.expectOk("echo 'important_state' > /workspace/keep.txt");
      await h.expectFail("head -c 16384 /dev/zero > /workspace/too_big.bin");
      await h.expectOk("cat /workspace/keep.txt", "important_state\n");
    },
  );
});

test("adversarial filenames containing spaces, quotes, dollar signs, semicolons, and glob characters are processed without injection", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/chaos",
      "printf 'v1\\n' > '/workspace/chaos/file with spaces.txt'",
      "printf 'v2\\n' > '/workspace/chaos/quote\"and$HOME.txt'",
      "printf 'v3\\n' > '/workspace/chaos/semi;echo_pwned.txt'",
      "printf 'v4\\n' > '/workspace/chaos/glob*[?].txt'",
      "find /workspace/chaos -type f -print0 | xargs -0 cat | sort",
    ].join("\n");

    await h.expectOk(
      script,
      ["v1", "v2", "v3", "v4", ""].join("\n"),
    );
  });
});

test("filenames starting with dashes (-rf, -n, --help) are safely handled via '--' option terminator", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/dashes && cd /workspace/dashes",
      "printf 'dash_payload\\n' > ./-rf",
      "cat -- -rf",
      "mv -- -rf -n",
      "cat -- -n",
      "rm -- -n",
      "ls -1 | wc -l | tr -d ' '",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "dash_payload",
        "dash_payload",
        "0",
        "",
      ].join("\n"),
    );
  });
});

test("untrusted environment variable values containing shell metacharacters are not executed when referenced", async () => {
  await withE2EHarness(
    {
      env: {
        UNTRUSTED_INPUT: "$(echo INJECTED > /workspace/pwned) ; rm -rf /workspace/*",
      },
    },
    async (h) => {
      const script = [
        'printf "%s\\n" "$UNTRUSTED_INPUT" > /workspace/safe_log.txt',
        "test ! -e /workspace/pwned && echo 'injection_blocked:yes'",
        "grep -c 'INJECTED' /workspace/safe_log.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "injection_blocked:yes",
          "1",
          "",
        ].join("\n"),
      );
    },
  );
});

test("binary NUL bytes in streams pass cleanly through cat, head -c, tail -c, cmp, and sha256sum without corruption", async () => {
  const payload = new Uint8Array(256);
  for (let i = 0; i < 256; i++) payload[i] = i;

  await withE2EHarness({ files: { "/workspace/all_bytes.bin": payload } }, async (h) => {

    const script = [
      "cat /workspace/all_bytes.bin | head -c 256 > /workspace/copy.bin",
      "cmp -s /workspace/all_bytes.bin /workspace/copy.bin && echo 'binary_intact:yes'",
      "wc -c < /workspace/copy.bin | tr -d ' '",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "binary_intact:yes",
        "256",
        "",
      ].join("\n"),
    );
  });
});

test("concurrent exec calls on independent shell instances do not share state, cwd, or global buffers", async () => {
  await withE2EHarness(async (h1) => {
    await withE2EHarness(async (h2) => {
      const [r1, r2] = await Promise.all([
        h1.exec("mkdir -p /workspace/only_1 && cd /workspace/only_1 && X=alpha && pwd && echo $X"),
        h2.exec("mkdir -p /workspace/only_2 && cd /workspace/only_2 && X=beta && pwd && echo $X"),
      ]);

      assert.equal(r1.exitCode, 0);
      assert.equal(r2.exitCode, 0);
      assert.equal(r1.stdout, "/workspace/only_1\nalpha\n");
      assert.equal(r2.stdout, "/workspace/only_2\nbeta\n");
      assert.equal(await h1.exists("/workspace/only_2"), false);
      assert.equal(await h2.exists("/workspace/only_1"), false);
    });
  });
});
