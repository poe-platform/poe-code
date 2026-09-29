/* Copyright 2017 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Adapted from Mozilla PDF.js test/unit/parser_spec.js at
 * 91041fb94d6744bc2a5bccd9aad28d617faa8195. Tests use CosByteLexer tokens
 * instead of PDF.js Lexer primitive values; cases and expected values retained.
 */
import { describe, expect, it } from "vitest";
import { CosByteLexer } from "./lexer.js";

describe("PDF.js lexer regressions", () => {
  it.each(["-.002", "34.5", "-3.62", "-1.", "0.0", "123", "-98", "43445", "0", "+17"])(
    "parses PDF number %s", raw => {
      const lexer = new CosByteLexer(new TextEncoder().encode(raw));
      expect(lexer.nextToken()).toMatchObject({ kind: "number", value: Number(raw) });
      expect(lexer.nextToken()).toBeUndefined();
    }
  );

  it.each([
    ["--205.88", -205.88],
    ["205--.88", 205.88],
    ["-\r\n205.88", -205.88],
    ["+\r\n205.88", 205.88],
  ])("recovers a malformed PDF number %j", (raw, value) => {
    const lexer = new CosByteLexer(new TextEncoder().encode(raw));
    expect(lexer.nextToken()).toMatchObject({ kind: "number", value });
    expect(lexer.nextToken()).toBeUndefined();
  });

  it.each([".", "-", "+", "-.", "+.", "-\r\n.", "+\r\n.", "-(", "-<"])(
    "treats a standalone sign or decimal point as zero: %j", raw => {
      const lexer = new CosByteLexer(new TextEncoder().encode(raw));
      expect(lexer.nextToken()).toMatchObject({ kind: "number", value: 0 });
    }
  );

  it.each(["..", ".-", ".+"])("rejects an invalid number prefix %j", raw => {
    const lexer = new CosByteLexer(new TextEncoder().encode(raw));
    expect(() => lexer.nextToken()).toThrow();
  });

  it("does not consume the operator glued to a number", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode("123ET"));
    expect(lexer.nextToken()).toMatchObject({ kind: "number", value: 123 });
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "ET" });
    expect(lexer.nextToken()).toBeUndefined();
  });

  it("ignores escaped CR and LF inside literal strings", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode("(\\101\\\r\n\\102\\\r\\103\\\n\\104)"));
    expect(lexer.nextToken()).toMatchObject({ kind: "string", bytes: new TextEncoder().encode("ABCD") });
  });

  it("pads the final nibble of an odd-length hexadecimal string", () => {
    const lexer = new CosByteLexer(new TextEncoder().encode("<7 0 2 15 5 2 2 2 4 3 2 4>"));
    expect(lexer.nextToken()).toMatchObject({ kind: "hex-string", bytes: new TextEncoder().encode('p!U"$2@') });
  });

  it.each([["/# 680 0 R", "#"], ["/#AQwerty", "#AQwerty"], ["/#A<</B", "#A"]])(
    "preserves malformed name escapes in %j", (raw, decoded) => {
      const lexer = new CosByteLexer(new TextEncoder().encode(raw));
      expect(lexer.nextToken()).toMatchObject({ kind: "name", decoded });
    }
  );

  it("separates a non-visible ASCII command from the following operator (PDF.js issue 13999)", () => {
    const lexer = new CosByteLexer(new Uint8Array([0x14, 0x71, 0x0a, 0x51]));
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "\x14" });
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "q" });
    expect(lexer.nextToken()).toMatchObject({ kind: "keyword", value: "Q" });
    expect(lexer.nextToken()).toBeUndefined();
  });
});
