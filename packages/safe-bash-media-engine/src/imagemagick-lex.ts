import { textBytes } from './bytes.js';

/** Incremental native byte grammar. Only token metadata survives each chunk;
 * comments, whitespace and ignored list suffixes are never retained. */
export class ImageMagickLexer {
  readonly tokens: Uint8Array[] = [];
  incomplete = false;
  limited = false;
  private tokenBytes = 0;
  done = false;
  private word = '';
  private quote = '';
  private active = false;
  private column = 0;
  private comment = false;
  private escape = false;
  private cr = false;
  private suffix = false;

  constructor(private readonly kind: 'script' | 'list', private readonly bounded = false) {}

  push(bytes: Uint8Array): void {
    for (let index = 0; index < bytes.length && !this.done; index++) {
      const c = String.fromCharCode(bytes[index]);
      if (this.kind === 'list') { this.list(c); continue; }
      if (this.cr) { this.cr = false; this.script(c === '\n' ? '\r' : '\n'); }
      if (this.done) break;
      if (c === '\r') this.cr = true;
      else this.script(c);
    }
  }

  finish(): { tokens: Uint8Array[]; incomplete: boolean; limited: boolean } {
    if (this.cr && !this.done) this.script('\n');
    if (!this.done) {
      if (this.kind === 'script' && this.quote) this.incomplete = true;
      else if (this.active) this.emit();
    }
    return { tokens: this.tokens, incomplete: this.incomplete, limited: this.limited };
  }

  private emit(): void {
    this.tokens.push(textBytes(this.word));
    this.word = ''; this.active = false;
    if (this.bounded && this.tokens.length >= 4096) this.done = this.limited = true;
  }

  private append(c: string): void {
    // This limits advisory predictions, never the native input or operation.
    if (this.bounded && this.tokenBytes >= 65536) {
      this.done = this.limited = true;
      this.word = '';
      return;
    }
    this.tokenBytes++;
    this.word += c;
  }

  private list(c: string): void {
    if (c === '\0') {
      if (this.active) this.emit();
      this.done = true;
      return;
    }
    const whitespace = ' \t\r\n\f\v'.includes(c);
    if (this.suffix) { if (whitespace) this.suffix = false; return; }
    if (!this.active) {
      if (whitespace) return;
      this.active = true;
      if (c === '"' || c === "'") { this.quote = c; return; }
    } else if (this.quote ? c === this.quote : whitespace) {
      this.emit();
      this.suffix = Boolean(this.quote);
      this.quote = '';
      return;
    }
    this.append(c);
  }

  private script(c: string): void {
    const code = c.charCodeAt(0);
    if (code < 7 || (code > 13 && code < 32 && code !== 27)) {
      this.incomplete = true; this.done = true; return;
    }
    if (this.comment) {
      if (c === '\n') { this.comment = false; this.column = 0; }
      return;
    }
    if (this.escape) {
      this.escape = false;
      if (c === '\n') { this.column = 0; return; }
      if (!this.quote || c === '"' || c === '\\') {
        this.column++; this.append(c); this.active = true; return;
      }
      this.append('\\');
    }
    if (!this.quote && !this.active && (c === '#' || (this.column === 0 && (c === ':' || c === '@')))) {
      this.comment = true; return;
    }
    this.column = c === '\n' ? 0 : this.column + 1;
    if (c === '\\' && this.quote !== "'") { this.escape = true; return; }
    if (this.quote) {
      if (c === this.quote) this.quote = ''; else this.append(c);
    } else if (c === '"' || c === "'") { this.quote = c; this.active = true; }
    else if (' \t\r\n'.includes(c)) {
      if (this.active) this.emit();
    } else { this.append(c); this.active = true; }
  }
}
