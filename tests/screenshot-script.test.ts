import { describe, it, expect, vi, afterEach } from "vitest";

import {
  buildScreenshotOutputPath,
  buildCommandHeader,
  buildColorEnv,
  buildSpawnSpec,
  createTimeout,
  ensureBinaryAvailable,
  resolveScreenshotTarget,
  sanitizeOutputChunk
} from "../scripts/screenshot.ts";

describe("buildScreenshotOutputPath", () => {
  it("creates a filename from args", () => {
    expect(buildScreenshotOutputPath(["login", "--help"])).toBe(
      "screenshots/login-help.png"
    );
  });

  it("strips leading dashes from each arg", () => {
    expect(buildScreenshotOutputPath(["--help"])).toBe(
      "screenshots/help.png"
    );
  });

  it("replaces spaces in args with dashes", () => {
    expect(buildScreenshotOutputPath(["setup", "foo bar"])).toBe(
      "screenshots/setup-foo-bar.png"
    );
  });

  it("falls back to a default name when args are empty", () => {
    expect(buildScreenshotOutputPath([])).toBe(
      "screenshots/screenshot.png"
    );
  });
});

describe("resolveScreenshotTarget", () => {
  it("builds a poe-code command when flagged", () => {
    const target = resolveScreenshotTarget(["--poe-code", "login", "--help"]);
    expect(target.command).toBe("npm");
    expect(target.args).toEqual([
      "run",
      "dev",
      "--silent",
      "--",
      "login",
      "--help"
    ]);
    expect(target.displayCommand).toBe("poe-code");
    expect(target.displayArgs).toEqual(["login", "--help"]);
    expect(buildScreenshotOutputPath(target.nameArgs)).toBe(
      "screenshots/login-help.png"
    );
  });

  it("uses the first arg as the command for arbitrary screenshots", () => {
    const target = resolveScreenshotTarget(["ls", "-l"]);
    expect(target.command).toBe("ls");
    expect(target.args).toEqual(["-l"]);
    expect(target.displayCommand).toBe("ls");
    expect(target.displayArgs).toEqual(["-l"]);
    expect(buildScreenshotOutputPath(target.nameArgs)).toBe(
      "screenshots/ls-l.png"
    );
  });

  it("requires a command when not using poe-code mode", () => {
    expect(() => resolveScreenshotTarget([])).toThrow(
      "Provide a command to screenshot."
    );
  });
});

describe("buildCommandHeader", () => {
  it("renders the command with a prompt marker", () => {
    expect(buildCommandHeader("poe-code", ["--help"])).toBe(
      "% poe-code --help\n"
    );
  });

  it("quotes args that contain spaces", () => {
    expect(
      buildCommandHeader("poe-code", ["query", "What is 2+2?"])
    ).toBe('% poe-code query "What is 2+2?"\n');
  });
});

describe("buildSpawnSpec", () => {
  it("adds the force-tty hook for poe-code commands", () => {
    const target = resolveScreenshotTarget([
      "--poe-code",
      "configure",
      "claude"
    ]);
    const spec = buildSpawnSpec(
      target,
      { NODE_OPTIONS: "--trace-warnings" },
      "/tmp/force-tty.cjs"
    );
    expect(spec.command).toBe("npm");
    expect(spec.args).toEqual([
      "run",
      "dev",
      "--silent",
      "--",
      "configure",
      "claude"
    ]);
    expect(spec.env.NODE_OPTIONS).toBe(
      "--trace-warnings --require /tmp/force-tty.cjs"
    );
  });

  it("does not inject the hook for arbitrary commands", () => {
    const target = resolveScreenshotTarget(["ls", "-l"]);
    const spec = buildSpawnSpec(
      target,
      { NODE_OPTIONS: "--trace-warnings" },
      "/tmp/force-tty.cjs"
    );
    expect(spec.command).toBe("ls");
    expect(spec.args).toEqual(["-l"]);
    expect(spec.env.NODE_OPTIONS).toBe("--trace-warnings");
  });
});

describe("sanitizeOutputChunk", () => {
  it("converts backspace to a cursor-left escape", () => {
    expect(sanitizeOutputChunk("foo\bbar")).toBe("foo\u001b[Dbar");
  });

  it("preserves escape sequences", () => {
    const text = "\u001b[31mred\u001b[0m";
    expect(sanitizeOutputChunk(text)).toBe(text);
  });

  it("keeps newlines and carriage returns", () => {
    const text = "line1\r\nline2\n";
    expect(sanitizeOutputChunk(text)).toBe(text);
  });
});

describe("buildColorEnv", () => {
  it("forces color output and removes NO_COLOR", () => {
    const env = buildColorEnv({ NO_COLOR: "1", TERM: "" });
    expect(env.FORCE_COLOR).toBe("1");
    expect(env.CLICOLOR_FORCE).toBe("1");
    expect(env.TERM).toBe("xterm-256color");
    expect(Object.prototype.hasOwnProperty.call(env, "NO_COLOR")).toBe(
      false
    );
  });

  it("keeps an existing TERM value", () => {
    const env = buildColorEnv({ TERM: "screen-256color" });
    expect(env.TERM).toBe("screen-256color");
  });
});

describe("createTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects after the timeout and calls the timeout callback", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const { promise } = createTimeout(5000, onTimeout);
    const rejection = expect(promise).rejects.toThrow(
      "Timed out after 5000ms"
    );
    await vi.runAllTimersAsync();
    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe("ensureBinaryAvailable", () => {
  it("throws with a brew install hint when missing", () => {
    expect(() =>
      ensureBinaryAvailable(
        "definitely-not-a-binary",
        "brew install charmbracelet/tap/freeze"
      )
    ).toThrow("brew install charmbracelet/tap/freeze");
  });

  it("does not throw when the binary exists", () => {
    expect(() =>
      ensureBinaryAvailable(
        process.execPath,
        "brew install charmbracelet/tap/freeze"
      )
    ).not.toThrow();
  });
});
