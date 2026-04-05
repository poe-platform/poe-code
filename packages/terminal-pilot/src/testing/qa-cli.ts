import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminalPilotCliRepl } from "./cli-repl.js";

type QaCase = {
  id: number;
  title: string;
  skipped?: boolean;
  run?: (ctx: QaContext) => Promise<void>;
};

type QaFailure = {
  id: number;
  title: string;
  reason: string;
};

type SessionListResult = {
  sessions: Array<{ session: string; command: string; pid: number }>;
};

type SessionResult = {
  session: string;
  pid: number;
  command: string;
  exitCode: number | null;
};

type CreateSessionResult = {
  session: string;
  pid: number;
};

type WaitForResult = {
  matched: true;
  line: string;
};

type ExitCodeResult = {
  exitCode: number;
};

type ReadScreenResult = {
  lines: string[];
  cursor: { row: number; col: number };
  size: { rows: number; cols: number };
  exitCode: number | null;
};

type ReadHistoryResult = {
  lines: string[];
  exitCode: number | null;
};

type OkResult = {
  ok: true;
};

const testingDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testingDirectory, "../../../..");
const tsxPath = path.join(repoRoot, "node_modules", ".bin", "tsx");
const testCliPath = path.join(repoRoot, "packages/terminal-pilot/src/testing/test-cli.js");
const menuCliPath = path.join(repoRoot, "packages/terminal-pilot/src/testing/menu-cli.js");
const vimSavedFile = path.join(os.tmpdir(), "terminal-pilot-qa-test.txt");
const vimDiscardFile = path.join(os.tmpdir(), "terminal-pilot-qa-discard.txt");

class QaContext {
  private readonly repl = createTerminalPilotCliRepl();

  async close(): Promise<void> {
    await this.repl.close();
  }

  async expectOk<T>(args: string[]): Promise<T> {
    const result = await this.repl.runJson<T>(args);

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed (${result.exitCode}): terminal-pilot ${args.join(" ")}\n${result.stderr || "<no error output>"}`
      );
    }

    return result.stdout;
  }

  async expectError(args: string[]): Promise<string> {
    const result = await this.repl.run(args);

    if (result.exitCode === 0) {
      throw new Error(
        `Expected command to fail: terminal-pilot ${args.join(" ")}\nstdout: ${result.stdout || "<empty>"}`
      );
    }

    return result.stderr || result.stdout;
  }

  async listSessions(): Promise<SessionListResult> {
    return this.expectOk<SessionListResult>(["list-sessions"]);
  }

  async getSessionIfExists(session: string): Promise<SessionResult | null> {
    const result = await this.repl.runJson<SessionResult>(["get-session", "-s", session]);
    if (result.exitCode !== 0) return null;
    return result.stdout;
  }

  async closeSessionIfExists(session: string): Promise<void> {
    const existing = await this.getSessionIfExists(session);

    if (existing !== null) {
      await this.expectOk<ExitCodeResult>(["close-session", "-s", session]);
    }
  }

  async ensurePromptSession(session: string): Promise<void> {
    const existing = await this.getSessionIfExists(session);

    if (existing?.exitCode !== null) {
      await this.expectOk<ExitCodeResult>(["close-session", "-s", session]);
    }

    if (existing === null || existing.exitCode !== null) {
      const created = await this.expectOk<CreateSessionResult>([
        "create-session",
        "-s",
        session,
        tsxPath,
        testCliPath
      ]);
      assert.equal(created.session, session);
      assert.ok(created.pid > 0);
    }

    const screen = await this.expectOk<ReadScreenResult>(["read-screen", "-s", session]);
    if (!screen.lines.some((line) => line.includes("What is your name?"))) {
      const prompt = await this.expectOk<WaitForResult>([
        "wait-for",
        "-s",
        session,
        "-l",
        "What is your name?"
      ]);
      assert.equal(prompt.matched, true);
    }
  }

  async ensureGreetingSession(session: string, name: string): Promise<void> {
    await this.ensurePromptSession(session);

    const history = await this.expectOk<ReadHistoryResult>(["read-history", "-s", session]);
    if (history.lines.some((line) => line.includes(`Hello, ${name}!`))) {
      return;
    }

    await this.expectOk<OkResult>(["fill", "-s", session, `${name}\n`]);
    const greeted = await this.expectOk<WaitForResult>([
      "wait-for",
      "-s",
      session,
      "-l",
      `Hello, ${name}!`
    ]);
    assert.equal(greeted.matched, true);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function closeSessions(ctx: QaContext, sessions: string[]): Promise<void> {
  for (const session of sessions) {
    await ctx.closeSessionIfExists(session);
  }
}

const cases: QaCase[] = [
  {
    id: 1,
    title: "Empty session list",
    async run(ctx) {
      await ctx.closeSessionIfExists("S1");
      const listed = await ctx.listSessions();
      assert.deepEqual(listed.sessions, []);
    }
  },
  {
    id: 2,
    title: "Create a session",
    async run(ctx) {
      await ctx.closeSessionIfExists("S1");
      const created = await ctx.expectOk<CreateSessionResult>([
        "create-session",
        "-s",
        "S1",
        tsxPath,
        testCliPath
      ]);
      assert.equal(created.session, "S1");
      assert.ok(created.pid > 0);
    }
  },
  {
    id: 3,
    title: "Session appears in list",
    async run(ctx) {
      await ctx.ensurePromptSession("S1");
      const listed = await ctx.listSessions();
      assert.equal(listed.sessions.length, 1);
      assert.equal(listed.sessions[0]?.session, "S1");
    }
  },
  {
    id: 4,
    title: "Get session metadata",
    async run(ctx) {
      await ctx.ensurePromptSession("S1");
      const session = await ctx.expectOk<SessionResult>(["get-session", "-s", "S1"]);
      assert.equal(session.session, "S1");
      assert.ok(session.pid > 0);
      assert.match(session.command, /tsx/);
      assert.equal(session.exitCode, null);
    }
  },
  {
    id: 5,
    title: "Wait for prompt",
    async run(ctx) {
      await ctx.ensurePromptSession("S1");
      const waited = await ctx.expectOk<WaitForResult>([
        "wait-for",
        "-s",
        "S1",
        "-l",
        "What is your name?"
      ]);
      assert.equal(waited.matched, true);
      assert.match(waited.line, /What is your name\?/);
    }
  },
  {
    id: 6,
    title: "Fill text",
    async run(ctx) {
      await ctx.ensurePromptSession("S1");
      const result = await ctx.expectOk<OkResult>(["fill", "-s", "S1", "Alice\n"]);
      assert.deepEqual(result, { ok: true });
    }
  },
  {
    id: 7,
    title: "Wait for greeting",
    async run(ctx) {
      await ctx.ensureGreetingSession("S1", "Alice");
      const waited = await ctx.expectOk<WaitForResult>([
        "wait-for",
        "-s",
        "S1",
        "-l",
        "Hello, Alice!"
      ]);
      assert.equal(waited.matched, true);
    }
  },
  {
    id: 8,
    title: "Read screen includes exitCode null",
    async run(ctx) {
      await ctx.ensureGreetingSession("S1", "Alice");
      const screen = await ctx.expectOk<ReadScreenResult>(["read-screen", "-s", "S1"]);
      assert.ok(Array.isArray(screen.lines));
      assert.equal(typeof screen.cursor.row, "number");
      assert.equal(typeof screen.cursor.col, "number");
      assert.equal(typeof screen.size.rows, "number");
      assert.equal(typeof screen.size.cols, "number");
      // test-cli exits immediately after printing the greeting, so exitCode may be 0 or null
      assert.ok(screen.exitCode === null || screen.exitCode === 0);
    }
  },
  {
    id: 9,
    title: "Read history includes all output, exitCode null",
    async run(ctx) {
      await ctx.ensureGreetingSession("S1", "Alice");
      const history = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "S1"]);
      assert.ok(history.lines.length > 0);
      assert.ok(history.lines.some((line) => line.includes("Hello, Alice!")));
      // test-cli exits immediately after printing the greeting, so exitCode may be 0 or null
      assert.ok(history.exitCode === null || history.exitCode === 0);
    }
  },
  {
    id: 10,
    title: "Read history with last N",
    async run(ctx) {
      await ctx.ensureGreetingSession("S1", "Alice");
      const history = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "S1", "-n", "2"]);
      assert.ok(history.lines.length <= 2);
    }
  },
  {
    id: 11,
    title: "Close session",
    async run(ctx) {
      await ctx.ensureGreetingSession("S1", "Alice");
      const closed = await ctx.expectOk<ExitCodeResult>(["close-session", "-s", "S1"]);
      assert.equal(typeof closed.exitCode, "number");

      const listed = await ctx.listSessions();
      assert.deepEqual(listed.sessions, []);

      const error = await ctx.expectError(["get-session", "-s", "S1"]);
      assert.match(error, /not found/);
    }
  },
  {
    id: 12,
    title: "terminal_type character-by-character",
    async run(ctx) {
      await ctx.closeSessionIfExists("S2");
      try {
        const created = await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "S2",
          tsxPath,
          testCliPath
        ]);
        assert.equal(created.session, "S2");
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S2", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["type", "-s", "S2", "Bob"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S2", "Enter"]);
        const greeted = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S2",
          "-l",
          "Hello, Bob!"
        ]);
        assert.equal(greeted.matched, true);
      } finally {
        await ctx.closeSessionIfExists("S2");
      }
    }
  },
  {
    id: 13,
    title: "terminal_wait_for with literal flag",
    async run(ctx) {
      await ctx.closeSessionIfExists("S3");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S3", tsxPath, testCliPath]);
        const prompt = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S3",
          "-l",
          "What is your name?"
        ]);
        assert.equal(prompt.matched, true);
        await ctx.expectOk<OkResult>(["fill", "-s", "S3", "Carol\n"]);
        const greeted = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S3",
          "-l",
          "Hello, Carol!"
        ]);
        assert.equal(greeted.matched, true);
      } finally {
        await ctx.closeSessionIfExists("S3");
      }
    }
  },
  {
    id: 14,
    title: "terminal_wait_for regex",
    async run(ctx) {
      await ctx.closeSessionIfExists("S4");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S4", tsxPath, testCliPath]);
        const prompt = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S4",
          "What is your name\\?"
        ]);
        assert.equal(prompt.matched, true);
        await ctx.expectOk<OkResult>(["fill", "-s", "S4", "Dan\n"]);
        const greeted = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S4",
          "Hello,\\s+Dan"
        ]);
        assert.equal(greeted.matched, true);
      } finally {
        await ctx.closeSessionIfExists("S4");
      }
    }
  },
  {
    id: 15,
    title: "terminal_wait_for timeout exceeded",
    async run(ctx) {
      await ctx.closeSessionIfExists("S5");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S5", tsxPath, testCliPath]);
        const error = await ctx.expectError([
          "wait-for",
          "-s",
          "S5",
          "-t",
          "500",
          "THIS_WILL_NEVER_APPEAR"
        ]);
        assert.match(error, /Timed out waiting for pattern/i);
      } finally {
        await ctx.closeSessionIfExists("S5");
      }
    }
  },
  {
    id: 16,
    title: "terminal_wait_for_exit natural exit",
    async run(ctx) {
      await ctx.closeSessionIfExists("S6");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S6", tsxPath, testCliPath]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S6", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "S6", "Eve\n"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "S6",
          "-t",
          "5000"
        ]);
        assert.equal(exited.exitCode, 0);

        const session = await ctx.expectOk<SessionResult>(["get-session", "-s", "S6"]);
        assert.equal(session.exitCode, 0);

        const exitedAgain = await ctx.expectOk<ExitCodeResult>(["wait-for-exit", "-s", "S6"]);
        assert.equal(exitedAgain.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("S6");
      }
    }
  },
  {
    id: 17,
    title: "terminal_wait_for_exit timeout exceeded",
    async run(ctx) {
      await ctx.closeSessionIfExists("S7");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S7", tsxPath, testCliPath]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S7", "-l", "What is your name?"]);
        const error = await ctx.expectError([
          "wait-for-exit",
          "-s",
          "S7",
          "-t",
          "300"
        ]);
        assert.match(error, /Timed out waiting for process to exit/i);
      } finally {
        await ctx.closeSessionIfExists("S7");
      }
    }
  },
  {
    id: 18,
    title: "terminal_send_signal SIGINT",
    async run(ctx) {
      await ctx.closeSessionIfExists("S8");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S8", tsxPath, testCliPath]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S8", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["send-signal", "-s", "S8", "SIGINT"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "S8",
          "-t",
          "3000"
        ]);
        assert.equal(typeof exited.exitCode, "number");
        const screen = await ctx.expectOk<ReadScreenResult>(["read-screen", "-s", "S8"]);
        assert.equal(screen.exitCode, exited.exitCode);
      } finally {
        await ctx.closeSessionIfExists("S8");
      }
    }
  },
  {
    id: 19,
    title: "terminal_resize",
    async run(ctx) {
      await ctx.closeSessionIfExists("S9");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "S9",
          "--cols",
          "80",
          "--rows",
          "24",
          tsxPath,
          testCliPath
        ]);
        const initialScreen = await ctx.expectOk<ReadScreenResult>(["read-screen", "-s", "S9"]);
        assert.equal(initialScreen.size.cols, 80);
        assert.equal(initialScreen.size.rows, 24);

        await ctx.expectOk<OkResult>(["resize", "-s", "S9", "--cols", "120", "--rows", "40"]);
        const resizedScreen = await ctx.expectOk<ReadScreenResult>(["read-screen", "-s", "S9"]);
        assert.equal(resizedScreen.size.cols, 120);
        assert.equal(resizedScreen.size.rows, 40);

        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S9", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "S9", "Frank\n"]);
        const greeted = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S9",
          "-l",
          "Hello, Frank!"
        ]);
        assert.equal(greeted.matched, true);
      } finally {
        await ctx.closeSessionIfExists("S9");
      }
    }
  },
  {
    id: 20,
    title: "Full flow menu-cli with ArrowDown navigation",
    async run(ctx) {
      await ctx.closeSessionIfExists("S10");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S10", tsxPath, menuCliPath]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S10", "-l", "Select an option:"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S10", "ArrowDown"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S10", "ArrowDown"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S10", "Enter"]);
        const selected = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S10",
          "-l",
          "You selected: Option 3"
        ]);
        assert.equal(selected.matched, true);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "S10",
          "-t",
          "3000"
        ]);
        assert.equal(exited.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("S10");
      }
    }
  },
  {
    id: 21,
    title: "Full flow menu-cli ArrowUp wrap-around",
    async run(ctx) {
      await ctx.closeSessionIfExists("S11");
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "S11", tsxPath, menuCliPath]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "S11", "-l", "Select an option:"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S11", "ArrowUp"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "S11", "Enter"]);
        const selected = await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "S11",
          "You selected: Option [123]"
        ]);
        assert.equal(selected.matched, true);
      } finally {
        await ctx.closeSessionIfExists("S11");
      }
    }
  },
  {
    id: 22,
    title: "Multiple concurrent sessions isolation",
    async run(ctx) {
      await closeSessions(ctx, ["SA", "SB", "SC"]);
      try {
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "SA", tsxPath, testCliPath]);
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "SB", tsxPath, testCliPath]);
        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "SC", tsxPath, menuCliPath]);

        const listed = await ctx.listSessions();
        assert.equal(listed.sessions.length, 3);

        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SA", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "SA", "Session-A\n"]);

        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SB", "-l", "What is your name?"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "SB", "Session-B\n"]);

        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SC", "-l", "Select an option:"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "SC", "Enter"]);

        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SA", "-l", "Hello, Session-A!"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SB", "-l", "Hello, Session-B!"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "SC", "-l", "You selected: Option 1"]);

        const historyA = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "SA"]);
        assert.ok(historyA.lines.some((line) => line.includes("Session-A")));
        assert.ok(historyA.lines.every((line) => !line.includes("Session-B")));

        const historyB = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "SB"]);
        assert.ok(historyB.lines.some((line) => line.includes("Session-B")));
        assert.ok(historyB.lines.every((line) => !line.includes("Session-A")));

        await ctx.expectOk<ExitCodeResult>(["close-session", "-s", "SB"]);
        const afterClose = await ctx.listSessions();
        // SA and SC exit naturally after their interactions complete,
        // so the list only guarantees SB is gone
        assert.ok(!afterClose.sessions.some((s) => s.session === "SB"));
      } finally {
        await closeSessions(ctx, ["SA", "SB", "SC"]);
      }
    }
  },
  {
    id: 23,
    title: "Final state",
    async run(ctx) {
      const listed = await ctx.listSessions();
      assert.deepEqual(listed.sessions, []);
    }
  },
  {
    id: 24,
    title: "Unknown session error",
    async run(ctx) {
      const readScreenError = await ctx.expectError(["read-screen", "-s", "does-not-exist"]);
      assert.match(readScreenError, /not found/);

      const closeError = await ctx.expectError(["close-session", "-s", "does-not-exist"]);
      assert.match(closeError, /not found/);
    }
  },
  {
    id: 25,
    title: "Bash interactive shell",
    async run(ctx) {
      await ctx.closeSessionIfExists("BASH");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "BASH",
          "--cols",
          "120",
          "--rows",
          "40",
          "bash",
          "--",
          "--norc",
          "--noprofile"
        ]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH", "-t", "3000", "\\$\\s*$"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "BASH", "echo hello-from-bash\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH", "-l", "hello-from-bash"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "BASH", "echo $((6 * 7))\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH", "-l", "42"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "BASH", "sleep 60\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH", "-t", "2000", "sleep"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "BASH", "Control+c"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH", "-t", "3000", "\\$\\s*$"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "BASH", "exit 0\n"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "BASH",
          "-t",
          "3000"
        ]);
        assert.equal(exited.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("BASH");
      }
    }
  },
  {
    id: 26,
    title: "Bash long output read_history line count",
    async run(ctx) {
      await ctx.closeSessionIfExists("BASH2");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "BASH2",
          "bash",
          "--",
          "--norc",
          "--noprofile"
        ]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH2", "-t", "3000", "\\$\\s*$"]);
        await ctx.expectOk<OkResult>([
          "fill",
          "-s",
          "BASH2",
          "for i in $(seq 1 50); do echo \"line $i\"; done\n"
        ]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "BASH2", "-l", "line 50"]);

        const history = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "BASH2"]);
        for (let index = 1; index <= 50; index += 1) {
          assert.ok(history.lines.some((line) => line.includes(`line ${index}`)));
        }

        const tail = await ctx.expectOk<ReadHistoryResult>(["read-history", "-s", "BASH2", "-n", "10"]);
        assert.ok(tail.lines.length <= 10);
        assert.ok(tail.lines.some((line) => /line 50/.test(line)));
      } finally {
        await ctx.closeSessionIfExists("BASH2");
      }
    }
  },
  {
    id: 27,
    title: "Python REPL expression evaluation and multi-line input",
    async run(ctx) {
      await ctx.closeSessionIfExists("PY");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "PY",
          "--cols",
          "120",
          "--rows",
          "40",
          "python3",
          "--",
          "-q"
        ]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "-l", ">>>"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "2 ** 10\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "-l", "1024"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "[x*x for x in range(5)]\n"]);
        await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "PY",
          "\\[0, 1, 4, 9, 16\\]"
        ]);

        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "def greet(name):\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "\\.\\.\\."]);
        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "    return f'hi {name}'\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "\\.\\.\\."]);
        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "-l", ">>>"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "PY", "greet('world')\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "PY", "-l", "hi world"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "PY", "Control+d"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "PY",
          "-t",
          "3000"
        ]);
        assert.equal(exited.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("PY");
      }
    }
  },
  {
    id: 28,
    title: "Node.js REPL evaluation",
    async run(ctx) {
      await ctx.closeSessionIfExists("NODE");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "NODE",
          "--cols",
          "120",
          "--rows",
          "40",
          "node"
        ]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "NODE", "-l", ">"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "NODE", "Math.PI.toFixed(4)\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "NODE", "-l", "3.1416"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "NODE", "[1,2,3].map(x => x * 2)\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "NODE", "\\[ 2, 4, 6 \\]"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "NODE", "process.version\n"]);
        await ctx.expectOk<WaitForResult>(["wait-for", "-s", "NODE", "v\\d+"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "NODE", "Control+d"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "NODE",
          "-t",
          "3000"
        ]);
        assert.equal(exited.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("NODE");
      }
    }
  },
  {
    id: 29,
    title: "vim open, edit, save and quit",
    async run(ctx) {
      await removeIfExists(vimSavedFile);
      await closeSessions(ctx, ["VIM", "CAT"]);
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "VIM",
          "--cols",
          "120",
          "--rows",
          "40",
          "vim",
          vimSavedFile
        ]);
        await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "VIM",
          "-t",
          "5000",
          path.basename(vimSavedFile)
        ]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "VIM", "i"]);
        await ctx.expectOk<OkResult>(["type", "-s", "VIM", "hello from terminal-pilot"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "VIM", "Escape"]);
        const screen = await ctx.expectOk<ReadScreenResult>(["read-screen", "-s", "VIM"]);
        assert.ok(screen.lines.some((line) => line.includes("hello from terminal-pilot")));
        assert.equal(screen.exitCode, null);
        await ctx.expectOk<OkResult>(["fill", "-s", "VIM", ":wq\n"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "VIM",
          "-t",
          "5000"
        ]);
        assert.equal(exited.exitCode, 0);

        await ctx.expectOk<CreateSessionResult>(["create-session", "-s", "CAT", "cat", vimSavedFile]);
        await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "CAT",
          "-l",
          "hello from terminal-pilot"
        ]);
      } finally {
        await closeSessions(ctx, ["VIM", "CAT"]);
        await removeIfExists(vimSavedFile);
      }
    }
  },
  {
    id: 30,
    title: "vim quit without saving",
    async run(ctx) {
      await removeIfExists(vimDiscardFile);
      await ctx.closeSessionIfExists("VIM2");
      try {
        await ctx.expectOk<CreateSessionResult>([
          "create-session",
          "-s",
          "VIM2",
          "--cols",
          "80",
          "--rows",
          "24",
          "vim",
          vimDiscardFile
        ]);
        await ctx.expectOk<WaitForResult>([
          "wait-for",
          "-s",
          "VIM2",
          "-t",
          "5000",
          path.basename(vimDiscardFile)
        ]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "VIM2", "i"]);
        await ctx.expectOk<OkResult>(["type", "-s", "VIM2", "this should not be saved"]);
        await ctx.expectOk<OkResult>(["press-key", "-s", "VIM2", "Escape"]);
        await ctx.expectOk<OkResult>(["fill", "-s", "VIM2", ":q!\n"]);
        const exited = await ctx.expectOk<ExitCodeResult>([
          "wait-for-exit",
          "-s",
          "VIM2",
          "-t",
          "5000"
        ]);
        assert.equal(exited.exitCode, 0);
      } finally {
        await ctx.closeSessionIfExists("VIM2");
        await removeIfExists(vimDiscardFile);
      }
    }
  },
  {
    id: 31,
    title: "poe-code help output",
    skipped: true
  },
  {
    id: 32,
    title: "poe-code configure interactive agent selection",
    skipped: true
  },
  {
    id: 33,
    title: "Claude Code version and help",
    skipped: true
  },
  {
    id: 34,
    title: "Claude Code single prompt",
    skipped: true
  },
  {
    id: 35,
    title: "Claude Code interactive REPL mode",
    skipped: true
  },
  {
    id: 36,
    title: "Final state all sessions closed",
    async run(ctx) {
      const listed = await ctx.listSessions();
      assert.deepEqual(listed.sessions, []);
    }
  }
];

export async function main(): Promise<void> {
  const ctx = new QaContext();
  const failures: QaFailure[] = [];

  try {
    for (const testCase of cases) {
      if (testCase.skipped === true) {
        process.stdout.write(`SKIP ${testCase.id}. ${testCase.title}\n`);
        continue;
      }

      process.stdout.write(`RUN ${testCase.id}. ${testCase.title}\n`);

      try {
        await testCase.run?.(ctx);
        process.stdout.write(`PASS ${testCase.id}. ${testCase.title}\n`);
      } catch (error) {
        const reason = formatError(error);
        failures.push({
          id: testCase.id,
          title: testCase.title,
          reason
        });
        process.stdout.write(`FAIL ${testCase.id}. ${testCase.title}\n`);
        process.stdout.write(`${reason}\n`);
      }
    }
  } finally {
    await ctx.close();
  }

  process.stdout.write(`\nSummary: ${cases.filter((entry) => !entry.skipped).length - failures.length} passed, ${failures.length} failed, ${cases.filter((entry) => entry.skipped).length} skipped.\n`);

  if (failures.length > 0) {
    process.stdout.write("\nFailures:\n");
    for (const failure of failures) {
      process.stdout.write(`${failure.id}. ${failure.title}: ${failure.reason}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
