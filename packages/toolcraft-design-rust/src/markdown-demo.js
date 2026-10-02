import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export function getMarkdownDemo(name="default") {
  if(typeof name!=="string")return;
  return native.designMarkdownDemo(name)??undefined;
}
