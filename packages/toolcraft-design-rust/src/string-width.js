import { createRequire } from "node:module";
import { createComponentPolicy } from "./component-host.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");

// Keep the executing JavaScript engine's Unicode data and sticky RegExp
// semantics. Rust owns block priority, accumulation and unmatched-point policy.
const blocks = {
  ansi: /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y,
  control: /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y,
  cjkt: /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/yu,
  tab: /\t{1,1000}/y,
  emoji: /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/yu,
  latin: /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y
};
const modifiers = /\p{M}+/gu;
const pairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const invoke = createComponentPolicy(native.designStringWidthPolicy, {
  controlOption: options => options.controlWidth ?? 0,
  tabOption: options => options.tabWidth ?? 8,
  emojiOption: options => options.emojiWidth ?? 2,
  regularOption: options => options.regularWidth ?? 1,
  wideOption: options => options.wideWidth ?? 2,
  zero: () => 0, one: () => 1, two: () => 2,
  unlimited: () => Math.max(0, Infinity - 0),
  latin: () => "latin", ansi: () => "ansi", control: () => "control",
  tab: () => "tab", emoji: () => "emoji", cjkt: () => "cjkt",
  matches(block, input, index) { blocks[block].lastIndex = index; return blocks[block].test(input); },
  lastIndex: block => blocks[block].lastIndex,
  pointLength(input) { let count = 0; pairs.lastIndex = 0; while(pairs.test(input)) count++; return input.length - count; },
  slice: (input, start, end) => input.slice(start, end),
  gt: (a,b) => a > b, ge: (a,b) => a >= b, truthy: value => !!value,
  subtract: (a,b) => a - b, multiply: (a,b) => a * b, add: (a,b) => a + b,
  increment: value => value + 1,
  state: length => ({truncationIndex:length,width:0,lengthExtra:0,start:0,previous:0}),
  overLimit: (a,b,limit) => a + b > limit,
  overInfinity: (a,b) => a + b > Infinity,
  pointKind: character => native.designStringWidthPointKind(character.codePointAt(0) || 0),
  advanceCharacter(state, character, extra) { state.lengthExtra += character.length; state.width += extra; },
  truncateCharacter(state) { state.truncationIndex = Math.min(state.truncationIndex, Math.max(state.start,state.previous) + state.lengthExtra); },
  truncateBlock(state,index,limit,width,blockWidth) { state.truncationIndex = Math.min(state.truncationIndex, index + Math.floor((limit - width) / blockWidth)); },
  unmatched(text, width, regular, wide, limit, state, start, previous) {
    state.width=width; state.lengthExtra=0; state.start=start; state.previous=previous;
    for(const character of text.replaceAll(modifiers, "")) invoke("character", [state, character, regular, wide, limit]);
    return state.width;
  },
  invalidOperation() { throw new TypeError("Invalid string width operation"); }
});

export default function stringWidth(input, options = {}) {
  return invoke("width", [input, options]);
}
