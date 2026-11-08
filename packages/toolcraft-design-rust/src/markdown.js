import {parse} from "./markdown-parser.js";
import {render} from "./markdown-render.js";
import {renderHtml} from "./html.js";
export {parse,render,renderHtml};
export {renderPlaintext,renderMarkdownPlaintext} from "./plaintext.js";

export function renderMarkdown(markdown,options) {
  const {ast}=parse(markdown);
  return render(ast,options);
}
export function renderMarkdownHtml(markdown,options) {
  const {ast}=parse(markdown);
  return renderHtml(ast,options);
}
