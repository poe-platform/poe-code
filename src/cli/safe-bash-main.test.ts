import { pickRuntimeOptions } from "./commands/runtime-options.js";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-platform/safe-bash";
import { parseSafeBashCliArgs, runSafeBashCli } from "./safe-bash-main.js";

describe("safe-bash CLI and workspace backend", () => {
  it("persists writes through both macOS temporary-directory aliases across invocations", async () => {
    const workspaceBackend = new MemoryFileSystem();
    for (const workspaceRoot of ["/private/tmp/project", "/tmp/project"]) {
      const options = { workspaceRoot, cwd: workspaceRoot, workspaceBackend, homeDir: "/Users/test" };
      expect(await runSafeBashCli(["-c", "printf persisted > /tmp/project/value.txt"], options)).toBe(0);
      const output: Uint8Array[] = [];
      expect(await runSafeBashCli(["-c", "cat /private/tmp/project/value.txt"], {
        ...options,
        stdout: (bytes) => { output.push(bytes); }
      })).toBe(0);
      expect(Buffer.concat(output).toString()).toBe("persisted");
      expect(new TextDecoder().decode(await workspaceBackend.readFile("/value.txt"))).toBe("persisted");
    }
  });

  it.each([
    ["sed in-place mutation", "sed -i 's/before/after/' value.txt && cat value.txt", "after\n"],
    ["diff ancestry", "diff -u value.txt value.txt", ""],
    ["rg parent capabilities", "rg --files", "value.txt\n"],
    ["exec builtin", "exec /bin/bash -c 'printf snapshot-ok'; printf unreachable", "snapshot-ok"],
    ["snapshot wrapper", "__CODEX_SNAPSHOT_OVERRIDE_SET_0=1\nexec /Users/test/.local/bin/safe-bash-bin/bash -c 'printf snapshot-ok'", "snapshot-ok"]
  ])("supports %s under a nested temporary mount", async (_name, command, expected) => {
    const workspaceBackend = new MemoryFileSystem();
    await workspaceBackend.writeFile("/value.txt", new TextEncoder().encode("before\n"));
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const status = await runSafeBashCli(["-lc", command], {
      workspaceRoot: "/private/tmp/project",
      cwd: "/private/tmp/project",
      homeDir: "/Users/test",
      workspaceBackend,
      stdout: (bytes) => { stdout.push(bytes); },
      stderr: (bytes) => { stderr.push(bytes); }
    });
    expect(Buffer.concat(stderr).toString()).toBe("");
    expect(status).toBe(0);
    expect(Buffer.concat(stdout).toString()).toBe(expected);
  });

  it("keeps --safe-bash strictly opt-in in CLI runtime options", () => {
    expect(pickRuntimeOptions({})).toEqual({});
    expect(pickRuntimeOptions({ safeBash: false })).toEqual({});
    expect(pickRuntimeOptions({ safeBash: true })).toEqual({ safeBash: true });
  });

  it("parses standard shell invocation flags (-c, -lc, -ic, -l -c, --workspace)", () => {
    expect(parseSafeBashCliArgs(["-c", "echo hi"])).toEqual({
      command: "echo hi",
      positionals: []
    });

    expect(parseSafeBashCliArgs(["-lc", "git status"])).toEqual({
      command: "git status",
      positionals: []
    });

    expect(parseSafeBashCliArgs(["-l", "-c", "pwd", "safe-bash", "arg1", "arg2"])).toEqual({
      command: "pwd",
      positionals: ["arg1", "arg2"]
    });

    expect(
      parseSafeBashCliArgs(["--workspace", "/repo/work", "--cwd", "/repo/work/sub", "-lc", "ls"])
    ).toEqual({
      command: "ls",
      positionals: [],
      workspaceRoot: "/repo/work",
      cwd: "/repo/work/sub"
    });
  });

  it("carries over parent environment variables (e.g. from Codex) into the shell", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const outChunks: Uint8Array[] = [];

    const exitCode = await runSafeBashCli(
      ["-lc", 'printf "%s|%s|%s" "$CODEX_THREAD_ID" "$CUSTOM_VAR" "$PWD"'],
      {
        workspaceRoot: "/workspace/project",
        cwd: "/workspace/project",
        homeDir: "/Users/test",
        workspaceBackend,
        env: {
          CODEX_THREAD_ID: "thr_codex_123",
          CUSTOM_VAR: "carried-over-value",
          HOME: "/Users/test"
        },
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("thr_codex_123|carried-over-value|/workspace/project");
  });

  it("mounts the workspace backend at the host path while isolating paths outside the workspace in memory", async () => {
    const workspaceBackend = new MemoryFileSystem();
    await workspaceBackend.writeFile("/existing.txt", new TextEncoder().encode("from-workspace\n"));

    const outChunks: Uint8Array[] = [];
    const exitCode = await runSafeBashCli(
      [
        "-lc",
        [
          "cat existing.txt",
          "cat /workspace/project/existing.txt",
          'echo "written-inside" > created.txt',
          'echo "scratch-only" > /tmp/scratch.txt',
          "cat /tmp/scratch.txt"
        ].join(" && ")
      ],
      {
        workspaceRoot: "/workspace/project",
        cwd: "/workspace/project",
        homeDir: "/Users/test",
        workspaceBackend,
        env: { HOME: "/Users/test" },
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("from-workspace\nfrom-workspace\nscratch-only\n");

    // Verify file created inside the workspace was persisted to workspaceBackend
    const createdBytes = await workspaceBackend.readFile("/created.txt");
    expect(new TextDecoder().decode(createdBytes)).toBe("written-inside\n");

    // Verify /tmp/scratch.txt was NOT written to workspaceBackend
    await expect(workspaceBackend.stat("/tmp/scratch.txt")).rejects.toThrow();
  });

  it("supports full git and git-rust workflows inside the mounted workspace backend", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const outChunks: Uint8Array[] = [];

    const exitCode = await runSafeBashCli(
      [
        "-lc",
        [
          "git init",
          'git config user.name "Codex Agent"',
          'git config user.email "codex@example.com"',
          'echo "hello safe-bash" > README.md',
          "git add README.md",
          'git commit -m "feat: initial commit"',
          "git-rust log -1 --oneline"
        ].join(" && ")
      ],
      {
        workspaceRoot: "/workspace/repo",
        cwd: "/workspace/repo",
        homeDir: "/Users/test",
        workspaceBackend,
        env: { HOME: "/Users/test" },
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("feat: initial commit");
    expect(new TextDecoder().decode(await workspaceBackend.readFile("/README.md"))).toBe(
      "hello safe-bash\n"
    );
    expect((await workspaceBackend.stat("/.git/HEAD")).type).toBe("file");
  });

  it("supports bash --version, /bin/bash --version, and nested login subshells", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const outChunks: Uint8Array[] = [];

    const exitCode = await runSafeBashCli(
      ["-lc", "command -v bash; bash --version; /bin/bash --version; /bin/bash -lc 'echo subshell-ok'"],
      {
        workspaceRoot: "/workspace/project",
        cwd: "/workspace/project",
        homeDir: "/Users/test",
        workspaceBackend,
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("bash\nsafe-bash (poe-code)\nsafe-bash (poe-code)\nsubshell-ok\n");
  });

  it("supports data (jq, yq, csvcut, sqlite3), image (magick, sips, exiftool), and video (ffmpeg, ffprobe) manipulation pipelines", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const outChunks: Uint8Array[] = [];

    const exitCode = await runSafeBashCli(
      [
        "-lc",
        [
          "printf 'region,amount\\nEU,120.5\\nNA,80.0\\nEU,79.5\\n' > sales.csv",
          "csvgrep -c region -m EU sales.csv | csvcut -c amount",
          "jq -n '[{region:\"EU\",total:200}]' | yq -P '.'",
          "magick -size 64x48 xc:#38bdf8 sample.png && identify sample.png",
          "sips -g pixelWidth sample.png",
          "ffmpeg -y -f lavfi -i testsrc=duration=1:size=64x48:rate=5 -c:v libx264 -pix_fmt yuv420p clip.mp4 && ffprobe -v quiet -print_format json -show_streams clip.mp4 | jq -r '.streams[0].codec_name'"
        ].join(" && ")
      ],
      {
        workspaceRoot: "/workspace/media",
        cwd: "/workspace/media",
        homeDir: "/Users/test",
        workspaceBackend,
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("120.5");
    expect(stdout).toContain("region: EU");
    expect(stdout).toContain("PNG 64x48");
    expect(stdout).toContain("pixelWidth: 64");
    expect(stdout).toContain("h264");
  });

  it("emits memory, CPU, and I/O telemetry for executed safe-bash commands", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const records: Array<Record<string, unknown>> = [];

    const exitCode = await runSafeBashCli(
      ["-lc", "printf 'hello-telemetry'; printf 'warn-msg\\n' >&2"],
      {
        workspaceRoot: "/workspace/telemetry",
        cwd: "/workspace/telemetry",
        homeDir: "/Users/test",
        workspaceBackend,
        stdout: () => {},
        stderr: () => {},
        onTelemetry: (record) => {
          records.push(record as unknown as Record<string, unknown>);
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      cwd: "/workspace/telemetry",
      workspaceRoot: "/workspace/telemetry",
      command: "printf 'hello-telemetry'; printf 'warn-msg\\n' >&2",
      exitCode: 0,
      stdoutBytes: 15,
      stderrBytes: 9,
      stderrPreview: "warn-msg\n"
    });
    expect(typeof records[0]?.wallMs).toBe("number");
    expect(typeof records[0]?.rssAfterMB).toBe("number");
    expect(typeof records[0]?.heapUsedAfterMB).toBe("number");
  });

  it("supports Codex shell-snapshot exec builtin, sqlite3 BEGIN TRANSACTION + .import, and exiftool -ImageDescription/-ver", async () => {
    const workspaceBackend = new MemoryFileSystem();
    const outChunks: Uint8Array[] = [];

    const exitCode = await runSafeBashCli(
      ["-lc", "exec '/bin/bash' -c 'printf \"k,v\\nA,10\\nB,20\\n\" > kv.csv && printf \"CREATE TABLE kv(k TEXT PRIMARY KEY, v INT);\\nBEGIN TRANSACTION;\\n.mode csv\\n.import --skip 1 kv.csv kv\\nCOMMIT;\\nSELECT SUM(v) FROM kv;\\n\" | sqlite3 test.db && exiftool -ver && magick -size 32x32 xc:#ef4444 card.jpg && exiftool -overwrite_original -Artist=Poe -ImageDescription=Hero card.jpg && exiftool -j card.jpg | jq -r \".[0].ImageDescription\"'"],
      {
        workspaceRoot: "/workspace/regressions",
        cwd: "/workspace/regressions",
        homeDir: "/Users/test",
        workspaceBackend,
        stdout: (bytes) => {
          outChunks.push(bytes);
        }
      }
    );

    const stdout = Buffer.concat(outChunks.map((b) => Buffer.from(b))).toString("utf8");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("30");
    expect(stdout).toContain("13.59");
    expect(stdout).toContain("Hero");
  });
});
