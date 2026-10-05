import {asciiPunctuation, digit, entity, letter, whitespace} from "./commonmark-syntax.js";
import {unicodeWhitespace} from "./commonmark-characters.js";
import type {AdapterContext} from "safe-bash-markdown-engine/types";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

type Scanned = {value: SourceRange; end: number};

/** CommonMark scanners retain source coordinates, never whole destination/title
 * strings. The sole materializing operation requires an explicit grammar bound. */
export class RetainedCommonMarkSyntax {
  constructor(readonly source: RetainedSourceText, readonly range: SourceRange, private readonly context: AdapterContext) {}
  async at(position: number): Promise<string | undefined> {
    return position < this.range.start || position >= this.range.end ? undefined : this.source.unit(position);
  }
  async small(range: SourceRange, maximum: number): Promise<string> {
    if (range.end - range.start > maximum) throw new RangeError("Expected grammar-bounded Markdown string");
    let text = "";
    for await (const chunk of this.source.chunks(range)) text += chunk;
    return text;
  }
  async spaces(position: number): Promise<number> {
    while ([" ", "\t", "\n", "\r"].includes(await this.at(position) ?? "")) {await this.context.cooperate(); position++;}
    return position;
  }
  async destination(start: number): Promise<Scanned | undefined> {
    let i = start;
    if (await this.at(i) === "<") {
      const begin = ++i;
      while (i < this.range.end && await this.at(i) !== ">") {
        await this.context.cooperate();
        const char = await this.at(i);
        if (char === "<" || char === "\n" || char === "\r") return;
        if (char === "\\" && asciiPunctuation(await this.at(i + 1))) i++;
        i++;
      }
      if (await this.at(i) !== ">") return;
      return {value: {start: begin, end: i}, end: i + 1};
    }
    let depth = 0;
    while (i < this.range.end && !whitespace(await this.at(i))) {
      await this.context.cooperate();
      const char = (await this.at(i))!;
      if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return;
      if (char === "\\" && asciiPunctuation(await this.at(i + 1))) {i += 2; continue;}
      if (char === "(") this.context.bound("depth", ++depth);
      if (char === ")") {if (!depth) break; depth--;}
      i++;
    }
    if (depth) return;
    return {value: {start, end: i}, end: i};
  }
  async title(start: number): Promise<Scanned | undefined> {
    const opening = await this.at(start);
    if (opening !== "'" && opening !== '"' && opening !== "(") return;
    const closing = opening === "(" ? ")" : opening;
    let i = start + 1;
    while (i < this.range.end) {
      await this.context.cooperate();
      const char = await this.at(i);
      if (char === closing) return {value: {start: start + 1, end: i}, end: i + 1};
      if (opening === "(" && char === "(") return;
      if (char === "\\" && asciiPunctuation(await this.at(i + 1))) i++;
      i++;
    }
  }
  async label(start: number): Promise<{label: string; end: number} | undefined> {
    if (await this.at(start) !== "[") return;
    let i = start + 1, count = 0;
    while (i < this.range.end) {
      await this.context.cooperate();
      const char = await this.at(i);
      if (char === "]") return {label: await this.small({start: start + 1, end: i}, 1998), end: i + 1};
      if (char === "[") return;
      if (char === "\\" && asciiPunctuation(await this.at(i + 1))) {i += 2; count += 2;}
      else {
        const high = char!.charCodeAt(0), low = (await this.at(i + 1))?.charCodeAt(0) ?? 0;
        i += high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
        count++;
      }
      if (count > 999) return;
    }
  }
  async target(start: number): Promise<{url: SourceRange; title: SourceRange; end: number} | undefined> {
    if (await this.at(start) !== "(") return;
    const begin = await this.spaces(start + 1), destination = await this.destination(begin);
    if (destination) {
      const gap = await this.spaces(destination.end);
      if (await this.at(gap) === ")") return {url: destination.value, title: {start: gap, end: gap}, end: gap + 1};
      if (gap > destination.end) {
        const title = await this.title(gap);
        if (title) {const end = await this.spaces(title.end); if (await this.at(end) === ")") return {url: destination.value, title: title.value, end: end + 1};}
      }
    }
    if (begin > start + 1) {
      const title = await this.title(begin);
      if (title) {const end = await this.spaces(title.end); if (await this.at(end) === ")") return {url: {start: begin, end: begin}, title: title.value, end: end + 1};}
    }
  }
  async *decoded(range: SourceRange): AsyncGenerator<string> {
    this.context.charge("retainedBytes", (range.end - range.start) * 4);
    let buffer = "";
    for (let i = range.start; i < range.end;) {
      await this.context.cooperate();
      const char = await this.source.unit(i);
      if (char === "\\" && i + 1 < range.end && asciiPunctuation(await this.source.unit(i + 1))) {buffer += await this.source.unit(i + 1); i += 2;}
      else if (char === "&") {
        const window = await this.small({start: i, end: Math.min(range.end, i + 34)}, 34), decoded = entity(window, 0, this.context);
        if (decoded) {buffer += decoded.value; i += decoded.end;} else {buffer += char; i++;}
      } else {buffer += char; i++;}
      if (buffer.length >= 4096) {yield buffer; buffer = "";}
    }
    if (buffer) yield buffer;
  }
  async *uri(chunks: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string> {
    let pending = "", buffer = "";
    for await (const chunk of chunks) {
      this.context.charge("retainedBytes", chunk.length * 24);
      const text = pending + chunk, last = text.charCodeAt(text.length - 1), end = last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
      pending = text.slice(end);
      for (const char of text.slice(0, end)) {
        await this.context.cooperate();
        buffer += letter(char) || digit(char) || ";/?:@&=+$,-_.!~*'()#%".includes(char) ? char : encodeURIComponent(char);
        if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
    }
    // Match encodeURIComponent's rejection of a trailing unpaired surrogate.
    if (pending) buffer += encodeURIComponent(pending);
    if (buffer) yield buffer;
  }
  async starts(position: number, prefix: string): Promise<boolean> {
    return this.source.starts({start: position, end: this.range.end}, prefix);
  }
  async html(start: number): Promise<number | undefined> {
    const terminated = async (prefix: string, suffix: string) => {
      if (!await this.starts(start, prefix)) return;
      const end = await this.source.find({start: start + prefix.length, end: this.range.end}, suffix);
      this.context.checkpoint(end < 0 ? this.range.end - start : end - start);
      return end < 0 ? undefined : end + suffix.length;
    };
    if (await this.starts(start, "<!--")) {
      if (await this.starts(start, "<!-->")) return start + 5;
      if (await this.starts(start, "<!--->")) return start + 6;
      return terminated("<!--", "-->");
    }
    if (await this.starts(start, "<?")) return terminated("<?", "?>");
    if (await this.starts(start, "<![CDATA[")) return terminated("<![CDATA[", "]]>");
    if (await this.starts(start, "<!")) {
      let i = start + 2; const begin = i;
      while (letter(await this.at(i))) i++;
      if (i === begin || !whitespace(await this.at(i))) return;
      return terminated("<!", ">");
    }
    let i = start + 1; const closing = await this.at(i) === "/";
    if (closing) i++;
    if (!letter(await this.at(i))) return;
    i++;
    while (letter(await this.at(i)) || digit(await this.at(i)) || await this.at(i) === "-") i++;
    for (;;) {
      await this.context.cooperate(); const begin = i; i = await this.spaces(i);
      if (await this.at(i) === ">") return i + 1;
      if (!closing && await this.at(i) === "/" && await this.at(i + 1) === ">") return i + 2;
      if (closing || i === begin || (!letter(await this.at(i)) && await this.at(i) !== "_" && await this.at(i) !== ":")) return;
      i++;
      while (letter(await this.at(i)) || digit(await this.at(i)) || await this.at(i) !== undefined && "_.:-".includes((await this.at(i))!)) {await this.context.cooperate(); i++;}
      const afterName = i; i = await this.spaces(i);
      if (await this.at(i) !== "=") {i = afterName; continue;}
      i = await this.spaces(i + 1); const quote = await this.at(i);
      if (quote === "'" || quote === '"') {
        i++; while (i < this.range.end && await this.at(i) !== quote) {await this.context.cooperate(); i++;}
        if (await this.at(i) !== quote) return; i++;
      } else {
        const begin = i;
        while (i < this.range.end && !whitespace(await this.at(i)) && !"\"'=<>`".includes((await this.at(i))!)) {await this.context.cooperate(); i++;}
        if (i === begin) return;
      }
    }
  }
  async filteredHtml(range: SourceRange): Promise<boolean> {
    let replacements = 0;
    for (let i = range.start; i < range.end; i++) {
      await this.context.cooperate(); if (await this.at(i) !== "<") continue;
      let at = i + 1; if (await this.at(at) === "/") at++;
      const begin = at; while (letter(await this.at(at))) {await this.context.cooperate(); at++;}
      if (at - begin > 9) continue;
      if ([">", "/", " ", "\t", "\n", "\r"].includes(await this.at(at) ?? "") &&
        ["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"].includes((await this.small({start: begin, end: at}, 9)).toLowerCase())) replacements++;
    }
    this.context.charge("retainedBytes", (range.end - range.start + replacements * 3) * 2);
    return replacements > 0;
  }
  async autolink(start: number, bare = false): Promise<{label: SourceRange; prefix: string; end: number} | undefined> {
    const alnum = (c: string | undefined) => letter(c) || digit(c);
    if (!bare) {
      let end = start + 1;
      while (end < this.range.end && await this.at(end) !== ">") {
        await this.context.cooperate(); const c = (await this.at(end))!;
        if (c === "<" || c.charCodeAt(0) <= 32) return; end++;
      }
      if (await this.at(end) !== ">") return;
      const label = {start: start + 1, end}; let i = label.start;
      if (letter(await this.at(i))) {
        i++; while (i < end && (alnum(await this.at(i)) || ["+", ".", "-"].includes(await this.at(i) ?? ""))) i++;
        if (i - label.start >= 2 && i - label.start <= 32 && await this.at(i) === ":") return {label, prefix: "", end: end + 1};
      }
      i = label.start;
      while (i < end && (alnum(await this.at(i)) || ".!#$%&'*+/=?^_`{|}~-".includes((await this.at(i))!))) i++;
      if (i === label.start || await this.at(i++) !== "@") return;
      for (;;) {
        const begin = i; if (!alnum(await this.at(i))) return; i++;
        while (i < end && (alnum(await this.at(i)) || await this.at(i) === "-")) i++;
        if (i - begin > 63 || await this.at(i - 1) === "-") return;
        if (i === end) return {label, prefix: "mailto:", end: end + 1};
        if (await this.at(i++) !== ".") return;
      }
    }
    const prev = await this.at(start - 1), boundary = start === this.range.start || unicodeWhitespace(prev) || "*_~(".includes(prev ?? "");
    let scheme: string | undefined;
    if (boundary) for (const prefix of ["https://", "http://", "ftp://", "www."]) if (await this.starts(start, prefix)) {scheme = prefix; break;}
    let end = start;
    if (scheme) {
      end += scheme.length; const domainStart = scheme === "www." ? start : end;
      while (end < this.range.end && !unicodeWhitespace(await this.at(end)) && await this.at(end) !== "<") {await this.context.cooperate(); end++;}
      let balance = 0;
      for (let i = start; i < end; i++) {await this.context.cooperate(); if (await this.at(i) === "(") balance++; if (await this.at(i) === ")") balance--;}
      for (;;) {
        const c = (await this.at(end - 1))!;
        if ("?!.,:*_~".includes(c)) {end--; continue;}
        if (c === ")" && balance < 0) {end--; balance++; continue;}
        if (c === ";") {
          let at = end - 2; while (alnum(await this.at(at))) {await this.context.cooperate(); at--;}
          if (at < end - 2 && await this.at(at) === "&") {end = at; continue;}
        }
        break;
      }
      let domainEnd = domainStart;
      while (domainEnd < end && !"/:?#".includes((await this.at(domainEnd))!)) {await this.context.cooperate(); domainEnd++;}
      let segments = 0, begin = domainStart, previousUnderscore = false, underscore = false;
      for (let i = domainStart; i <= domainEnd; i++) {
        const c = await this.at(i);
        if (i === domainEnd || c === ".") {
          if (i === begin) return;
          segments++; if (i === domainEnd) break;
          begin = i + 1; previousUnderscore = underscore; underscore = false;
        } else if (c === "_") underscore = true;
      }
      if (segments < 2 || previousUnderscore || underscore) return;
      return {label: {start, end}, prefix: scheme === "www." ? "http://" : "", end};
    }
    if (start > this.range.start && (alnum(prev) || ".-_+".includes(prev ?? ""))) return;
    while (alnum(await this.at(end)) || await this.at(end) !== undefined && ".-_+".includes((await this.at(end))!)) {await this.context.cooperate(); end++;}
    if (end === start || await this.at(end++) !== "@") return;
    const domainStart = end; let dot = false;
    while (alnum(await this.at(end)) || await this.at(end) !== undefined && ".-_".includes((await this.at(end))!)) {await this.context.cooperate(); end++;}
    while (await this.at(end - 1) === ".") end--;
    for (let i = domainStart; i < end; i++) if (await this.at(i) === ".") dot = true;
    if (!dot || await this.at(end - 1) === "-" || await this.at(end - 1) === "_" || await this.at(end) === "+") return;
    return {label: {start, end}, prefix: "mailto:", end};
  }
}
