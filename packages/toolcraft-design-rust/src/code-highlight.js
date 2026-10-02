import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");

// Internal prerequisite for Markdown renderers, not a new public subpath.
export function highlightCodeBlock(node) {
  if(node.tokens!==undefined)return node.tokens;
  const lang=node.lang;
  if(lang===undefined||lang.length===0)return undefined;
  const alias=lang.toLowerCase();
  if(typeof alias!=="string"||!native.designCodeLanguageKnown(alias)||node.value.length===0)return undefined;
  const tokens=native.designHighlightCode(node.value,alias);
  return tokens.length===0?undefined:tokens;
}
