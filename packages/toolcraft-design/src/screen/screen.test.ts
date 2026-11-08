import { describe, expect, it } from "vitest";
import { Screen } from "./screen.js";
import { packStyle } from "./style.js";

describe("Screen", () => {
  it("emits only changed cells and coalesces adjacent cells into one run", () => {
    const screen = new Screen({ cols: 10, rows: 2 }, { colors: true });
    screen.text(2, 0, "abc", packStyle({ bold: true, fg: 2 }));
    const first = screen.flush();
    expect(first).toContain("\u001b[1;3H");
    expect(first).toContain("abc");
    expect(first.match(/\u001b\[/g)?.length).toBe(2); // cursor + SGR
    screen.text(2, 0, "abc", packStyle({ bold: true, fg: 2 }));
    expect(screen.flush()).toBe("");

    screen.text(2, 0, "axc", packStyle({ bold: true, fg: 2 }));
    const second = screen.flush();
    expect(second).toContain("\u001b[1;4H");
    expect(second).toContain("x");
    expect(second).not.toContain("abc");
  });

  it("invalidates the neighbor when overwriting a wide grapheme", () => {
    const screen = new Screen({ cols: 5, rows: 1 });
    screen.text(1, 0, "🙂");
    screen.flush();
    screen.cell(1, 0, "a");
    const output = screen.flush();
    expect(output).toContain("a ");
  });

  it("keeps a cursor-only frame far below the full-screen byte budget", () => {
    const screen = new Screen({ cols: 200, rows: 50 });
    screen.cell(0, 0, ">");
    screen.flush();
    screen.cell(0, 0, " ");
    screen.cell(0, 1, ">");
    expect(Buffer.byteLength(screen.flush())).toBeLessThan(2_000);
  });
});
