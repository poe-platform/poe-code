// Keep character properties with the JS runtime's Unicode version. The native
// parser needs no regex engine or additional Unicode package.
const whitespace=/\s/u,punctuation=/[\p{P}\p{S}]/u;
export function classifyMarkdownUnit(text) {
  return Number(text===""||whitespace.test(text))|Number(text!==""&&punctuation.test(text))*2;
}
