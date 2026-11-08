import { expect, it } from "vitest";
import { StringStream, Type1Parser } from "../vendor/pdfjs-fonts.mjs";

it("admits Type1 lexer and decryption scratch before reading", () => {
  const failure = new Error("Type1 owner rejected scratch");
  expect(() => new Type1Parser(new StringStream("font data"), true, true, () => { throw failure; })).toThrow(failure);
});

it("admits CID Type1 glyph records before expanding the CID map", () => {
  const binary = "\0".repeat(33);
  let parsing = false; const failure = new Error("CID glyph owner rejected expansion");
  const parser = new Type1Parser(new StringStream("%!PS-Adobe-3.0 Resource-CIDFont\n/CIDMapOffset 0 def /FDBytes 0 def /GDBytes 1 def /CIDCount 32 def /Private 1 dict dup begin /lenIV -1 def end def (Binary) 33 StartData " + binary), false, true, bytes => {
    if (parsing && bytes > 10000) throw failure;
  });
  parsing = true;
  expect(() => parser.extractCidKeyedFontProgram({})).toThrow(failure);
});

it("admits recursive Type1 charstring expansion at every invocation", () => {
  const code = String.fromCharCode(139, 10, 11); // call subroutine zero, then return
  let parsing = false, admitted = 0; const failure = new Error("recursive conversion owner exhausted");
  const parser = new Type1Parser(new StringStream("/lenIV -1 def /Subrs 1 array dup 0 3 RD " + code + " NP end /CharStrings 1 dict dup begin /A 3 RD " + code + " ND end"), false, true, bytes => {
    if (parsing && (admitted += bytes) > 8192) throw failure;
  });
  parsing = true;
  expect(() => parser.extractFontProgram({})).toThrow(failure);
  expect(admitted).toBeGreaterThan(8192);
});

it("admits declared Type1 decryption output before allocating it", () => {
  const failure = new Error("decryption output owner exhausted");
  const parser = new Type1Parser(new StringStream("x"), false, true, bytes => { if (bytes > 100000) throw failure; });
  expect(() => parser.readCharStrings(new Uint8Array([0]), -100000)).toThrow(failure);
});

it("skips large Type1 comments without charging a token-sized working buffer", () => {
  let admitted = 0;
  const parser = new Type1Parser(new StringStream("%" + "x".repeat(65536) + "\nA"), false, true, bytes => {
    admitted += bytes;
    if (admitted > 4096) throw new Error("comment charged as retained tokens");
  });
  expect(parser.getToken()).toBe("A");
  expect(admitted).toBeLessThanOrEqual(4096);
});
