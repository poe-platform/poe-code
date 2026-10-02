import {extractFrontmatter} from "./markdown-frontmatter.js";
import {parseBlockBody} from "./markdown-block-body.js";

export function parseBlocks(input) {
  return parseBlockDocument(input).children;
}
export function parseBlockDocument(input) {
  const {frontmatter,body,range}=extractFrontmatter(input);
  const children=parseBlockBody(body,range?.end??0);
  return frontmatter===undefined?{children}:{frontmatter,frontmatterRange:range,children};
}
