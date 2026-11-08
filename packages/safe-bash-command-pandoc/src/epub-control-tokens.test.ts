import {expect, it, vi} from "vitest";
import {selectEpubTokens} from "./epub-control-tokens.js";

it.each(["", "nav", " nav  cover-image ", "nav\tcover-image", "navigation cover-image-extra", "😀 nav 😀", "nav nav cover-image"])("matches only space-separated EPUB control tokens in %j", async value => {
  const bytes = new TextEncoder().encode(value), wanted = ["nav", "cover-image", "noteref"];
  const source = (async function* () {const window = new Uint8Array(1); for (const byte of bytes) {window[0] = byte; yield window; window[0] = 255;}})();
  expect(await selectEpubTokens(source, wanted, async () => {})).toEqual(wanted.filter(token => value.split(" ").includes(token)));
});

it("discards arbitrarily long unknown tokens and duplicate matches while retiring the source", async () => {
  let closed = 0;
  const cooperate = vi.fn(async () => {}), encoder = new TextEncoder();
  const source = (async function* () {try {yield encoder.encode("nav "); const chunk = encoder.encode("x".repeat(4096)); for (let n = 0; n < 64; n++) yield chunk; yield encoder.encode(" cover-image "); for (let n = 0; n < 64; n++) yield encoder.encode("nav ".repeat(1024));} finally {closed++;}})();
  expect(await selectEpubTokens(source, ["nav", "cover-image", "noteref"], cooperate)).toEqual(["nav", "cover-image"]);
  expect(closed).toBe(1); expect(cooperate).toHaveBeenCalled();
});

it("retires an owned token source when cooperation fails", async () => {
  let closed = 0;
  const source = (async function* () {try {for (;;) yield new TextEncoder().encode("nav ");} finally {closed++;}})();
  await expect(selectEpubTokens(source, ["noteref"], async () => {throw new Error("cancelled");})).rejects.toThrow("cancelled");
  expect(closed).toBe(1);
});
