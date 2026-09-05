type Cell = ([number, string] & { style?: string }) | null;
type Row = Cell[];

interface SgrStyleState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  conceal: boolean;
  strikethrough: boolean;
  fg?: number[];
  bg?: number[];
}

interface SavedCursorState {
  x: number;
  y: number;
  autoWrap: boolean;
  style: SgrStyleState;
  styleSequence: string;
}

interface PrimaryScreenState {
  screen: Row[];
  cursorX: number;
  cursorY: number;
  pendingWrap: boolean;
  style: SgrStyleState;
  styleSequence: string;
}

const RESET_SGR = "\x1b[0m";
const DEC_SPECIAL_GRAPHICS: Record<string, string> = {
  j: "┘",
  k: "┐",
  l: "┌",
  m: "└",
  n: "┼",
  q: "─",
  t: "├",
  u: "┤",
  v: "┴",
  w: "┬",
  x: "│"
};

const enum State {
  Normal,
  Escape,
  Csi,
  Osc,
  Str,
  StringEscape,
  EscCharset,
  EscHash
}

export class TerminalBuffer {
  private _cols: number;
  private _rows: number;
  private _screen: Row[];
  private _primaryScreen: PrimaryScreenState | null = null;
  private _cursorX = 0;
  private _cursorY = 0;
  private _savedCursor: SavedCursorState;
  private _scrollTop = 0;
  private _scrollBottom: number;
  private _state = State.Normal;
  private _csiParams = "";
  private _csiPrivate = "";
  private _autoWrap = true;
  private _pendingWrap = false;
  private _originMode = false;
  private _insertMode = false;
  private _tabStops: Set<number>;
  private _lastPrintedChar: string | null = null;
  private _style: SgrStyleState = createDefaultStyleState();
  private _styleSequence = "";
  private _stringState = State.Normal;
  private _charsetTarget: "g0" | "g1" | null = null;
  private _g0Charset: "ascii" | "graphics" = "ascii";
  private _g1Charset: "ascii" | "graphics" = "ascii";
  private _shiftOut = false;

  readonly displayBuffer: {
    readonly cursorX: number;
    readonly cursorY: number;
    readonly data: Array<Row | undefined>;
  };

  constructor(cols: number, rows: number) {
    this._cols = cols;
    this._rows = rows;
    this._scrollBottom = rows - 1;
    this._screen = this._makeScreen(cols, rows);
    this._tabStops = this._createDefaultTabStops(cols);
    this._savedCursor = this._createSavedCursorState();

    this.displayBuffer = Object.defineProperties(
      {} as {
        readonly cursorX: number;
        readonly cursorY: number;
        readonly data: Array<Row | undefined>;
      },
      {
        cursorX: { get: () => this._cursorX, enumerable: true },
        cursorY: { get: () => this._cursorY, enumerable: true },
        data: { get: () => this._screen as Array<Row | undefined>, enumerable: true }
      }
    );
  }

  write(data: string): void {
    for (const ch of data) {
      this._feed(ch);
    }
  }

  renderLine(row: number): string {
    const cells = this._screen[row] ?? [];
    let lastVisibleCell = -1;

    for (let index = cells.length - 1; index >= 0; index -= 1) {
      if (cells[index] !== null) {
        lastVisibleCell = index;
        break;
      }
    }

    if (lastVisibleCell === -1) {
      return "";
    }

    let line = "";
    let activeStyle = "";

    for (let index = 0; index <= lastVisibleCell; index += 1) {
      const cell = cells[index];
      const cellStyle = cell?.style ?? "";

      if (cellStyle !== activeStyle) {
        if (activeStyle.length > 0) {
          line += RESET_SGR;
        }
        line += cellStyle;
        activeStyle = cellStyle;
      }

      line += cell?.[1] ?? " ";
    }

    if (activeStyle.length > 0) {
      line += RESET_SGR;
    }

    return line;
  }

  resize(cols: number, rows: number): void {
    // Adjust row count
    while (this._screen.length < rows) {
      this._screen.push(this._makeRow(cols));
    }
    this._screen.length = rows;

    // Adjust col count for each row
    for (let y = 0; y < rows; y++) {
      const row = this._screen[y] ?? this._makeRow(cols);
      while (row.length < cols) row.push(null);
      row.length = cols;
      this._screen[y] = row;
    }

    this._cols = cols;
    this._rows = rows;
    this._scrollTop = this._clamp(this._scrollTop, 0, rows - 1);
    this._scrollBottom = this._clamp(this._scrollBottom, 0, rows - 1);
    if (this._scrollTop >= this._scrollBottom) {
      this._scrollTop = 0;
      this._scrollBottom = rows - 1;
    }
    this._cursorX = this._clamp(this._cursorX, 0, cols - 1);
    this._cursorY = this._clamp(this._cursorY, 0, rows - 1);
  }

  private _makeScreen(cols: number, rows: number): Row[] {
    return Array.from({ length: rows }, () => this._makeRow(cols));
  }

  private _makeRow(cols: number): Row {
    return Array(cols).fill(null) as Row;
  }

  private _createDefaultTabStops(cols: number): Set<number> {
    const tabStops = new Set<number>();
    for (let column = 8; column < cols; column += 8) {
      tabStops.add(column);
    }
    return tabStops;
  }

  private _clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private _createSavedCursorState(): SavedCursorState {
    return {
      x: this._cursorX,
      y: this._cursorY,
      autoWrap: this._autoWrap,
      style: { ...this._style, fg: this._style.fg?.slice(), bg: this._style.bg?.slice() },
      styleSequence: this._styleSequence
    };
  }

  private _saveCursor(): void {
    this._savedCursor = this._createSavedCursorState();
  }

  private _restoreCursor(): void {
    this._cursorX = this._clamp(this._savedCursor.x, 0, this._cols - 1);
    this._cursorY = this._clamp(this._savedCursor.y, 0, this._rows - 1);
    this._autoWrap = this._savedCursor.autoWrap;
    this._style = {
      ...this._savedCursor.style,
      fg: this._savedCursor.style.fg?.slice(),
      bg: this._savedCursor.style.bg?.slice()
    };
    this._styleSequence = this._savedCursor.styleSequence;
  }

  private _resetModes(): void {
    this._autoWrap = true;
    this._originMode = false;
    this._insertMode = false;
    this._pendingWrap = false;
    this._tabStops = this._createDefaultTabStops(this._cols);
    this._g0Charset = "ascii";
    this._g1Charset = "ascii";
    this._shiftOut = false;
    this._resetStyle();
  }

  private _writePrintable(ch: string): void {
    const width = this._cellWidth(ch);

    if (width === 0) {
      this._appendCombiningMark(ch);
      return;
    }

    if (this._autoWrap && this._pendingWrap) {
      this._cursorX = 0;
      this._newline();
    } else if (this._autoWrap && this._cursorX + width > this._cols) {
      this._cursorX = 0;
      this._newline();
    }

    if (this._insertMode) {
      const row = this._screen[this._cursorY];
      if (row) {
        row.splice(this._cursorX, 0, ...(Array(width).fill(null) as Cell[]));
        row.splice(this._cols);
      }
    }

    this._setChar(this._cursorY, this._cursorX, ch);
    for (let column = 1; column < width && this._cursorX + column < this._cols; column += 1) {
      const row = this._screen[this._cursorY];
      if (row) row[this._cursorX + column] = null;
    }
    this._lastPrintedChar = ch;

    if (!this._autoWrap) {
      this._cursorX = Math.min(this._cursorX + width, this._cols - 1);
      this._pendingWrap = false;
    } else if (this._cursorX + width >= this._cols) {
      this._cursorX = this._cols - 1;
      this._pendingWrap = true;
    } else {
      this._cursorX += width;
      this._pendingWrap = false;
    }
  }

  private _cellWidth(ch: string): number {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) return 0;
    if (isCombiningCodePoint(codePoint)) {
      return 0;
    }
    if (
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
      (codePoint >= 0x3041 && codePoint <= 0x33bf) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f200 && codePoint <= 0x1fffd) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    ) {
      return Math.min(2, this._cols);
    }
    return 1;
  }

  private _appendCombiningMark(ch: string): void {
    const target = this._findCombiningTarget();
    if (target === null) {
      return;
    }

    const cell = this._screen[target.y]?.[target.x];
    if (cell === null || cell === undefined) {
      return;
    }

    cell[1] += ch;
  }

  private _findCombiningTarget(): { x: number; y: number } | null {
    const startX = this._pendingWrap ? this._cursorX : this._cursorX - 1;

    for (let y = this._cursorY; y >= 0; y -= 1) {
      const row = this._screen[y];
      if (row === undefined) {
        continue;
      }

      for (let x = y === this._cursorY ? startX : this._cols - 1; x >= 0; x -= 1) {
        if (row[x] !== null) {
          return { x, y };
        }
      }
    }

    return null;
  }

  private _setChar(y: number, x: number, ch: string): void {
    const row = this._screen[y];
    if (row && x >= 0 && x < this._cols) {
      const renderedChar = this._style.conceal ? " " : ch;
      const cell = [renderedChar.charCodeAt(0), renderedChar] as Exclude<Cell, null>;

      if (this._styleSequence.length > 0) {
        Object.defineProperty(cell, "style", {
          value: this._styleSequence,
          writable: true,
          configurable: true
        });
      }

      row[x] = cell;
    }
  }

  private _eraseLine(y: number, fromX: number, toX: number): void {
    const row = this._screen[y];
    if (!row) return;
    for (let x = fromX; x <= toX && x < this._cols; x++) {
      row[x] = null;
    }
  }

  private _scrollUp(count: number): void {
    for (let i = 0; i < count; i++) {
      this._screen.splice(this._scrollTop, 1);
      this._screen.splice(this._scrollBottom, 0, this._makeRow(this._cols));
    }
  }

  private _scrollDown(count: number): void {
    for (let i = 0; i < count; i++) {
      this._screen.splice(this._scrollBottom, 1);
      this._screen.splice(this._scrollTop, 0, this._makeRow(this._cols));
    }
  }

  private _newline(): void {
    this._pendingWrap = false;
    if (this._cursorY === this._scrollBottom) {
      this._scrollUp(1);
    } else {
      this._cursorY = Math.min(this._cursorY + 1, this._rows - 1);
    }
  }

  private _parseCsiParams(): number[] {
    if (!this._csiParams) return [];
    const values = this._csiParams
      .split(";")
      .flatMap((segment) => segment.split(":"))
      .map((segment) => (segment === "" ? 0 : parseInt(segment, 10)));
    if ((values[0] === 38 || values[0] === 48) && values[1] === 2 && values[2] === 0) {
      values.splice(2, 1);
    }
    return values;
  }

  private _execCsi(final: string): void {
    const params = this._parseCsiParams();
    const p0 = params[0] ?? 0;
    const p1 = params[1] ?? 0;

    if (this._csiPrivate === "?") {
      if (final === "h" || final === "l") {
        if (params.includes(7)) {
          this._autoWrap = final === "h";
        }

        if (params.includes(6)) {
          this._originMode = final === "h";
          this._cursorX = 0;
          this._cursorY = this._originMode ? this._scrollTop : 0;
        }

        if (params.includes(1049)) {
          if (final === "h") {
            this._primaryScreen = {
              screen: this._screen,
              cursorX: this._cursorX,
              cursorY: this._cursorY,
              pendingWrap: this._pendingWrap,
              style: { ...this._style, fg: this._style.fg?.slice(), bg: this._style.bg?.slice() },
              styleSequence: this._styleSequence
            };
            this._screen = this._makeScreen(this._cols, this._rows);
            this._cursorX = 0;
            this._cursorY = 0;
            this._pendingWrap = false;
          } else {
            if (this._primaryScreen !== null) {
              this._screen = this._primaryScreen.screen;
              this._cursorX = this._primaryScreen.cursorX;
              this._cursorY = this._primaryScreen.cursorY;
              this._pendingWrap = this._primaryScreen.pendingWrap;
              this._style = this._primaryScreen.style;
              this._styleSequence = this._primaryScreen.styleSequence;
              this._primaryScreen = null;
            }
          }
          if (final === "h") this._resetStyle();
        }
      }
      return;
    }

    if ((final === "h" || final === "l") && params.includes(4)) {
      this._insertMode = final === "h";
      return;
    }

    switch (final) {
      case "A": // cursor up
        this._cursorY = this._clamp(this._cursorY - Math.max(1, p0), 0, this._rows - 1);
        break;
      case "B": // cursor down
        this._cursorY = this._clamp(this._cursorY + Math.max(1, p0), 0, this._rows - 1);
        break;
      case "C": // cursor forward
      case "a":
        this._cursorX = this._clamp(this._cursorX + Math.max(1, p0), 0, this._cols - 1);
        break;
      case "D": // cursor backward
        this._cursorX = this._clamp(this._cursorX - Math.max(1, p0), 0, this._cols - 1);
        break;
      case "E": // cursor next line
        this._cursorY = this._clamp(this._cursorY + Math.max(1, p0), 0, this._rows - 1);
        this._cursorX = 0;
        break;
      case "F": // cursor preceding line
        this._cursorY = this._clamp(this._cursorY - Math.max(1, p0), 0, this._rows - 1);
        this._cursorX = 0;
        break;
      case "G": // cursor horizontal absolute
      case "`":
        this._cursorX = this._clamp(Math.max(1, p0) - 1, 0, this._cols - 1);
        break;
      case "H": // cursor position
      case "f":
        this._cursorY = this._originMode
          ? this._clamp(this._scrollTop + Math.max(1, p0) - 1, this._scrollTop, this._scrollBottom)
          : this._clamp(Math.max(1, p0) - 1, 0, this._rows - 1);
        this._cursorX = this._clamp(Math.max(1, p1) - 1, 0, this._cols - 1);
        break;
      case "I": // cursor forward tabulation
        for (let i = 0; i < Math.max(1, p0); i++) {
          this._cursorX = Math.min(this._cols - 1, (Math.floor(this._cursorX / 8) + 1) * 8);
        }
        break;
      case "J": // erase in display
        if (p0 === 0) {
          this._eraseLine(this._cursorY, this._cursorX, this._cols - 1);
          for (let y = this._cursorY + 1; y < this._rows; y++)
            this._eraseLine(y, 0, this._cols - 1);
        } else if (p0 === 1) {
          for (let y = 0; y < this._cursorY; y++) this._eraseLine(y, 0, this._cols - 1);
          this._eraseLine(this._cursorY, 0, this._cursorX);
        } else if (p0 === 2) {
          for (let y = 0; y < this._rows; y++) this._eraseLine(y, 0, this._cols - 1);
        }
        break;
      case "K": // erase in line
        if (p0 === 0) this._eraseLine(this._cursorY, this._cursorX, this._cols - 1);
        else if (p0 === 1) this._eraseLine(this._cursorY, 0, this._cursorX);
        else if (p0 === 2) this._eraseLine(this._cursorY, 0, this._cols - 1);
        break;
      case "X": // erase characters (ECH)
        this._eraseLine(this._cursorY, this._cursorX, this._cursorX + Math.max(1, p0) - 1);
        break;
      case "L": {
        // insert lines
        if (this._cursorY < this._scrollTop || this._cursorY > this._scrollBottom) {
          break;
        }
        const n = Math.max(1, p0);
        for (let i = 0; i < n; i++) {
          this._screen.splice(this._scrollBottom, 1);
          this._screen.splice(this._cursorY, 0, this._makeRow(this._cols));
        }
        break;
      }
      case "M": {
        // delete lines
        if (this._cursorY < this._scrollTop || this._cursorY > this._scrollBottom) {
          break;
        }
        const n = Math.max(1, p0);
        for (let i = 0; i < n; i++) {
          this._screen.splice(this._cursorY, 1);
          this._screen.splice(this._scrollBottom, 0, this._makeRow(this._cols));
        }
        break;
      }
      case "P": {
        // delete characters
        const row = this._screen[this._cursorY];
        if (row) {
          const n = Math.max(1, p0);
          row.splice(this._cursorX, n);
          while (row.length < this._cols) row.push(null);
        }
        break;
      }
      case "@": {
        // insert blank characters
        const row = this._screen[this._cursorY];
        if (row) {
          const n = Math.max(1, p0);
          for (let i = 0; i < n; i++) row.splice(this._cursorX, 0, null);
          row.splice(this._cols);
        }
        break;
      }
      case "S": // scroll up
        this._scrollUp(Math.max(1, p0));
        break;
      case "T": // scroll down
        if (params.length <= 1) this._scrollDown(Math.max(1, p0));
        break;
      case "Z": {
        // cursor backward tabulation
        const n = Math.max(1, p0);
        for (let i = 0; i < n; i++) {
          this._cursorX = Math.max(0, (Math.ceil(this._cursorX / 8) - 1) * 8);
        }
        break;
      }
      case "b": // repeat preceding character
        if (this._lastPrintedChar !== null) {
          for (let index = 0; index < Math.max(1, p0); index += 1) {
            this._writePrintable(this._lastPrintedChar);
          }
        }
        break;
      case "d": // line position absolute
        this._cursorY = this._clamp(Math.max(1, p0) - 1, 0, this._rows - 1);
        break;
      case "e": // vertical position relative
        this._cursorY = this._clamp(this._cursorY + Math.max(1, p0), 0, this._rows - 1);
        break;
      case "r": {
        // set scrolling region
        const top = this._clamp(Math.max(1, p0) - 1, 0, this._rows - 1);
        const bottom = this._clamp((p1 === 0 ? this._rows : p1) - 1, 0, this._rows - 1);
        if (top < bottom) {
          this._scrollTop = top;
          this._scrollBottom = bottom;
        }
        this._cursorX = 0;
        this._cursorY = this._originMode ? this._scrollTop : 0;
        break;
      }
      case "s": // save cursor
        this._saveCursor();
        break;
      case "u": // restore cursor
        this._restoreCursor();
        break;
      case "p":
        if (this._csiPrivate === "!") {
          this._resetModes();
        }
        break;
      case "m":
        this._applySgr(params);
        break;
      default:
        break;
    }
  }

  private _feed(ch: string): void {
    const code = ch.charCodeAt(0);

    if (this._state !== State.Normal && (code === 0x18 || code === 0x1a)) {
      this._state = State.Normal;
      return;
    }

    if (this._state === State.Csi && code === 0x1b) {
      this._state = State.Escape;
      return;
    }

    switch (this._state) {
      case State.Normal:
        this._feedNormal(ch, code);
        break;
      case State.Escape:
        this._feedEscape(ch, code);
        break;
      case State.Csi:
        this._feedCsi(ch, code);
        break;
      case State.Osc:
        // consume until BEL or ST
        if (code === 0x07 || code === 0x9c) {
          this._state = State.Normal;
        } else if (code === 0x1b) {
          this._stringState = State.Osc;
          this._state = State.StringEscape;
        }
        break;
      case State.Str:
        // consume until ST
        if (code === 0x9c) {
          this._state = State.Normal;
        } else if (code === 0x1b) {
          this._stringState = State.Str;
          this._state = State.StringEscape;
        }
        break;
      case State.StringEscape:
        this._state = ch === "\\" ? State.Normal : this._stringState;
        break;
      case State.EscCharset:
        if (this._charsetTarget === "g0") this._g0Charset = ch === "0" ? "graphics" : "ascii";
        if (this._charsetTarget === "g1") this._g1Charset = ch === "0" ? "graphics" : "ascii";
        this._charsetTarget = null;
        this._state = State.Normal;
        break;
      case State.EscHash:
        if (ch === "8") {
          for (let row = 0; row < this._rows; row += 1) {
            for (let column = 0; column < this._cols; column += 1) {
              this._setChar(row, column, "E");
            }
          }
          this._cursorX = 0;
          this._cursorY = 0;
        }
        this._state = State.Normal;
        break;
    }
  }

  private _feedNormal(ch: string, code: number): void {
    if (code === 0x1b) {
      this._state = State.Escape;
    } else if (code === 0x9b) {
      // C1 CSI
      this._csiParams = "";
      this._csiPrivate = "";
      this._state = State.Csi;
    } else if (code === 0x9d) {
      // C1 OSC
      this._state = State.Osc;
    } else if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      // DCS, SOS, PM, APC
      this._state = State.Str;
    } else if (code === 0x85) {
      // C1 NEL = next line
      this._cursorX = 0;
      this._newline();
    } else if (code === 0x9c) {
      // C1 ST outside a string has no visible effect
    } else if (code === 0x07 || code === 0x05 || code === 0x06) {
      // BEL, ENQ, ACK — ignore
    } else if (code === 0x08) {
      // BS
      this._pendingWrap = false;
      if (this._cursorX > 0) this._cursorX--;
    } else if (code === 0x7f) {
      // DEL — ignore in displayed output
    } else if (code === 0x09) {
      // HT
      const nextTabStop = [...this._tabStops]
        .sort((left, right) => left - right)
        .find((tabStop) => tabStop > this._cursorX);
      this._cursorX = nextTabStop ?? this._cols - 1;
    } else if (code === 0x0a || code === 0x0b || code === 0x0c) {
      // LF, VT, FF
      this._newline();
    } else if (code === 0x0d) {
      // CR
      this._pendingWrap = false;
      this._cursorX = 0;
    } else if (code === 0x0e || code === 0x0f) {
      // SO, SI — shift between G1 and G0 character sets
      this._shiftOut = code === 0x0e;
    } else if (code >= 0x20 && code !== 0x7f) {
      // Printable character (including multi-byte Unicode via code points)
      const charset = this._shiftOut ? this._g1Charset : this._g0Charset;
      this._writePrintable(charset === "graphics" ? (DEC_SPECIAL_GRAPHICS[ch] ?? ch) : ch);
    }
  }

  private _feedEscape(ch: string, code: number): void {
    this._state = State.Normal;

    if (code === 0x5b) {
      // ESC [ = CSI
      this._csiParams = "";
      this._csiPrivate = "";
      this._state = State.Csi;
    } else if (code === 0x5d) {
      // ESC ] = OSC
      this._state = State.Osc;
    } else if (code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f) {
      // DCS, SOS, PM, APC
      this._state = State.Str;
    } else if (
      code === 0x28 ||
      code === 0x29 ||
      code === 0x2a ||
      code === 0x2b ||
      code === 0x2d ||
      code === 0x2e
    ) {
      // ESC ( ) * + - . = charset designation (consume next char)
      this._charsetTarget = code === 0x28 ? "g0" : code === 0x29 ? "g1" : null;
      this._state = State.EscCharset;
    } else if (code === 0x23) {
      // ESC # = line attributes (consume next char)
      this._state = State.EscHash;
    } else if (code === 0x37) {
      // ESC 7 = save cursor
      this._saveCursor();
    } else if (code === 0x38) {
      // ESC 8 = restore cursor
      this._restoreCursor();
    } else if (code === 0x44) {
      // ESC D = index (LF)
      this._newline();
    } else if (code === 0x45) {
      // ESC E = next line
      this._cursorX = 0;
      this._newline();
    } else if (code === 0x4d) {
      // ESC M = reverse index
      if (this._cursorY === this._scrollTop) {
        this._scrollDown(1);
      } else {
        this._cursorY = Math.max(0, this._cursorY - 1);
      }
    } else if (code === 0x48) {
      // ESC H = horizontal tab set
      this._tabStops.add(this._cursorX);
    } else if (code === 0x63) {
      // ESC c = full reset
      this._screen = this._makeScreen(this._cols, this._rows);
      this._cursorX = 0;
      this._cursorY = 0;
      this._scrollTop = 0;
      this._scrollBottom = this._rows - 1;
      this._resetModes();
      this._savedCursor = this._createSavedCursorState();
    }
    // All other ESC sequences: two-char, already consumed — ignore
  }

  private _feedCsi(ch: string, code: number): void {
    if (code >= 0x40 && code <= 0x7e) {
      // Final byte
      this._execCsi(ch);
      this._state = State.Normal;
    } else if (code === 0x3f || code === 0x21 || code === 0x3e || code === 0x20) {
      // Private/intermediate marker (?, !, >, space)
      this._csiPrivate = ch;
    } else if ((code >= 0x30 && code <= 0x39) || code === 0x3b || code === 0x3a) {
      // Digit, semicolon, or colon — parameter byte
      this._csiParams += ch;
    }
    // Other bytes ignored
  }

  private _resetStyle(): void {
    this._style = createDefaultStyleState();
    this._styleSequence = "";
  }

  private _applySgr(params: number[]): void {
    const normalizedParams = params.length === 0 ? [0] : params;

    for (let index = 0; index < normalizedParams.length; index += 1) {
      const value = normalizedParams[index] ?? 0;

      switch (value) {
        case 0:
          this._resetStyle();
          break;
        case 1:
          this._style.bold = true;
          break;
        case 2:
          this._style.dim = true;
          break;
        case 3:
          this._style.italic = true;
          break;
        case 4:
          this._style.underline = true;
          break;
        case 7:
          this._style.inverse = true;
          break;
        case 8:
          this._style.conceal = true;
          break;
        case 9:
          this._style.strikethrough = true;
          break;
        case 21:
        case 22:
          this._style.bold = false;
          this._style.dim = false;
          break;
        case 23:
          this._style.italic = false;
          break;
        case 24:
          this._style.underline = false;
          break;
        case 27:
          this._style.inverse = false;
          break;
        case 28:
          this._style.conceal = false;
          break;
        case 29:
          this._style.strikethrough = false;
          break;
        case 39:
          this._style.fg = undefined;
          break;
        case 49:
          this._style.bg = undefined;
          break;
        case 38:
        case 48:
          index = this._applyExtendedColor(value, normalizedParams, index);
          break;
        default:
          if ((value >= 30 && value <= 37) || (value >= 90 && value <= 97)) {
            this._style.fg = [value];
          } else if ((value >= 40 && value <= 47) || (value >= 100 && value <= 107)) {
            this._style.bg = [value];
          }
          break;
      }
    }

    this._styleSequence = serializeStyleState(this._style);
  }

  private _applyExtendedColor(control: 38 | 48, params: number[], index: number): number {
    const mode = params[index + 1];
    const target = control === 38 ? "fg" : "bg";

    if (mode === 5) {
      const paletteIndex = params[index + 2];
      if (paletteIndex !== undefined) {
        this._style[target] = [control, 5, paletteIndex];
        return index + 2;
      }

      return index;
    }

    if (mode === 2) {
      const red = params[index + 2];
      const green = params[index + 3];
      const blue = params[index + 4];
      if (red !== undefined && green !== undefined && blue !== undefined) {
        this._style[target] = [control, 2, red, green, blue];
        return index + 4;
      }
    }

    return index;
  }
}

function createDefaultStyleState(): SgrStyleState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    conceal: false,
    strikethrough: false
  };
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function serializeStyleState(state: SgrStyleState): string {
  const codes: number[] = [];

  if (state.bold) {
    codes.push(1);
  }
  if (state.dim) {
    codes.push(2);
  }
  if (state.italic) {
    codes.push(3);
  }
  if (state.underline) {
    codes.push(4);
  }
  if (state.inverse) {
    codes.push(7);
  }
  if (state.conceal) {
    codes.push(8);
  }
  if (state.strikethrough) {
    codes.push(9);
  }
  if (state.fg !== undefined) {
    codes.push(...state.fg);
  }
  if (state.bg !== undefined) {
    codes.push(...state.bg);
  }

  return codes.length === 0 ? "" : `\x1b[${codes.join(";")}m`;
}
