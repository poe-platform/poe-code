import {expect, it} from "vitest";
import {AsciiUrlHost} from "./ascii-url-host.js";

it("matches native DNS and IPv4 admission with bounded label state", () => {
  const labels = ["", "0", "00", "09", "08", "0x", "0xg", "0xf", "0xFFFFFFFF", "4294967295", "4294967296", "0377", "0400", "256", "255", "1", "-", "a", "foo", "123abc"];
  for (const a of labels) for (const b of labels) for (const c of labels) {
    for (const host of [`${a}.${b}.${c}`, `${a}.${b}.${c}.`, `${a}.${b}.${c}..`]) {
      const state = new AsciiUrlHost(); for (const char of host) state.write(char);
      expect(state.finish(), host).toBe(URL.canParse(`http://${host}/`));
    }
  }
});

it("defers IDNA labels and encoded Unicode to native validation", () => {
  for (const host of ["xn--bcher-kva", "x.XN--a.y", "%c3%a9", "bücher", "K", "İ"]) {
    const state = new AsciiUrlHost(); for (const char of host) state.write(char);
    expect(state.finish(), host).toBeUndefined();
  }
});

it("matches native ASCII punctuation and forbidden domain code points", () => {
  for (let code = 0; code < 128; code++) {
    const char = String.fromCharCode(code);
    if ("%\t\r\n/#?:@\\".includes(char)) continue;
    const host = "a" + char + "b", state = new AsciiUrlHost();
    for (const value of host) state.write(value);
    expect(state.finish(), String(code)).toBe(URL.canParse(`http://${host}/`));
  }
});

it("rejects all Unicode noncharacters without native hostname collection", () => {
  const points = [...Array.from({length: 32}, (_, index) => 0xfdd0 + index), ...Array.from({length: 17}, (_, plane) => [plane * 0x10000 + 0xfffe, plane * 0x10000 + 0xffff]).flat()];
  for (const point of points) for (const encode of [false, true]) {
    const scalar = String.fromCodePoint(point), host = "é" + (encode ? encodeURIComponent(scalar) : scalar) + "example";
    expect(() => new URL(`https://${host}/`)).toThrow();
    const state = new AsciiUrlHost();
    // Feed UTF-16 units separately, including split supplementary scalars.
    for (let index = 0; index < host.length; index++) state.write(host[index]!);
    expect(state.finish(), `U+${point.toString(16)}, escaped=${encode}`).toBe(false);
  }
});
