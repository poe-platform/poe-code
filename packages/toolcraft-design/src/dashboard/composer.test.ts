import { describe, expect, it, vi } from "vitest";
import { createComposerState, editComposer } from "./composer.js";
import type { KeypressEvent } from "./terminal.js";

const key = (name: string, flags: Partial<KeypressEvent> = {}): KeypressEvent => ({
  name, ctrl: false, meta: false, shift: false, ...flags
});

describe("dashboard queue composer", () => {
  it("queues one message at a time without treating q, p, or f as dashboard commands", () => {
    let state = createComposerState("message", "plan-1");
    state = editComposer(state, key("paste", { ch: "queue a review\nplease verify" })).state;
    const result = editComposer(state, key("return"));
    expect(result.submit).toEqual({ kind: "message", text: "queue a review\nplease verify", afterPlanId: "plan-1" });
    expect(result.state.text).toBe(state.text);
    expect(result.handled).toBe(true);
  });

  it("does not submit empty input or turn pasted newlines into submissions", () => {
    const empty = createComposerState("message");
    expect(editComposer(empty, key("return")).submit).toBeUndefined();
    const pasted = editComposer(empty, key("paste", { ch: "first\nsecond" }));
    expect(pasted.submit).toBeUndefined();
    expect(pasted.state.text).toBe("first\nsecond");
  });

  it("edits Unicode graphemes as whole characters", () => {
    let state = editComposer(createComposerState("message"), key("paste", { ch: "A👩‍💻éB" })).state;
    state = editComposer(state, key("left")).state;
    state = editComposer(state, key("backspace")).state;
    expect(state.text).toBe("A👩‍💻B");
    state = editComposer(state, key("left")).state;
    state = editComposer(state, key("delete")).state;
    expect(state.text).toBe("AB");
    state = editComposer(state, { ch: "界", ctrl: false, meta: false, shift: false }).state;
    expect(state.text).toBe("A界B");
  });

  it("preserves a draft when leaving edit mode and never consumes Ctrl+C", () => {
    const draft = editComposer(createComposerState("message"), key("paste", { ch: "Keep this draft" })).state;
    const escaped = editComposer(draft, key("escape"));
    expect(escaped.state).toMatchObject({ text: "Keep this draft", focused: false });
    expect(editComposer(draft, key("c", { ctrl: true })).handled).toBe(false);
  });

  it("supports line editing and an explicit newline without submitting", () => {
    let state = editComposer(createComposerState("message"), key("paste", { ch: "one\ntwo words" })).state;
    state = editComposer(state, key("w", { ctrl: true })).state;
    expect(state.text).toBe("one\ntwo ");
    state = editComposer(state, key("home")).state;
    expect(state.cursor).toBe(4);
    state = editComposer(state, key("k", { ctrl: true })).state;
    expect(state.text).toBe("one\n");
    const newline = editComposer(state, key("return", { meta: true }));
    expect(newline.state.text).toBe("one\n\n");
    expect(newline.submit).toBeUndefined();
  });

  it("submits plan paths separately from messages", () => {
    const draft = editComposer(createComposerState("plan"), key("paste", { ch: "docs/plans/next.md" })).state;
    expect(editComposer(draft, key("return")).submit).toEqual({ kind: "plan", text: "docs/plans/next.md" });
  });

  it("inserts text and submits a long draft without resegmenting untouched text", () => {
    const text = "Review 👩‍💻 changes\n".repeat(1000);
    const state = { ...createComposerState("message"), text, cursor: text.length };
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      const edited = editComposer(state, key("x", { ch: "x" })).state;
      expect(edited.text).toBe(text + "x");
      expect(editComposer(edited, key("return")).submit?.text).toBe(text + "x");
      expect(segment).not.toHaveBeenCalled();
    } finally { segment.mockRestore(); }
  });

  it.each([key("home"), key("u", { ctrl: true })])("keeps the cursor at the start of an empty first line: %j", (event) => {
    const state = { ...createComposerState("message"), text: "\nsecond line", cursor: 0 };
    expect(editComposer(state, event).state).toMatchObject({ text: state.text, cursor: 0 });
  });
});
