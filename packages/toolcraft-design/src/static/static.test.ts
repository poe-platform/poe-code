import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";
import { renderMenu } from "./menu.js";
import { SPINNER_FRAMES, renderSpinnerFrame, renderSpinnerStopped } from "./spinner.js";

function restoreEnv(name: "FORCE_COLOR" | "NO_COLOR", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("static/menu", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  const options = [
    { value: "claude", label: "Claude Code", hint: "Recommended" },
    { value: "codex", label: "Codex CLI" }
  ];

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("renders terminal menu unchanged", () => {
    const output = withOutputFormat("terminal", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 0
      })
    );

    expect(output).toContain("\x1b[36m◆\x1b[0m  Pick an agent:");
    expect(output).toContain("\x1b[90m│\x1b[0m  \x1b[36m◆\x1b[0m ");
    expect(output).toContain("\x1b[90m│\x1b[0m  \x1b[90m○\x1b[0m Codex CLI");
  });

  it("renders markdown menu output", () => {
    const output = withOutputFormat("markdown", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 0
      })
    );

    expect(output).toBe(["**Pick an agent:**", "- [x] Claude Code", "- [ ] Codex CLI"].join("\n"));
  });

  it("keeps markdown menu options on their own rows", () => {
    const output = withOutputFormat("markdown", () =>
      renderMenu({
        message: "Pick an agent:",
        options: [{ value: "safe", label: "Safe\n- [x] Forged" }],
        selectedIndex: 0
      })
    );

    expect(output).toBe(["**Pick an agent:**", "- [x] Safe - [x] Forged"].join("\n"));
  });

  it("renders json menu output", () => {
    const output = withOutputFormat("json", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 1
      })
    );

    expect(output).toBe(
      JSON.stringify({
        type: "menu",
        message: "Pick an agent:",
        options,
        selected: 1
      })
    );
  });

  it("rejects a non-finite menu selection index", () => {
    expect(() =>
      withOutputFormat("json", () =>
        renderMenu({ message: "Pick an agent:", options, selectedIndex: Number.NaN })
      )
    ).toThrow("selectedIndex must be a finite integer");
  });
});

describe("static/spinner", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("renders terminal spinner frame and stopped output unchanged", () => {
    const frame = withOutputFormat("terminal", () =>
      renderSpinnerFrame({ frame: 1, message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("terminal", () =>
      renderSpinnerStopped({
        message: "Done",
        timer: "2s",
        subtext: "Finished"
      })
    );

    expect(frame).toBe("\x1b[35m◐\x1b[0m  Loading\x1b[2m [1s]\x1b[0m\n\x1b[90m│\x1b[0m");
    expect(stopped).toBe(
      "\x1b[32m◆\x1b[0m  Done\x1b[2m [2s]\x1b[0m\n\x1b[90m│\x1b[0m     \x1b[2mFinished\x1b[0m"
    );
  });

  it("cycles negative terminal spinner frame indexes", () => {
    const frame = withOutputFormat("terminal", () =>
      renderSpinnerFrame({ frame: -1, message: "Loading" })
    );

    expect(frame).toContain("◑");
    expect(frame).not.toContain("undefined");
  });

  it("prevents exported spinner frames from changing terminal renders", () => {
    const originalFrame = SPINNER_FRAMES[0];

    try {
      expect(Reflect.set(SPINNER_FRAMES, "0", "UNTRUSTED")).toBe(false);

      const frame = withOutputFormat("terminal", () =>
        renderSpinnerFrame({ frame: 0, message: "Loading" })
      );

      expect(frame).toContain(originalFrame);
      expect(frame).not.toContain("UNTRUSTED");
    } finally {
      Reflect.set(SPINNER_FRAMES, "0", originalFrame);
    }
  });

  it("renders markdown spinner output", () => {
    const frame = withOutputFormat("markdown", () =>
      renderSpinnerFrame({ message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("markdown", () =>
      renderSpinnerStopped({ message: "Done", timer: "2s", subtext: "Ignored" })
    );

    expect(frame).toBe("- Loading [1s]...\n");
    expect(stopped).toBe("- Done [2s]\n");
  });

  it("keeps stopped markdown spinner messages in one item", () => {
    const stopped = withOutputFormat("markdown", () =>
      renderSpinnerStopped({ message: "Done\n- **error:** deploy failed", code: 0 })
    );

    expect(stopped).toBe("- Done - **error:** deploy failed\n");
  });

  it("keeps running markdown spinner messages in one item", () => {
    const frame = withOutputFormat("markdown", () =>
      renderSpinnerFrame({ message: "Uploading\n- injected item", timer: "1s\n- forged" })
    );

    expect(frame).toBe("- Uploading - injected item [1s - forged]...\n");
  });

  it("renders json spinner output", () => {
    const frame = withOutputFormat("json", () =>
      renderSpinnerFrame({ message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("json", () =>
      renderSpinnerStopped({ message: "Done", timer: "2s" })
    );

    expect(frame).toBe(
      `${JSON.stringify({
        type: "spinner",
        state: "running",
        message: "Loading",
        timer: "1s"
      })}\n`
    );
    expect(stopped).toBe(
      `${JSON.stringify({
        type: "spinner",
        state: "stopped",
        message: "Done",
        code: 0,
        timer: "2s"
      })}\n`
    );
  });

  it("preserves stopped spinner failures in json output", () => {
    const stopped = withOutputFormat("json", () =>
      renderSpinnerStopped({ message: "Failed", code: 17, subtext: "command failed" })
    );

    expect(JSON.parse(stopped)).toEqual({
      type: "spinner",
      state: "stopped",
      message: "Failed",
      code: 17,
      subtext: "command failed"
    });
  });
});
