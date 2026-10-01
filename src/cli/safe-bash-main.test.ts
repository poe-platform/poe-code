import { pickRuntimeOptions } from "./commands/runtime-options.js";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-platform/safe-bash";
import { parseSafeBashCliArgs, runSafeBashCli } from "./safe-bash-main.js";

describe("safe-bash CLI and workspace backend", () => {
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
});
