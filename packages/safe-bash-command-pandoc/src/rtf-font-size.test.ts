import {expect, it} from "vitest";
import {readRtfFontSize} from "./rtf-font-size.js";

it("preserves numeric font syntax and suffix-error precedence across reused fragments", async () => {
  const values = ["1pt", " 12 pt", "\ufeff+12.5\tpt", "-0pt", ".5pt", "1.pt", "1e1pt", "5e-1pt", "0x10pt", "0B101pt", "0o17pt",
    "+0x10pt", "-0x1pt", "00x1pt", "1 2pt", "1ept", "1e+pt", ".pt", "pt", "Infinitypt", "NaNpt", "1pt ", "1px", "16383.5pt", "16384pt",
    "0".repeat(5000) + "1pt", "1" + "0".repeat(5000) + "e-5000pt", "0." + "0".repeat(5000) + "5e5000pt", "0x" + "f".repeat(5000) + "pt",
    "1." + "0".repeat(5000) + "1pt", "1e" + "0".repeat(5000) + "1pt"];
  for (const value of values) {
    const expected = Number(value.slice(0, -2)) * 2;
    const fragments = (async function* () {for (let i = 0; i < value.length; i += 7) yield value.slice(i, i + 7);})();
    if (!value.endsWith("pt")) await expect(readRtfFontSize(fragments)).rejects.toThrow("RTF font-size requires points");
    else if (!Number.isSafeInteger(expected) || expected < 1 || expected > 32767) await expect(readRtfFontSize(fragments)).rejects.toThrow("Invalid RTF font-size");
    else expect(await readRtfFontSize(fragments)).toBe(expected);
  }
});
