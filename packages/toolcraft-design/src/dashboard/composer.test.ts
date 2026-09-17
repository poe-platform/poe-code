import { describe, expect, it, vi } from "vitest";
import { createComposerState, editComposer } from "./composer.js";
import type { KeypressEvent } from "./terminal.js";

const key = (name: string, flags: Partial<KeypressEvent> = {}): KeypressEvent => ({
  name, ctrl: false, meta: false, shift: false, ...flags
});

describe("dashboard queue composer", () => {
  it("moves vertically through multiline input and restores the column after a shorter line", () => {
    let state = editComposer(createComposerState("message"), key("paste", { ch: "first row\nx\nthird row" })).state;
    const up = editComposer(state, key("up"));
    expect(up.handled).toBe(true);
    expect(up.state.cursor).toBe(11);
    state = editComposer(up.state, key("up")).state;
    expect(state.cursor).toBe(9);
    state = editComposer(state, key("down")).state;
    expect(state.cursor).toBe(11);
    state = editComposer(state, key("down")).state;
    expect(state.cursor).toBe(state.text.length);
    expect(editComposer(state, key("down")).handled).toBe(true);
  });

  it("moves through wrapped input at grapheme boundaries using terminal column widths", () => {
    let state = editComposer(createComposerState("message"), key("paste", { ch: "ab界👩‍💻\nxy\n123456" })).state;
    state = editComposer(state, key("left")).state;
    state = editComposer(state, key("up"), 10).state;
    expect(state.cursor).toBe("ab界👩‍💻\nxy".length);
    state = editComposer(state, key("up"), 10).state;
    expect(state.cursor).toBe(3);
    state = editComposer(state, key("down"), 10).state;
    state = editComposer(state, key("down"), 10).state;
    expect(state.cursor).toBe(state.text.length - 1);
    const wrapped = { ...createComposerState("message"), text: "abcdefghijklmno", cursor: 13 };
    expect(editComposer(wrapped, key("up"), 5).state.cursor).toBe(8);
    expect(editComposer({ ...wrapped, cursor: 8 }, key("down"), 5).state.cursor).toBe(13);
  });

  it("resets the desired vertical column after ordinary editing or horizontal movement", () => {
    let state = editComposer(createComposerState("message"), key("paste", { ch: "first row\nx\nthird row" })).state;
    state = editComposer(state, key("up")).state;
    state = editComposer(state, key("left")).state;
    state = editComposer(state, key("up")).state;
    expect(state.cursor).toBe(0);
    state = editComposer(state, key("end")).state;
    state = editComposer(state, key("down")).state;
    state = editComposer(state, key("z", { ch: "z" })).state;
    state = editComposer(state, key("down")).state;
    expect(state.cursor).toBe(state.text.indexOf("third") + 2);
  });

  it("recalculates the desired column after resizing and keeps tabs intact", () => {
    let state = { ...createComposerState("message"), text: "abcdefghij\nklmnopqrst", cursor: 19 };
    state = editComposer(state, key("up"), 12).state;
    expect(state.cursor).toBe(8);
    state = editComposer(state, key("down"), 5).state;
    expect(state.cursor).toBe(14);
    const tabs = { ...createComposerState("message"), text: "a\tb\n1234", cursor: 7 };
    expect(editComposer(tabs, key("up"), 10).state.cursor).toBe(2);
  });

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
