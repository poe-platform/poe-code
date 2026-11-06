import { escapeXml } from "./text-markup.js";

export function* complexNavigation(stem: string, firstPage: number, lastPage: number, index: boolean): Generator<string> {
  const basename = escapeXml(stem.slice(stem.lastIndexOf("/") + 1));
  yield '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/><title></title></head>\n';
  if (index) {
    yield "<body>\n";
    for (let page = firstPage; page <= lastPage; page++) {
      yield `<a href="${basename}-${page}.html" target="contents">Page ${page}</a><br/>\n`;
    }
    yield "</body>\n";
  } else {
    yield `<frameset cols="100,*">\n<frame name="links" src="${basename}_ind.html"/>\n<frame name="contents" src="${basename}-${firstPage}.html"/>\n</frameset>\n`;
  }
  yield "</html>\n";
}
