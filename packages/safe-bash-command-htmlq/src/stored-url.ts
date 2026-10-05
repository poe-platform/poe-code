import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { normalizeStoredHostname } from "safe-bash-command-html-to-markdown/stored-destination";
import type { HtmlBudget } from "./contracts.js";
import { StoredSequence } from "./document-store.js";

const ports: Readonly<Record<string, string>> = { ftp: "21", file: "", http: "80", https: "443", ws: "80", wss: "443" };
const alpha = (c: string): boolean => c >= "a" && c <= "z" || c >= "A" && c <= "Z";
const digit = (c: string): boolean => c >= "0" && c <= "9";
interface StoredUrl {
  scheme: number;
  special: string | undefined;
  host: number | undefined;
  user: number;
  password: number;
  port: string;
  path: number;
  opaque: boolean;
  opaqueRoot: number | undefined;
  query: number | undefined;
  fragment: number | undefined;
}

/** URL components and a persistent path stack live in caller storage. Native
 * URL is used only for fixed-window escaping and bounded IP/IDNA probes. */
export class StoredUrls {
  private readonly legacyOpaqueRelative = (() => { try { new URL("a#f", "z:b"); return true; } catch { return false; } })();
  private readonly emptyParentKeepsSlash = new URL("z:/..").pathname === "/";
  constructor(private readonly text: TextStore, private readonly storage: PagedStorage, private readonly budget: HtmlBudget) {}

  private async *characters(root: number, start = 0, end?: number): AsyncGenerator<readonly [string, number]> {
    let offset = start;
    for await (const chunk of this.text.chunks(await this.text.slice(root, start, end))) {
      this.budget.charge("work", chunk.length);
      for (const c of chunk) { yield [c, offset]; offset += c.length; }
    }
  }
  private async small(root: number, maximum = 16): Promise<string | undefined> {
    if ((await this.text.info(root)).length > maximum) return undefined;
    let value = ""; for await (const chunk of this.text.chunks(root)) value += chunk; return value;
  }
  private async equal(a: number, b: number): Promise<boolean> {
    if ((await this.text.info(a)).length !== (await this.text.info(b)).length) return false;
    const right = this.text.characters(b);
    try { for await (const [c] of this.characters(a)) if (c !== (await right.next()).value) return false; return true; }
    finally { await right.return(undefined); }
  }
  private async clean(root: number): Promise<number> {
    const builder = this.text.builder(); let start = -1, end = 0, offset = 0;
    for await (const chunk of this.text.chunks(root)) {
      let clean = "";
      for (const c of chunk) {
        this.budget.charge("work", c.length);
        if (c === "\t" || c === "\n" || c === "\r") continue;
        if (c.codePointAt(0)! > 32) { if (start < 0) start = offset; end = offset + c.length; }
        clean += c; offset += c.length;
      }
      await builder.write(clean);
    }
    const result = await builder.finish(); return start < 0 ? 0 : this.text.slice(result, start, end);
  }
  private async encode(root: number, kind: "path" | "opaque" | "query" | "fragment" | "user" | "password" | "host", special = false): Promise<number> {
    const result = this.text.builder();
    for await (const chunk of this.text.chunks(root)) {
      this.budget.charge("work", chunk.length);
      const probe = new URL(special ? "http://x/" : "z://x/");
      let value: string;
      if (kind === "query") { probe.search = "?x" + chunk; value = probe.search.slice(2); }
      else if (kind === "fragment") { probe.hash = "#x" + chunk; value = probe.hash.slice(2); }
      else if (kind === "user") { probe.username = chunk; value = probe.username; }
      else if (kind === "password") { probe.password = chunk; value = probe.password; }
      else if (kind === "path") { probe.pathname = "/x" + chunk + "x"; value = probe.pathname.slice(2, -1); }
      else if (kind === "host") value = new URL("z://x" + chunk + "x/").hostname.slice(1, -1);
      else value = new URL("z:x" + chunk + "x").pathname.slice(1, -1);
      await result.write(value);
    }
    return result.finish();
  }
  private async pathNode(id: number): Promise<readonly [number, number]> {
    if (!id) return [0, 0];
    const bytes = await this.storage.read(id, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getFloat64(0, true), view.getFloat64(8, true)];
  }
  private async push(url: StoredUrl, segment: number): Promise<void> {
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setFloat64(0, url.path, true); view.setFloat64(8, segment, true);
    url.path = await this.storage.append(bytes);
  }
  private async drive(root: number): Promise<boolean> {
    const value = await this.small(root, 2);
    return value !== undefined && value.length === 2 && alpha(value[0]!) && (value[1] === ":" || value[1] === "|");
  }
  private async shorten(url: StoredUrl): Promise<void> {
    const [parent, segment] = await this.pathNode(url.path);
    if (url.special === "file" && !parent && await this.drive(segment)) return;
    url.path = parent;
  }
  private async firstDrive(url: StoredUrl): Promise<number> {
    let id = url.path;
    while (id) { const [parent, segment] = await this.pathNode(id); if (!parent) return await this.drive(segment) ? segment : 0; id = parent; }
    return 0;
  }
  private async beginsDrive(root: number, start: number, end: number): Promise<boolean> {
    if (end - start < 2 || !await this.drive(await this.text.slice(root, start, start + 2))) return false;
    const next = await this.text.at(root, start + 2);
    return start + 2 === end || next === "/" || next === "\\";
  }
  private async path(url: StoredUrl, root: number, start: number, end: number): Promise<void> {
    let first = start;
    const segment = async (last: number, final: boolean): Promise<void> => {
      let part = await this.text.slice(root, first, last);
      const small = (await this.small(part, 6))?.toLowerCase();
      if (small === ".." || small === ".%2e" || small === "%2e." || small === "%2e%2e") {
        const hadPath = Boolean(url.path);
        await this.shorten(url);
        if (final && (url.special !== undefined || hadPath || this.emptyParentKeepsSlash)) await this.push(url, 0);
      } else if (small === "." || small === "%2e") { if (final) await this.push(url, 0); }
      else {
        if (url.special === "file" && !url.path && await this.drive(part)) {
          part = await this.text.from((await this.small(part, 2))![0] + ":");
        }
        await this.push(url, await this.encode(part, "path"));
      }
    };
    for await (const [c, offset] of this.characters(root, start, end)) {
      if (c === "/" || url.special !== undefined && c === "\\") { await segment(offset, false); first = offset + 1; }
    }
    await segment(end, true);
  }
  private async authority(url: StoredUrl, root: number): Promise<boolean> {
    const length = (await this.text.info(root)).length;
    let at = -1;
    for await (const [c, offset] of this.characters(root)) if (c === "@") at = offset;
    if (at >= 0) {
      if (url.special === "file") return false;
      let colon = at;
      for await (const [c, offset] of this.characters(root, 0, at)) if (c === ":") { colon = offset; break; }
      url.user = await this.encode(await this.text.slice(root, 0, colon), "user");
      if (colon < at) url.password = await this.encode(await this.text.slice(root, colon + 1, at), "password");
    }
    const start = at + 1; let end = length, bracket = false;
    for await (const [c, offset] of this.characters(root, start)) {
      if (c === "[") bracket = true;
      if (c === "]") bracket = false;
      if (c === ":" && !bracket) { end = offset; break; }
    }
    if (end < length) {
      if (url.special === "file") return false;
      let port = 0;
      for await (const [c] of this.characters(root, end + 1)) { if (!digit(c)) return false; port = port * 10 + Number(c); if (port > 65535) return false; }
      if (end + 1 < length && String(port) !== ports[url.special ?? ""]) url.port = String(port);
    }
    const host = await this.text.slice(root, start, end);
    if (!host) {
      if (at >= 0 || end < length || url.special !== undefined && url.special !== "file") return false;
      url.host = 0; return true;
    }
    if (url.special !== undefined || await this.text.at(host, 0) === "[") {
      url.host = await normalizeStoredHostname(this.text, host, { work: n => this.budget.charge("work", n), checkpoint: () => this.budget.check() });
      if (url.host === undefined) return false;
      if (url.special === "file" && await this.small(url.host) === "localhost") url.host = 0;
    } else {
      for await (const [c] of this.characters(host)) if (c === "\0" || " #/:<>?@[\\]^|".includes(c)) return false;
      url.host = await this.encode(host, "host");
    }
    return true;
  }

  async parse(original: number, base?: StoredUrl): Promise<StoredUrl | undefined> {
    const root = await this.clean(original), length = (await this.text.info(root)).length;
    let fragmentAt = length, queryAt = length;
    for await (const [c, offset] of this.characters(root)) {
      if (c === "#") { fragmentAt = offset; break; }
      if (c === "?" && queryAt === length) queryAt = offset;
    }
    const end = Math.min(queryAt, fragmentAt);
    let schemeEnd = -1;
    for await (const [c, offset] of this.characters(root, 0, end)) {
      if (offset > 0 && c === ":") { schemeEnd = offset; break; }
      if (!(alpha(c) || offset > 0 && (digit(c) || c === "+" || c === "-" || c === "."))) break;
    }
    let scheme = 0, special: string | undefined;
    if (schemeEnd >= 0) {
      const builder = this.text.builder();
      for await (const chunk of this.text.chunks(await this.text.slice(root, 0, schemeEnd))) await builder.write(chunk.toLowerCase());
      scheme = await builder.finish(); const name = await this.small(scheme);
      if (name !== undefined && Object.hasOwn(ports, name)) special = name;
    } else {
      if (!base) return undefined;
      scheme = base.scheme; special = base.special;
    }
    let url: StoredUrl = { scheme, special, host: undefined, user: 0, password: 0, port: "", path: 0, opaque: false, opaqueRoot: undefined, query: undefined, fragment: undefined };
    let start = schemeEnd < 0 ? 0 : schemeEnd + 1;
    const slash = (c: string | undefined): boolean => c === "/" || special !== undefined && c === "\\";
    const first = await this.text.at(root, start), second = await this.text.at(root, start + 1);
    const sameSpecial = schemeEnd >= 0 && special !== undefined && base && await this.equal(scheme, base.scheme);
    let relative = schemeEnd < 0 || Boolean(sameSpecial && special !== "file" && !(first === "/" && second === "/"));
    let authority = false, fileDriveAuthority = false, pathStarted = false;
    if (special === "file") {
      url.host = 0;
      if (slash(first) && slash(second)) { authority = true; start += 2; }
      else {
        if (base?.special === "file") {
          url.host = base.host; url.path = base.path; url.query = base.query;
        }
        if (slash(first)) {
          start++; pathStarted = true;
          const drive = base?.special === "file" ? await this.firstDrive(base) : 0;
          url.path = 0;
          if (drive && !await this.beginsDrive(root, start, end)) await this.push(url, drive);
        } else if (start < end) {
          if (await this.beginsDrive(root, start, end)) url.path = 0;
          else await this.shorten(url);
        }
      }
      relative = false;
    } else if (relative) {
      if (!base) return undefined;
      url = { ...base, fragment: undefined };
      if (base.opaque && await this.text.at(root, 0) !== "#") {
        if (!this.legacyOpaqueRelative || fragmentAt === length || schemeEnd >= 0) return undefined;
        if (start < end) {
          url.opaque = false; url.path = 0;
          let part = 0;
          for await (const [c, offset] of this.characters(base.path)) if (c === "/") {
            const segment = await this.text.slice(base.path, part, offset);
            if (url.opaqueRoot === undefined) url.opaqueRoot = segment;
            else await this.push(url, segment);
            part = offset + 1;
          }
          const last = await this.text.slice(base.path, part);
          if (url.opaqueRoot === undefined) url.opaqueRoot = last;
          else await this.push(url, last);
        }
      }
      if (!url.opaque) {
        if (slash(first) && slash(second)) {
          authority = true; start += 2;
          url = { ...url, host: undefined, user: 0, password: 0, port: "", path: 0, opaqueRoot: undefined, query: undefined };
        } else if (slash(first)) { url.path = 0; url.opaqueRoot = undefined; url.query = undefined; start++; pathStarted = true; }
        else if (start < end) { await this.shorten(url); url.query = undefined; }
      }
    } else if (special !== undefined) { authority = true; }
    else if (first === "/" && second === "/") { authority = true; start += 2; }
    else if (first === "/") { start++; pathStarted = true; }
    else url.opaque = true;

    if (authority) {
      if (special !== undefined && special !== "file") {
        for await (const [c, offset] of this.characters(root, start, end)) { if (!slash(c)) break; start = offset + 1; }
      }
      let stop = end;
      for await (const [c, offset] of this.characters(root, start, end)) if (slash(c)) { stop = offset; break; }
      const host = await this.text.slice(root, start, stop);
      if (special === "file" && await this.drive(host)) { fileDriveAuthority = true; url.host = 0; }
      else {
        if (!await this.authority(url, host)) return undefined;
        start = stop;
        if (start < end && slash(await this.text.at(root, start))) { start++; pathStarted = true; }
      }
    }
    if (url.opaque) {
      if (!relative) {
        const trailingSpace = end < length && await this.text.at(root, end - 1) === " ";
        url.path = await this.encode(await this.text.slice(root, start, trailingSpace ? end - 1 : end), "opaque");
        if (trailingSpace) url.path = await this.text.concat(url.path, await this.text.from(new URL("z:x " + (queryAt < fragmentAt ? "?q" : "#f")).pathname.slice(1)));
      }
    } else if (start < end || pathStarted || authority || !url.path && special !== undefined) {
      // Non-special empty authority paths serialize without an added slash.
      if (!(authority && special === undefined && start === end && !pathStarted))
        await this.path(url, root, start, end);
      if (fileDriveAuthority) url.host = 0;
      url.query = undefined;
    }
    if (queryAt < fragmentAt) url.query = await this.encode(await this.text.slice(root, queryAt + 1, fragmentAt), "query", special !== undefined);
    if (fragmentAt < length) url.fragment = await this.encode(await this.text.slice(root, fragmentAt + 1), "fragment");
    return url;
  }

  async serialize(url: StoredUrl): Promise<number> {
    const result = this.text.builder(); await result.append(url.scheme); await result.write(":");
    if (url.host !== undefined) {
      await result.write("//");
      if (url.user || url.password) {
        await result.append(url.user);
        if (url.password) { await result.write(":"); await result.append(url.password); }
        await result.write("@");
      }
      await result.append(url.host); if (url.port) await result.write(":" + url.port);
    }
    if (url.opaque) await result.append(url.path);
    else {
      const segments = new StoredSequence(this.storage);
      for (let id = url.path; id;) { const [parent, segment] = await this.pathNode(id); await segments.push(segment); id = parent; }
      if (url.opaqueRoot !== undefined) await result.append(url.opaqueRoot);
      if (url.opaqueRoot === undefined && url.host === undefined && segments.length > 1 && await segments.get(segments.length - 1) === 0) await result.write("/.");
      while (segments.length) { await result.write("/"); await result.append((await segments.pop())!); }
    }
    if (url.query !== undefined) { await result.write("?"); await result.append(url.query); }
    if (url.fragment !== undefined) { await result.write("#"); await result.append(url.fragment); }
    return result.finish();
  }
}
