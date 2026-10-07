function* cffValidationMath(command, stack, size) {
    const values = [yield stack.get(size - 2), yield stack.get(size - 1)];
    command.stackFn(values, 2);
    if (size >= 2) yield stack.set(size - 2, values[0]);
    yield stack.set(size - 1, values[1]);
  }
/* eslint-disable */
/* Mozilla PDF.js, Apache-2.0. Generated from 91041fb94d6744bc2a5bccd9aad28d617faa8195; see THIRD_PARTY_NOTICES.md. */

// src/core/cmap.js
var MAX_MAP_RANGE = 2 ** 24 - 1;
var CMap = class {
  // Map entries have one of two forms.
  // - cid chars are 16-bit unsigned integers, stored as integers.
  // - bf chars are variable-length byte sequences, stored as strings, with
  //   one byte per character.
  #map = /* @__PURE__ */ new Map();
  #mappedEntries = 0;
  #onAllocation;
  constructor(builtInCMap = false, onAllocation) {
    this.#onAllocation = onAllocation;
    this.codespaceRanges = [[], [], [], []];
    this.numCodespaceRanges = 0;
    this.name = "";
    this.vertical = false;
    this.useCMap = null;
    this.builtInCMap = builtInCMap;
  }
  addCodespaceRange(n, low, high) {
    this.#onAllocation?.(16);
    this.codespaceRanges[n - 1].push(low, high);
    this.numCodespaceRanges++;
  }
  #consumeBudget(count, name, bytesPerEntry = 64) {
    if (count <= 0) {
      return;
    }
    if (this.#mappedEntries + count > MAX_MAP_RANGE) {
      throw new Error(`${name} - ignoring data above MAX_MAP_RANGE.`);
    }
    this.#onAllocation?.(count * bytesPerEntry);
    this.#mappedEntries += count;
  }
  mapCidRange(low, high, dstLow) {
    this.#consumeBudget(high - low + 1, "mapCidRange");
    while (low <= high) {
      this.#map.set(low++, dstLow++);
    }
  }
  mapBfRange(low, high, dstLow) {
    this.#consumeBudget(high - low + 1, "mapBfRange", 64 + 4 * (dstLow.length + 2));
    const lastByte = dstLow.length - 1;
    while (low <= high) {
      this.#map.set(low++, dstLow);
      const nextCharCode = dstLow.charCodeAt(lastByte) + 1;
      if (nextCharCode > 255) {
        dstLow = dstLow.substring(0, lastByte - 1) + String.fromCharCode(dstLow.charCodeAt(lastByte - 1) + 1) + "\0";
        continue;
      }
      dstLow = dstLow.substring(0, lastByte) + String.fromCharCode(nextCharCode);
    }
  }
  mapBfRangeToArray(low, high, array) {
    const ii = array.length;
    this.#consumeBudget(Math.min(high - low + 1, ii), "mapBfRangeToArray");
    let i = 0;
    while (low <= high && i < ii) {
      this.#map.set(low++, array[i++]);
    }
  }
  // This is used for both bf and cid chars.
  mapOne(src, dst) {
    this.#onAllocation?.(64 + (typeof dst === "string" ? dst.length * 2 : 0));
    this.#map.set(src, dst);
  }
  lookup(code) {
    return this.#map.get(code);
  }
  contains(code) {
    return this.#map.has(code);
  }
  forEach(callback) {
    for (const [charCode, entry] of this.#map) {
      callback(charCode, entry);
    }
  }
  charCodeOf(value) {
    for (const [charCode, entry] of this.#map) {
      if (entry === value) {
        return charCode;
      }
    }
    return -1;
  }
  getMap() {
    return new Map(this.#map);
  }
  readCharCode(str, offset, out) {
    let c = 0;
    const codespaceRanges = this.codespaceRanges;
    for (let n = 0, nn = codespaceRanges.length; n < nn; n++) {
      c = (c << 8 | str.charCodeAt(offset + n)) >>> 0;
      const codespaceRange = codespaceRanges[n];
      for (let k = 0, kk = codespaceRange.length; k < kk; ) {
        const low = codespaceRange[k++];
        const high = codespaceRange[k++];
        if (c >= low && c <= high) {
          out.charcode = c;
          out.length = n + 1;
          return;
        }
      }
    }
    out.charcode = 0;
    out.length = 1;
  }
  getCharCodeLength(charCode) {
    const codespaceRanges = this.codespaceRanges;
    for (let n = 0, nn = codespaceRanges.length; n < nn; n++) {
      const codespaceRange = codespaceRanges[n];
      for (let k = 0, kk = codespaceRange.length; k < kk; ) {
        const low = codespaceRange[k++];
        const high = codespaceRange[k++];
        if (charCode >= low && charCode <= high) {
          return n + 1;
        }
      }
    }
    return 1;
  }
  get size() {
    return this.#map.size;
  }
  get isIdentityCMap() {
    if (!(this.name === "Identity-H" || this.name === "Identity-V")) {
      return false;
    }
    if (this.#map.size !== 65536) {
      return false;
    }
    for (let i = 0; i < 65536; i++) {
      if (this.#map.get(i) !== i) {
        return false;
      }
    }
    return true;
  }
};

// src/shared/util.js
var isNodeJS = (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) && typeof process === "object" && process + "" === "[object process]" && !process.versions.nw && !(process.versions.electron && process.type && process.type !== "browser");
var BBOX_INIT = [Infinity, Infinity, -Infinity, -Infinity];
var F32_BBOX_INIT = new Float32Array(BBOX_INIT);
var FONT_IDENTITY_MATRIX = [1e-3, 0, 0, 1e-3, 0, 0];
var LINE_FACTOR = 1.35;
var LINE_DESCENT_FACTOR = 0.35;
var BASELINE_FACTOR = LINE_DESCENT_FACTOR / LINE_FACTOR;
var MeshFigureType = {
  TRIANGLES: 1,
  LATTICE: 2,
  PATCH: 3
};
var VerbosityLevel = {
  ERRORS: 0,
  WARNINGS: 1,
  INFOS: 5
};
var DrawOPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4
};
var PasswordResponses = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2
};
var verbosity = VerbosityLevel.WARNINGS;
function info(msg) {
  if (verbosity >= VerbosityLevel.INFOS) {
    console.info(`Info: ${msg}`);
  }
}
function warn(msg) {
  if (verbosity >= VerbosityLevel.WARNINGS) {
    console.warn(`Warning: ${msg}`);
  }
}
function unreachable(msg) {
  throw new Error(msg);
}
function assert(cond, msg) {
  if (!cond) {
    unreachable(msg);
  }
}
function shadow(obj, prop, value, nonSerializable2 = false) {
  if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
    assert(
      prop in obj,
      `shadow: Property "${prop && prop.toString()}" not found in object.`
    );
  }
  Object.defineProperty(obj, prop, {
    value,
    enumerable: !nonSerializable2,
    configurable: true,
    writable: false
  });
  return value;
}
var BaseException = (function BaseExceptionClosure() {
  function BaseException2(message, name) {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === BaseException2) {
      unreachable("Cannot initialize BaseException.");
    }
    this.message = message;
    this.name = name;
  }
  BaseException2.prototype = new Error();
  BaseException2.constructor = BaseException2;
  return BaseException2;
})();
var PasswordException = class extends BaseException {
  constructor(msg, code) {
    super(msg, "PasswordException");
    this.code = code;
  }
};
var FormatError = class extends BaseException {
  constructor(msg) {
    super(msg, "FormatError");
  }
};
function bytesToString(bytes) {
  if (typeof bytes !== "object" || bytes?.length === void 0) {
    unreachable("Invalid argument for bytesToString");
  }
  const length = bytes.length;
  const MAX_ARGUMENT_COUNT = 8192;
  if (length < MAX_ARGUMENT_COUNT) {
    return String.fromCharCode.apply(null, bytes);
  }
  const strBuf = [];
  for (let i = 0; i < length; i += MAX_ARGUMENT_COUNT) {
    const chunkEnd = Math.min(i + MAX_ARGUMENT_COUNT, length);
    const chunk = bytes.subarray(i, chunkEnd);
    strBuf.push(String.fromCharCode.apply(null, chunk));
  }
  return strBuf.join("");
}
function stringToBytes(str) {
  if (typeof str !== "string") {
    unreachable("Invalid argument for stringToBytes");
  }
  const length = str.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; ++i) {
    bytes[i] = str.charCodeAt(i) & 255;
  }
  return bytes;
}
var FeatureTest = class {
  static get isLittleEndian() {
    const buffer8 = new Uint8Array(4);
    buffer8[0] = 1;
    const view32 = new Uint32Array(buffer8.buffer, 0, 1);
    return shadow(this, "isLittleEndian", view32[0] === 1);
  }
  static get isOffscreenCanvasSupported() {
    return shadow(
      this,
      "isOffscreenCanvasSupported",
      typeof OffscreenCanvas !== "undefined"
    );
  }
  static get isImageDecoderSupported() {
    return shadow(
      this,
      "isImageDecoderSupported",
      typeof ImageDecoder !== "undefined"
    );
  }
  static get isFloat16ArraySupported() {
    return shadow(
      this,
      "isFloat16ArraySupported",
      typeof Float16Array !== "undefined"
    );
  }
  static get isSanitizerSupported() {
    return shadow(
      this,
      "isSanitizerSupported",
      typeof Sanitizer !== "undefined"
    );
  }
  static get platform() {
    const { platform, userAgent } = navigator;
    return shadow(this, "platform", {
      isAndroid: userAgent.includes("Android"),
      isLinux: platform.includes("Linux"),
      isMac: platform.includes("Mac"),
      isWindows: platform.includes("Win"),
      isFirefox: typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL") || userAgent.includes("Firefox")
    });
  }
  static get isCanvasFilterSupported() {
    let ctx;
    if (this.isOffscreenCanvasSupported) {
      ctx = new OffscreenCanvas(1, 1).getContext("2d");
    } else if ((typeof PDFJSDev === "undefined" || !PDFJSDev.test("WORKER_THREAD")) && typeof document !== "undefined") {
      ctx = document.createElement("canvas").getContext("2d");
    }
    return shadow(this, "isCanvasFilterSupported", ctx?.filter !== void 0);
  }
  static get isAlphaColorInputSupported() {
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("WORKER_THREAD") || typeof document === "undefined") {
      return shadow(this, "isAlphaColorInputSupported", false);
    }
    const input = document.createElement("input");
    input.type = "color";
    input.setAttribute("alpha", "");
    input.value = "#ff000080";
    return shadow(
      this,
      "isAlphaColorInputSupported",
      input.value !== "#ff0000"
    );
  }
  static get isBackdropFilterSupported() {
    return shadow(
      this,
      "isBackdropFilterSupported",
      typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "blur(1px)")
    );
  }
};
var Util = class {
  static get hexNums() {
    return shadow(
      this,
      "hexNums",
      Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, "0"))
    );
  }
  static makeHexColor(r, g, b) {
    return `#${this.hexNums[r]}${this.hexNums[g]}${this.hexNums[b]}`;
  }
  // Concatenates two transformation matrices together and returns the result.
  static transform(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }
  // Multiplies m (an array-based transform) by md (a DOMMatrix transform).
  static multiplyByDOMMatrix(m, md) {
    return [
      m[0] * md.a + m[2] * md.b,
      m[1] * md.a + m[3] * md.b,
      m[0] * md.c + m[2] * md.d,
      m[1] * md.c + m[3] * md.d,
      m[0] * md.e + m[2] * md.f + m[4],
      m[1] * md.e + m[3] * md.f + m[5]
    ];
  }
  // For 2d affine transforms
  static applyTransform(p, m, pos = 0) {
    const p0 = p[pos];
    const p1 = p[pos + 1];
    p[pos] = p0 * m[0] + p1 * m[2] + m[4];
    p[pos + 1] = p0 * m[1] + p1 * m[3] + m[5];
  }
  static applyTransformToBezier(p, transform, pos = 0) {
    const m0 = transform[0];
    const m1 = transform[1];
    const m2 = transform[2];
    const m3 = transform[3];
    const m4 = transform[4];
    const m5 = transform[5];
    for (let i = 0; i < 6; i += 2) {
      const pI = p[pos + i];
      const pI1 = p[pos + i + 1];
      p[pos + i] = pI * m0 + pI1 * m2 + m4;
      p[pos + i + 1] = pI * m1 + pI1 * m3 + m5;
    }
  }
  static applyInverseTransform(p, m) {
    const p0 = p[0];
    const p1 = p[1];
    const d = m[0] * m[3] - m[1] * m[2];
    p[0] = (p0 * m[3] - p1 * m[2] + m[2] * m[5] - m[4] * m[3]) / d;
    p[1] = (-p0 * m[1] + p1 * m[0] + m[4] * m[1] - m[5] * m[0]) / d;
  }
  // Applies the transform to the rectangle and finds the minimum axially
  // aligned bounding box.
  static axialAlignedBoundingBox(rect, transform, output) {
    const m0 = transform[0];
    const m1 = transform[1];
    const m2 = transform[2];
    const m3 = transform[3];
    const m4 = transform[4];
    const m5 = transform[5];
    const r0 = rect[0];
    const r1 = rect[1];
    const r2 = rect[2];
    const r3 = rect[3];
    let a0 = m0 * r0 + m4;
    let a2 = a0;
    let a1 = m0 * r2 + m4;
    let a3 = a1;
    let b0 = m3 * r1 + m5;
    let b2 = b0;
    let b1 = m3 * r3 + m5;
    let b3 = b1;
    if (m1 !== 0 || m2 !== 0) {
      const m1r0 = m1 * r0;
      const m1r2 = m1 * r2;
      const m2r1 = m2 * r1;
      const m2r3 = m2 * r3;
      a0 += m2r1;
      a3 += m2r1;
      a1 += m2r3;
      a2 += m2r3;
      b0 += m1r0;
      b3 += m1r0;
      b1 += m1r2;
      b2 += m1r2;
    }
    output[0] = Math.min(output[0], a0, a1, a2, a3);
    output[1] = Math.min(output[1], b0, b1, b2, b3);
    output[2] = Math.max(output[2], a0, a1, a2, a3);
    output[3] = Math.max(output[3], b0, b1, b2, b3);
  }
  static inverseTransform(m) {
    const d = m[0] * m[3] - m[1] * m[2];
    return [
      m[3] / d,
      -m[1] / d,
      -m[2] / d,
      m[0] / d,
      (m[2] * m[5] - m[4] * m[3]) / d,
      (m[4] * m[1] - m[5] * m[0]) / d
    ];
  }
  // This calculation uses Singular Value Decomposition.
  // The SVD can be represented with formula A = USV. We are interested in the
  // matrix S here because it represents the scale values.
  static singularValueDecompose2dScale(matrix, output) {
    const m0 = matrix[0];
    const m1 = matrix[1];
    const m2 = matrix[2];
    const m3 = matrix[3];
    const a = m0 ** 2 + m1 ** 2;
    const b = m0 * m2 + m1 * m3;
    const c = m2 ** 2 + m3 ** 2;
    const first = (a + c) / 2;
    const second = Math.sqrt(first ** 2 - (a * c - b ** 2));
    output[0] = Math.sqrt(first + second || 1);
    output[1] = Math.sqrt(first - second || 1);
  }
  // Normalize rectangle rect=[x1, y1, x2, y2] so that (x1,y1) < (x2,y2)
  // For coordinate systems whose origin lies in the bottom-left, this
  // means normalization to (BL,TR) ordering. For systems with origin in the
  // top-left, this means (TL,BR) ordering.
  static normalizeRect(rect) {
    const r = rect.slice(0);
    if (rect[0] > rect[2]) {
      r[0] = rect[2];
      r[2] = rect[0];
    }
    if (rect[1] > rect[3]) {
      r[1] = rect[3];
      r[3] = rect[1];
    }
    return r;
  }
  // Returns a rectangle [x1, y1, x2, y2] corresponding to the
  // intersection of rect1 and rect2. If no intersection, returns 'null'
  // The rectangle coordinates of rect1, rect2 should be [x1, y1, x2, y2]
  static intersect(rect1, rect2) {
    const xLow = Math.max(
      Math.min(rect1[0], rect1[2]),
      Math.min(rect2[0], rect2[2])
    );
    const xHigh = Math.min(
      Math.max(rect1[0], rect1[2]),
      Math.max(rect2[0], rect2[2])
    );
    if (xLow > xHigh) {
      return null;
    }
    const yLow = Math.max(
      Math.min(rect1[1], rect1[3]),
      Math.min(rect2[1], rect2[3])
    );
    const yHigh = Math.min(
      Math.max(rect1[1], rect1[3]),
      Math.max(rect2[1], rect2[3])
    );
    return yLow > yHigh ? null : [xLow, yLow, xHigh, yHigh];
  }
  static pointBoundingBox(x, y, minMax) {
    minMax[0] = Math.min(minMax[0], x);
    minMax[1] = Math.min(minMax[1], y);
    minMax[2] = Math.max(minMax[2], x);
    minMax[3] = Math.max(minMax[3], y);
  }
  static rectBoundingBox(x0, y0, x1, y1, minMax) {
    minMax[0] = Math.min(minMax[0], x0, x1);
    minMax[1] = Math.min(minMax[1], y0, y1);
    minMax[2] = Math.max(minMax[2], x0, x1);
    minMax[3] = Math.max(minMax[3], y0, y1);
  }
  static #getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, t, minMax) {
    if (t <= 0 || t >= 1) {
      return;
    }
    const mt = 1 - t;
    const tt = t * t;
    const ttt = tt * t;
    const x = mt * (mt * (mt * x0 + 3 * t * x1) + 3 * tt * x2) + ttt * x3;
    const y = mt * (mt * (mt * y0 + 3 * t * y1) + 3 * tt * y2) + ttt * y3;
    minMax[0] = Math.min(minMax[0], x);
    minMax[1] = Math.min(minMax[1], y);
    minMax[2] = Math.max(minMax[2], x);
    minMax[3] = Math.max(minMax[3], y);
  }
  static #getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, a, b, c, minMax) {
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) >= 1e-12) {
        this.#getExtremumOnCurve(
          x0,
          x1,
          x2,
          x3,
          y0,
          y1,
          y2,
          y3,
          -c / b,
          minMax
        );
      }
      return;
    }
    const delta = b ** 2 - 4 * c * a;
    if (delta < 0) {
      return;
    }
    const sqrtDelta = Math.sqrt(delta);
    const a2 = 2 * a;
    this.#getExtremumOnCurve(
      x0,
      x1,
      x2,
      x3,
      y0,
      y1,
      y2,
      y3,
      (-b + sqrtDelta) / a2,
      minMax
    );
    this.#getExtremumOnCurve(
      x0,
      x1,
      x2,
      x3,
      y0,
      y1,
      y2,
      y3,
      (-b - sqrtDelta) / a2,
      minMax
    );
  }
  // From https://github.com/adobe-webplatform/Snap.svg/blob/b365287722a72526000ac4bfcf0ce4cac2faa015/src/path.js#L852
  static bezierBoundingBox(x0, y0, x1, y1, x2, y2, x3, y3, minMax) {
    minMax[0] = Math.min(minMax[0], x0, x3);
    minMax[1] = Math.min(minMax[1], y0, y3);
    minMax[2] = Math.max(minMax[2], x0, x3);
    minMax[3] = Math.max(minMax[3], y0, y3);
    this.#getExtremum(
      x0,
      x1,
      x2,
      x3,
      y0,
      y1,
      y2,
      y3,
      3 * (-x0 + 3 * (x1 - x2) + x3),
      6 * (x0 - 2 * x1 + x2),
      3 * (x1 - x0),
      minMax
    );
    this.#getExtremum(
      x0,
      x1,
      x2,
      x3,
      y0,
      y1,
      y2,
      y3,
      3 * (-y0 + 3 * (y1 - y2) + y3),
      6 * (y0 - 2 * y1 + y2),
      3 * (y1 - y0),
      minMax
    );
  }
};
function utf8StringToString(str) {
  return unescape(encodeURIComponent(str));
}
function isArrayEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (let i = 0, ii = arr1.length; i < ii; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
}
var makeArr = () => [];
if (typeof PDFJSDev !== "undefined" && !PDFJSDev.test("SKIP_BABEL") && typeof Blob.prototype.bytes !== "function") {
  Blob.prototype.bytes = async function() {
    return new Uint8Array(await this.arrayBuffer());
  };
}
if (typeof PDFJSDev !== "undefined" && !PDFJSDev.test("SKIP_BABEL") && typeof Response.prototype.bytes !== "function") {
  Response.prototype.bytes = async function() {
    return new Uint8Array(await this.arrayBuffer());
  };
}
if (typeof Iterator.prototype.join !== "function") {
  Iterator.prototype.join = function(separator) {
    return [...this].join(separator);
  };
}

// src/core/charsets.js
var ISOAdobeCharset = [
  ".notdef",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quoteright",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "quoteleft",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "exclamdown",
  "cent",
  "sterling",
  "fraction",
  "yen",
  "florin",
  "section",
  "currency",
  "quotesingle",
  "quotedblleft",
  "guillemotleft",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "endash",
  "dagger",
  "daggerdbl",
  "periodcentered",
  "paragraph",
  "bullet",
  "quotesinglbase",
  "quotedblbase",
  "quotedblright",
  "guillemotright",
  "ellipsis",
  "perthousand",
  "questiondown",
  "grave",
  "acute",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "dieresis",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron",
  "emdash",
  "AE",
  "ordfeminine",
  "Lslash",
  "Oslash",
  "OE",
  "ordmasculine",
  "ae",
  "dotlessi",
  "lslash",
  "oslash",
  "oe",
  "germandbls",
  "onesuperior",
  "logicalnot",
  "mu",
  "trademark",
  "Eth",
  "onehalf",
  "plusminus",
  "Thorn",
  "onequarter",
  "divide",
  "brokenbar",
  "degree",
  "thorn",
  "threequarters",
  "twosuperior",
  "registered",
  "minus",
  "eth",
  "multiply",
  "threesuperior",
  "copyright",
  "Aacute",
  "Acircumflex",
  "Adieresis",
  "Agrave",
  "Aring",
  "Atilde",
  "Ccedilla",
  "Eacute",
  "Ecircumflex",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Ntilde",
  "Oacute",
  "Ocircumflex",
  "Odieresis",
  "Ograve",
  "Otilde",
  "Scaron",
  "Uacute",
  "Ucircumflex",
  "Udieresis",
  "Ugrave",
  "Yacute",
  "Ydieresis",
  "Zcaron",
  "aacute",
  "acircumflex",
  "adieresis",
  "agrave",
  "aring",
  "atilde",
  "ccedilla",
  "eacute",
  "ecircumflex",
  "edieresis",
  "egrave",
  "iacute",
  "icircumflex",
  "idieresis",
  "igrave",
  "ntilde",
  "oacute",
  "ocircumflex",
  "odieresis",
  "ograve",
  "otilde",
  "scaron",
  "uacute",
  "ucircumflex",
  "udieresis",
  "ugrave",
  "yacute",
  "ydieresis",
  "zcaron"
];
var ExpertCharset = [
  ".notdef",
  "space",
  "exclamsmall",
  "Hungarumlautsmall",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "comma",
  "hyphen",
  "period",
  "fraction",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "colon",
  "semicolon",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "questionsmall",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "isuperior",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "ff",
  "fi",
  "fl",
  "ffi",
  "ffl",
  "parenleftinferior",
  "parenrightinferior",
  "Circumflexsmall",
  "hyphensuperior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "exclamdownsmall",
  "centoldstyle",
  "Lslashsmall",
  "Scaronsmall",
  "Zcaronsmall",
  "Dieresissmall",
  "Brevesmall",
  "Caronsmall",
  "Dotaccentsmall",
  "Macronsmall",
  "figuredash",
  "hypheninferior",
  "Ogoneksmall",
  "Ringsmall",
  "Cedillasmall",
  "onequarter",
  "onehalf",
  "threequarters",
  "questiondownsmall",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "zerosuperior",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior",
  "Agravesmall",
  "Aacutesmall",
  "Acircumflexsmall",
  "Atildesmall",
  "Adieresissmall",
  "Aringsmall",
  "AEsmall",
  "Ccedillasmall",
  "Egravesmall",
  "Eacutesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Igravesmall",
  "Iacutesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ethsmall",
  "Ntildesmall",
  "Ogravesmall",
  "Oacutesmall",
  "Ocircumflexsmall",
  "Otildesmall",
  "Odieresissmall",
  "OEsmall",
  "Oslashsmall",
  "Ugravesmall",
  "Uacutesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "Yacutesmall",
  "Thornsmall",
  "Ydieresissmall"
];
var ExpertSubsetCharset = [
  ".notdef",
  "space",
  "dollaroldstyle",
  "dollarsuperior",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "comma",
  "hyphen",
  "period",
  "fraction",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "colon",
  "semicolon",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "isuperior",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "ff",
  "fi",
  "fl",
  "ffi",
  "ffl",
  "parenleftinferior",
  "parenrightinferior",
  "hyphensuperior",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "centoldstyle",
  "figuredash",
  "hypheninferior",
  "onequarter",
  "onehalf",
  "threequarters",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "zerosuperior",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior"
];

// src/core/encodings.js
var ExpertEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclamsmall",
  "Hungarumlautsmall",
  "",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "comma",
  "hyphen",
  "period",
  "fraction",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "colon",
  "semicolon",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "questionsmall",
  "",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "",
  "",
  "",
  "isuperior",
  "",
  "",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "",
  "",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "",
  "ff",
  "fi",
  "fl",
  "ffi",
  "ffl",
  "parenleftinferior",
  "",
  "parenrightinferior",
  "Circumflexsmall",
  "hyphensuperior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "exclamdownsmall",
  "centoldstyle",
  "Lslashsmall",
  "",
  "",
  "Scaronsmall",
  "Zcaronsmall",
  "Dieresissmall",
  "Brevesmall",
  "Caronsmall",
  "",
  "Dotaccentsmall",
  "",
  "",
  "Macronsmall",
  "",
  "",
  "figuredash",
  "hypheninferior",
  "",
  "",
  "Ogoneksmall",
  "Ringsmall",
  "Cedillasmall",
  "",
  "",
  "",
  "onequarter",
  "onehalf",
  "threequarters",
  "questiondownsmall",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "",
  "",
  "zerosuperior",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior",
  "Agravesmall",
  "Aacutesmall",
  "Acircumflexsmall",
  "Atildesmall",
  "Adieresissmall",
  "Aringsmall",
  "AEsmall",
  "Ccedillasmall",
  "Egravesmall",
  "Eacutesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Igravesmall",
  "Iacutesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ethsmall",
  "Ntildesmall",
  "Ogravesmall",
  "Oacutesmall",
  "Ocircumflexsmall",
  "Otildesmall",
  "Odieresissmall",
  "OEsmall",
  "Oslashsmall",
  "Ugravesmall",
  "Uacutesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "Yacutesmall",
  "Thornsmall",
  "Ydieresissmall"
];
var MacExpertEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclamsmall",
  "Hungarumlautsmall",
  "centoldstyle",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "comma",
  "hyphen",
  "period",
  "fraction",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "colon",
  "semicolon",
  "",
  "threequartersemdash",
  "",
  "questionsmall",
  "",
  "",
  "",
  "",
  "Ethsmall",
  "",
  "",
  "onequarter",
  "onehalf",
  "threequarters",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "",
  "",
  "",
  "",
  "",
  "",
  "ff",
  "fi",
  "fl",
  "ffi",
  "ffl",
  "parenleftinferior",
  "",
  "parenrightinferior",
  "Circumflexsmall",
  "hypheninferior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "",
  "",
  "asuperior",
  "centsuperior",
  "",
  "",
  "",
  "",
  "Aacutesmall",
  "Agravesmall",
  "Acircumflexsmall",
  "Adieresissmall",
  "Atildesmall",
  "Aringsmall",
  "Ccedillasmall",
  "Eacutesmall",
  "Egravesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Iacutesmall",
  "Igravesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ntildesmall",
  "Oacutesmall",
  "Ogravesmall",
  "Ocircumflexsmall",
  "Odieresissmall",
  "Otildesmall",
  "Uacutesmall",
  "Ugravesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "",
  "eightsuperior",
  "fourinferior",
  "threeinferior",
  "sixinferior",
  "eightinferior",
  "seveninferior",
  "Scaronsmall",
  "",
  "centinferior",
  "twoinferior",
  "",
  "Dieresissmall",
  "",
  "Caronsmall",
  "osuperior",
  "fiveinferior",
  "",
  "commainferior",
  "periodinferior",
  "Yacutesmall",
  "",
  "dollarinferior",
  "",
  "",
  "Thornsmall",
  "",
  "nineinferior",
  "zeroinferior",
  "Zcaronsmall",
  "AEsmall",
  "Oslashsmall",
  "questiondownsmall",
  "oneinferior",
  "Lslashsmall",
  "",
  "",
  "",
  "",
  "",
  "",
  "Cedillasmall",
  "",
  "",
  "",
  "",
  "",
  "OEsmall",
  "figuredash",
  "hyphensuperior",
  "",
  "",
  "",
  "",
  "exclamdownsmall",
  "",
  "Ydieresissmall",
  "",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "ninesuperior",
  "zerosuperior",
  "",
  "esuperior",
  "rsuperior",
  "tsuperior",
  "",
  "",
  "isuperior",
  "ssuperior",
  "dsuperior",
  "",
  "",
  "",
  "",
  "",
  "lsuperior",
  "Ogoneksmall",
  "Brevesmall",
  "Macronsmall",
  "bsuperior",
  "nsuperior",
  "msuperior",
  "commasuperior",
  "periodsuperior",
  "Dotaccentsmall",
  "Ringsmall",
  "",
  "",
  "",
  ""
];
var MacRomanEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quotesingle",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "grave",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "",
  "Adieresis",
  "Aring",
  "Ccedilla",
  "Eacute",
  "Ntilde",
  "Odieresis",
  "Udieresis",
  "aacute",
  "agrave",
  "acircumflex",
  "adieresis",
  "atilde",
  "aring",
  "ccedilla",
  "eacute",
  "egrave",
  "ecircumflex",
  "edieresis",
  "iacute",
  "igrave",
  "icircumflex",
  "idieresis",
  "ntilde",
  "oacute",
  "ograve",
  "ocircumflex",
  "odieresis",
  "otilde",
  "uacute",
  "ugrave",
  "ucircumflex",
  "udieresis",
  "dagger",
  "degree",
  "cent",
  "sterling",
  "section",
  "bullet",
  "paragraph",
  "germandbls",
  "registered",
  "copyright",
  "trademark",
  "acute",
  "dieresis",
  "notequal",
  "AE",
  "Oslash",
  "infinity",
  "plusminus",
  "lessequal",
  "greaterequal",
  "yen",
  "mu",
  "partialdiff",
  "summation",
  "product",
  "pi",
  "integral",
  "ordfeminine",
  "ordmasculine",
  "Omega",
  "ae",
  "oslash",
  "questiondown",
  "exclamdown",
  "logicalnot",
  "radical",
  "florin",
  "approxequal",
  "Delta",
  "guillemotleft",
  "guillemotright",
  "ellipsis",
  "space",
  "Agrave",
  "Atilde",
  "Otilde",
  "OE",
  "oe",
  "endash",
  "emdash",
  "quotedblleft",
  "quotedblright",
  "quoteleft",
  "quoteright",
  "divide",
  "lozenge",
  "ydieresis",
  "Ydieresis",
  "fraction",
  "currency",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "daggerdbl",
  "periodcentered",
  "quotesinglbase",
  "quotedblbase",
  "perthousand",
  "Acircumflex",
  "Ecircumflex",
  "Aacute",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Oacute",
  "Ocircumflex",
  "apple",
  "Ograve",
  "Uacute",
  "Ucircumflex",
  "Ugrave",
  "dotlessi",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron"
];
var StandardEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quoteright",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "quoteleft",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "exclamdown",
  "cent",
  "sterling",
  "fraction",
  "yen",
  "florin",
  "section",
  "currency",
  "quotesingle",
  "quotedblleft",
  "guillemotleft",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "",
  "endash",
  "dagger",
  "daggerdbl",
  "periodcentered",
  "",
  "paragraph",
  "bullet",
  "quotesinglbase",
  "quotedblbase",
  "quotedblright",
  "guillemotright",
  "ellipsis",
  "perthousand",
  "",
  "questiondown",
  "",
  "grave",
  "acute",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "dieresis",
  "",
  "ring",
  "cedilla",
  "",
  "hungarumlaut",
  "ogonek",
  "caron",
  "emdash",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "AE",
  "",
  "ordfeminine",
  "",
  "",
  "",
  "",
  "Lslash",
  "Oslash",
  "OE",
  "ordmasculine",
  "",
  "",
  "",
  "",
  "",
  "ae",
  "",
  "",
  "",
  "dotlessi",
  "",
  "",
  "lslash",
  "oslash",
  "oe",
  "germandbls",
  "",
  "",
  "",
  ""
];
var WinAnsiEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quotesingle",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "grave",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "bullet",
  "Euro",
  "bullet",
  "quotesinglbase",
  "florin",
  "quotedblbase",
  "ellipsis",
  "dagger",
  "daggerdbl",
  "circumflex",
  "perthousand",
  "Scaron",
  "guilsinglleft",
  "OE",
  "bullet",
  "Zcaron",
  "bullet",
  "bullet",
  "quoteleft",
  "quoteright",
  "quotedblleft",
  "quotedblright",
  "bullet",
  "endash",
  "emdash",
  "tilde",
  "trademark",
  "scaron",
  "guilsinglright",
  "oe",
  "bullet",
  "zcaron",
  "Ydieresis",
  "space",
  "exclamdown",
  "cent",
  "sterling",
  "currency",
  "yen",
  "brokenbar",
  "section",
  "dieresis",
  "copyright",
  "ordfeminine",
  "guillemotleft",
  "logicalnot",
  "hyphen",
  "registered",
  "macron",
  "degree",
  "plusminus",
  "twosuperior",
  "threesuperior",
  "acute",
  "mu",
  "paragraph",
  "periodcentered",
  "cedilla",
  "onesuperior",
  "ordmasculine",
  "guillemotright",
  "onequarter",
  "onehalf",
  "threequarters",
  "questiondown",
  "Agrave",
  "Aacute",
  "Acircumflex",
  "Atilde",
  "Adieresis",
  "Aring",
  "AE",
  "Ccedilla",
  "Egrave",
  "Eacute",
  "Ecircumflex",
  "Edieresis",
  "Igrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Eth",
  "Ntilde",
  "Ograve",
  "Oacute",
  "Ocircumflex",
  "Otilde",
  "Odieresis",
  "multiply",
  "Oslash",
  "Ugrave",
  "Uacute",
  "Ucircumflex",
  "Udieresis",
  "Yacute",
  "Thorn",
  "germandbls",
  "agrave",
  "aacute",
  "acircumflex",
  "atilde",
  "adieresis",
  "aring",
  "ae",
  "ccedilla",
  "egrave",
  "eacute",
  "ecircumflex",
  "edieresis",
  "igrave",
  "iacute",
  "icircumflex",
  "idieresis",
  "eth",
  "ntilde",
  "ograve",
  "oacute",
  "ocircumflex",
  "otilde",
  "odieresis",
  "divide",
  "oslash",
  "ugrave",
  "uacute",
  "ucircumflex",
  "udieresis",
  "yacute",
  "thorn",
  "ydieresis"
];
var SymbolSetEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclam",
  "universal",
  "numbersign",
  "existential",
  "percent",
  "ampersand",
  "suchthat",
  "parenleft",
  "parenright",
  "asteriskmath",
  "plus",
  "comma",
  "minus",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "congruent",
  "Alpha",
  "Beta",
  "Chi",
  "Delta",
  "Epsilon",
  "Phi",
  "Gamma",
  "Eta",
  "Iota",
  "theta1",
  "Kappa",
  "Lambda",
  "Mu",
  "Nu",
  "Omicron",
  "Pi",
  "Theta",
  "Rho",
  "Sigma",
  "Tau",
  "Upsilon",
  "sigma1",
  "Omega",
  "Xi",
  "Psi",
  "Zeta",
  "bracketleft",
  "therefore",
  "bracketright",
  "perpendicular",
  "underscore",
  "radicalex",
  "alpha",
  "beta",
  "chi",
  "delta",
  "epsilon",
  "phi",
  "gamma",
  "eta",
  "iota",
  "phi1",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "omicron",
  "pi",
  "theta",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "omega1",
  "omega",
  "xi",
  "psi",
  "zeta",
  "braceleft",
  "bar",
  "braceright",
  "similar",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "Euro",
  "Upsilon1",
  "minute",
  "lessequal",
  "fraction",
  "infinity",
  "florin",
  "club",
  "diamond",
  "heart",
  "spade",
  "arrowboth",
  "arrowleft",
  "arrowup",
  "arrowright",
  "arrowdown",
  "degree",
  "plusminus",
  "second",
  "greaterequal",
  "multiply",
  "proportional",
  "partialdiff",
  "bullet",
  "divide",
  "notequal",
  "equivalence",
  "approxequal",
  "ellipsis",
  "arrowvertex",
  "arrowhorizex",
  "carriagereturn",
  "aleph",
  "Ifraktur",
  "Rfraktur",
  "weierstrass",
  "circlemultiply",
  "circleplus",
  "emptyset",
  "intersection",
  "union",
  "propersuperset",
  "reflexsuperset",
  "notsubset",
  "propersubset",
  "reflexsubset",
  "element",
  "notelement",
  "angle",
  "gradient",
  "registerserif",
  "copyrightserif",
  "trademarkserif",
  "product",
  "radical",
  "dotmath",
  "logicalnot",
  "logicaland",
  "logicalor",
  "arrowdblboth",
  "arrowdblleft",
  "arrowdblup",
  "arrowdblright",
  "arrowdbldown",
  "lozenge",
  "angleleft",
  "registersans",
  "copyrightsans",
  "trademarksans",
  "summation",
  "parenlefttp",
  "parenleftex",
  "parenleftbt",
  "bracketlefttp",
  "bracketleftex",
  "bracketleftbt",
  "bracelefttp",
  "braceleftmid",
  "braceleftbt",
  "braceex",
  "",
  "angleright",
  "integral",
  "integraltp",
  "integralex",
  "integralbt",
  "parenrighttp",
  "parenrightex",
  "parenrightbt",
  "bracketrighttp",
  "bracketrightex",
  "bracketrightbt",
  "bracerighttp",
  "bracerightmid",
  "bracerightbt",
  ""
];
var ZapfDingbatsEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "a1",
  "a2",
  "a202",
  "a3",
  "a4",
  "a5",
  "a119",
  "a118",
  "a117",
  "a11",
  "a12",
  "a13",
  "a14",
  "a15",
  "a16",
  "a105",
  "a17",
  "a18",
  "a19",
  "a20",
  "a21",
  "a22",
  "a23",
  "a24",
  "a25",
  "a26",
  "a27",
  "a28",
  "a6",
  "a7",
  "a8",
  "a9",
  "a10",
  "a29",
  "a30",
  "a31",
  "a32",
  "a33",
  "a34",
  "a35",
  "a36",
  "a37",
  "a38",
  "a39",
  "a40",
  "a41",
  "a42",
  "a43",
  "a44",
  "a45",
  "a46",
  "a47",
  "a48",
  "a49",
  "a50",
  "a51",
  "a52",
  "a53",
  "a54",
  "a55",
  "a56",
  "a57",
  "a58",
  "a59",
  "a60",
  "a61",
  "a62",
  "a63",
  "a64",
  "a65",
  "a66",
  "a67",
  "a68",
  "a69",
  "a70",
  "a71",
  "a72",
  "a73",
  "a74",
  "a203",
  "a75",
  "a204",
  "a76",
  "a77",
  "a78",
  "a79",
  "a81",
  "a82",
  "a83",
  "a84",
  "a97",
  "a98",
  "a99",
  "a100",
  "",
  "a89",
  "a90",
  "a93",
  "a94",
  "a91",
  "a92",
  "a205",
  "a85",
  "a206",
  "a86",
  "a87",
  "a88",
  "a95",
  "a96",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "a101",
  "a102",
  "a103",
  "a104",
  "a106",
  "a107",
  "a108",
  "a112",
  "a111",
  "a110",
  "a109",
  "a120",
  "a121",
  "a122",
  "a123",
  "a124",
  "a125",
  "a126",
  "a127",
  "a128",
  "a129",
  "a130",
  "a131",
  "a132",
  "a133",
  "a134",
  "a135",
  "a136",
  "a137",
  "a138",
  "a139",
  "a140",
  "a141",
  "a142",
  "a143",
  "a144",
  "a145",
  "a146",
  "a147",
  "a148",
  "a149",
  "a150",
  "a151",
  "a152",
  "a153",
  "a154",
  "a155",
  "a156",
  "a157",
  "a158",
  "a159",
  "a160",
  "a161",
  "a163",
  "a164",
  "a196",
  "a165",
  "a192",
  "a166",
  "a167",
  "a168",
  "a169",
  "a170",
  "a171",
  "a172",
  "a173",
  "a162",
  "a174",
  "a175",
  "a176",
  "a177",
  "a178",
  "a179",
  "a193",
  "a180",
  "a199",
  "a181",
  "a200",
  "a182",
  "",
  "a201",
  "a183",
  "a184",
  "a197",
  "a185",
  "a194",
  "a198",
  "a186",
  "a195",
  "a187",
  "a188",
  "a189",
  "a190",
  "a191",
  ""
];
function getEncoding(encodingName) {
  switch (encodingName) {
    case "WinAnsiEncoding":
      return WinAnsiEncoding;
    case "StandardEncoding":
      return StandardEncoding;
    case "MacRomanEncoding":
      return MacRomanEncoding;
    case "SymbolSetEncoding":
      return SymbolSetEncoding;
    case "ZapfDingbatsEncoding":
      return ZapfDingbatsEncoding;
    case "ExpertEncoding":
      return ExpertEncoding;
    case "MacExpertEncoding":
      return MacExpertEncoding;
    default:
      return null;
  }
}

// src/shared/math_clamp.js
function MathClamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// src/core/data_builder.js
var DataBuilder = class {
  #buf;
  #bufLength = 1024;
  #hasExactLength = false;
  #pos = 0;
  #view;
  constructor({ exactLength = 0, minLength = 0 }) {
    this.#hasExactLength = !!exactLength;
    this.#initBuf(exactLength || minLength);
  }
  #initBuf(minLength) {
    if (this.#hasExactLength) {
      this.#bufLength = minLength;
    } else {
      while (this.#bufLength < minLength) {
        this.#bufLength *= 2;
      }
    }
    const newBuf = new Uint8Array(this.#bufLength);
    if (this.#buf) {
      newBuf.set(this.#buf, 0);
    }
    this.#buf = newBuf;
    this.#view = new DataView(newBuf.buffer);
  }
  get data() {
    return this.#buf.subarray(0, this.#pos);
  }
  get length() {
    return this.#pos;
  }
  skip(n) {
    this.#pos += n;
  }
  setArray(arr) {
    const newPos = this.#pos + arr.length;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#buf.set(arr, this.#pos);
    this.#pos = newPos;
  }
  setInt16(val) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        typeof val === "number" && Math.abs(val) < 2 ** 16,
        `setInt16: Unexpected input "${val}".`
      );
    }
    const newPos = this.#pos + 2;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt16(this.#pos, val);
    this.#pos = newPos;
  }
  setSafeInt16(val) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        typeof val === "number" && !Number.isNaN(val),
        `safeString16: Unexpected input "${val}".`
      );
    }
    const newPos = this.#pos + 2;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt16(this.#pos, MathClamp(val, -32768, 32767));
    this.#pos = newPos;
  }
  setInt32(val) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        typeof val === "number" && Math.abs(val) < 2 ** 32,
        `setInt32: Unexpected input "${val}".`
      );
    }
    const newPos = this.#pos + 4;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt32(this.#pos, val);
    this.#pos = newPos;
  }
};

// src/core/cff_parser.js
var MAX_SUBR_NESTING = 10;
function looksLikeUnsigned16BitNegative(coord) {
  return coord > 32767 && coord <= 65535;
}
function recoverSigned16BitBBox(bbox, onlyLowerLeft = false) {
  return Util.normalizeRect(
    bbox.map(
      (coord, i) => (!onlyLowerLeft || i < 2) && looksLikeUnsigned16BitNegative(coord) ? coord - 65536 : coord
    )
  );
}
var CFFStandardStrings = [
  ".notdef",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quoteright",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "quoteleft",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "exclamdown",
  "cent",
  "sterling",
  "fraction",
  "yen",
  "florin",
  "section",
  "currency",
  "quotesingle",
  "quotedblleft",
  "guillemotleft",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "endash",
  "dagger",
  "daggerdbl",
  "periodcentered",
  "paragraph",
  "bullet",
  "quotesinglbase",
  "quotedblbase",
  "quotedblright",
  "guillemotright",
  "ellipsis",
  "perthousand",
  "questiondown",
  "grave",
  "acute",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "dieresis",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron",
  "emdash",
  "AE",
  "ordfeminine",
  "Lslash",
  "Oslash",
  "OE",
  "ordmasculine",
  "ae",
  "dotlessi",
  "lslash",
  "oslash",
  "oe",
  "germandbls",
  "onesuperior",
  "logicalnot",
  "mu",
  "trademark",
  "Eth",
  "onehalf",
  "plusminus",
  "Thorn",
  "onequarter",
  "divide",
  "brokenbar",
  "degree",
  "thorn",
  "threequarters",
  "twosuperior",
  "registered",
  "minus",
  "eth",
  "multiply",
  "threesuperior",
  "copyright",
  "Aacute",
  "Acircumflex",
  "Adieresis",
  "Agrave",
  "Aring",
  "Atilde",
  "Ccedilla",
  "Eacute",
  "Ecircumflex",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Ntilde",
  "Oacute",
  "Ocircumflex",
  "Odieresis",
  "Ograve",
  "Otilde",
  "Scaron",
  "Uacute",
  "Ucircumflex",
  "Udieresis",
  "Ugrave",
  "Yacute",
  "Ydieresis",
  "Zcaron",
  "aacute",
  "acircumflex",
  "adieresis",
  "agrave",
  "aring",
  "atilde",
  "ccedilla",
  "eacute",
  "ecircumflex",
  "edieresis",
  "egrave",
  "iacute",
  "icircumflex",
  "idieresis",
  "igrave",
  "ntilde",
  "oacute",
  "ocircumflex",
  "odieresis",
  "ograve",
  "otilde",
  "scaron",
  "uacute",
  "ucircumflex",
  "udieresis",
  "ugrave",
  "yacute",
  "ydieresis",
  "zcaron",
  "exclamsmall",
  "Hungarumlautsmall",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "questionsmall",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "isuperior",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "ff",
  "ffi",
  "ffl",
  "parenleftinferior",
  "parenrightinferior",
  "Circumflexsmall",
  "hyphensuperior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "exclamdownsmall",
  "centoldstyle",
  "Lslashsmall",
  "Scaronsmall",
  "Zcaronsmall",
  "Dieresissmall",
  "Brevesmall",
  "Caronsmall",
  "Dotaccentsmall",
  "Macronsmall",
  "figuredash",
  "hypheninferior",
  "Ogoneksmall",
  "Ringsmall",
  "Cedillasmall",
  "questiondownsmall",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "zerosuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior",
  "Agravesmall",
  "Aacutesmall",
  "Acircumflexsmall",
  "Atildesmall",
  "Adieresissmall",
  "Aringsmall",
  "AEsmall",
  "Ccedillasmall",
  "Egravesmall",
  "Eacutesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Igravesmall",
  "Iacutesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ethsmall",
  "Ntildesmall",
  "Ogravesmall",
  "Oacutesmall",
  "Ocircumflexsmall",
  "Otildesmall",
  "Odieresissmall",
  "OEsmall",
  "Oslashsmall",
  "Ugravesmall",
  "Uacutesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "Yacutesmall",
  "Thornsmall",
  "Ydieresissmall",
  "001.000",
  "001.001",
  "001.002",
  "001.003",
  "Black",
  "Bold",
  "Book",
  "Light",
  "Medium",
  "Regular",
  "Roman",
  "Semibold"
];
var NUM_STANDARD_CFF_STRINGS = 391;
var DEFAULT_BLUE_SCALE = 0.039625;
var DEFAULT_BLUE_SHIFT = 7;
var DEFAULT_BLUE_FUZZ = 1;
var DEFAULT_EXPANSION_FACTOR = 0.06;
var CharstringValidationData = [
  /*  0 */
  null,
  /*  1 */
  { id: "hstem", min: 2, stackClearing: true, stem: true },
  /*  2 */
  null,
  /*  3 */
  { id: "vstem", min: 2, stackClearing: true, stem: true },
  /*  4 */
  { id: "vmoveto", min: 1, stackClearing: true },
  /*  5 */
  { id: "rlineto", min: 2, resetStack: true },
  /*  6 */
  { id: "hlineto", min: 1, resetStack: true },
  /*  7 */
  { id: "vlineto", min: 1, resetStack: true },
  /*  8 */
  { id: "rrcurveto", min: 6, resetStack: true },
  /*  9 */
  null,
  /* 10 */
  { id: "callsubr", min: 1 },
  /* 11 */
  { id: "return", min: 0 },
  /* 12 */
  null,
  /* 13 */
  null,
  /* 14 */
  { id: "endchar", min: 0, stackClearing: true },
  /* 15 */
  null,
  /* 16 */
  null,
  /* 17 */
  null,
  /* 18 */
  { id: "hstemhm", min: 2, stackClearing: true, stem: true },
  /* 19 */
  { id: "hintmask", min: 0, stackClearing: true },
  /* 20 */
  { id: "cntrmask", min: 0, stackClearing: true },
  /* 21 */
  { id: "rmoveto", min: 2, stackClearing: true },
  /* 22 */
  { id: "hmoveto", min: 1, stackClearing: true },
  /* 23 */
  { id: "vstemhm", min: 2, stackClearing: true, stem: true },
  /* 24 */
  { id: "rcurveline", min: 8, resetStack: true },
  /* 25 */
  { id: "rlinecurve", min: 8, resetStack: true },
  /* 26 */
  { id: "vvcurveto", min: 4, resetStack: true },
  /* 27 */
  { id: "hhcurveto", min: 4, resetStack: true },
  /* 28 */
  null,
  // shortint
  /* 29 */
  { id: "callgsubr", min: 1 },
  /* 30 */
  { id: "vhcurveto", min: 4, resetStack: true },
  /* 31 */
  { id: "hvcurveto", min: 4, resetStack: true }
];
var CharstringValidationData12 = [
  null,
  null,
  null,
  { id: "and", min: 2, stackDelta: -1 },
  { id: "or", min: 2, stackDelta: -1 },
  { id: "not", min: 1, stackDelta: 0 },
  null,
  null,
  null,
  { id: "abs", min: 1, stackDelta: 0 },
  {
    id: "add",
    min: 2,
    stackDelta: -1,
    stackFn(stack, index) {
      stack[index - 2] = stack[index - 2] + stack[index - 1];
    }
  },
  {
    id: "sub",
    min: 2,
    stackDelta: -1,
    stackFn(stack, index) {
      stack[index - 2] = stack[index - 2] - stack[index - 1];
    }
  },
  {
    id: "div",
    min: 2,
    stackDelta: -1,
    stackFn(stack, index) {
      stack[index - 2] = stack[index - 2] / stack[index - 1];
    }
  },
  null,
  {
    id: "neg",
    min: 1,
    stackDelta: 0,
    stackFn(stack, index) {
      stack[index - 1] = -stack[index - 1];
    }
  },
  { id: "eq", min: 2, stackDelta: -1 },
  null,
  null,
  { id: "drop", min: 1, stackDelta: -1 },
  null,
  { id: "put", min: 2, stackDelta: -2 },
  { id: "get", min: 1, stackDelta: 0 },
  { id: "ifelse", min: 4, stackDelta: -3 },
  { id: "random", min: 0, stackDelta: 1 },
  {
    id: "mul",
    min: 2,
    stackDelta: -1,
    stackFn(stack, index) {
      stack[index - 2] = stack[index - 2] * stack[index - 1];
    }
  },
  null,
  { id: "sqrt", min: 1, stackDelta: 0 },
  { id: "dup", min: 1, stackDelta: 1 },
  { id: "exch", min: 2, stackDelta: 0 },
  { id: "index", min: 2, stackDelta: 0 },
  { id: "roll", min: 3, stackDelta: -2 },
  null,
  null,
  null,
  { id: "hflex", min: 7, resetStack: true },
  { id: "flex", min: 13, resetStack: true },
  { id: "hflex1", min: 9, resetStack: true },
  { id: "flex1", min: 11, resetStack: true }
];
var CFFParser = class {
  constructor(file, properties, seacAnalysisEnabled, onAllocation) {
    this.onAllocation = onAllocation;
    onAllocation?.(2048);
    this.bytes = file.getBytes();
    this.properties = properties;
    this.seacAnalysisEnabled = !!seacAnalysisEnabled;
  }
  parse() {
    this.onAllocation?.(2048);
    const properties = this.properties;
    const cff = new CFF(this.bytes.length);
    this.cff = cff;
    const header = this.parseHeader();
    const nameIndex = this.parseIndex(header.endPos);
    const topDictIndex = this.parseIndex(nameIndex.endPos);
    const stringIndex = this.parseIndex(topDictIndex.endPos);
    const globalSubrIndex = this.parseIndex(stringIndex.endPos);
    const topDictParsed = this.parseDict(topDictIndex.obj.get(0));
    const topDict = this.createDict(CFFTopDict, topDictParsed, cff.strings);
    cff.header = header.obj;
    cff.names = this.parseNameIndex(nameIndex.obj);
    cff.strings = this.parseStringIndex(stringIndex.obj);
    cff.topDict = topDict;
    cff.globalSubrIndex = globalSubrIndex.obj;
    this.parsePrivateDict(cff.topDict);
    cff.isCIDFont = topDict.hasName("ROS");
    const charStringOffset = topDict.getByName("CharStrings");
    const charStringIndex = this.parseIndex(charStringOffset).obj;
    cff.charStringCount = charStringIndex.count;
    const fontMatrix = topDict.getByName("FontMatrix");
    if (fontMatrix) {
      properties.fontMatrix = fontMatrix;
    }
    let fontBBox = topDict.getByName("FontBBox");
    const descriptorBBox = properties.bbox?.some((coord) => coord !== 0) ? recoverSigned16BitBBox(properties.bbox) : null;
    const cffBBoxHasUnsignedLowerLeft = fontBBox?.slice(0, 2).some(looksLikeUnsigned16BitNegative);
    const cffBBoxHasUnsignedCoords = fontBBox?.some(
      looksLikeUnsigned16BitNegative
    );
    if (fontBBox?.every((coord) => coord === 0) && descriptorBBox) {
      fontBBox = descriptorBBox;
      topDict.setByName("FontBBox", fontBBox);
    } else if (cffBBoxHasUnsignedCoords) {
      const recoveredFontBBox = recoverSigned16BitBBox(fontBBox);
      const descriptorCorroborates = descriptorBBox && properties.bbox.some((coord) => coord < 0) && !properties.bbox.some(looksLikeUnsigned16BitNegative) && isArrayEqual(recoveredFontBBox, descriptorBBox);
      if (descriptorCorroborates || cffBBoxHasUnsignedLowerLeft) {
        fontBBox = descriptorCorroborates ? recoveredFontBBox : recoverSigned16BitBBox(
          fontBBox,
          /* onlyLowerLeft = */
          true
        );
        topDict.setByName("FontBBox", fontBBox);
      }
    }
    if (fontBBox?.some((coord) => coord !== 0)) {
      properties.ascent = Math.max(fontBBox[3], fontBBox[1]);
      properties.descent = Math.min(fontBBox[1], fontBBox[3]);
      properties.ascentScaled = true;
    }
    let charset, encoding;
    if (cff.isCIDFont) {
      const fdArrayIndex = this.parseIndex(topDict.getByName("FDArray")).obj;
      for (let i = 0, ii = fdArrayIndex.count; i < ii; ++i) {
        const dictRaw = fdArrayIndex.get(i);
        const fontDict = this.createDict(
          CFFTopDict,
          this.parseDict(dictRaw),
          cff.strings
        );
        this.parsePrivateDict(fontDict);
        cff.fdArray.push(fontDict);
      }
      encoding = null;
      charset = this.parseCharsets(
        topDict.getByName("charset"),
        charStringIndex.count,
        cff.strings,
        true
      );
      cff.fdSelect = this.parseFDSelect(
        topDict.getByName("FDSelect"),
        charStringIndex.count
      );
    } else {
      charset = this.parseCharsets(
        topDict.getByName("charset"),
        charStringIndex.count,
        cff.strings,
        false
      );
      encoding = this.parseEncoding(
        topDict.getByName("Encoding"),
        properties,
        cff.strings,
        charset.charset
      );
    }
    cff.charset = charset;
    cff.encoding = encoding;
    const charStringsAndSeacs = this.parseCharStrings({
      charStrings: charStringIndex,
      localSubrIndex: topDict.privateDict.subrsIndex,
      globalSubrIndex: globalSubrIndex.obj,
      fdSelect: cff.fdSelect,
      fdArray: cff.fdArray,
      privateDict: topDict.privateDict
    });
    cff.charStrings = charStringsAndSeacs.charStrings;
    cff.seacs = charStringsAndSeacs.seacs;
    cff.widths = charStringsAndSeacs.widths;
    return cff;
  }
  parseHeader() {
    let bytes = this.bytes;
    const bytesLength = bytes.length;
    let offset = 0;
    while (offset < bytesLength && bytes[offset] !== 1) {
      ++offset;
    }
    if (offset >= bytesLength) {
      throw new FormatError("Invalid CFF header");
    }
    if (offset !== 0) {
      info("cff data is shifted");
      bytes = bytes.subarray(offset);
      this.bytes = bytes;
    }
    const major = bytes[0];
    const minor = bytes[1];
    const hdrSize = bytes[2];
    const offSize = bytes[3];
    const header = new CFFHeader(major, minor, hdrSize, offSize);
    return { obj: header, endPos: hdrSize };
  }
  parseDict(dict) {
    this.onAllocation?.(1024 + dict.length * 128);
    const view = new DataView(dict.buffer, dict.byteOffset, dict.bytesLength);
    let pos = 0;
    function parseOperand() {
      let value = dict[pos++];
      if (value === 30) {
        return parseFloatOperand();
      } else if (value === 28) {
        value = view.getInt16(pos);
        pos += 2;
        return value;
      } else if (value === 29) {
        value = view.getInt32(pos);
        pos += 4;
        return value;
      } else if (value >= 32 && value <= 246) {
        return value - 139;
      } else if (value >= 247 && value <= 250) {
        return (value - 247) * 256 + dict[pos++] + 108;
      } else if (value >= 251 && value <= 254) {
        return -((value - 251) * 256) - dict[pos++] - 108;
      }
      warn(`CFFParser.parseDict: "${value}" is a reserved command.`);
      return NaN;
    }
    function parseFloatOperand() {
      let str = "";
      const eof = 15;
      const lookup = [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        ".",
        "E",
        "E-",
        null,
        "-"
      ];
      const length = dict.length;
      while (pos < length) {
        const b = dict[pos++];
        const b1 = b >> 4;
        const b2 = b & 15;
        if (b1 === eof) {
          break;
        }
        str += lookup[b1];
        if (b2 === eof) {
          break;
        }
        str += lookup[b2];
      }
      return parseFloat(str);
    }
    let operands = [];
    const entries = [];
    pos = 0;
    const end = dict.length;
    while (pos < end) {
      let b = dict[pos];
      if (b <= 21) {
        if (b === 12) {
          b = b << 8 | dict[++pos];
        }
        entries.push([b, operands]);
        operands = [];
        ++pos;
      } else {
        operands.push(parseOperand());
      }
    }
    return entries;
  }
  parseIndex(pos) {
    const cffIndex = new CFFIndex();
    const bytes = this.bytes;
    const count = bytes[pos++] << 8 | bytes[pos++];
    this.onAllocation?.(256 + count * 128);
    const offsets = [];
    let end = pos;
    let i, ii;
    if (count !== 0) {
      const offsetSize = bytes[pos++];
      const startPos = pos + (count + 1) * offsetSize - 1;
      for (i = 0, ii = count + 1; i < ii; ++i) {
        let offset = 0;
        for (let j = 0; j < offsetSize; ++j) {
          offset <<= 8;
          offset += bytes[pos++];
        }
        offsets.push(startPos + offset);
      }
      end = offsets[count];
    }
    for (i = 0, ii = offsets.length - 1; i < ii; ++i) {
      const offsetStart = offsets[i];
      const offsetEnd = offsets[i + 1];
      cffIndex.add(bytes.subarray(offsetStart, offsetEnd));
    }
    return { obj: cffIndex, endPos: end };
  }
  parseNameIndex(index) {
    const names = [];
    for (let i = 0, ii = index.count; i < ii; ++i) {
      const name = index.get(i);
      this.onAllocation?.(64 + name.length * 32);
      names.push(bytesToString(name));
    }
    return names;
  }
  parseStringIndex(index) {
    const strings = new CFFStrings();
    for (let i = 0, ii = index.count; i < ii; ++i) {
      const data = index.get(i);
      this.onAllocation?.(64 + data.length * 32);
      strings.add(bytesToString(data));
    }
    return strings;
  }
  createDict(Type, dict, strings) {
    this.onAllocation?.(2048 + dict.length * 128);
    const cffDict = new Type(strings);
    for (const [key, value] of dict) {
      cffDict.setByKey(key, value);
    }
    return cffDict;
  }
  parseCharString(state, data, localSubrIndex, globalSubrIndex) {
    if (!data || state.callDepth > MAX_SUBR_NESTING) {
      return false;
    }
    this.onAllocation?.(256 + data.length * 16);
    const view = new DataView(data.buffer, data.byteOffset, data.bytesLength);
    let stackSize = state.stackSize;
    const stack = state.stack;
    let length = data.length;
    for (let j = 0; j < length; ) {
      const value = data[j++];
      let validationCommand = null;
      if (value === 12) {
        const q = data[j++];
        if (q === 0) {
          data[j - 2] = 139;
          data[j - 1] = 22;
          stackSize = 0;
        } else {
          validationCommand = CharstringValidationData12[q];
        }
      } else if (value === 28) {
        stack[stackSize] = view.getInt16(j);
        j += 2;
        stackSize++;
      } else if (value === 14) {
        if (stackSize >= 4) {
          stackSize -= 4;
          if (this.seacAnalysisEnabled) {
            state.seac = stack.slice(stackSize, stackSize + 4);
            return false;
          }
        }
        validationCommand = CharstringValidationData[value];
      } else if (value >= 32 && value <= 246) {
        stack[stackSize] = value - 139;
        stackSize++;
      } else if (value >= 247 && value <= 254) {
        stack[stackSize] = value < 251 ? (value - 247 << 8) + data[j] + 108 : -(value - 251 << 8) - data[j] - 108;
        j++;
        stackSize++;
      } else if (value === 255) {
        stack[stackSize] = view.getInt32(j) / 65536;
        j += 4;
        stackSize++;
      } else if (value === 19 || value === 20) {
        state.hints += stackSize >> 1;
        if (state.hints === 0) {
          data.copyWithin(j - 1, j, -1);
          j -= 1;
          length -= 1;
          continue;
        }
        j += state.hints + 7 >> 3;
        stackSize %= 2;
        validationCommand = CharstringValidationData[value];
      } else if (value === 10 || value === 29) {
        const subrsIndex = value === 10 ? localSubrIndex : globalSubrIndex;
        if (!subrsIndex) {
          validationCommand = CharstringValidationData[value];
          warn("Missing subrsIndex for " + validationCommand.id);
          return false;
        }
        let bias = 32768;
        if (subrsIndex.count < 1240) {
          bias = 107;
        } else if (subrsIndex.count < 33900) {
          bias = 1131;
        }
        const subrNumber = stack[--stackSize] + bias;
        if (subrNumber < 0 || subrNumber >= subrsIndex.count || isNaN(subrNumber)) {
          validationCommand = CharstringValidationData[value];
          warn("Out of bounds subrIndex for " + validationCommand.id);
          return false;
        }
        state.stackSize = stackSize;
        state.callDepth++;
        const valid = this.parseCharString(
          state,
          subrsIndex.get(subrNumber),
          localSubrIndex,
          globalSubrIndex
        );
        if (!valid) {
          return false;
        }
        state.callDepth--;
        stackSize = state.stackSize;
        continue;
      } else if (value === 11) {
        state.stackSize = stackSize;
        return true;
      } else if (value === 0 && j === data.length) {
        data[j - 1] = 14;
        validationCommand = CharstringValidationData[14];
      } else if (value === 9) {
        data.copyWithin(j - 1, j, -1);
        j -= 1;
        length -= 1;
        continue;
      } else {
        validationCommand = CharstringValidationData[value];
      }
      if (validationCommand) {
        if (validationCommand.stem) {
          state.hints += stackSize >> 1;
          if (value === 3 || value === 23) {
            state.hasVStems = true;
          } else if (state.hasVStems && (value === 1 || value === 18)) {
            warn("CFF stem hints are in wrong order");
            data[j - 1] = value === 1 ? 3 : 23;
          }
        }
        if (stackSize < validationCommand.min) {
          warn(
            "Not enough parameters for " + validationCommand.id + "; actual: " + stackSize + ", expected: " + validationCommand.min
          );
          if (stackSize === 0) {
            data[j - 1] = 14;
            return true;
          }
          return false;
        }
        if (state.firstStackClearing && validationCommand.stackClearing) {
          state.firstStackClearing = false;
          stackSize -= validationCommand.min;
          if (stackSize >= 2 && validationCommand.stem) {
            stackSize %= 2;
          } else if (stackSize > 1) {
            warn("Found too many parameters for stack-clearing command");
          }
          if (stackSize > 0) {
            state.width = stack[stackSize - 1];
          }
        }
        if ("stackDelta" in validationCommand) {
          if ("stackFn" in validationCommand) {
            validationCommand.stackFn(stack, stackSize);
          }
          stackSize += validationCommand.stackDelta;
        } else if (validationCommand.stackClearing || validationCommand.resetStack) {
          stackSize = 0;
        }
      }
    }
    if (length < data.length) {
      data.fill(
        /* endchar = */
        14,
        length
      );
    }
    state.stackSize = stackSize;
    return true;
  }
  *parseCharStringSteps(state, data, localSubrIndex, globalSubrIndex) {
    if (!data || state.callDepth > MAX_SUBR_NESTING) {
        return false;
    }
    ;
    ;
    let stackSize = state.stackSize;
    const stack = state.stack;
    let length = data.length;
    for (let j = 0; j < length;) {
        const value = (yield data.byte(j++));
        let validationCommand = null;
        if (value === 12) {
            const q = (yield data.byte(j++));
            if (q === 0) {
                (yield data.writeByte(j - 2, 139));
                (yield data.writeByte(j - 1, 22));
                stackSize = 0;
            }
            else {
                validationCommand = CharstringValidationData12[q];
            }
        }
        else if (value === 28) {
            (yield stack.set(stackSize, (yield data.parserInt(j, 2))));
            j += 2;
            stackSize++;
        }
        else if (value === 14) {
            if (stackSize >= 4) {
                stackSize -= 4;
                if (this.seacAnalysisEnabled) {
                    state.seac = (yield stack.slice(stackSize, stackSize + 4));
                    return false;
                }
            }
            validationCommand = CharstringValidationData[value];
        }
        else if (value >= 32 && value <= 246) {
            (yield stack.set(stackSize, value - 139));
            stackSize++;
        }
        else if (value >= 247 && value <= 254) {
            (yield stack.set(stackSize, value < 251 ? (value - 247 << 8) + (yield data.byte(j)) + 108 : -(value - 251 << 8) - (yield data.byte(j)) - 108));
            j++;
            stackSize++;
        }
        else if (value === 255) {
            (yield stack.set(stackSize, (yield data.parserInt(j, 4)) / 65536));
            j += 4;
            stackSize++;
        }
        else if (value === 19 || value === 20) {
            state.hints += stackSize >> 1;
            if (state.hints === 0) {
                (yield data.copyWithin(j - 1, j, -1));
                j -= 1;
                length -= 1;
                continue;
            }
            j += state.hints + 7 >> 3;
            stackSize %= 2;
            validationCommand = CharstringValidationData[value];
        }
        else if (value === 10 || value === 29) {
            const subrsIndex = value === 10 ? localSubrIndex : globalSubrIndex;
            if (!subrsIndex) {
                validationCommand = CharstringValidationData[value];
                warn("Missing subrsIndex for " + validationCommand.id);
                return false;
            }
            let bias = 32768;
            if (subrsIndex.count < 1240) {
                bias = 107;
            }
            else if (subrsIndex.count < 33900) {
                bias = 1131;
            }
            const subrNumber = (yield stack.get(--stackSize)) + bias;
            if (subrNumber < 0 || subrNumber >= subrsIndex.count || isNaN(subrNumber)) {
                validationCommand = CharstringValidationData[value];
                warn("Out of bounds subrIndex for " + validationCommand.id);
                return false;
            }
            state.stackSize = stackSize;
            state.callDepth++;
            const valid = (yield* this.parseCharStringSteps(state, (yield subrsIndex.get(subrNumber)), localSubrIndex, globalSubrIndex));
            if (!valid) {
                return false;
            }
            state.callDepth--;
            stackSize = state.stackSize;
            continue;
        }
        else if (value === 11) {
            state.stackSize = stackSize;
            return true;
        }
        else if (value === 0 && j === data.length) {
            (yield data.writeByte(j - 1, 14));
            validationCommand = CharstringValidationData[14];
        }
        else if (value === 9) {
            (yield data.copyWithin(j - 1, j, -1));
            j -= 1;
            length -= 1;
            continue;
        }
        else {
            validationCommand = CharstringValidationData[value];
        }
        if (validationCommand) {
            if (validationCommand.stem) {
                state.hints += stackSize >> 1;
                if (value === 3 || value === 23) {
                    state.hasVStems = true;
                }
                else if (state.hasVStems && (value === 1 || value === 18)) {
                    warn("CFF stem hints are in wrong order");
                    (yield data.writeByte(j - 1, value === 1 ? 3 : 23));
                }
            }
            if (stackSize < validationCommand.min) {
                warn("Not enough parameters for " + validationCommand.id + "; actual: " + stackSize + ", expected: " + validationCommand.min);
                if (stackSize === 0) {
                    (yield data.writeByte(j - 1, 14));
                    return true;
                }
                return false;
            }
            if (state.firstStackClearing && validationCommand.stackClearing) {
                state.firstStackClearing = false;
                stackSize -= validationCommand.min;
                if (stackSize >= 2 && validationCommand.stem) {
                    stackSize %= 2;
                }
                else if (stackSize > 1) {
                    warn("Found too many parameters for stack-clearing command");
                }
                if (stackSize > 0) {
                    state.width = (yield stack.get(stackSize - 1));
                }
            }
            if ("stackDelta" in validationCommand) {
                if ("stackFn" in validationCommand) {
                    (yield* cffValidationMath(validationCommand, stack, stackSize));
                }
                stackSize += validationCommand.stackDelta;
            }
            else if (validationCommand.stackClearing || validationCommand.resetStack) {
                stackSize = 0;
            }
        }
    }
    if (length < data.length) {
        (yield data.fill(
        /* endchar = */
        14, length));
    }
    state.stackSize = stackSize;
    return true;
}
  parseCharStrings({
    charStrings,
    localSubrIndex,
    globalSubrIndex,
    fdSelect,
    fdArray,
    privateDict
  }) {
    const seacs = /* @__PURE__ */ new Map();
    const widths = [];
    const count = charStrings.count;
    this.onAllocation?.(count * 512);
    for (let i = 0; i < count; i++) {
      const charstring = charStrings.get(i);
      const state = {
        callDepth: 0,
        stackSize: 0,
        stack: [],
        hints: 0,
        firstStackClearing: true,
        seac: null,
        width: null,
        hasVStems: false
      };
      let valid = true;
      let localSubrToUse = null;
      let privateDictToUse = privateDict;
      if (fdSelect && fdArray.length) {
        const fdIndex = fdSelect.getFDIndex(i);
        if (fdIndex === -1) {
          warn("Glyph index is not in fd select.");
          valid = false;
        }
        if (fdIndex >= fdArray.length) {
          warn("Invalid fd index for glyph index.");
          valid = false;
        }
        if (valid) {
          privateDictToUse = fdArray[fdIndex].privateDict;
          localSubrToUse = privateDictToUse.subrsIndex;
        }
      } else if (localSubrIndex) {
        localSubrToUse = localSubrIndex;
      }
      valid &&= this.parseCharString(
        state,
        charstring,
        localSubrToUse,
        globalSubrIndex
      );
      if (state.width !== null) {
        const nominalWidth = privateDictToUse.getByName("nominalWidthX");
        widths[i] = nominalWidth + state.width;
      } else {
        const defaultWidth = privateDictToUse.getByName("defaultWidthX");
        widths[i] = defaultWidth;
      }
      if (state.seac !== null) {
        seacs.set(i, state.seac);
      }
      if (!valid) {
        charStrings.set(i, new Uint8Array([14]));
      }
    }
    return { charStrings, seacs, widths };
  }
  emptyPrivateDictionary(parentDict) {
    const privateDict = this.createDict(CFFPrivateDict, [], parentDict.strings);
    parentDict.setByKey(18, [0, 0]);
    parentDict.privateDict = privateDict;
  }
  parsePrivateDict(parentDict) {
    if (!parentDict.hasName("Private")) {
      this.emptyPrivateDictionary(parentDict);
      return;
    }
    const privateOffset = parentDict.getByName("Private");
    if (!Array.isArray(privateOffset) || privateOffset.length !== 2) {
      parentDict.removeByName("Private");
      return;
    }
    const size = privateOffset[0];
    const offset = privateOffset[1];
    if (size === 0 || offset >= this.bytes.length) {
      this.emptyPrivateDictionary(parentDict);
      return;
    }
    if (offset + size > this.bytes.length) {
      throw new FormatError("CFF Private DICT extends past end of font");
    }
    const privateDictEnd = offset + size;
    const dictData = this.bytes.subarray(offset, privateDictEnd);
    const dict = this.parseDict(dictData);
    const privateDict = this.createDict(
      CFFPrivateDict,
      dict,
      parentDict.strings
    );
    parentDict.privateDict = privateDict;
    const blueScale = privateDict.getByName("BlueScale");
    const blueShift = privateDict.getByName("BlueShift");
    const blueFuzz = privateDict.getByName("BlueFuzz");
    const expansionFactor = privateDict.getByName("ExpansionFactor");
    if (blueScale === 0 && blueShift === 0 && blueFuzz === 0 && expansionFactor === 0) {
      privateDict.setByName("BlueScale", DEFAULT_BLUE_SCALE);
      privateDict.setByName("BlueShift", DEFAULT_BLUE_SHIFT);
      privateDict.setByName("BlueFuzz", DEFAULT_BLUE_FUZZ);
    }
    if (expansionFactor === 0) {
      privateDict.setByName("ExpansionFactor", DEFAULT_EXPANSION_FACTOR);
    }
    if (blueScale > 0) {
      let maxZoneHeight = 0;
      for (const zones of [
        privateDict.getByName("BlueValues"),
        privateDict.getByName("OtherBlues")
      ]) {
        if (!zones) {
          continue;
        }
        for (let i = 1; i < zones.length; i += 2) {
          if (zones[i] > maxZoneHeight) {
            maxZoneHeight = zones[i];
          }
        }
      }
      if (maxZoneHeight > 0) {
        const PRECISION = 1e5;
        const lowerBound = 0.5 / maxZoneHeight;
        const minBlueScale = lowerBound <= DEFAULT_BLUE_SCALE ? Math.ceil(lowerBound * PRECISION) / PRECISION : -Infinity;
        const maxBlueScale = Math.floor(PRECISION / maxZoneHeight) / PRECISION;
        const clamped = MathClamp(blueScale, minBlueScale, maxBlueScale);
        if (clamped !== blueScale) {
          privateDict.setByName("BlueScale", clamped);
        }
      }
    }
    if (!privateDict.getByName("Subrs")) {
      return;
    }
    const subrsOffset = privateDict.getByName("Subrs");
    const relativeOffset = offset + subrsOffset;
    if (subrsOffset === 0 || relativeOffset >= this.bytes.length) {
      this.emptyPrivateDictionary(parentDict);
      return;
    }
    const subrsIndex = this.parseIndex(relativeOffset);
    privateDict.subrsIndex = subrsIndex.obj;
  }
  parseCharsets(pos, length, strings, cid) {
    this.onAllocation?.(256);
    if (pos === 0) {
      return new CFFCharset(
        true,
        CFFCharsetPredefinedTypes.ISO_ADOBE,
        ISOAdobeCharset
      );
    } else if (pos === 1) {
      return new CFFCharset(
        true,
        CFFCharsetPredefinedTypes.EXPERT,
        ExpertCharset
      );
    } else if (pos === 2) {
      return new CFFCharset(
        true,
        CFFCharsetPredefinedTypes.EXPERT_SUBSET,
        ExpertSubsetCharset
      );
    }
    const { bytes } = this;
    const format = bytes[pos++];
    const charset = [cid ? 0 : ".notdef"];
    let id, count, i;
    length -= 1;
    switch (format) {
      case 0:
        this.onAllocation?.(Math.max(0, length) * 16);
        for (i = 0; i < length; i++) {
          id = bytes[pos++] << 8 | bytes[pos++];
          charset.push(cid ? id : strings.get(id));
        }
        break;
      case 1:
        while (charset.length <= length) {
          if (pos + (format === 1 ? 3 : 4) > bytes.length) throw new FormatError("Truncated CFF charset range");
          id = bytes[pos++] << 8 | bytes[pos++];
          count = bytes[pos++];
          this.onAllocation?.((count + 1) * 16);
          for (i = 0; i <= count; i++) {
            charset.push(cid ? id++ : strings.get(id++));
          }
        }
        break;
      case 2:
        while (charset.length <= length) {
          if (pos + (format === 1 ? 3 : 4) > bytes.length) throw new FormatError("Truncated CFF charset range");
          id = bytes[pos++] << 8 | bytes[pos++];
          count = bytes[pos++] << 8 | bytes[pos++];
          this.onAllocation?.((count + 1) * 16);
          for (i = 0; i <= count; i++) {
            charset.push(cid ? id++ : strings.get(id++));
          }
        }
        break;
      default:
        throw new FormatError("Unknown charset format");
    }
    return new CFFCharset(false, format, charset);
  }
  parseEncoding(pos, properties, strings, charset) {
    this.onAllocation?.(32768);
    const encoding = /* @__PURE__ */ Object.create(null);
    const bytes = this.bytes;
    let predefined = false;
    let format, i, ii;
    let raw = null;
    function readSupplement() {
      const supplementsCount = bytes[pos++];
      for (i = 0; i < supplementsCount; i++) {
        const code = bytes[pos++];
        const sid = (bytes[pos++] << 8) + (bytes[pos++] & 255);
        encoding[code] = charset.indexOf(strings.get(sid));
      }
    }
    if (pos === 0 || pos === 1) {
      predefined = true;
      format = pos;
      const baseEncoding = pos ? ExpertEncoding : StandardEncoding;
      for (i = 0, ii = charset.length; i < ii; i++) {
        const index = baseEncoding.indexOf(charset[i]);
        if (index !== -1) {
          encoding[index] = i;
        }
      }
    } else {
      const dataStart = pos;
      format = bytes[pos++];
      switch (format & 127) {
        case 0:
          const glyphsCount = bytes[pos++];
          for (i = 1; i <= glyphsCount; i++) {
            encoding[bytes[pos++]] = i;
          }
          break;
        case 1:
          const rangesCount = bytes[pos++];
          let gid = 1;
          for (i = 0; i < rangesCount; i++) {
            const start = bytes[pos++];
            const left = bytes[pos++];
            for (let j = start; j <= start + left; j++) {
              encoding[j] = gid++;
            }
          }
          break;
        default:
          throw new FormatError(`Unknown encoding format: ${format} in CFF`);
      }
      const dataEnd = pos;
      if (format & 128) {
        bytes[dataStart] &= 127;
        readSupplement();
      }
      raw = bytes.subarray(dataStart, dataEnd);
    }
    format &= 127;
    return new CFFEncoding(predefined, format, encoding, raw);
  }
  parseFDSelect(pos, length) {
    this.onAllocation?.(256);
    const bytes = this.bytes;
    const format = bytes[pos++];
    const fdSelect = [];
    let i;
    switch (format) {
      case 0:
        this.onAllocation?.(Math.max(0, length) * 16);
        for (i = 0; i < length; ++i) {
          const id = bytes[pos++];
          fdSelect.push(id);
        }
        break;
      case 3:
        const rangesCount = bytes[pos++] << 8 | bytes[pos++];
        for (i = 0; i < rangesCount; ++i) {
          let first = bytes[pos++] << 8 | bytes[pos++];
          if (i === 0 && first !== 0) {
            warn(
              "parseFDSelect: The first range must have a first GID of 0 -- trying to recover."
            );
            first = 0;
          }
          const fdIndex = bytes[pos++];
          const next = bytes[pos] << 8 | bytes[pos + 1];
          this.onAllocation?.(Math.max(0, next - first) * 16);
          for (let j = first; j < next; ++j) {
            fdSelect.push(fdIndex);
          }
        }
        pos += 2;
        break;
      default:
        throw new FormatError(`parseFDSelect: Unknown format "${format}".`);
    }
    if (fdSelect.length !== length) {
      throw new FormatError("parseFDSelect: Invalid font data.");
    }
    return new CFFFDSelect(format, fdSelect);
  }
};
var CFF = class {
  header = null;
  names = [];
  topDict = null;
  strings = new CFFStrings();
  globalSubrIndex = null;
  // The following could really be per font, but since we only have one font
  // store them here.
  encoding = null;
  charset = null;
  charStrings = null;
  fdArray = [];
  fdSelect = null;
  isCIDFont = false;
  charStringCount = 0;
  constructor(rawFileLength = 0) {
    this.rawFileLength = rawFileLength;
  }
  duplicateFirstGlyph() {
    if (this.charStrings.count >= 65535) {
      warn("Not enough space in charstrings to duplicate first glyph.");
      return;
    }
    const glyphZero = this.charStrings.get(0);
    this.charStrings.add(glyphZero);
    if (this.isCIDFont) {
      this.fdSelect.fdSelect.push(this.fdSelect.fdSelect[0]);
    }
  }
  hasGlyphId(id) {
    if (id < 0 || id >= this.charStrings.count) {
      return false;
    }
    const glyph = this.charStrings.get(id);
    return glyph.length > 0;
  }
};
var CFFHeader = class {
  constructor(major, minor, hdrSize, offSize) {
    this.major = major;
    this.minor = minor;
    this.hdrSize = hdrSize;
    this.offSize = offSize;
  }
};
var CFFStrings = class {
  strings = [];
  get(index) {
    if (index >= 0 && index <= NUM_STANDARD_CFF_STRINGS - 1) {
      return CFFStandardStrings[index];
    }
    return index - NUM_STANDARD_CFF_STRINGS <= this.strings.length ? this.strings[index - NUM_STANDARD_CFF_STRINGS] : CFFStandardStrings[0];
  }
  getSID(str) {
    let index = CFFStandardStrings.indexOf(str);
    if (index !== -1) {
      return index;
    }
    index = this.strings.indexOf(str);
    return index !== -1 ? index + NUM_STANDARD_CFF_STRINGS : -1;
  }
  add(value) {
    this.strings.push(value);
  }
  get count() {
    return this.strings.length;
  }
};
var CFFIndex = class {
  objects = [];
  length = 0;
  add(data) {
    this.length += data.length;
    this.objects.push(data);
  }
  set(index, data) {
    this.length += data.length - this.objects[index].length;
    this.objects[index] = data;
  }
  get(index) {
    return this.objects[index];
  }
  get count() {
    return this.objects.length;
  }
};
var CFFDict = class {
  values = /* @__PURE__ */ new Map();
  constructor(tables, strings) {
    this.keyToNameMap = tables.keyToNameMap;
    this.nameToKeyMap = tables.nameToKeyMap;
    this.defaults = tables.defaults;
    this.types = tables.types;
    this.opcodes = tables.opcodes;
    this.order = tables.order;
    this.strings = strings;
  }
  // value should always be an array
  setByKey(key, value) {
    if (!this.keyToNameMap.has(key)) {
      return false;
    }
    if (value.length === 0) {
      return true;
    }
    for (const val of value) {
      if (isNaN(val)) {
        warn(`Invalid CFFDict value: "${value}" for key "${key}".`);
        return true;
      }
    }
    const type = this.types.get(key);
    if (type === "num" || type === "sid" || type === "offset") {
      value = value[0];
    }
    this.values.set(key, value);
    return true;
  }
  setByName(name, value) {
    if (!this.nameToKeyMap.has(name)) {
      throw new FormatError(`Invalid dictionary name "${name}"`);
    }
    const key = this.nameToKeyMap.get(name);
    this.values.set(key, value);
  }
  hasName(name) {
    const key = this.nameToKeyMap.get(name);
    return this.values.has(key);
  }
  getByName(name) {
    if (!this.nameToKeyMap.has(name)) {
      throw new FormatError(`Invalid dictionary name ${name}"`);
    }
    const key = this.nameToKeyMap.get(name);
    return this.values.has(key) ? this.values.get(key) : this.defaults.get(key);
  }
  removeByName(name) {
    const key = this.nameToKeyMap.get(name);
    this.values.delete(key);
  }
  static createTables(layout) {
    const tables = {
      keyToNameMap: /* @__PURE__ */ new Map(),
      nameToKeyMap: /* @__PURE__ */ new Map(),
      defaults: /* @__PURE__ */ new Map(),
      types: /* @__PURE__ */ new Map(),
      opcodes: /* @__PURE__ */ new Map(),
      order: []
    };
    for (const entry of layout) {
      const key = Array.isArray(entry[0]) ? (entry[0][0] << 8) + entry[0][1] : entry[0];
      tables.keyToNameMap.set(key, entry[1]);
      tables.nameToKeyMap.set(entry[1], key);
      tables.types.set(key, entry[2]);
      tables.defaults.set(key, entry[3]);
      tables.opcodes.set(key, Array.isArray(entry[0]) ? entry[0] : [entry[0]]);
      tables.order.push(key);
    }
    return tables;
  }
};
var CFFTopDictLayout = [
  [[12, 30], "ROS", ["sid", "sid", "num"], null],
  [[12, 20], "SyntheticBase", "num", null],
  [0, "version", "sid", null],
  [1, "Notice", "sid", null],
  [[12, 0], "Copyright", "sid", null],
  [2, "FullName", "sid", null],
  [3, "FamilyName", "sid", null],
  [4, "Weight", "sid", null],
  [[12, 1], "isFixedPitch", "num", 0],
  [[12, 2], "ItalicAngle", "num", 0],
  [[12, 3], "UnderlinePosition", "num", -100],
  [[12, 4], "UnderlineThickness", "num", 50],
  [[12, 5], "PaintType", "num", 0],
  [[12, 6], "CharstringType", "num", 2],
  // prettier-ignore
  [
    [12, 7],
    "FontMatrix",
    ["num", "num", "num", "num", "num", "num"],
    [1e-3, 0, 0, 1e-3, 0, 0]
  ],
  [13, "UniqueID", "num", null],
  [5, "FontBBox", ["num", "num", "num", "num"], [0, 0, 0, 0]],
  [[12, 8], "StrokeWidth", "num", 0],
  [14, "XUID", "array", null],
  [15, "charset", "offset", 0],
  [16, "Encoding", "offset", 0],
  [17, "CharStrings", "offset", 0],
  [18, "Private", ["offset", "offset"], null],
  [[12, 21], "PostScript", "sid", null],
  [[12, 22], "BaseFontName", "sid", null],
  [[12, 23], "BaseFontBlend", "delta", null],
  [[12, 31], "CIDFontVersion", "num", 0],
  [[12, 32], "CIDFontRevision", "num", 0],
  [[12, 33], "CIDFontType", "num", 0],
  [[12, 34], "CIDCount", "num", 8720],
  [[12, 35], "UIDBase", "num", null],
  // XXX: CID Fonts on DirectWrite 6.1 only seem to work if FDSelect comes
  // before FDArray.
  [[12, 37], "FDSelect", "offset", null],
  [[12, 36], "FDArray", "offset", null],
  [[12, 38], "FontName", "sid", null]
];
var CFFTopDict = class _CFFTopDict extends CFFDict {
  static get tables() {
    return shadow(this, "tables", this.createTables(CFFTopDictLayout));
  }
  privateDict = null;
  constructor(strings) {
    super(_CFFTopDict.tables, strings);
  }
};
var CFFPrivateDictLayout = [
  [6, "BlueValues", "delta", null],
  [7, "OtherBlues", "delta", null],
  [8, "FamilyBlues", "delta", null],
  [9, "FamilyOtherBlues", "delta", null],
  [[12, 9], "BlueScale", "num", DEFAULT_BLUE_SCALE],
  [[12, 10], "BlueShift", "num", DEFAULT_BLUE_SHIFT],
  [[12, 11], "BlueFuzz", "num", DEFAULT_BLUE_FUZZ],
  [10, "StdHW", "num", null],
  [11, "StdVW", "num", null],
  [[12, 12], "StemSnapH", "delta", null],
  [[12, 13], "StemSnapV", "delta", null],
  [[12, 14], "ForceBold", "num", 0],
  [[12, 17], "LanguageGroup", "num", 0],
  [[12, 18], "ExpansionFactor", "num", DEFAULT_EXPANSION_FACTOR],
  [[12, 19], "initialRandomSeed", "num", 0],
  [20, "defaultWidthX", "num", 0],
  [21, "nominalWidthX", "num", 0],
  [19, "Subrs", "offset", null]
];
var CFFPrivateDict = class _CFFPrivateDict extends CFFDict {
  static get tables() {
    return shadow(this, "tables", this.createTables(CFFPrivateDictLayout));
  }
  subrsIndex = null;
  constructor(strings) {
    super(_CFFPrivateDict.tables, strings);
  }
};
var CFFCharsetPredefinedTypes = {
  ISO_ADOBE: 0,
  EXPERT: 1,
  EXPERT_SUBSET: 2
};
var CFFCharset = class {
  constructor(predefined, format, charset) {
    this.predefined = predefined;
    this.format = format;
    this.charset = charset;
  }
};
var CFFEncoding = class {
  constructor(predefined, format, encoding, raw) {
    this.predefined = predefined;
    this.format = format;
    this.encoding = encoding;
    this.raw = raw;
  }
};
var CFFFDSelect = class {
  constructor(format, fdSelect) {
    this.format = format;
    this.fdSelect = fdSelect;
  }
  getFDIndex(glyphIndex) {
    return glyphIndex < 0 || glyphIndex >= this.fdSelect.length ? -1 : this.fdSelect[glyphIndex];
  }
};
var CFFOffsetTracker = class {
  #offsets = /* @__PURE__ */ new Map();
  isTracking(key) {
    return this.#offsets.has(key);
  }
  track(key, location) {
    if (this.#offsets.has(key)) {
      throw new FormatError(`Already tracking location of ${key}`);
    }
    this.#offsets.set(key, location);
  }
  offset(value) {
    for (const [key, val] of this.#offsets) {
      this.#offsets.set(key, val + value);
    }
  }
  setEntryLocation(key, values, output) {
    if (!this.#offsets.has(key)) {
      throw new FormatError(`Not tracking location of ${key}`);
    }
    const data = output.data;
    const dataOffset = this.#offsets.get(key);
    const size = 5;
    for (let i = 0, ii = values.length; i < ii; ++i) {
      const offset0 = i * size + dataOffset;
      const offset1 = offset0 + 1;
      const offset2 = offset0 + 2;
      const offset3 = offset0 + 3;
      const offset4 = offset0 + 4;
      if (data[offset0] !== 29 || data[offset1] !== 0 || data[offset2] !== 0 || data[offset3] !== 0 || data[offset4] !== 0) {
        throw new FormatError("writing to an offset that is not empty");
      }
      const value = values[i];
      data[offset0] = 29;
      data[offset1] = value >> 24 & 255;
      data[offset2] = value >> 16 & 255;
      data[offset3] = value >> 8 & 255;
      data[offset4] = value & 255;
    }
  }
};
var CFFCompiler = class _CFFCompiler {
  constructor(cff) {
    this.cff = cff;
  }
  compile() {
    const cff = this.cff;
    const output = new DataBuilder({ minLength: cff.rawFileLength });
    const header = this.compileHeader(cff.header);
    output.setArray(header);
    const nameIndex = this.compileNameIndex(cff.names);
    output.setArray(nameIndex);
    if (cff.isCIDFont) {
      if (cff.topDict.hasName("FontMatrix")) {
        const base = cff.topDict.getByName("FontMatrix");
        cff.topDict.removeByName("FontMatrix");
        for (const subDict of cff.fdArray) {
          let matrix = base.slice(0);
          if (subDict.hasName("FontMatrix")) {
            matrix = Util.transform(matrix, subDict.getByName("FontMatrix"));
          }
          subDict.setByName("FontMatrix", matrix);
        }
      }
    }
    const xuid = cff.topDict.getByName("XUID");
    if (xuid?.length > 16) {
      cff.topDict.removeByName("XUID");
    }
    cff.topDict.setByName("charset", 0);
    let compiled = this.compileTopDicts(
      [cff.topDict],
      output.length,
      cff.isCIDFont
    );
    output.setArray(compiled.output);
    const topDictTracker = compiled.trackers[0];
    const stringIndex = this.compileStringIndex(cff.strings.strings);
    output.setArray(stringIndex);
    const globalSubrIndex = this.compileIndex(cff.globalSubrIndex);
    output.setArray(globalSubrIndex);
    if (cff.encoding && cff.topDict.hasName("Encoding")) {
      if (cff.encoding.predefined) {
        topDictTracker.setEntryLocation(
          "Encoding",
          [cff.encoding.format],
          output
        );
      } else {
        const encoding = this.compileEncoding(cff.encoding);
        topDictTracker.setEntryLocation("Encoding", [output.length], output);
        output.setArray(encoding);
      }
    }
    const charset = this.compileCharset(
      cff.charset,
      cff.charStrings.count,
      cff.strings,
      cff.isCIDFont
    );
    topDictTracker.setEntryLocation("charset", [output.length], output);
    output.setArray(charset);
    const charStrings = this.compileCharStrings(cff.charStrings);
    topDictTracker.setEntryLocation("CharStrings", [output.length], output);
    output.setArray(charStrings);
    if (cff.isCIDFont) {
      topDictTracker.setEntryLocation("FDSelect", [output.length], output);
      const fdSelect = this.compileFDSelect(cff.fdSelect);
      output.setArray(fdSelect);
      compiled = this.compileTopDicts(cff.fdArray, output.length, true);
      topDictTracker.setEntryLocation("FDArray", [output.length], output);
      output.setArray(compiled.output);
      const fontDictTrackers = compiled.trackers;
      this.compilePrivateDicts(cff.fdArray, fontDictTrackers, output);
    }
    this.compilePrivateDicts([cff.topDict], [topDictTracker], output);
    output.setArray([0]);
    return output.data;
  }
  encodeNumber(value) {
    return Number.isInteger(value) ? this.encodeInteger(value) : this.encodeFloat(value);
  }
  static get EncodeFloatRegExp() {
    return shadow(
      this,
      "EncodeFloatRegExp",
      /\.(\d*?)(?:9{5,20}|0{5,20})\d{0,2}(?:e(.+)|$)/
    );
  }
  encodeFloat(num) {
    let value = num.toString();
    const m = _CFFCompiler.EncodeFloatRegExp.exec(value);
    if (m) {
      const epsilon = parseFloat("1e" + ((m[2] ? +m[2] : 0) + m[1].length));
      value = (Math.round(num * epsilon) / epsilon).toString();
    }
    let nibbles = "";
    let i, ii;
    for (i = 0, ii = value.length; i < ii; ++i) {
      const a = value[i];
      if (a === "e") {
        nibbles += value[++i] === "-" ? "c" : "b";
      } else if (a === ".") {
        nibbles += "a";
      } else if (a === "-") {
        nibbles += "e";
      } else {
        nibbles += a;
      }
    }
    nibbles += nibbles.length & 1 ? "f" : "ff";
    const out = [30];
    for (i = 0, ii = nibbles.length; i < ii; i += 2) {
      out.push(parseInt(nibbles.substring(i, i + 2), 16));
    }
    return out;
  }
  encodeInteger(value) {
    let code;
    if (value >= -107 && value <= 107) {
      code = [value + 139];
    } else if (value >= 108 && value <= 1131) {
      value -= 108;
      code = [(value >> 8) + 247, value & 255];
    } else if (value >= -1131 && value <= -108) {
      value = -value - 108;
      code = [(value >> 8) + 251, value & 255];
    } else if (value >= -32768 && value <= 32767) {
      code = [28, value >> 8 & 255, value & 255];
    } else {
      code = [
        29,
        value >> 24 & 255,
        value >> 16 & 255,
        value >> 8 & 255,
        value & 255
      ];
    }
    return code;
  }
  compileHeader(header) {
    return [header.major, header.minor, 4, header.offSize];
  }
  compileNameIndex(names) {
    const nameIndex = new CFFIndex();
    for (const name of names) {
      const length = Math.min(name.length, 127);
      let sanitizedName = new Array(length);
      for (let j = 0; j < length; j++) {
        let char = name[j];
        if (char < "!" || char > "~" || char === "[" || char === "]" || char === "(" || char === ")" || char === "{" || char === "}" || char === "<" || char === ">" || char === "/" || char === "%") {
          char = "_";
        }
        sanitizedName[j] = char;
      }
      sanitizedName = sanitizedName.join("");
      if (sanitizedName === "") {
        sanitizedName = "Bad_Font_Name";
      }
      nameIndex.add(stringToBytes(sanitizedName));
    }
    return this.compileIndex(nameIndex);
  }
  compileTopDicts(dicts, length, removeCidKeys) {
    const fontDictTrackers = [];
    let fdArrayIndex = new CFFIndex();
    for (const fontDict of dicts) {
      if (removeCidKeys) {
        fontDict.removeByName("CIDFontVersion");
        fontDict.removeByName("CIDFontRevision");
        fontDict.removeByName("CIDFontType");
        fontDict.removeByName("CIDCount");
        fontDict.removeByName("UIDBase");
      }
      const fontDictTracker = new CFFOffsetTracker();
      const fontDictData = this.compileDict(fontDict, fontDictTracker);
      fontDictTrackers.push(fontDictTracker);
      fdArrayIndex.add(fontDictData);
      fontDictTracker.offset(length);
    }
    fdArrayIndex = this.compileIndex(fdArrayIndex, fontDictTrackers);
    return {
      trackers: fontDictTrackers,
      output: fdArrayIndex
    };
  }
  compilePrivateDicts(dicts, trackers, output) {
    for (let i = 0, ii = dicts.length; i < ii; ++i) {
      const fontDict = dicts[i];
      const privateDict = fontDict.privateDict;
      if (!privateDict || !fontDict.hasName("Private")) {
        throw new FormatError("There must be a private dictionary.");
      }
      const privateDictTracker = new CFFOffsetTracker();
      const privateDictData = this.compileDict(privateDict, privateDictTracker);
      let outputLength = output.length;
      privateDictTracker.offset(outputLength);
      if (!privateDictData.length) {
        outputLength = 0;
      }
      trackers[i].setEntryLocation(
        "Private",
        [privateDictData.length, outputLength],
        output
      );
      output.setArray(privateDictData);
      if (privateDict.subrsIndex && privateDict.hasName("Subrs")) {
        const subrs = this.compileIndex(privateDict.subrsIndex);
        privateDictTracker.setEntryLocation(
          "Subrs",
          [privateDictData.length],
          output
        );
        output.setArray(subrs);
      }
    }
  }
  compileDict(dict, offsetTracker) {
    const out = [];
    for (const key of dict.order) {
      if (!dict.values.has(key)) {
        continue;
      }
      let values = dict.values.get(key);
      let types = dict.types.get(key);
      if (!Array.isArray(types)) {
        types = [types];
      }
      if (!Array.isArray(values)) {
        values = [values];
      }
      if (values.length === 0) {
        continue;
      }
      for (let j = 0, jj = types.length; j < jj; ++j) {
        const type = types[j];
        const value = values[j];
        switch (type) {
          case "num":
          case "sid":
            out.push(...this.encodeNumber(value));
            break;
          case "offset":
            const name = dict.keyToNameMap.get(key);
            if (!offsetTracker.isTracking(name)) {
              offsetTracker.track(name, out.length);
            }
            out.push(29, 0, 0, 0, 0);
            break;
          case "array":
          case "delta":
            out.push(...this.encodeNumber(value));
            for (let k = 1, kk = values.length; k < kk; ++k) {
              out.push(...this.encodeNumber(values[k]));
            }
            break;
          default:
            throw new FormatError(`Unknown data type of ${type}`);
        }
      }
      out.push(...dict.opcodes.get(key));
    }
    return out;
  }
  compileStringIndex(strings) {
    const stringIndex = new CFFIndex();
    for (const string of strings) {
      stringIndex.add(stringToBytes(string));
    }
    return this.compileIndex(stringIndex);
  }
  compileCharStrings(charStrings) {
    const charStringsIndex = new CFFIndex();
    for (let i = 0; i < charStrings.count; i++) {
      const glyph = charStrings.get(i);
      if (glyph.length === 0) {
        charStringsIndex.add(new Uint8Array([139, 14]));
        continue;
      }
      charStringsIndex.add(glyph);
    }
    return this.compileIndex(charStringsIndex);
  }
  compileCharset(charset, numGlyphs, strings, isCIDFont) {
    let out;
    const numGlyphsLessNotDef = numGlyphs - 1;
    if (isCIDFont) {
      const nLeft = numGlyphsLessNotDef - 1;
      out = new Uint8Array([
        2,
        // format
        0,
        // first CID upper byte
        1,
        // first CID lower byte
        nLeft >> 8 & 255,
        nLeft & 255
      ]);
    } else {
      const length = 1 + numGlyphsLessNotDef * 2;
      out = new Uint8Array(length);
      let charsetIndex = 0;
      const numCharsets = charset.charset.length;
      let warned = false;
      for (let i = 1; i < out.length; i += 2) {
        let sid = 0;
        if (charsetIndex < numCharsets) {
          const name = charset.charset[charsetIndex++];
          sid = strings.getSID(name);
          if (sid === -1) {
            sid = 0;
            if (!warned) {
              warned = true;
              warn(`Couldn't find ${name} in CFF strings`);
            }
          }
        }
        out[i] = sid >> 8 & 255;
        out[i + 1] = sid & 255;
      }
    }
    return out;
  }
  compileEncoding(encoding) {
    return encoding.raw;
  }
  compileFDSelect(fdSelect) {
    const format = fdSelect.format;
    let out, i;
    switch (format) {
      case 0:
        out = new Uint8Array(1 + fdSelect.fdSelect.length);
        out[0] = format;
        out.set(fdSelect.fdSelect, 1);
        break;
      case 3:
        const start = 0;
        let lastFD = fdSelect.fdSelect[0];
        const ranges = [
          format,
          0,
          // nRanges place holder
          0,
          // nRanges place holder
          start >> 8 & 255,
          start & 255,
          lastFD
        ];
        for (i = 1; i < fdSelect.fdSelect.length; i++) {
          const currentFD = fdSelect.fdSelect[i];
          if (currentFD !== lastFD) {
            ranges.push(i >> 8 & 255, i & 255, currentFD);
            lastFD = currentFD;
          }
        }
        const numRanges = (ranges.length - 3) / 3;
        ranges[1] = numRanges >> 8 & 255;
        ranges[2] = numRanges & 255;
        ranges.push(i >> 8 & 255, i & 255);
        out = new Uint8Array(ranges);
        break;
    }
    return out;
  }
  compileIndex(index, trackers = []) {
    const objects = index.objects;
    const count = objects.length;
    if (count === 0) {
      return new Uint8Array(2);
    }
    let lastOffset = 1, i;
    for (i = 0; i < count; ++i) {
      lastOffset += objects[i].length;
    }
    let offsetSize;
    if (lastOffset < 256) {
      offsetSize = 1;
    } else if (lastOffset < 65536) {
      offsetSize = 2;
    } else if (lastOffset < 16777216) {
      offsetSize = 3;
    } else {
      offsetSize = 4;
    }
    const data = new Uint8Array(2 + offsetSize * (count + 1) + lastOffset);
    let pos = 0;
    data[pos++] = count >> 8 & 255;
    data[pos++] = count & 255;
    data[pos++] = offsetSize;
    let relativeOffset = 1;
    for (i = 0; i < count + 1; i++) {
      if (offsetSize === 1) {
        data[pos++] = relativeOffset & 255;
      } else if (offsetSize === 2) {
        data[pos++] = relativeOffset >> 8 & 255;
        data[pos++] = relativeOffset & 255;
      } else if (offsetSize === 3) {
        data[pos++] = relativeOffset >> 16 & 255;
        data[pos++] = relativeOffset >> 8 & 255;
        data[pos++] = relativeOffset & 255;
      } else {
        data[pos++] = relativeOffset >>> 24 & 255;
        data[pos++] = relativeOffset >> 16 & 255;
        data[pos++] = relativeOffset >> 8 & 255;
        data[pos++] = relativeOffset & 255;
      }
      if (objects[i]) {
        relativeOffset += objects[i].length;
      }
    }
    for (i = 0; i < count; i++) {
      trackers[i]?.offset(pos);
      data.set(objects[i], pos);
      pos += objects[i].length;
    }
    return data;
  }
};

// src/shared/obj_bin_transform_utils.js
var FONT_INFO = class {
  static bools = [
    "black",
    "bold",
    "disableFontFace",
    "fontExtraProperties",
    "isInvalidPDFjsFont",
    "isType3Font",
    "italic",
    "missingFile",
    "remeasure",
    "vertical"
  ];
  static numbers = ["ascent", "defaultWidth", "descent"];
  static strings = ["fallbackName", "loadedName", "mimetype", "name"];
  static OFFSET_NUMBERS = Math.ceil(this.bools.length * 2 / 8);
  static OFFSET_BBOX = this.OFFSET_NUMBERS + this.numbers.length * 8;
  static OFFSET_FONT_MATRIX = this.OFFSET_BBOX + 1 + 2 * 4;
  static OFFSET_DEFAULT_VMETRICS = this.OFFSET_FONT_MATRIX + 1 + 8 * 6;
  static OFFSET_STRINGS = this.OFFSET_DEFAULT_VMETRICS + 1 + 2 * 3;
};

// src/core/obj_bin_transform_core.js
function compileFontPathInfo(path) {
  if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
    assert(
      FeatureTest.isFloat16ArraySupported ? path instanceof Float16Array : path instanceof Float32Array,
      "compileFontPathInfo: Unexpected path format."
    );
  }
  return path.slice().buffer;
}

// src/core/primitives.js
var NameCache = /* @__PURE__ */ new Map();
var RefCache = /* @__PURE__ */ new Map();
var Name = class _Name {
  constructor(name) {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && typeof name !== "string") {
      unreachable('Name: The "name" must be a string.');
    }
    this.name = name;
  }
  /**
   * NOTE: This method is invoked a lot, hence `getOrInsertComputed` is
   *       purposely *not* used to avoid creating unneeded callback functions.
   */
  static get(name) {
    let n = NameCache.get(name);
    if (!n) {
      n = new _Name(name);
      NameCache.set(name, n);
    }
    return n;
  }
};
var nonSerializable = () => nonSerializable;
var Dict = class _Dict {
  __nonSerializable__ = nonSerializable;
  // Disable cloning of the Dict.
  #map = /* @__PURE__ */ new Map();
  objId = null;
  suppressEncryption = false;
  xref;
  constructor(xref = null) {
    this.xref = xref;
  }
  assignXref(newXref) {
    this.xref = newXref;
  }
  get size() {
    return this.#map.size;
  }
  #getValue(isAsync, key1, key2) {
    let value = this.#map.get(key1);
    if (value === void 0 && key2 !== void 0) {
      if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && key2.length < key1.length) {
        unreachable("Dict.#getValue: Expected keys to be ordered by length.");
      }
      value = this.#map.get(key2);
    }
    if (value instanceof Ref && this.xref) {
      return isAsync ? this.xref.fetchAsync(value, this.suppressEncryption) : this.xref.fetch(value, this.suppressEncryption);
    }
    return value;
  }
  // Automatically dereferences Ref objects.
  get(key1, key2) {
    return this.#getValue(
      /* isAsync = */
      false,
      key1,
      key2
    );
  }
  // Same as get(), but returns a promise and uses fetchIfRefAsync().
  async getAsync(key1, key2) {
    return this.#getValue(
      /* isAsync = */
      true,
      key1,
      key2
    );
  }
  // Same as get(), but dereferences all elements if the result is an Array.
  getArray(key1, key2) {
    let value = this.#getValue(
      /* isAsync = */
      false,
      key1,
      key2
    );
    if (Array.isArray(value)) {
      value = value.slice();
      for (let i = 0, ii = value.length; i < ii; i++) {
        if (value[i] instanceof Ref && this.xref) {
          value[i] = this.xref.fetch(value[i], this.suppressEncryption);
        }
      }
    }
    return value;
  }
  // No dereferencing.
  getRaw(key) {
    return this.#map.get(key);
  }
  getKeys() {
    return this.#map.keys();
  }
  // No dereferencing.
  getRawValues() {
    return this.#map.values();
  }
  getRawEntries() {
    return this.#map.entries();
  }
  set(key, value) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      if (typeof key !== "string") {
        unreachable('Dict.set: The "key" must be a string.');
      } else if (value === void 0) {
        unreachable('Dict.set: The "value" cannot be undefined.');
      }
    }
    this.#map.set(key, value);
  }
  setIfNotExists(key, value) {
    if (!this.has(key)) {
      this.set(key, value);
    }
  }
  setIfNumber(key, value) {
    if (typeof value === "number") {
      this.set(key, value);
    }
  }
  setIfArray(key, value) {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      this.set(key, value);
    }
  }
  setIfDefined(key, value) {
    if (value !== void 0 && value !== null) {
      this.set(key, value);
    }
  }
  setIfName(key, value) {
    if (typeof value === "string") {
      this.set(key, Name.get(value));
    } else if (value instanceof Name) {
      this.set(key, value);
    }
  }
  setIfDict(key, value) {
    if (value instanceof _Dict) {
      this.set(key, value);
    }
  }
  has(key) {
    return this.#map.has(key);
  }
  *[Symbol.iterator]() {
    for (const [key, value] of this.#map) {
      yield [
        key,
        value instanceof Ref && this.xref ? this.xref.fetch(value, this.suppressEncryption) : value
      ];
    }
  }
  static get empty() {
    const emptyDict = new _Dict(null);
    emptyDict.set = (key, value) => {
      unreachable("Should not call `set` on the empty dictionary.");
    };
    return shadow(this, "empty", emptyDict);
  }
  static merge({ xref, dictArray, mergeSubDicts = false }) {
    const mergedDict = new _Dict(xref), properties = /* @__PURE__ */ new Map();
    for (const dict of dictArray) {
      if (!(dict instanceof _Dict)) {
        continue;
      }
      for (const [key, value] of dict.getRawEntries()) {
        const property = properties.getOrInsertComputed(key, makeArr);
        if (property.length && !(mergeSubDicts && value instanceof _Dict)) {
          continue;
        }
        property.push(value);
      }
    }
    for (const [name, values] of properties) {
      if (values.length === 1 || !(values[0] instanceof _Dict)) {
        mergedDict.set(name, values[0]);
        continue;
      }
      const subDict = new _Dict(xref);
      for (const dict of values) {
        for (const [key, value] of dict.getRawEntries()) {
          subDict.setIfNotExists(key, value);
        }
      }
      if (subDict.size > 0) {
        mergedDict.set(name, subDict);
      }
    }
    properties.clear();
    return mergedDict.size > 0 ? mergedDict : _Dict.empty;
  }
  clone() {
    const dict = new _Dict(this.xref);
    for (const [key, value] of this.#map) {
      dict.set(key, value);
    }
    return dict;
  }
  delete(key) {
    this.#map.delete(key);
  }
};
var Ref = class _Ref {
  #str;
  constructor(str, num, gen) {
    this.#str = str;
    this.num = num;
    this.gen = gen;
  }
  toString() {
    return this.#str;
  }
  static fromString(str) {
    let ref = RefCache.get(str);
    if (ref) {
      return ref;
    }
    const m = /^([1-9]\d*)R([1-9]\d*)?$/.exec(str);
    if (!m) {
      return null;
    }
    ref = new _Ref(
      str,
      /* num = */
      parseInt(m[1], 10),
      /* gen = */
      !m[2] ? 0 : parseInt(m[2], 10)
    );
    RefCache.set(str, ref);
    return ref;
  }
  /**
   * NOTE: This method is invoked a lot, hence `getOrInsertComputed` is
   *       purposely *not* used to avoid creating unneeded callback functions.
   */
  static get(num, gen) {
    const str = gen === 0 ? `${num}R` : `${num}R${gen}`;
    let ref = RefCache.get(str);
    if (!ref) {
      ref = new _Ref(str, num, gen);
      RefCache.set(str, ref);
    }
    return ref;
  }
};
function isName(v, name) {
  return v instanceof Name && (name === void 0 || v.name === name);
}
function isDict(v, type) {
  return v instanceof Dict && (type === void 0 || isName(v.get("Type"), type));
}

// src/core/base_stream.js
var BaseStream = class _BaseStream {
  constructor() {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _BaseStream) {
      unreachable("Cannot initialize BaseStream.");
    }
  }
  /**
   * @abstract
   * @returns {number}
   */
  get length() {
    unreachable("Abstract getter `length` accessed");
  }
  /**
   * @abstract
   * @returns {boolean}
   */
  get isEmpty() {
    unreachable("Abstract getter `isEmpty` accessed");
  }
  get isDataLoaded() {
    return shadow(this, "isDataLoaded", true);
  }
  getByte() {
    unreachable("Abstract method `getByte` called");
  }
  /**
   * @abstract
   * @param {number | undefined} [length]
   * @returns {Uint8Array}
   */
  getBytes(length) {
    unreachable("Abstract method `getBytes` called");
  }
  /**
   * NOTE: This method can only be used to get image-data that is guaranteed
   *       to be fully loaded, since otherwise intermittent errors may occur;
   *       note the `ObjectLoader` class.
   */
  async getImageData(length, decoderOptions) {
    return this.getBytes(length, decoderOptions);
  }
  async asyncGetBytes() {
    unreachable("Abstract method `asyncGetBytes` called");
  }
  get isAsync() {
    return false;
  }
  get isAsyncDecoder() {
    return false;
  }
  get isImageStream() {
    return false;
  }
  get canAsyncDecodeImageFromBuffer() {
    return false;
  }
  /**
   * @param {number} width - The width from the image dictionary.
   * @param {number} height - The height from the image dictionary.
   */
  async getTransferableImage(width, height) {
    return null;
  }
  peekByte() {
    const peekedByte = this.getByte();
    if (peekedByte !== -1) {
      this.pos--;
    }
    return peekedByte;
  }
  peekBytes(length) {
    const bytes = this.getBytes(length);
    this.pos -= bytes.length;
    return bytes;
  }
  getUint16() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    return b0 === -1 || b1 === -1 ? -1 : (b0 << 8) + b1;
  }
  getInt32() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    const b2 = this.getByte();
    const b3 = this.getByte();
    return (b0 << 24) + (b1 << 16) + (b2 << 8) + b3;
  }
  getByteRange(begin, end) {
    unreachable("Abstract method `getByteRange` called");
  }
  getString(length) {
    return bytesToString(this.getBytes(length));
  }
  skip(n) {
    this.pos += n || 1;
  }
  reset() {
    unreachable("Abstract method `reset` called");
  }
  moveStart() {
    unreachable("Abstract method `moveStart` called");
  }
  makeSubStream(start, length, dict = null) {
    unreachable("Abstract method `makeSubStream` called");
  }
  clone() {
    unreachable("Abstract method `clone` called");
  }
  /**
   * @returns {Array | null}
   */
  getBaseStreams() {
    return null;
  }
  getOriginalStream() {
    return this.stream?.getOriginalStream() || this;
  }
};

// src/core/core_utils.js
var MAX_INT_32 = 2 ** 31 - 1;
function getLookupTableFactory(initializer, useArray = false) {
  let lookup;
  return function() {
    if (initializer) {
      lookup = useArray ? [] : /* @__PURE__ */ Object.create(null);
      initializer(lookup);
      initializer = null;
    }
    return lookup;
  };
}
function isWhiteSpace(ch3) {
  return ch3 === 32 || ch3 === 9 || ch3 === 13 || ch3 === 10;
}
function isNumberArray(arr, len) {
  if (Array.isArray(arr)) {
    return (len === null || arr.length === len) && arr.every((x) => typeof x === "number");
  }
  return ArrayBuffer.isView(arr) && !(arr instanceof BigInt64Array || arr instanceof BigUint64Array) && (len === null || arr.length === len);
}
var XMLEntities = {
  /* < */
  60: "&lt;",
  /* > */
  62: "&gt;",
  /* & */
  38: "&amp;",
  /* " */
  34: "&quot;",
  /* ' */
  39: "&apos;"
};
function encodeToXmlString(str) {
  const buffer = [];
  let start = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.codePointAt(i);
    if (32 <= char && char <= 126) {
      const entity = XMLEntities[char];
      if (entity) {
        if (start < i) {
          buffer.push(str.substring(start, i));
        }
        buffer.push(entity);
        start = i + 1;
      }
    } else {
      if (start < i) {
        buffer.push(str.substring(start, i));
      }
      buffer.push(`&#x${char.toString(16).toUpperCase()};`);
      if (char > 65535) {
        i++;
      }
      start = i + 1;
    }
  }
  if (buffer.length === 0) {
    return str;
  }
  if (start < str.length) {
    buffer.push(str.substring(start));
  }
  return buffer.join("");
}

// src/core/glyphlist.js
var getGlyphsUnicode = getLookupTableFactory(function(t) {
  t.A = 65;
  t.AE = 198;
  t.AEacute = 508;
  t.AEmacron = 482;
  t.AEsmall = 63462;
  t.Aacute = 193;
  t.Aacutesmall = 63457;
  t.Abreve = 258;
  t.Abreveacute = 7854;
  t.Abrevecyrillic = 1232;
  t.Abrevedotbelow = 7862;
  t.Abrevegrave = 7856;
  t.Abrevehookabove = 7858;
  t.Abrevetilde = 7860;
  t.Acaron = 461;
  t.Acircle = 9398;
  t.Acircumflex = 194;
  t.Acircumflexacute = 7844;
  t.Acircumflexdotbelow = 7852;
  t.Acircumflexgrave = 7846;
  t.Acircumflexhookabove = 7848;
  t.Acircumflexsmall = 63458;
  t.Acircumflextilde = 7850;
  t.Acute = 63177;
  t.Acutesmall = 63412;
  t.Acyrillic = 1040;
  t.Adblgrave = 512;
  t.Adieresis = 196;
  t.Adieresiscyrillic = 1234;
  t.Adieresismacron = 478;
  t.Adieresissmall = 63460;
  t.Adotbelow = 7840;
  t.Adotmacron = 480;
  t.Agrave = 192;
  t.Agravesmall = 63456;
  t.Ahookabove = 7842;
  t.Aiecyrillic = 1236;
  t.Ainvertedbreve = 514;
  t.Alpha = 913;
  t.Alphatonos = 902;
  t.Amacron = 256;
  t.Amonospace = 65313;
  t.Aogonek = 260;
  t.Aring = 197;
  t.Aringacute = 506;
  t.Aringbelow = 7680;
  t.Aringsmall = 63461;
  t.Asmall = 63329;
  t.Atilde = 195;
  t.Atildesmall = 63459;
  t.Aybarmenian = 1329;
  t.B = 66;
  t.Bcircle = 9399;
  t.Bdotaccent = 7682;
  t.Bdotbelow = 7684;
  t.Becyrillic = 1041;
  t.Benarmenian = 1330;
  t.Beta = 914;
  t.Bhook = 385;
  t.Blinebelow = 7686;
  t.Bmonospace = 65314;
  t.Brevesmall = 63220;
  t.Bsmall = 63330;
  t.Btopbar = 386;
  t.C = 67;
  t.Caarmenian = 1342;
  t.Cacute = 262;
  t.Caron = 63178;
  t.Caronsmall = 63221;
  t.Ccaron = 268;
  t.Ccedilla = 199;
  t.Ccedillaacute = 7688;
  t.Ccedillasmall = 63463;
  t.Ccircle = 9400;
  t.Ccircumflex = 264;
  t.Cdot = 266;
  t.Cdotaccent = 266;
  t.Cedillasmall = 63416;
  t.Chaarmenian = 1353;
  t.Cheabkhasiancyrillic = 1212;
  t.Checyrillic = 1063;
  t.Chedescenderabkhasiancyrillic = 1214;
  t.Chedescendercyrillic = 1206;
  t.Chedieresiscyrillic = 1268;
  t.Cheharmenian = 1347;
  t.Chekhakassiancyrillic = 1227;
  t.Cheverticalstrokecyrillic = 1208;
  t.Chi = 935;
  t.Chook = 391;
  t.Circumflexsmall = 63222;
  t.Cmonospace = 65315;
  t.Coarmenian = 1361;
  t.Csmall = 63331;
  t.D = 68;
  t.DZ = 497;
  t.DZcaron = 452;
  t.Daarmenian = 1332;
  t.Dafrican = 393;
  t.Dcaron = 270;
  t.Dcedilla = 7696;
  t.Dcircle = 9401;
  t.Dcircumflexbelow = 7698;
  t.Dcroat = 272;
  t.Ddotaccent = 7690;
  t.Ddotbelow = 7692;
  t.Decyrillic = 1044;
  t.Deicoptic = 1006;
  t.Delta = 8710;
  t.Deltagreek = 916;
  t.Dhook = 394;
  t.Dieresis = 63179;
  t.DieresisAcute = 63180;
  t.DieresisGrave = 63181;
  t.Dieresissmall = 63400;
  t.Digammagreek = 988;
  t.Djecyrillic = 1026;
  t.Dlinebelow = 7694;
  t.Dmonospace = 65316;
  t.Dotaccentsmall = 63223;
  t.Dslash = 272;
  t.Dsmall = 63332;
  t.Dtopbar = 395;
  t.Dz = 498;
  t.Dzcaron = 453;
  t.Dzeabkhasiancyrillic = 1248;
  t.Dzecyrillic = 1029;
  t.Dzhecyrillic = 1039;
  t.E = 69;
  t.Eacute = 201;
  t.Eacutesmall = 63465;
  t.Ebreve = 276;
  t.Ecaron = 282;
  t.Ecedillabreve = 7708;
  t.Echarmenian = 1333;
  t.Ecircle = 9402;
  t.Ecircumflex = 202;
  t.Ecircumflexacute = 7870;
  t.Ecircumflexbelow = 7704;
  t.Ecircumflexdotbelow = 7878;
  t.Ecircumflexgrave = 7872;
  t.Ecircumflexhookabove = 7874;
  t.Ecircumflexsmall = 63466;
  t.Ecircumflextilde = 7876;
  t.Ecyrillic = 1028;
  t.Edblgrave = 516;
  t.Edieresis = 203;
  t.Edieresissmall = 63467;
  t.Edot = 278;
  t.Edotaccent = 278;
  t.Edotbelow = 7864;
  t.Efcyrillic = 1060;
  t.Egrave = 200;
  t.Egravesmall = 63464;
  t.Eharmenian = 1335;
  t.Ehookabove = 7866;
  t.Eightroman = 8551;
  t.Einvertedbreve = 518;
  t.Eiotifiedcyrillic = 1124;
  t.Elcyrillic = 1051;
  t.Elevenroman = 8554;
  t.Emacron = 274;
  t.Emacronacute = 7702;
  t.Emacrongrave = 7700;
  t.Emcyrillic = 1052;
  t.Emonospace = 65317;
  t.Encyrillic = 1053;
  t.Endescendercyrillic = 1186;
  t.Eng = 330;
  t.Enghecyrillic = 1188;
  t.Enhookcyrillic = 1223;
  t.Eogonek = 280;
  t.Eopen = 400;
  t.Epsilon = 917;
  t.Epsilontonos = 904;
  t.Ercyrillic = 1056;
  t.Ereversed = 398;
  t.Ereversedcyrillic = 1069;
  t.Escyrillic = 1057;
  t.Esdescendercyrillic = 1194;
  t.Esh = 425;
  t.Esmall = 63333;
  t.Eta = 919;
  t.Etarmenian = 1336;
  t.Etatonos = 905;
  t.Eth = 208;
  t.Ethsmall = 63472;
  t.Etilde = 7868;
  t.Etildebelow = 7706;
  t.Euro = 8364;
  t.Ezh = 439;
  t.Ezhcaron = 494;
  t.Ezhreversed = 440;
  t.F = 70;
  t.Fcircle = 9403;
  t.Fdotaccent = 7710;
  t.Feharmenian = 1366;
  t.Feicoptic = 996;
  t.Fhook = 401;
  t.Fitacyrillic = 1138;
  t.Fiveroman = 8548;
  t.Fmonospace = 65318;
  t.Fourroman = 8547;
  t.Fsmall = 63334;
  t.G = 71;
  t.GBsquare = 13191;
  t.Gacute = 500;
  t.Gamma = 915;
  t.Gammaafrican = 404;
  t.Gangiacoptic = 1002;
  t.Gbreve = 286;
  t.Gcaron = 486;
  t.Gcedilla = 290;
  t.Gcircle = 9404;
  t.Gcircumflex = 284;
  t.Gcommaaccent = 290;
  t.Gdot = 288;
  t.Gdotaccent = 288;
  t.Gecyrillic = 1043;
  t.Ghadarmenian = 1346;
  t.Ghemiddlehookcyrillic = 1172;
  t.Ghestrokecyrillic = 1170;
  t.Gheupturncyrillic = 1168;
  t.Ghook = 403;
  t.Gimarmenian = 1331;
  t.Gjecyrillic = 1027;
  t.Gmacron = 7712;
  t.Gmonospace = 65319;
  t.Grave = 63182;
  t.Gravesmall = 63328;
  t.Gsmall = 63335;
  t.Gsmallhook = 667;
  t.Gstroke = 484;
  t.H = 72;
  t.H18533 = 9679;
  t.H18543 = 9642;
  t.H18551 = 9643;
  t.H22073 = 9633;
  t.HPsquare = 13259;
  t.Haabkhasiancyrillic = 1192;
  t.Hadescendercyrillic = 1202;
  t.Hardsigncyrillic = 1066;
  t.Hbar = 294;
  t.Hbrevebelow = 7722;
  t.Hcedilla = 7720;
  t.Hcircle = 9405;
  t.Hcircumflex = 292;
  t.Hdieresis = 7718;
  t.Hdotaccent = 7714;
  t.Hdotbelow = 7716;
  t.Hmonospace = 65320;
  t.Hoarmenian = 1344;
  t.Horicoptic = 1e3;
  t.Hsmall = 63336;
  t.Hungarumlaut = 63183;
  t.Hungarumlautsmall = 63224;
  t.Hzsquare = 13200;
  t.I = 73;
  t.IAcyrillic = 1071;
  t.IJ = 306;
  t.IUcyrillic = 1070;
  t.Iacute = 205;
  t.Iacutesmall = 63469;
  t.Ibreve = 300;
  t.Icaron = 463;
  t.Icircle = 9406;
  t.Icircumflex = 206;
  t.Icircumflexsmall = 63470;
  t.Icyrillic = 1030;
  t.Idblgrave = 520;
  t.Idieresis = 207;
  t.Idieresisacute = 7726;
  t.Idieresiscyrillic = 1252;
  t.Idieresissmall = 63471;
  t.Idot = 304;
  t.Idotaccent = 304;
  t.Idotbelow = 7882;
  t.Iebrevecyrillic = 1238;
  t.Iecyrillic = 1045;
  t.Ifraktur = 8465;
  t.Igrave = 204;
  t.Igravesmall = 63468;
  t.Ihookabove = 7880;
  t.Iicyrillic = 1048;
  t.Iinvertedbreve = 522;
  t.Iishortcyrillic = 1049;
  t.Imacron = 298;
  t.Imacroncyrillic = 1250;
  t.Imonospace = 65321;
  t.Iniarmenian = 1339;
  t.Iocyrillic = 1025;
  t.Iogonek = 302;
  t.Iota = 921;
  t.Iotaafrican = 406;
  t.Iotadieresis = 938;
  t.Iotatonos = 906;
  t.Ismall = 63337;
  t.Istroke = 407;
  t.Itilde = 296;
  t.Itildebelow = 7724;
  t.Izhitsacyrillic = 1140;
  t.Izhitsadblgravecyrillic = 1142;
  t.J = 74;
  t.Jaarmenian = 1345;
  t.Jcircle = 9407;
  t.Jcircumflex = 308;
  t.Jecyrillic = 1032;
  t.Jheharmenian = 1355;
  t.Jmonospace = 65322;
  t.Jsmall = 63338;
  t.K = 75;
  t.KBsquare = 13189;
  t.KKsquare = 13261;
  t.Kabashkircyrillic = 1184;
  t.Kacute = 7728;
  t.Kacyrillic = 1050;
  t.Kadescendercyrillic = 1178;
  t.Kahookcyrillic = 1219;
  t.Kappa = 922;
  t.Kastrokecyrillic = 1182;
  t.Kaverticalstrokecyrillic = 1180;
  t.Kcaron = 488;
  t.Kcedilla = 310;
  t.Kcircle = 9408;
  t.Kcommaaccent = 310;
  t.Kdotbelow = 7730;
  t.Keharmenian = 1364;
  t.Kenarmenian = 1343;
  t.Khacyrillic = 1061;
  t.Kheicoptic = 998;
  t.Khook = 408;
  t.Kjecyrillic = 1036;
  t.Klinebelow = 7732;
  t.Kmonospace = 65323;
  t.Koppacyrillic = 1152;
  t.Koppagreek = 990;
  t.Ksicyrillic = 1134;
  t.Ksmall = 63339;
  t.L = 76;
  t.LJ = 455;
  t.LL = 63167;
  t.Lacute = 313;
  t.Lambda = 923;
  t.Lcaron = 317;
  t.Lcedilla = 315;
  t.Lcircle = 9409;
  t.Lcircumflexbelow = 7740;
  t.Lcommaaccent = 315;
  t.Ldot = 319;
  t.Ldotaccent = 319;
  t.Ldotbelow = 7734;
  t.Ldotbelowmacron = 7736;
  t.Liwnarmenian = 1340;
  t.Lj = 456;
  t.Ljecyrillic = 1033;
  t.Llinebelow = 7738;
  t.Lmonospace = 65324;
  t.Lslash = 321;
  t.Lslashsmall = 63225;
  t.Lsmall = 63340;
  t.M = 77;
  t.MBsquare = 13190;
  t.Macron = 63184;
  t.Macronsmall = 63407;
  t.Macute = 7742;
  t.Mcircle = 9410;
  t.Mdotaccent = 7744;
  t.Mdotbelow = 7746;
  t.Menarmenian = 1348;
  t.Mmonospace = 65325;
  t.Msmall = 63341;
  t.Mturned = 412;
  t.Mu = 924;
  t.N = 78;
  t.NJ = 458;
  t.Nacute = 323;
  t.Ncaron = 327;
  t.Ncedilla = 325;
  t.Ncircle = 9411;
  t.Ncircumflexbelow = 7754;
  t.Ncommaaccent = 325;
  t.Ndotaccent = 7748;
  t.Ndotbelow = 7750;
  t.Nhookleft = 413;
  t.Nineroman = 8552;
  t.Nj = 459;
  t.Njecyrillic = 1034;
  t.Nlinebelow = 7752;
  t.Nmonospace = 65326;
  t.Nowarmenian = 1350;
  t.Nsmall = 63342;
  t.Ntilde = 209;
  t.Ntildesmall = 63473;
  t.Nu = 925;
  t.O = 79;
  t.OE = 338;
  t.OEsmall = 63226;
  t.Oacute = 211;
  t.Oacutesmall = 63475;
  t.Obarredcyrillic = 1256;
  t.Obarreddieresiscyrillic = 1258;
  t.Obreve = 334;
  t.Ocaron = 465;
  t.Ocenteredtilde = 415;
  t.Ocircle = 9412;
  t.Ocircumflex = 212;
  t.Ocircumflexacute = 7888;
  t.Ocircumflexdotbelow = 7896;
  t.Ocircumflexgrave = 7890;
  t.Ocircumflexhookabove = 7892;
  t.Ocircumflexsmall = 63476;
  t.Ocircumflextilde = 7894;
  t.Ocyrillic = 1054;
  t.Odblacute = 336;
  t.Odblgrave = 524;
  t.Odieresis = 214;
  t.Odieresiscyrillic = 1254;
  t.Odieresissmall = 63478;
  t.Odotbelow = 7884;
  t.Ogoneksmall = 63227;
  t.Ograve = 210;
  t.Ogravesmall = 63474;
  t.Oharmenian = 1365;
  t.Ohm = 8486;
  t.Ohookabove = 7886;
  t.Ohorn = 416;
  t.Ohornacute = 7898;
  t.Ohorndotbelow = 7906;
  t.Ohorngrave = 7900;
  t.Ohornhookabove = 7902;
  t.Ohorntilde = 7904;
  t.Ohungarumlaut = 336;
  t.Oi = 418;
  t.Oinvertedbreve = 526;
  t.Omacron = 332;
  t.Omacronacute = 7762;
  t.Omacrongrave = 7760;
  t.Omega = 8486;
  t.Omegacyrillic = 1120;
  t.Omegagreek = 937;
  t.Omegaroundcyrillic = 1146;
  t.Omegatitlocyrillic = 1148;
  t.Omegatonos = 911;
  t.Omicron = 927;
  t.Omicrontonos = 908;
  t.Omonospace = 65327;
  t.Oneroman = 8544;
  t.Oogonek = 490;
  t.Oogonekmacron = 492;
  t.Oopen = 390;
  t.Oslash = 216;
  t.Oslashacute = 510;
  t.Oslashsmall = 63480;
  t.Osmall = 63343;
  t.Ostrokeacute = 510;
  t.Otcyrillic = 1150;
  t.Otilde = 213;
  t.Otildeacute = 7756;
  t.Otildedieresis = 7758;
  t.Otildesmall = 63477;
  t.P = 80;
  t.Pacute = 7764;
  t.Pcircle = 9413;
  t.Pdotaccent = 7766;
  t.Pecyrillic = 1055;
  t.Peharmenian = 1354;
  t.Pemiddlehookcyrillic = 1190;
  t.Phi = 934;
  t.Phook = 420;
  t.Pi = 928;
  t.Piwrarmenian = 1363;
  t.Pmonospace = 65328;
  t.Psi = 936;
  t.Psicyrillic = 1136;
  t.Psmall = 63344;
  t.Q = 81;
  t.Qcircle = 9414;
  t.Qmonospace = 65329;
  t.Qsmall = 63345;
  t.R = 82;
  t.Raarmenian = 1356;
  t.Racute = 340;
  t.Rcaron = 344;
  t.Rcedilla = 342;
  t.Rcircle = 9415;
  t.Rcommaaccent = 342;
  t.Rdblgrave = 528;
  t.Rdotaccent = 7768;
  t.Rdotbelow = 7770;
  t.Rdotbelowmacron = 7772;
  t.Reharmenian = 1360;
  t.Rfraktur = 8476;
  t.Rho = 929;
  t.Ringsmall = 63228;
  t.Rinvertedbreve = 530;
  t.Rlinebelow = 7774;
  t.Rmonospace = 65330;
  t.Rsmall = 63346;
  t.Rsmallinverted = 641;
  t.Rsmallinvertedsuperior = 694;
  t.S = 83;
  t.SF010000 = 9484;
  t.SF020000 = 9492;
  t.SF030000 = 9488;
  t.SF040000 = 9496;
  t.SF050000 = 9532;
  t.SF060000 = 9516;
  t.SF070000 = 9524;
  t.SF080000 = 9500;
  t.SF090000 = 9508;
  t.SF100000 = 9472;
  t.SF110000 = 9474;
  t.SF190000 = 9569;
  t.SF200000 = 9570;
  t.SF210000 = 9558;
  t.SF220000 = 9557;
  t.SF230000 = 9571;
  t.SF240000 = 9553;
  t.SF250000 = 9559;
  t.SF260000 = 9565;
  t.SF270000 = 9564;
  t.SF280000 = 9563;
  t.SF360000 = 9566;
  t.SF370000 = 9567;
  t.SF380000 = 9562;
  t.SF390000 = 9556;
  t.SF400000 = 9577;
  t.SF410000 = 9574;
  t.SF420000 = 9568;
  t.SF430000 = 9552;
  t.SF440000 = 9580;
  t.SF450000 = 9575;
  t.SF460000 = 9576;
  t.SF470000 = 9572;
  t.SF480000 = 9573;
  t.SF490000 = 9561;
  t.SF500000 = 9560;
  t.SF510000 = 9554;
  t.SF520000 = 9555;
  t.SF530000 = 9579;
  t.SF540000 = 9578;
  t.Sacute = 346;
  t.Sacutedotaccent = 7780;
  t.Sampigreek = 992;
  t.Scaron = 352;
  t.Scarondotaccent = 7782;
  t.Scaronsmall = 63229;
  t.Scedilla = 350;
  t.Schwa = 399;
  t.Schwacyrillic = 1240;
  t.Schwadieresiscyrillic = 1242;
  t.Scircle = 9416;
  t.Scircumflex = 348;
  t.Scommaaccent = 536;
  t.Sdotaccent = 7776;
  t.Sdotbelow = 7778;
  t.Sdotbelowdotaccent = 7784;
  t.Seharmenian = 1357;
  t.Sevenroman = 8550;
  t.Shaarmenian = 1351;
  t.Shacyrillic = 1064;
  t.Shchacyrillic = 1065;
  t.Sheicoptic = 994;
  t.Shhacyrillic = 1210;
  t.Shimacoptic = 1004;
  t.Sigma = 931;
  t.Sixroman = 8549;
  t.Smonospace = 65331;
  t.Softsigncyrillic = 1068;
  t.Ssmall = 63347;
  t.Stigmagreek = 986;
  t.T = 84;
  t.Tau = 932;
  t.Tbar = 358;
  t.Tcaron = 356;
  t.Tcedilla = 354;
  t.Tcircle = 9417;
  t.Tcircumflexbelow = 7792;
  t.Tcommaaccent = 354;
  t.Tdotaccent = 7786;
  t.Tdotbelow = 7788;
  t.Tecyrillic = 1058;
  t.Tedescendercyrillic = 1196;
  t.Tenroman = 8553;
  t.Tetsecyrillic = 1204;
  t.Theta = 920;
  t.Thook = 428;
  t.Thorn = 222;
  t.Thornsmall = 63486;
  t.Threeroman = 8546;
  t.Tildesmall = 63230;
  t.Tiwnarmenian = 1359;
  t.Tlinebelow = 7790;
  t.Tmonospace = 65332;
  t.Toarmenian = 1337;
  t.Tonefive = 444;
  t.Tonesix = 388;
  t.Tonetwo = 423;
  t.Tretroflexhook = 430;
  t.Tsecyrillic = 1062;
  t.Tshecyrillic = 1035;
  t.Tsmall = 63348;
  t.Twelveroman = 8555;
  t.Tworoman = 8545;
  t.U = 85;
  t.Uacute = 218;
  t.Uacutesmall = 63482;
  t.Ubreve = 364;
  t.Ucaron = 467;
  t.Ucircle = 9418;
  t.Ucircumflex = 219;
  t.Ucircumflexbelow = 7798;
  t.Ucircumflexsmall = 63483;
  t.Ucyrillic = 1059;
  t.Udblacute = 368;
  t.Udblgrave = 532;
  t.Udieresis = 220;
  t.Udieresisacute = 471;
  t.Udieresisbelow = 7794;
  t.Udieresiscaron = 473;
  t.Udieresiscyrillic = 1264;
  t.Udieresisgrave = 475;
  t.Udieresismacron = 469;
  t.Udieresissmall = 63484;
  t.Udotbelow = 7908;
  t.Ugrave = 217;
  t.Ugravesmall = 63481;
  t.Uhookabove = 7910;
  t.Uhorn = 431;
  t.Uhornacute = 7912;
  t.Uhorndotbelow = 7920;
  t.Uhorngrave = 7914;
  t.Uhornhookabove = 7916;
  t.Uhorntilde = 7918;
  t.Uhungarumlaut = 368;
  t.Uhungarumlautcyrillic = 1266;
  t.Uinvertedbreve = 534;
  t.Ukcyrillic = 1144;
  t.Umacron = 362;
  t.Umacroncyrillic = 1262;
  t.Umacrondieresis = 7802;
  t.Umonospace = 65333;
  t.Uogonek = 370;
  t.Upsilon = 933;
  t.Upsilon1 = 978;
  t.Upsilonacutehooksymbolgreek = 979;
  t.Upsilonafrican = 433;
  t.Upsilondieresis = 939;
  t.Upsilondieresishooksymbolgreek = 980;
  t.Upsilonhooksymbol = 978;
  t.Upsilontonos = 910;
  t.Uring = 366;
  t.Ushortcyrillic = 1038;
  t.Usmall = 63349;
  t.Ustraightcyrillic = 1198;
  t.Ustraightstrokecyrillic = 1200;
  t.Utilde = 360;
  t.Utildeacute = 7800;
  t.Utildebelow = 7796;
  t.V = 86;
  t.Vcircle = 9419;
  t.Vdotbelow = 7806;
  t.Vecyrillic = 1042;
  t.Vewarmenian = 1358;
  t.Vhook = 434;
  t.Vmonospace = 65334;
  t.Voarmenian = 1352;
  t.Vsmall = 63350;
  t.Vtilde = 7804;
  t.W = 87;
  t.Wacute = 7810;
  t.Wcircle = 9420;
  t.Wcircumflex = 372;
  t.Wdieresis = 7812;
  t.Wdotaccent = 7814;
  t.Wdotbelow = 7816;
  t.Wgrave = 7808;
  t.Wmonospace = 65335;
  t.Wsmall = 63351;
  t.X = 88;
  t.Xcircle = 9421;
  t.Xdieresis = 7820;
  t.Xdotaccent = 7818;
  t.Xeharmenian = 1341;
  t.Xi = 926;
  t.Xmonospace = 65336;
  t.Xsmall = 63352;
  t.Y = 89;
  t.Yacute = 221;
  t.Yacutesmall = 63485;
  t.Yatcyrillic = 1122;
  t.Ycircle = 9422;
  t.Ycircumflex = 374;
  t.Ydieresis = 376;
  t.Ydieresissmall = 63487;
  t.Ydotaccent = 7822;
  t.Ydotbelow = 7924;
  t.Yericyrillic = 1067;
  t.Yerudieresiscyrillic = 1272;
  t.Ygrave = 7922;
  t.Yhook = 435;
  t.Yhookabove = 7926;
  t.Yiarmenian = 1349;
  t.Yicyrillic = 1031;
  t.Yiwnarmenian = 1362;
  t.Ymonospace = 65337;
  t.Ysmall = 63353;
  t.Ytilde = 7928;
  t.Yusbigcyrillic = 1130;
  t.Yusbigiotifiedcyrillic = 1132;
  t.Yuslittlecyrillic = 1126;
  t.Yuslittleiotifiedcyrillic = 1128;
  t.Z = 90;
  t.Zaarmenian = 1334;
  t.Zacute = 377;
  t.Zcaron = 381;
  t.Zcaronsmall = 63231;
  t.Zcircle = 9423;
  t.Zcircumflex = 7824;
  t.Zdot = 379;
  t.Zdotaccent = 379;
  t.Zdotbelow = 7826;
  t.Zecyrillic = 1047;
  t.Zedescendercyrillic = 1176;
  t.Zedieresiscyrillic = 1246;
  t.Zeta = 918;
  t.Zhearmenian = 1338;
  t.Zhebrevecyrillic = 1217;
  t.Zhecyrillic = 1046;
  t.Zhedescendercyrillic = 1174;
  t.Zhedieresiscyrillic = 1244;
  t.Zlinebelow = 7828;
  t.Zmonospace = 65338;
  t.Zsmall = 63354;
  t.Zstroke = 437;
  t.a = 97;
  t.aabengali = 2438;
  t.aacute = 225;
  t.aadeva = 2310;
  t.aagujarati = 2694;
  t.aagurmukhi = 2566;
  t.aamatragurmukhi = 2622;
  t.aarusquare = 13059;
  t.aavowelsignbengali = 2494;
  t.aavowelsigndeva = 2366;
  t.aavowelsigngujarati = 2750;
  t.abbreviationmarkarmenian = 1375;
  t.abbreviationsigndeva = 2416;
  t.abengali = 2437;
  t.abopomofo = 12570;
  t.abreve = 259;
  t.abreveacute = 7855;
  t.abrevecyrillic = 1233;
  t.abrevedotbelow = 7863;
  t.abrevegrave = 7857;
  t.abrevehookabove = 7859;
  t.abrevetilde = 7861;
  t.acaron = 462;
  t.acircle = 9424;
  t.acircumflex = 226;
  t.acircumflexacute = 7845;
  t.acircumflexdotbelow = 7853;
  t.acircumflexgrave = 7847;
  t.acircumflexhookabove = 7849;
  t.acircumflextilde = 7851;
  t.acute = 180;
  t.acutebelowcmb = 791;
  t.acutecmb = 769;
  t.acutecomb = 769;
  t.acutedeva = 2388;
  t.acutelowmod = 719;
  t.acutetonecmb = 833;
  t.acyrillic = 1072;
  t.adblgrave = 513;
  t.addakgurmukhi = 2673;
  t.adeva = 2309;
  t.adieresis = 228;
  t.adieresiscyrillic = 1235;
  t.adieresismacron = 479;
  t.adotbelow = 7841;
  t.adotmacron = 481;
  t.ae = 230;
  t.aeacute = 509;
  t.aekorean = 12624;
  t.aemacron = 483;
  t.afii00208 = 8213;
  t.afii08941 = 8356;
  t.afii10017 = 1040;
  t.afii10018 = 1041;
  t.afii10019 = 1042;
  t.afii10020 = 1043;
  t.afii10021 = 1044;
  t.afii10022 = 1045;
  t.afii10023 = 1025;
  t.afii10024 = 1046;
  t.afii10025 = 1047;
  t.afii10026 = 1048;
  t.afii10027 = 1049;
  t.afii10028 = 1050;
  t.afii10029 = 1051;
  t.afii10030 = 1052;
  t.afii10031 = 1053;
  t.afii10032 = 1054;
  t.afii10033 = 1055;
  t.afii10034 = 1056;
  t.afii10035 = 1057;
  t.afii10036 = 1058;
  t.afii10037 = 1059;
  t.afii10038 = 1060;
  t.afii10039 = 1061;
  t.afii10040 = 1062;
  t.afii10041 = 1063;
  t.afii10042 = 1064;
  t.afii10043 = 1065;
  t.afii10044 = 1066;
  t.afii10045 = 1067;
  t.afii10046 = 1068;
  t.afii10047 = 1069;
  t.afii10048 = 1070;
  t.afii10049 = 1071;
  t.afii10050 = 1168;
  t.afii10051 = 1026;
  t.afii10052 = 1027;
  t.afii10053 = 1028;
  t.afii10054 = 1029;
  t.afii10055 = 1030;
  t.afii10056 = 1031;
  t.afii10057 = 1032;
  t.afii10058 = 1033;
  t.afii10059 = 1034;
  t.afii10060 = 1035;
  t.afii10061 = 1036;
  t.afii10062 = 1038;
  t.afii10063 = 63172;
  t.afii10064 = 63173;
  t.afii10065 = 1072;
  t.afii10066 = 1073;
  t.afii10067 = 1074;
  t.afii10068 = 1075;
  t.afii10069 = 1076;
  t.afii10070 = 1077;
  t.afii10071 = 1105;
  t.afii10072 = 1078;
  t.afii10073 = 1079;
  t.afii10074 = 1080;
  t.afii10075 = 1081;
  t.afii10076 = 1082;
  t.afii10077 = 1083;
  t.afii10078 = 1084;
  t.afii10079 = 1085;
  t.afii10080 = 1086;
  t.afii10081 = 1087;
  t.afii10082 = 1088;
  t.afii10083 = 1089;
  t.afii10084 = 1090;
  t.afii10085 = 1091;
  t.afii10086 = 1092;
  t.afii10087 = 1093;
  t.afii10088 = 1094;
  t.afii10089 = 1095;
  t.afii10090 = 1096;
  t.afii10091 = 1097;
  t.afii10092 = 1098;
  t.afii10093 = 1099;
  t.afii10094 = 1100;
  t.afii10095 = 1101;
  t.afii10096 = 1102;
  t.afii10097 = 1103;
  t.afii10098 = 1169;
  t.afii10099 = 1106;
  t.afii10100 = 1107;
  t.afii10101 = 1108;
  t.afii10102 = 1109;
  t.afii10103 = 1110;
  t.afii10104 = 1111;
  t.afii10105 = 1112;
  t.afii10106 = 1113;
  t.afii10107 = 1114;
  t.afii10108 = 1115;
  t.afii10109 = 1116;
  t.afii10110 = 1118;
  t.afii10145 = 1039;
  t.afii10146 = 1122;
  t.afii10147 = 1138;
  t.afii10148 = 1140;
  t.afii10192 = 63174;
  t.afii10193 = 1119;
  t.afii10194 = 1123;
  t.afii10195 = 1139;
  t.afii10196 = 1141;
  t.afii10831 = 63175;
  t.afii10832 = 63176;
  t.afii10846 = 1241;
  t.afii299 = 8206;
  t.afii300 = 8207;
  t.afii301 = 8205;
  t.afii57381 = 1642;
  t.afii57388 = 1548;
  t.afii57392 = 1632;
  t.afii57393 = 1633;
  t.afii57394 = 1634;
  t.afii57395 = 1635;
  t.afii57396 = 1636;
  t.afii57397 = 1637;
  t.afii57398 = 1638;
  t.afii57399 = 1639;
  t.afii57400 = 1640;
  t.afii57401 = 1641;
  t.afii57403 = 1563;
  t.afii57407 = 1567;
  t.afii57409 = 1569;
  t.afii57410 = 1570;
  t.afii57411 = 1571;
  t.afii57412 = 1572;
  t.afii57413 = 1573;
  t.afii57414 = 1574;
  t.afii57415 = 1575;
  t.afii57416 = 1576;
  t.afii57417 = 1577;
  t.afii57418 = 1578;
  t.afii57419 = 1579;
  t.afii57420 = 1580;
  t.afii57421 = 1581;
  t.afii57422 = 1582;
  t.afii57423 = 1583;
  t.afii57424 = 1584;
  t.afii57425 = 1585;
  t.afii57426 = 1586;
  t.afii57427 = 1587;
  t.afii57428 = 1588;
  t.afii57429 = 1589;
  t.afii57430 = 1590;
  t.afii57431 = 1591;
  t.afii57432 = 1592;
  t.afii57433 = 1593;
  t.afii57434 = 1594;
  t.afii57440 = 1600;
  t.afii57441 = 1601;
  t.afii57442 = 1602;
  t.afii57443 = 1603;
  t.afii57444 = 1604;
  t.afii57445 = 1605;
  t.afii57446 = 1606;
  t.afii57448 = 1608;
  t.afii57449 = 1609;
  t.afii57450 = 1610;
  t.afii57451 = 1611;
  t.afii57452 = 1612;
  t.afii57453 = 1613;
  t.afii57454 = 1614;
  t.afii57455 = 1615;
  t.afii57456 = 1616;
  t.afii57457 = 1617;
  t.afii57458 = 1618;
  t.afii57470 = 1607;
  t.afii57505 = 1700;
  t.afii57506 = 1662;
  t.afii57507 = 1670;
  t.afii57508 = 1688;
  t.afii57509 = 1711;
  t.afii57511 = 1657;
  t.afii57512 = 1672;
  t.afii57513 = 1681;
  t.afii57514 = 1722;
  t.afii57519 = 1746;
  t.afii57534 = 1749;
  t.afii57636 = 8362;
  t.afii57645 = 1470;
  t.afii57658 = 1475;
  t.afii57664 = 1488;
  t.afii57665 = 1489;
  t.afii57666 = 1490;
  t.afii57667 = 1491;
  t.afii57668 = 1492;
  t.afii57669 = 1493;
  t.afii57670 = 1494;
  t.afii57671 = 1495;
  t.afii57672 = 1496;
  t.afii57673 = 1497;
  t.afii57674 = 1498;
  t.afii57675 = 1499;
  t.afii57676 = 1500;
  t.afii57677 = 1501;
  t.afii57678 = 1502;
  t.afii57679 = 1503;
  t.afii57680 = 1504;
  t.afii57681 = 1505;
  t.afii57682 = 1506;
  t.afii57683 = 1507;
  t.afii57684 = 1508;
  t.afii57685 = 1509;
  t.afii57686 = 1510;
  t.afii57687 = 1511;
  t.afii57688 = 1512;
  t.afii57689 = 1513;
  t.afii57690 = 1514;
  t.afii57694 = 64298;
  t.afii57695 = 64299;
  t.afii57700 = 64331;
  t.afii57705 = 64287;
  t.afii57716 = 1520;
  t.afii57717 = 1521;
  t.afii57718 = 1522;
  t.afii57723 = 64309;
  t.afii57793 = 1460;
  t.afii57794 = 1461;
  t.afii57795 = 1462;
  t.afii57796 = 1467;
  t.afii57797 = 1464;
  t.afii57798 = 1463;
  t.afii57799 = 1456;
  t.afii57800 = 1458;
  t.afii57801 = 1457;
  t.afii57802 = 1459;
  t.afii57803 = 1474;
  t.afii57804 = 1473;
  t.afii57806 = 1465;
  t.afii57807 = 1468;
  t.afii57839 = 1469;
  t.afii57841 = 1471;
  t.afii57842 = 1472;
  t.afii57929 = 700;
  t.afii61248 = 8453;
  t.afii61289 = 8467;
  t.afii61352 = 8470;
  t.afii61573 = 8236;
  t.afii61574 = 8237;
  t.afii61575 = 8238;
  t.afii61664 = 8204;
  t.afii63167 = 1645;
  t.afii64937 = 701;
  t.agrave = 224;
  t.agujarati = 2693;
  t.agurmukhi = 2565;
  t.ahiragana = 12354;
  t.ahookabove = 7843;
  t.aibengali = 2448;
  t.aibopomofo = 12574;
  t.aideva = 2320;
  t.aiecyrillic = 1237;
  t.aigujarati = 2704;
  t.aigurmukhi = 2576;
  t.aimatragurmukhi = 2632;
  t.ainarabic = 1593;
  t.ainfinalarabic = 65226;
  t.aininitialarabic = 65227;
  t.ainmedialarabic = 65228;
  t.ainvertedbreve = 515;
  t.aivowelsignbengali = 2504;
  t.aivowelsigndeva = 2376;
  t.aivowelsigngujarati = 2760;
  t.akatakana = 12450;
  t.akatakanahalfwidth = 65393;
  t.akorean = 12623;
  t.alef = 1488;
  t.alefarabic = 1575;
  t.alefdageshhebrew = 64304;
  t.aleffinalarabic = 65166;
  t.alefhamzaabovearabic = 1571;
  t.alefhamzaabovefinalarabic = 65156;
  t.alefhamzabelowarabic = 1573;
  t.alefhamzabelowfinalarabic = 65160;
  t.alefhebrew = 1488;
  t.aleflamedhebrew = 64335;
  t.alefmaddaabovearabic = 1570;
  t.alefmaddaabovefinalarabic = 65154;
  t.alefmaksuraarabic = 1609;
  t.alefmaksurafinalarabic = 65264;
  t.alefmaksurainitialarabic = 65267;
  t.alefmaksuramedialarabic = 65268;
  t.alefpatahhebrew = 64302;
  t.alefqamatshebrew = 64303;
  t.aleph = 8501;
  t.allequal = 8780;
  t.alpha = 945;
  t.alphatonos = 940;
  t.amacron = 257;
  t.amonospace = 65345;
  t.ampersand = 38;
  t.ampersandmonospace = 65286;
  t.ampersandsmall = 63270;
  t.amsquare = 13250;
  t.anbopomofo = 12578;
  t.angbopomofo = 12580;
  t.angbracketleft = 12296;
  t.angbracketright = 12297;
  t.angkhankhuthai = 3674;
  t.angle = 8736;
  t.anglebracketleft = 12296;
  t.anglebracketleftvertical = 65087;
  t.anglebracketright = 12297;
  t.anglebracketrightvertical = 65088;
  t.angleleft = 9001;
  t.angleright = 9002;
  t.angstrom = 8491;
  t.anoteleia = 903;
  t.anudattadeva = 2386;
  t.anusvarabengali = 2434;
  t.anusvaradeva = 2306;
  t.anusvaragujarati = 2690;
  t.aogonek = 261;
  t.apaatosquare = 13056;
  t.aparen = 9372;
  t.apostrophearmenian = 1370;
  t.apostrophemod = 700;
  t.apple = 63743;
  t.approaches = 8784;
  t.approxequal = 8776;
  t.approxequalorimage = 8786;
  t.approximatelyequal = 8773;
  t.araeaekorean = 12686;
  t.araeakorean = 12685;
  t.arc = 8978;
  t.arighthalfring = 7834;
  t.aring = 229;
  t.aringacute = 507;
  t.aringbelow = 7681;
  t.arrowboth = 8596;
  t.arrowdashdown = 8675;
  t.arrowdashleft = 8672;
  t.arrowdashright = 8674;
  t.arrowdashup = 8673;
  t.arrowdblboth = 8660;
  t.arrowdbldown = 8659;
  t.arrowdblleft = 8656;
  t.arrowdblright = 8658;
  t.arrowdblup = 8657;
  t.arrowdown = 8595;
  t.arrowdownleft = 8601;
  t.arrowdownright = 8600;
  t.arrowdownwhite = 8681;
  t.arrowheaddownmod = 709;
  t.arrowheadleftmod = 706;
  t.arrowheadrightmod = 707;
  t.arrowheadupmod = 708;
  t.arrowhorizex = 63719;
  t.arrowleft = 8592;
  t.arrowleftdbl = 8656;
  t.arrowleftdblstroke = 8653;
  t.arrowleftoverright = 8646;
  t.arrowleftwhite = 8678;
  t.arrowright = 8594;
  t.arrowrightdblstroke = 8655;
  t.arrowrightheavy = 10142;
  t.arrowrightoverleft = 8644;
  t.arrowrightwhite = 8680;
  t.arrowtableft = 8676;
  t.arrowtabright = 8677;
  t.arrowup = 8593;
  t.arrowupdn = 8597;
  t.arrowupdnbse = 8616;
  t.arrowupdownbase = 8616;
  t.arrowupleft = 8598;
  t.arrowupleftofdown = 8645;
  t.arrowupright = 8599;
  t.arrowupwhite = 8679;
  t.arrowvertex = 63718;
  t.asciicircum = 94;
  t.asciicircummonospace = 65342;
  t.asciitilde = 126;
  t.asciitildemonospace = 65374;
  t.ascript = 593;
  t.ascriptturned = 594;
  t.asmallhiragana = 12353;
  t.asmallkatakana = 12449;
  t.asmallkatakanahalfwidth = 65383;
  t.asterisk = 42;
  t.asteriskaltonearabic = 1645;
  t.asteriskarabic = 1645;
  t.asteriskmath = 8727;
  t.asteriskmonospace = 65290;
  t.asterisksmall = 65121;
  t.asterism = 8258;
  t.asuperior = 63209;
  t.asymptoticallyequal = 8771;
  t.at = 64;
  t.atilde = 227;
  t.atmonospace = 65312;
  t.atsmall = 65131;
  t.aturned = 592;
  t.aubengali = 2452;
  t.aubopomofo = 12576;
  t.audeva = 2324;
  t.augujarati = 2708;
  t.augurmukhi = 2580;
  t.aulengthmarkbengali = 2519;
  t.aumatragurmukhi = 2636;
  t.auvowelsignbengali = 2508;
  t.auvowelsigndeva = 2380;
  t.auvowelsigngujarati = 2764;
  t.avagrahadeva = 2365;
  t.aybarmenian = 1377;
  t.ayin = 1506;
  t.ayinaltonehebrew = 64288;
  t.ayinhebrew = 1506;
  t.b = 98;
  t.babengali = 2476;
  t.backslash = 92;
  t.backslashmonospace = 65340;
  t.badeva = 2348;
  t.bagujarati = 2732;
  t.bagurmukhi = 2604;
  t.bahiragana = 12400;
  t.bahtthai = 3647;
  t.bakatakana = 12496;
  t.bar = 124;
  t.barmonospace = 65372;
  t.bbopomofo = 12549;
  t.bcircle = 9425;
  t.bdotaccent = 7683;
  t.bdotbelow = 7685;
  t.beamedsixteenthnotes = 9836;
  t.because = 8757;
  t.becyrillic = 1073;
  t.beharabic = 1576;
  t.behfinalarabic = 65168;
  t.behinitialarabic = 65169;
  t.behiragana = 12409;
  t.behmedialarabic = 65170;
  t.behmeeminitialarabic = 64671;
  t.behmeemisolatedarabic = 64520;
  t.behnoonfinalarabic = 64621;
  t.bekatakana = 12505;
  t.benarmenian = 1378;
  t.bet = 1489;
  t.beta = 946;
  t.betasymbolgreek = 976;
  t.betdagesh = 64305;
  t.betdageshhebrew = 64305;
  t.bethebrew = 1489;
  t.betrafehebrew = 64332;
  t.bhabengali = 2477;
  t.bhadeva = 2349;
  t.bhagujarati = 2733;
  t.bhagurmukhi = 2605;
  t.bhook = 595;
  t.bihiragana = 12403;
  t.bikatakana = 12499;
  t.bilabialclick = 664;
  t.bindigurmukhi = 2562;
  t.birusquare = 13105;
  t.blackcircle = 9679;
  t.blackdiamond = 9670;
  t.blackdownpointingtriangle = 9660;
  t.blackleftpointingpointer = 9668;
  t.blackleftpointingtriangle = 9664;
  t.blacklenticularbracketleft = 12304;
  t.blacklenticularbracketleftvertical = 65083;
  t.blacklenticularbracketright = 12305;
  t.blacklenticularbracketrightvertical = 65084;
  t.blacklowerlefttriangle = 9699;
  t.blacklowerrighttriangle = 9698;
  t.blackrectangle = 9644;
  t.blackrightpointingpointer = 9658;
  t.blackrightpointingtriangle = 9654;
  t.blacksmallsquare = 9642;
  t.blacksmilingface = 9787;
  t.blacksquare = 9632;
  t.blackstar = 9733;
  t.blackupperlefttriangle = 9700;
  t.blackupperrighttriangle = 9701;
  t.blackuppointingsmalltriangle = 9652;
  t.blackuppointingtriangle = 9650;
  t.blank = 9251;
  t.blinebelow = 7687;
  t.block = 9608;
  t.bmonospace = 65346;
  t.bobaimaithai = 3610;
  t.bohiragana = 12412;
  t.bokatakana = 12508;
  t.bparen = 9373;
  t.bqsquare = 13251;
  t.braceex = 63732;
  t.braceleft = 123;
  t.braceleftbt = 63731;
  t.braceleftmid = 63730;
  t.braceleftmonospace = 65371;
  t.braceleftsmall = 65115;
  t.bracelefttp = 63729;
  t.braceleftvertical = 65079;
  t.braceright = 125;
  t.bracerightbt = 63742;
  t.bracerightmid = 63741;
  t.bracerightmonospace = 65373;
  t.bracerightsmall = 65116;
  t.bracerighttp = 63740;
  t.bracerightvertical = 65080;
  t.bracketleft = 91;
  t.bracketleftbt = 63728;
  t.bracketleftex = 63727;
  t.bracketleftmonospace = 65339;
  t.bracketlefttp = 63726;
  t.bracketright = 93;
  t.bracketrightbt = 63739;
  t.bracketrightex = 63738;
  t.bracketrightmonospace = 65341;
  t.bracketrighttp = 63737;
  t.breve = 728;
  t.brevebelowcmb = 814;
  t.brevecmb = 774;
  t.breveinvertedbelowcmb = 815;
  t.breveinvertedcmb = 785;
  t.breveinverteddoublecmb = 865;
  t.bridgebelowcmb = 810;
  t.bridgeinvertedbelowcmb = 826;
  t.brokenbar = 166;
  t.bstroke = 384;
  t.bsuperior = 63210;
  t.btopbar = 387;
  t.buhiragana = 12406;
  t.bukatakana = 12502;
  t.bullet = 8226;
  t.bulletinverse = 9688;
  t.bulletoperator = 8729;
  t.bullseye = 9678;
  t.c = 99;
  t.caarmenian = 1390;
  t.cabengali = 2458;
  t.cacute = 263;
  t.cadeva = 2330;
  t.cagujarati = 2714;
  t.cagurmukhi = 2586;
  t.calsquare = 13192;
  t.candrabindubengali = 2433;
  t.candrabinducmb = 784;
  t.candrabindudeva = 2305;
  t.candrabindugujarati = 2689;
  t.capslock = 8682;
  t.careof = 8453;
  t.caron = 711;
  t.caronbelowcmb = 812;
  t.caroncmb = 780;
  t.carriagereturn = 8629;
  t.cbopomofo = 12568;
  t.ccaron = 269;
  t.ccedilla = 231;
  t.ccedillaacute = 7689;
  t.ccircle = 9426;
  t.ccircumflex = 265;
  t.ccurl = 597;
  t.cdot = 267;
  t.cdotaccent = 267;
  t.cdsquare = 13253;
  t.cedilla = 184;
  t.cedillacmb = 807;
  t.cent = 162;
  t.centigrade = 8451;
  t.centinferior = 63199;
  t.centmonospace = 65504;
  t.centoldstyle = 63394;
  t.centsuperior = 63200;
  t.chaarmenian = 1401;
  t.chabengali = 2459;
  t.chadeva = 2331;
  t.chagujarati = 2715;
  t.chagurmukhi = 2587;
  t.chbopomofo = 12564;
  t.cheabkhasiancyrillic = 1213;
  t.checkmark = 10003;
  t.checyrillic = 1095;
  t.chedescenderabkhasiancyrillic = 1215;
  t.chedescendercyrillic = 1207;
  t.chedieresiscyrillic = 1269;
  t.cheharmenian = 1395;
  t.chekhakassiancyrillic = 1228;
  t.cheverticalstrokecyrillic = 1209;
  t.chi = 967;
  t.chieuchacirclekorean = 12919;
  t.chieuchaparenkorean = 12823;
  t.chieuchcirclekorean = 12905;
  t.chieuchkorean = 12618;
  t.chieuchparenkorean = 12809;
  t.chochangthai = 3594;
  t.chochanthai = 3592;
  t.chochingthai = 3593;
  t.chochoethai = 3596;
  t.chook = 392;
  t.cieucacirclekorean = 12918;
  t.cieucaparenkorean = 12822;
  t.cieuccirclekorean = 12904;
  t.cieuckorean = 12616;
  t.cieucparenkorean = 12808;
  t.cieucuparenkorean = 12828;
  t.circle = 9675;
  t.circlecopyrt = 169;
  t.circlemultiply = 8855;
  t.circleot = 8857;
  t.circleplus = 8853;
  t.circlepostalmark = 12342;
  t.circlewithlefthalfblack = 9680;
  t.circlewithrighthalfblack = 9681;
  t.circumflex = 710;
  t.circumflexbelowcmb = 813;
  t.circumflexcmb = 770;
  t.clear = 8999;
  t.clickalveolar = 450;
  t.clickdental = 448;
  t.clicklateral = 449;
  t.clickretroflex = 451;
  t.club = 9827;
  t.clubsuitblack = 9827;
  t.clubsuitwhite = 9831;
  t.cmcubedsquare = 13220;
  t.cmonospace = 65347;
  t.cmsquaredsquare = 13216;
  t.coarmenian = 1409;
  t.colon = 58;
  t.colonmonetary = 8353;
  t.colonmonospace = 65306;
  t.colonsign = 8353;
  t.colonsmall = 65109;
  t.colontriangularhalfmod = 721;
  t.colontriangularmod = 720;
  t.comma = 44;
  t.commaabovecmb = 787;
  t.commaaboverightcmb = 789;
  t.commaaccent = 63171;
  t.commaarabic = 1548;
  t.commaarmenian = 1373;
  t.commainferior = 63201;
  t.commamonospace = 65292;
  t.commareversedabovecmb = 788;
  t.commareversedmod = 701;
  t.commasmall = 65104;
  t.commasuperior = 63202;
  t.commaturnedabovecmb = 786;
  t.commaturnedmod = 699;
  t.compass = 9788;
  t.congruent = 8773;
  t.contourintegral = 8750;
  t.control = 8963;
  t.controlACK = 6;
  t.controlBEL = 7;
  t.controlBS = 8;
  t.controlCAN = 24;
  t.controlCR = 13;
  t.controlDC1 = 17;
  t.controlDC2 = 18;
  t.controlDC3 = 19;
  t.controlDC4 = 20;
  t.controlDEL = 127;
  t.controlDLE = 16;
  t.controlEM = 25;
  t.controlENQ = 5;
  t.controlEOT = 4;
  t.controlESC = 27;
  t.controlETB = 23;
  t.controlETX = 3;
  t.controlFF = 12;
  t.controlFS = 28;
  t.controlGS = 29;
  t.controlHT = 9;
  t.controlLF = 10;
  t.controlNAK = 21;
  t.controlNULL = 0;
  t.controlRS = 30;
  t.controlSI = 15;
  t.controlSO = 14;
  t.controlSOT = 2;
  t.controlSTX = 1;
  t.controlSUB = 26;
  t.controlSYN = 22;
  t.controlUS = 31;
  t.controlVT = 11;
  t.copyright = 169;
  t.copyrightsans = 63721;
  t.copyrightserif = 63193;
  t.cornerbracketleft = 12300;
  t.cornerbracketlefthalfwidth = 65378;
  t.cornerbracketleftvertical = 65089;
  t.cornerbracketright = 12301;
  t.cornerbracketrighthalfwidth = 65379;
  t.cornerbracketrightvertical = 65090;
  t.corporationsquare = 13183;
  t.cosquare = 13255;
  t.coverkgsquare = 13254;
  t.cparen = 9374;
  t.cruzeiro = 8354;
  t.cstretched = 663;
  t.curlyand = 8911;
  t.curlyor = 8910;
  t.currency = 164;
  t.cyrBreve = 63185;
  t.cyrFlex = 63186;
  t.cyrbreve = 63188;
  t.cyrflex = 63189;
  t.d = 100;
  t.daarmenian = 1380;
  t.dabengali = 2470;
  t.dadarabic = 1590;
  t.dadeva = 2342;
  t.dadfinalarabic = 65214;
  t.dadinitialarabic = 65215;
  t.dadmedialarabic = 65216;
  t.dagesh = 1468;
  t.dageshhebrew = 1468;
  t.dagger = 8224;
  t.daggerdbl = 8225;
  t.dagujarati = 2726;
  t.dagurmukhi = 2598;
  t.dahiragana = 12384;
  t.dakatakana = 12480;
  t.dalarabic = 1583;
  t.dalet = 1491;
  t.daletdagesh = 64307;
  t.daletdageshhebrew = 64307;
  t.dalethebrew = 1491;
  t.dalfinalarabic = 65194;
  t.dammaarabic = 1615;
  t.dammalowarabic = 1615;
  t.dammatanaltonearabic = 1612;
  t.dammatanarabic = 1612;
  t.danda = 2404;
  t.dargahebrew = 1447;
  t.dargalefthebrew = 1447;
  t.dasiapneumatacyrilliccmb = 1157;
  t.dblGrave = 63187;
  t.dblanglebracketleft = 12298;
  t.dblanglebracketleftvertical = 65085;
  t.dblanglebracketright = 12299;
  t.dblanglebracketrightvertical = 65086;
  t.dblarchinvertedbelowcmb = 811;
  t.dblarrowleft = 8660;
  t.dblarrowright = 8658;
  t.dbldanda = 2405;
  t.dblgrave = 63190;
  t.dblgravecmb = 783;
  t.dblintegral = 8748;
  t.dbllowline = 8215;
  t.dbllowlinecmb = 819;
  t.dbloverlinecmb = 831;
  t.dblprimemod = 698;
  t.dblverticalbar = 8214;
  t.dblverticallineabovecmb = 782;
  t.dbopomofo = 12553;
  t.dbsquare = 13256;
  t.dcaron = 271;
  t.dcedilla = 7697;
  t.dcircle = 9427;
  t.dcircumflexbelow = 7699;
  t.dcroat = 273;
  t.ddabengali = 2465;
  t.ddadeva = 2337;
  t.ddagujarati = 2721;
  t.ddagurmukhi = 2593;
  t.ddalarabic = 1672;
  t.ddalfinalarabic = 64393;
  t.dddhadeva = 2396;
  t.ddhabengali = 2466;
  t.ddhadeva = 2338;
  t.ddhagujarati = 2722;
  t.ddhagurmukhi = 2594;
  t.ddotaccent = 7691;
  t.ddotbelow = 7693;
  t.decimalseparatorarabic = 1643;
  t.decimalseparatorpersian = 1643;
  t.decyrillic = 1076;
  t.degree = 176;
  t.dehihebrew = 1453;
  t.dehiragana = 12391;
  t.deicoptic = 1007;
  t.dekatakana = 12487;
  t.deleteleft = 9003;
  t.deleteright = 8998;
  t.delta = 948;
  t.deltaturned = 397;
  t.denominatorminusonenumeratorbengali = 2552;
  t.dezh = 676;
  t.dhabengali = 2471;
  t.dhadeva = 2343;
  t.dhagujarati = 2727;
  t.dhagurmukhi = 2599;
  t.dhook = 599;
  t.dialytikatonos = 901;
  t.dialytikatonoscmb = 836;
  t.diamond = 9830;
  t.diamondsuitwhite = 9826;
  t.dieresis = 168;
  t.dieresisacute = 63191;
  t.dieresisbelowcmb = 804;
  t.dieresiscmb = 776;
  t.dieresisgrave = 63192;
  t.dieresistonos = 901;
  t.dihiragana = 12386;
  t.dikatakana = 12482;
  t.dittomark = 12291;
  t.divide = 247;
  t.divides = 8739;
  t.divisionslash = 8725;
  t.djecyrillic = 1106;
  t.dkshade = 9619;
  t.dlinebelow = 7695;
  t.dlsquare = 13207;
  t.dmacron = 273;
  t.dmonospace = 65348;
  t.dnblock = 9604;
  t.dochadathai = 3598;
  t.dodekthai = 3604;
  t.dohiragana = 12393;
  t.dokatakana = 12489;
  t.dollar = 36;
  t.dollarinferior = 63203;
  t.dollarmonospace = 65284;
  t.dollaroldstyle = 63268;
  t.dollarsmall = 65129;
  t.dollarsuperior = 63204;
  t.dong = 8363;
  t.dorusquare = 13094;
  t.dotaccent = 729;
  t.dotaccentcmb = 775;
  t.dotbelowcmb = 803;
  t.dotbelowcomb = 803;
  t.dotkatakana = 12539;
  t.dotlessi = 305;
  t.dotlessj = 63166;
  t.dotlessjstrokehook = 644;
  t.dotmath = 8901;
  t.dottedcircle = 9676;
  t.doubleyodpatah = 64287;
  t.doubleyodpatahhebrew = 64287;
  t.downtackbelowcmb = 798;
  t.downtackmod = 725;
  t.dparen = 9375;
  t.dsuperior = 63211;
  t.dtail = 598;
  t.dtopbar = 396;
  t.duhiragana = 12389;
  t.dukatakana = 12485;
  t.dz = 499;
  t.dzaltone = 675;
  t.dzcaron = 454;
  t.dzcurl = 677;
  t.dzeabkhasiancyrillic = 1249;
  t.dzecyrillic = 1109;
  t.dzhecyrillic = 1119;
  t.e = 101;
  t.eacute = 233;
  t.earth = 9793;
  t.ebengali = 2447;
  t.ebopomofo = 12572;
  t.ebreve = 277;
  t.ecandradeva = 2317;
  t.ecandragujarati = 2701;
  t.ecandravowelsigndeva = 2373;
  t.ecandravowelsigngujarati = 2757;
  t.ecaron = 283;
  t.ecedillabreve = 7709;
  t.echarmenian = 1381;
  t.echyiwnarmenian = 1415;
  t.ecircle = 9428;
  t.ecircumflex = 234;
  t.ecircumflexacute = 7871;
  t.ecircumflexbelow = 7705;
  t.ecircumflexdotbelow = 7879;
  t.ecircumflexgrave = 7873;
  t.ecircumflexhookabove = 7875;
  t.ecircumflextilde = 7877;
  t.ecyrillic = 1108;
  t.edblgrave = 517;
  t.edeva = 2319;
  t.edieresis = 235;
  t.edot = 279;
  t.edotaccent = 279;
  t.edotbelow = 7865;
  t.eegurmukhi = 2575;
  t.eematragurmukhi = 2631;
  t.efcyrillic = 1092;
  t.egrave = 232;
  t.egujarati = 2703;
  t.eharmenian = 1383;
  t.ehbopomofo = 12573;
  t.ehiragana = 12360;
  t.ehookabove = 7867;
  t.eibopomofo = 12575;
  t.eight = 56;
  t.eightarabic = 1640;
  t.eightbengali = 2542;
  t.eightcircle = 9319;
  t.eightcircleinversesansserif = 10129;
  t.eightdeva = 2414;
  t.eighteencircle = 9329;
  t.eighteenparen = 9349;
  t.eighteenperiod = 9369;
  t.eightgujarati = 2798;
  t.eightgurmukhi = 2670;
  t.eighthackarabic = 1640;
  t.eighthangzhou = 12328;
  t.eighthnotebeamed = 9835;
  t.eightideographicparen = 12839;
  t.eightinferior = 8328;
  t.eightmonospace = 65304;
  t.eightoldstyle = 63288;
  t.eightparen = 9339;
  t.eightperiod = 9359;
  t.eightpersian = 1784;
  t.eightroman = 8567;
  t.eightsuperior = 8312;
  t.eightthai = 3672;
  t.einvertedbreve = 519;
  t.eiotifiedcyrillic = 1125;
  t.ekatakana = 12456;
  t.ekatakanahalfwidth = 65396;
  t.ekonkargurmukhi = 2676;
  t.ekorean = 12628;
  t.elcyrillic = 1083;
  t.element = 8712;
  t.elevencircle = 9322;
  t.elevenparen = 9342;
  t.elevenperiod = 9362;
  t.elevenroman = 8570;
  t.ellipsis = 8230;
  t.ellipsisvertical = 8942;
  t.emacron = 275;
  t.emacronacute = 7703;
  t.emacrongrave = 7701;
  t.emcyrillic = 1084;
  t.emdash = 8212;
  t.emdashvertical = 65073;
  t.emonospace = 65349;
  t.emphasismarkarmenian = 1371;
  t.emptyset = 8709;
  t.enbopomofo = 12579;
  t.encyrillic = 1085;
  t.endash = 8211;
  t.endashvertical = 65074;
  t.endescendercyrillic = 1187;
  t.eng = 331;
  t.engbopomofo = 12581;
  t.enghecyrillic = 1189;
  t.enhookcyrillic = 1224;
  t.enspace = 8194;
  t.eogonek = 281;
  t.eokorean = 12627;
  t.eopen = 603;
  t.eopenclosed = 666;
  t.eopenreversed = 604;
  t.eopenreversedclosed = 606;
  t.eopenreversedhook = 605;
  t.eparen = 9376;
  t.epsilon = 949;
  t.epsilontonos = 941;
  t.equal = 61;
  t.equalmonospace = 65309;
  t.equalsmall = 65126;
  t.equalsuperior = 8316;
  t.equivalence = 8801;
  t.erbopomofo = 12582;
  t.ercyrillic = 1088;
  t.ereversed = 600;
  t.ereversedcyrillic = 1101;
  t.escyrillic = 1089;
  t.esdescendercyrillic = 1195;
  t.esh = 643;
  t.eshcurl = 646;
  t.eshortdeva = 2318;
  t.eshortvowelsigndeva = 2374;
  t.eshreversedloop = 426;
  t.eshsquatreversed = 645;
  t.esmallhiragana = 12359;
  t.esmallkatakana = 12455;
  t.esmallkatakanahalfwidth = 65386;
  t.estimated = 8494;
  t.esuperior = 63212;
  t.eta = 951;
  t.etarmenian = 1384;
  t.etatonos = 942;
  t.eth = 240;
  t.etilde = 7869;
  t.etildebelow = 7707;
  t.etnahtafoukhhebrew = 1425;
  t.etnahtafoukhlefthebrew = 1425;
  t.etnahtahebrew = 1425;
  t.etnahtalefthebrew = 1425;
  t.eturned = 477;
  t.eukorean = 12641;
  t.euro = 8364;
  t.evowelsignbengali = 2503;
  t.evowelsigndeva = 2375;
  t.evowelsigngujarati = 2759;
  t.exclam = 33;
  t.exclamarmenian = 1372;
  t.exclamdbl = 8252;
  t.exclamdown = 161;
  t.exclamdownsmall = 63393;
  t.exclammonospace = 65281;
  t.exclamsmall = 63265;
  t.existential = 8707;
  t.ezh = 658;
  t.ezhcaron = 495;
  t.ezhcurl = 659;
  t.ezhreversed = 441;
  t.ezhtail = 442;
  t.f = 102;
  t.fadeva = 2398;
  t.fagurmukhi = 2654;
  t.fahrenheit = 8457;
  t.fathaarabic = 1614;
  t.fathalowarabic = 1614;
  t.fathatanarabic = 1611;
  t.fbopomofo = 12552;
  t.fcircle = 9429;
  t.fdotaccent = 7711;
  t.feharabic = 1601;
  t.feharmenian = 1414;
  t.fehfinalarabic = 65234;
  t.fehinitialarabic = 65235;
  t.fehmedialarabic = 65236;
  t.feicoptic = 997;
  t.female = 9792;
  t.ff = 64256;
  t.f_f = 64256;
  t.ffi = 64259;
  t.f_f_i = 64259;
  t.ffl = 64260;
  t.f_f_l = 64260;
  t.fi = 64257;
  t.f_i = 64257;
  t.fifteencircle = 9326;
  t.fifteenparen = 9346;
  t.fifteenperiod = 9366;
  t.figuredash = 8210;
  t.filledbox = 9632;
  t.filledrect = 9644;
  t.finalkaf = 1498;
  t.finalkafdagesh = 64314;
  t.finalkafdageshhebrew = 64314;
  t.finalkafhebrew = 1498;
  t.finalmem = 1501;
  t.finalmemhebrew = 1501;
  t.finalnun = 1503;
  t.finalnunhebrew = 1503;
  t.finalpe = 1507;
  t.finalpehebrew = 1507;
  t.finaltsadi = 1509;
  t.finaltsadihebrew = 1509;
  t.firsttonechinese = 713;
  t.fisheye = 9673;
  t.fitacyrillic = 1139;
  t.five = 53;
  t.fivearabic = 1637;
  t.fivebengali = 2539;
  t.fivecircle = 9316;
  t.fivecircleinversesansserif = 10126;
  t.fivedeva = 2411;
  t.fiveeighths = 8541;
  t.fivegujarati = 2795;
  t.fivegurmukhi = 2667;
  t.fivehackarabic = 1637;
  t.fivehangzhou = 12325;
  t.fiveideographicparen = 12836;
  t.fiveinferior = 8325;
  t.fivemonospace = 65301;
  t.fiveoldstyle = 63285;
  t.fiveparen = 9336;
  t.fiveperiod = 9356;
  t.fivepersian = 1781;
  t.fiveroman = 8564;
  t.fivesuperior = 8309;
  t.fivethai = 3669;
  t.fl = 64258;
  t.f_l = 64258;
  t.florin = 402;
  t.fmonospace = 65350;
  t.fmsquare = 13209;
  t.fofanthai = 3615;
  t.fofathai = 3613;
  t.fongmanthai = 3663;
  t.forall = 8704;
  t.four = 52;
  t.fourarabic = 1636;
  t.fourbengali = 2538;
  t.fourcircle = 9315;
  t.fourcircleinversesansserif = 10125;
  t.fourdeva = 2410;
  t.fourgujarati = 2794;
  t.fourgurmukhi = 2666;
  t.fourhackarabic = 1636;
  t.fourhangzhou = 12324;
  t.fourideographicparen = 12835;
  t.fourinferior = 8324;
  t.fourmonospace = 65300;
  t.fournumeratorbengali = 2551;
  t.fouroldstyle = 63284;
  t.fourparen = 9335;
  t.fourperiod = 9355;
  t.fourpersian = 1780;
  t.fourroman = 8563;
  t.foursuperior = 8308;
  t.fourteencircle = 9325;
  t.fourteenparen = 9345;
  t.fourteenperiod = 9365;
  t.fourthai = 3668;
  t.fourthtonechinese = 715;
  t.fparen = 9377;
  t.fraction = 8260;
  t.franc = 8355;
  t.g = 103;
  t.gabengali = 2455;
  t.gacute = 501;
  t.gadeva = 2327;
  t.gafarabic = 1711;
  t.gaffinalarabic = 64403;
  t.gafinitialarabic = 64404;
  t.gafmedialarabic = 64405;
  t.gagujarati = 2711;
  t.gagurmukhi = 2583;
  t.gahiragana = 12364;
  t.gakatakana = 12460;
  t.gamma = 947;
  t.gammalatinsmall = 611;
  t.gammasuperior = 736;
  t.gangiacoptic = 1003;
  t.gbopomofo = 12557;
  t.gbreve = 287;
  t.gcaron = 487;
  t.gcedilla = 291;
  t.gcircle = 9430;
  t.gcircumflex = 285;
  t.gcommaaccent = 291;
  t.gdot = 289;
  t.gdotaccent = 289;
  t.gecyrillic = 1075;
  t.gehiragana = 12370;
  t.gekatakana = 12466;
  t.geometricallyequal = 8785;
  t.gereshaccenthebrew = 1436;
  t.gereshhebrew = 1523;
  t.gereshmuqdamhebrew = 1437;
  t.germandbls = 223;
  t.gershayimaccenthebrew = 1438;
  t.gershayimhebrew = 1524;
  t.getamark = 12307;
  t.ghabengali = 2456;
  t.ghadarmenian = 1394;
  t.ghadeva = 2328;
  t.ghagujarati = 2712;
  t.ghagurmukhi = 2584;
  t.ghainarabic = 1594;
  t.ghainfinalarabic = 65230;
  t.ghaininitialarabic = 65231;
  t.ghainmedialarabic = 65232;
  t.ghemiddlehookcyrillic = 1173;
  t.ghestrokecyrillic = 1171;
  t.gheupturncyrillic = 1169;
  t.ghhadeva = 2394;
  t.ghhagurmukhi = 2650;
  t.ghook = 608;
  t.ghzsquare = 13203;
  t.gihiragana = 12366;
  t.gikatakana = 12462;
  t.gimarmenian = 1379;
  t.gimel = 1490;
  t.gimeldagesh = 64306;
  t.gimeldageshhebrew = 64306;
  t.gimelhebrew = 1490;
  t.gjecyrillic = 1107;
  t.glottalinvertedstroke = 446;
  t.glottalstop = 660;
  t.glottalstopinverted = 662;
  t.glottalstopmod = 704;
  t.glottalstopreversed = 661;
  t.glottalstopreversedmod = 705;
  t.glottalstopreversedsuperior = 740;
  t.glottalstopstroke = 673;
  t.glottalstopstrokereversed = 674;
  t.gmacron = 7713;
  t.gmonospace = 65351;
  t.gohiragana = 12372;
  t.gokatakana = 12468;
  t.gparen = 9378;
  t.gpasquare = 13228;
  t.gradient = 8711;
  t.grave = 96;
  t.gravebelowcmb = 790;
  t.gravecmb = 768;
  t.gravecomb = 768;
  t.gravedeva = 2387;
  t.gravelowmod = 718;
  t.gravemonospace = 65344;
  t.gravetonecmb = 832;
  t.greater = 62;
  t.greaterequal = 8805;
  t.greaterequalorless = 8923;
  t.greatermonospace = 65310;
  t.greaterorequivalent = 8819;
  t.greaterorless = 8823;
  t.greateroverequal = 8807;
  t.greatersmall = 65125;
  t.gscript = 609;
  t.gstroke = 485;
  t.guhiragana = 12368;
  t.guillemotleft = 171;
  t.guillemotright = 187;
  t.guilsinglleft = 8249;
  t.guilsinglright = 8250;
  t.gukatakana = 12464;
  t.guramusquare = 13080;
  t.gysquare = 13257;
  t.h = 104;
  t.haabkhasiancyrillic = 1193;
  t.haaltonearabic = 1729;
  t.habengali = 2489;
  t.hadescendercyrillic = 1203;
  t.hadeva = 2361;
  t.hagujarati = 2745;
  t.hagurmukhi = 2617;
  t.haharabic = 1581;
  t.hahfinalarabic = 65186;
  t.hahinitialarabic = 65187;
  t.hahiragana = 12399;
  t.hahmedialarabic = 65188;
  t.haitusquare = 13098;
  t.hakatakana = 12495;
  t.hakatakanahalfwidth = 65418;
  t.halantgurmukhi = 2637;
  t.hamzaarabic = 1569;
  t.hamzalowarabic = 1569;
  t.hangulfiller = 12644;
  t.hardsigncyrillic = 1098;
  t.harpoonleftbarbup = 8636;
  t.harpoonrightbarbup = 8640;
  t.hasquare = 13258;
  t.hatafpatah = 1458;
  t.hatafpatah16 = 1458;
  t.hatafpatah23 = 1458;
  t.hatafpatah2f = 1458;
  t.hatafpatahhebrew = 1458;
  t.hatafpatahnarrowhebrew = 1458;
  t.hatafpatahquarterhebrew = 1458;
  t.hatafpatahwidehebrew = 1458;
  t.hatafqamats = 1459;
  t.hatafqamats1b = 1459;
  t.hatafqamats28 = 1459;
  t.hatafqamats34 = 1459;
  t.hatafqamatshebrew = 1459;
  t.hatafqamatsnarrowhebrew = 1459;
  t.hatafqamatsquarterhebrew = 1459;
  t.hatafqamatswidehebrew = 1459;
  t.hatafsegol = 1457;
  t.hatafsegol17 = 1457;
  t.hatafsegol24 = 1457;
  t.hatafsegol30 = 1457;
  t.hatafsegolhebrew = 1457;
  t.hatafsegolnarrowhebrew = 1457;
  t.hatafsegolquarterhebrew = 1457;
  t.hatafsegolwidehebrew = 1457;
  t.hbar = 295;
  t.hbopomofo = 12559;
  t.hbrevebelow = 7723;
  t.hcedilla = 7721;
  t.hcircle = 9431;
  t.hcircumflex = 293;
  t.hdieresis = 7719;
  t.hdotaccent = 7715;
  t.hdotbelow = 7717;
  t.he = 1492;
  t.heart = 9829;
  t.heartsuitblack = 9829;
  t.heartsuitwhite = 9825;
  t.hedagesh = 64308;
  t.hedageshhebrew = 64308;
  t.hehaltonearabic = 1729;
  t.heharabic = 1607;
  t.hehebrew = 1492;
  t.hehfinalaltonearabic = 64423;
  t.hehfinalalttwoarabic = 65258;
  t.hehfinalarabic = 65258;
  t.hehhamzaabovefinalarabic = 64421;
  t.hehhamzaaboveisolatedarabic = 64420;
  t.hehinitialaltonearabic = 64424;
  t.hehinitialarabic = 65259;
  t.hehiragana = 12408;
  t.hehmedialaltonearabic = 64425;
  t.hehmedialarabic = 65260;
  t.heiseierasquare = 13179;
  t.hekatakana = 12504;
  t.hekatakanahalfwidth = 65421;
  t.hekutaarusquare = 13110;
  t.henghook = 615;
  t.herutusquare = 13113;
  t.het = 1495;
  t.hethebrew = 1495;
  t.hhook = 614;
  t.hhooksuperior = 689;
  t.hieuhacirclekorean = 12923;
  t.hieuhaparenkorean = 12827;
  t.hieuhcirclekorean = 12909;
  t.hieuhkorean = 12622;
  t.hieuhparenkorean = 12813;
  t.hihiragana = 12402;
  t.hikatakana = 12498;
  t.hikatakanahalfwidth = 65419;
  t.hiriq = 1460;
  t.hiriq14 = 1460;
  t.hiriq21 = 1460;
  t.hiriq2d = 1460;
  t.hiriqhebrew = 1460;
  t.hiriqnarrowhebrew = 1460;
  t.hiriqquarterhebrew = 1460;
  t.hiriqwidehebrew = 1460;
  t.hlinebelow = 7830;
  t.hmonospace = 65352;
  t.hoarmenian = 1392;
  t.hohipthai = 3627;
  t.hohiragana = 12411;
  t.hokatakana = 12507;
  t.hokatakanahalfwidth = 65422;
  t.holam = 1465;
  t.holam19 = 1465;
  t.holam26 = 1465;
  t.holam32 = 1465;
  t.holamhebrew = 1465;
  t.holamnarrowhebrew = 1465;
  t.holamquarterhebrew = 1465;
  t.holamwidehebrew = 1465;
  t.honokhukthai = 3630;
  t.hookabovecomb = 777;
  t.hookcmb = 777;
  t.hookpalatalizedbelowcmb = 801;
  t.hookretroflexbelowcmb = 802;
  t.hoonsquare = 13122;
  t.horicoptic = 1001;
  t.horizontalbar = 8213;
  t.horncmb = 795;
  t.hotsprings = 9832;
  t.house = 8962;
  t.hparen = 9379;
  t.hsuperior = 688;
  t.hturned = 613;
  t.huhiragana = 12405;
  t.huiitosquare = 13107;
  t.hukatakana = 12501;
  t.hukatakanahalfwidth = 65420;
  t.hungarumlaut = 733;
  t.hungarumlautcmb = 779;
  t.hv = 405;
  t.hyphen = 45;
  t.hypheninferior = 63205;
  t.hyphenmonospace = 65293;
  t.hyphensmall = 65123;
  t.hyphensuperior = 63206;
  t.hyphentwo = 8208;
  t.i = 105;
  t.iacute = 237;
  t.iacyrillic = 1103;
  t.ibengali = 2439;
  t.ibopomofo = 12583;
  t.ibreve = 301;
  t.icaron = 464;
  t.icircle = 9432;
  t.icircumflex = 238;
  t.icyrillic = 1110;
  t.idblgrave = 521;
  t.ideographearthcircle = 12943;
  t.ideographfirecircle = 12939;
  t.ideographicallianceparen = 12863;
  t.ideographiccallparen = 12858;
  t.ideographiccentrecircle = 12965;
  t.ideographicclose = 12294;
  t.ideographiccomma = 12289;
  t.ideographiccommaleft = 65380;
  t.ideographiccongratulationparen = 12855;
  t.ideographiccorrectcircle = 12963;
  t.ideographicearthparen = 12847;
  t.ideographicenterpriseparen = 12861;
  t.ideographicexcellentcircle = 12957;
  t.ideographicfestivalparen = 12864;
  t.ideographicfinancialcircle = 12950;
  t.ideographicfinancialparen = 12854;
  t.ideographicfireparen = 12843;
  t.ideographichaveparen = 12850;
  t.ideographichighcircle = 12964;
  t.ideographiciterationmark = 12293;
  t.ideographiclaborcircle = 12952;
  t.ideographiclaborparen = 12856;
  t.ideographicleftcircle = 12967;
  t.ideographiclowcircle = 12966;
  t.ideographicmedicinecircle = 12969;
  t.ideographicmetalparen = 12846;
  t.ideographicmoonparen = 12842;
  t.ideographicnameparen = 12852;
  t.ideographicperiod = 12290;
  t.ideographicprintcircle = 12958;
  t.ideographicreachparen = 12867;
  t.ideographicrepresentparen = 12857;
  t.ideographicresourceparen = 12862;
  t.ideographicrightcircle = 12968;
  t.ideographicsecretcircle = 12953;
  t.ideographicselfparen = 12866;
  t.ideographicsocietyparen = 12851;
  t.ideographicspace = 12288;
  t.ideographicspecialparen = 12853;
  t.ideographicstockparen = 12849;
  t.ideographicstudyparen = 12859;
  t.ideographicsunparen = 12848;
  t.ideographicsuperviseparen = 12860;
  t.ideographicwaterparen = 12844;
  t.ideographicwoodparen = 12845;
  t.ideographiczero = 12295;
  t.ideographmetalcircle = 12942;
  t.ideographmooncircle = 12938;
  t.ideographnamecircle = 12948;
  t.ideographsuncircle = 12944;
  t.ideographwatercircle = 12940;
  t.ideographwoodcircle = 12941;
  t.ideva = 2311;
  t.idieresis = 239;
  t.idieresisacute = 7727;
  t.idieresiscyrillic = 1253;
  t.idotbelow = 7883;
  t.iebrevecyrillic = 1239;
  t.iecyrillic = 1077;
  t.ieungacirclekorean = 12917;
  t.ieungaparenkorean = 12821;
  t.ieungcirclekorean = 12903;
  t.ieungkorean = 12615;
  t.ieungparenkorean = 12807;
  t.igrave = 236;
  t.igujarati = 2695;
  t.igurmukhi = 2567;
  t.ihiragana = 12356;
  t.ihookabove = 7881;
  t.iibengali = 2440;
  t.iicyrillic = 1080;
  t.iideva = 2312;
  t.iigujarati = 2696;
  t.iigurmukhi = 2568;
  t.iimatragurmukhi = 2624;
  t.iinvertedbreve = 523;
  t.iishortcyrillic = 1081;
  t.iivowelsignbengali = 2496;
  t.iivowelsigndeva = 2368;
  t.iivowelsigngujarati = 2752;
  t.ij = 307;
  t.ikatakana = 12452;
  t.ikatakanahalfwidth = 65394;
  t.ikorean = 12643;
  t.ilde = 732;
  t.iluyhebrew = 1452;
  t.imacron = 299;
  t.imacroncyrillic = 1251;
  t.imageorapproximatelyequal = 8787;
  t.imatragurmukhi = 2623;
  t.imonospace = 65353;
  t.increment = 8710;
  t.infinity = 8734;
  t.iniarmenian = 1387;
  t.integral = 8747;
  t.integralbottom = 8993;
  t.integralbt = 8993;
  t.integralex = 63733;
  t.integraltop = 8992;
  t.integraltp = 8992;
  t.intersection = 8745;
  t.intisquare = 13061;
  t.invbullet = 9688;
  t.invcircle = 9689;
  t.invsmileface = 9787;
  t.iocyrillic = 1105;
  t.iogonek = 303;
  t.iota = 953;
  t.iotadieresis = 970;
  t.iotadieresistonos = 912;
  t.iotalatin = 617;
  t.iotatonos = 943;
  t.iparen = 9380;
  t.irigurmukhi = 2674;
  t.ismallhiragana = 12355;
  t.ismallkatakana = 12451;
  t.ismallkatakanahalfwidth = 65384;
  t.issharbengali = 2554;
  t.istroke = 616;
  t.isuperior = 63213;
  t.iterationhiragana = 12445;
  t.iterationkatakana = 12541;
  t.itilde = 297;
  t.itildebelow = 7725;
  t.iubopomofo = 12585;
  t.iucyrillic = 1102;
  t.ivowelsignbengali = 2495;
  t.ivowelsigndeva = 2367;
  t.ivowelsigngujarati = 2751;
  t.izhitsacyrillic = 1141;
  t.izhitsadblgravecyrillic = 1143;
  t.j = 106;
  t.jaarmenian = 1393;
  t.jabengali = 2460;
  t.jadeva = 2332;
  t.jagujarati = 2716;
  t.jagurmukhi = 2588;
  t.jbopomofo = 12560;
  t.jcaron = 496;
  t.jcircle = 9433;
  t.jcircumflex = 309;
  t.jcrossedtail = 669;
  t.jdotlessstroke = 607;
  t.jecyrillic = 1112;
  t.jeemarabic = 1580;
  t.jeemfinalarabic = 65182;
  t.jeeminitialarabic = 65183;
  t.jeemmedialarabic = 65184;
  t.jeharabic = 1688;
  t.jehfinalarabic = 64395;
  t.jhabengali = 2461;
  t.jhadeva = 2333;
  t.jhagujarati = 2717;
  t.jhagurmukhi = 2589;
  t.jheharmenian = 1403;
  t.jis = 12292;
  t.jmonospace = 65354;
  t.jparen = 9381;
  t.jsuperior = 690;
  t.k = 107;
  t.kabashkircyrillic = 1185;
  t.kabengali = 2453;
  t.kacute = 7729;
  t.kacyrillic = 1082;
  t.kadescendercyrillic = 1179;
  t.kadeva = 2325;
  t.kaf = 1499;
  t.kafarabic = 1603;
  t.kafdagesh = 64315;
  t.kafdageshhebrew = 64315;
  t.kaffinalarabic = 65242;
  t.kafhebrew = 1499;
  t.kafinitialarabic = 65243;
  t.kafmedialarabic = 65244;
  t.kafrafehebrew = 64333;
  t.kagujarati = 2709;
  t.kagurmukhi = 2581;
  t.kahiragana = 12363;
  t.kahookcyrillic = 1220;
  t.kakatakana = 12459;
  t.kakatakanahalfwidth = 65398;
  t.kappa = 954;
  t.kappasymbolgreek = 1008;
  t.kapyeounmieumkorean = 12657;
  t.kapyeounphieuphkorean = 12676;
  t.kapyeounpieupkorean = 12664;
  t.kapyeounssangpieupkorean = 12665;
  t.karoriisquare = 13069;
  t.kashidaautoarabic = 1600;
  t.kashidaautonosidebearingarabic = 1600;
  t.kasmallkatakana = 12533;
  t.kasquare = 13188;
  t.kasraarabic = 1616;
  t.kasratanarabic = 1613;
  t.kastrokecyrillic = 1183;
  t.katahiraprolongmarkhalfwidth = 65392;
  t.kaverticalstrokecyrillic = 1181;
  t.kbopomofo = 12558;
  t.kcalsquare = 13193;
  t.kcaron = 489;
  t.kcedilla = 311;
  t.kcircle = 9434;
  t.kcommaaccent = 311;
  t.kdotbelow = 7731;
  t.keharmenian = 1412;
  t.kehiragana = 12369;
  t.kekatakana = 12465;
  t.kekatakanahalfwidth = 65401;
  t.kenarmenian = 1391;
  t.kesmallkatakana = 12534;
  t.kgreenlandic = 312;
  t.khabengali = 2454;
  t.khacyrillic = 1093;
  t.khadeva = 2326;
  t.khagujarati = 2710;
  t.khagurmukhi = 2582;
  t.khaharabic = 1582;
  t.khahfinalarabic = 65190;
  t.khahinitialarabic = 65191;
  t.khahmedialarabic = 65192;
  t.kheicoptic = 999;
  t.khhadeva = 2393;
  t.khhagurmukhi = 2649;
  t.khieukhacirclekorean = 12920;
  t.khieukhaparenkorean = 12824;
  t.khieukhcirclekorean = 12906;
  t.khieukhkorean = 12619;
  t.khieukhparenkorean = 12810;
  t.khokhaithai = 3586;
  t.khokhonthai = 3589;
  t.khokhuatthai = 3587;
  t.khokhwaithai = 3588;
  t.khomutthai = 3675;
  t.khook = 409;
  t.khorakhangthai = 3590;
  t.khzsquare = 13201;
  t.kihiragana = 12365;
  t.kikatakana = 12461;
  t.kikatakanahalfwidth = 65399;
  t.kiroguramusquare = 13077;
  t.kiromeetorusquare = 13078;
  t.kirosquare = 13076;
  t.kiyeokacirclekorean = 12910;
  t.kiyeokaparenkorean = 12814;
  t.kiyeokcirclekorean = 12896;
  t.kiyeokkorean = 12593;
  t.kiyeokparenkorean = 12800;
  t.kiyeoksioskorean = 12595;
  t.kjecyrillic = 1116;
  t.klinebelow = 7733;
  t.klsquare = 13208;
  t.kmcubedsquare = 13222;
  t.kmonospace = 65355;
  t.kmsquaredsquare = 13218;
  t.kohiragana = 12371;
  t.kohmsquare = 13248;
  t.kokaithai = 3585;
  t.kokatakana = 12467;
  t.kokatakanahalfwidth = 65402;
  t.kooposquare = 13086;
  t.koppacyrillic = 1153;
  t.koreanstandardsymbol = 12927;
  t.koroniscmb = 835;
  t.kparen = 9382;
  t.kpasquare = 13226;
  t.ksicyrillic = 1135;
  t.ktsquare = 13263;
  t.kturned = 670;
  t.kuhiragana = 12367;
  t.kukatakana = 12463;
  t.kukatakanahalfwidth = 65400;
  t.kvsquare = 13240;
  t.kwsquare = 13246;
  t.l = 108;
  t.labengali = 2482;
  t.lacute = 314;
  t.ladeva = 2354;
  t.lagujarati = 2738;
  t.lagurmukhi = 2610;
  t.lakkhangyaothai = 3653;
  t.lamaleffinalarabic = 65276;
  t.lamalefhamzaabovefinalarabic = 65272;
  t.lamalefhamzaaboveisolatedarabic = 65271;
  t.lamalefhamzabelowfinalarabic = 65274;
  t.lamalefhamzabelowisolatedarabic = 65273;
  t.lamalefisolatedarabic = 65275;
  t.lamalefmaddaabovefinalarabic = 65270;
  t.lamalefmaddaaboveisolatedarabic = 65269;
  t.lamarabic = 1604;
  t.lambda = 955;
  t.lambdastroke = 411;
  t.lamed = 1500;
  t.lameddagesh = 64316;
  t.lameddageshhebrew = 64316;
  t.lamedhebrew = 1500;
  t.lamfinalarabic = 65246;
  t.lamhahinitialarabic = 64714;
  t.laminitialarabic = 65247;
  t.lamjeeminitialarabic = 64713;
  t.lamkhahinitialarabic = 64715;
  t.lamlamhehisolatedarabic = 65010;
  t.lammedialarabic = 65248;
  t.lammeemhahinitialarabic = 64904;
  t.lammeeminitialarabic = 64716;
  t.largecircle = 9711;
  t.lbar = 410;
  t.lbelt = 620;
  t.lbopomofo = 12556;
  t.lcaron = 318;
  t.lcedilla = 316;
  t.lcircle = 9435;
  t.lcircumflexbelow = 7741;
  t.lcommaaccent = 316;
  t.ldot = 320;
  t.ldotaccent = 320;
  t.ldotbelow = 7735;
  t.ldotbelowmacron = 7737;
  t.leftangleabovecmb = 794;
  t.lefttackbelowcmb = 792;
  t.less = 60;
  t.lessequal = 8804;
  t.lessequalorgreater = 8922;
  t.lessmonospace = 65308;
  t.lessorequivalent = 8818;
  t.lessorgreater = 8822;
  t.lessoverequal = 8806;
  t.lesssmall = 65124;
  t.lezh = 622;
  t.lfblock = 9612;
  t.lhookretroflex = 621;
  t.lira = 8356;
  t.liwnarmenian = 1388;
  t.lj = 457;
  t.ljecyrillic = 1113;
  t.ll = 63168;
  t.lladeva = 2355;
  t.llagujarati = 2739;
  t.llinebelow = 7739;
  t.llladeva = 2356;
  t.llvocalicbengali = 2529;
  t.llvocalicdeva = 2401;
  t.llvocalicvowelsignbengali = 2531;
  t.llvocalicvowelsigndeva = 2403;
  t.lmiddletilde = 619;
  t.lmonospace = 65356;
  t.lmsquare = 13264;
  t.lochulathai = 3628;
  t.logicaland = 8743;
  t.logicalnot = 172;
  t.logicalnotreversed = 8976;
  t.logicalor = 8744;
  t.lolingthai = 3621;
  t.longs = 383;
  t.lowlinecenterline = 65102;
  t.lowlinecmb = 818;
  t.lowlinedashed = 65101;
  t.lozenge = 9674;
  t.lparen = 9383;
  t.lslash = 322;
  t.lsquare = 8467;
  t.lsuperior = 63214;
  t.ltshade = 9617;
  t.luthai = 3622;
  t.lvocalicbengali = 2444;
  t.lvocalicdeva = 2316;
  t.lvocalicvowelsignbengali = 2530;
  t.lvocalicvowelsigndeva = 2402;
  t.lxsquare = 13267;
  t.m = 109;
  t.mabengali = 2478;
  t.macron = 175;
  t.macronbelowcmb = 817;
  t.macroncmb = 772;
  t.macronlowmod = 717;
  t.macronmonospace = 65507;
  t.macute = 7743;
  t.madeva = 2350;
  t.magujarati = 2734;
  t.magurmukhi = 2606;
  t.mahapakhhebrew = 1444;
  t.mahapakhlefthebrew = 1444;
  t.mahiragana = 12414;
  t.maichattawalowleftthai = 63637;
  t.maichattawalowrightthai = 63636;
  t.maichattawathai = 3659;
  t.maichattawaupperleftthai = 63635;
  t.maieklowleftthai = 63628;
  t.maieklowrightthai = 63627;
  t.maiekthai = 3656;
  t.maiekupperleftthai = 63626;
  t.maihanakatleftthai = 63620;
  t.maihanakatthai = 3633;
  t.maitaikhuleftthai = 63625;
  t.maitaikhuthai = 3655;
  t.maitholowleftthai = 63631;
  t.maitholowrightthai = 63630;
  t.maithothai = 3657;
  t.maithoupperleftthai = 63629;
  t.maitrilowleftthai = 63634;
  t.maitrilowrightthai = 63633;
  t.maitrithai = 3658;
  t.maitriupperleftthai = 63632;
  t.maiyamokthai = 3654;
  t.makatakana = 12510;
  t.makatakanahalfwidth = 65423;
  t.male = 9794;
  t.mansyonsquare = 13127;
  t.maqafhebrew = 1470;
  t.mars = 9794;
  t.masoracirclehebrew = 1455;
  t.masquare = 13187;
  t.mbopomofo = 12551;
  t.mbsquare = 13268;
  t.mcircle = 9436;
  t.mcubedsquare = 13221;
  t.mdotaccent = 7745;
  t.mdotbelow = 7747;
  t.meemarabic = 1605;
  t.meemfinalarabic = 65250;
  t.meeminitialarabic = 65251;
  t.meemmedialarabic = 65252;
  t.meemmeeminitialarabic = 64721;
  t.meemmeemisolatedarabic = 64584;
  t.meetorusquare = 13133;
  t.mehiragana = 12417;
  t.meizierasquare = 13182;
  t.mekatakana = 12513;
  t.mekatakanahalfwidth = 65426;
  t.mem = 1502;
  t.memdagesh = 64318;
  t.memdageshhebrew = 64318;
  t.memhebrew = 1502;
  t.menarmenian = 1396;
  t.merkhahebrew = 1445;
  t.merkhakefulahebrew = 1446;
  t.merkhakefulalefthebrew = 1446;
  t.merkhalefthebrew = 1445;
  t.mhook = 625;
  t.mhzsquare = 13202;
  t.middledotkatakanahalfwidth = 65381;
  t.middot = 183;
  t.mieumacirclekorean = 12914;
  t.mieumaparenkorean = 12818;
  t.mieumcirclekorean = 12900;
  t.mieumkorean = 12609;
  t.mieumpansioskorean = 12656;
  t.mieumparenkorean = 12804;
  t.mieumpieupkorean = 12654;
  t.mieumsioskorean = 12655;
  t.mihiragana = 12415;
  t.mikatakana = 12511;
  t.mikatakanahalfwidth = 65424;
  t.minus = 8722;
  t.minusbelowcmb = 800;
  t.minuscircle = 8854;
  t.minusmod = 727;
  t.minusplus = 8723;
  t.minute = 8242;
  t.miribaarusquare = 13130;
  t.mirisquare = 13129;
  t.mlonglegturned = 624;
  t.mlsquare = 13206;
  t.mmcubedsquare = 13219;
  t.mmonospace = 65357;
  t.mmsquaredsquare = 13215;
  t.mohiragana = 12418;
  t.mohmsquare = 13249;
  t.mokatakana = 12514;
  t.mokatakanahalfwidth = 65427;
  t.molsquare = 13270;
  t.momathai = 3617;
  t.moverssquare = 13223;
  t.moverssquaredsquare = 13224;
  t.mparen = 9384;
  t.mpasquare = 13227;
  t.mssquare = 13235;
  t.msuperior = 63215;
  t.mturned = 623;
  t.mu = 181;
  t.mu1 = 181;
  t.muasquare = 13186;
  t.muchgreater = 8811;
  t.muchless = 8810;
  t.mufsquare = 13196;
  t.mugreek = 956;
  t.mugsquare = 13197;
  t.muhiragana = 12416;
  t.mukatakana = 12512;
  t.mukatakanahalfwidth = 65425;
  t.mulsquare = 13205;
  t.multiply = 215;
  t.mumsquare = 13211;
  t.munahhebrew = 1443;
  t.munahlefthebrew = 1443;
  t.musicalnote = 9834;
  t.musicalnotedbl = 9835;
  t.musicflatsign = 9837;
  t.musicsharpsign = 9839;
  t.mussquare = 13234;
  t.muvsquare = 13238;
  t.muwsquare = 13244;
  t.mvmegasquare = 13241;
  t.mvsquare = 13239;
  t.mwmegasquare = 13247;
  t.mwsquare = 13245;
  t.n = 110;
  t.nabengali = 2472;
  t.nabla = 8711;
  t.nacute = 324;
  t.nadeva = 2344;
  t.nagujarati = 2728;
  t.nagurmukhi = 2600;
  t.nahiragana = 12394;
  t.nakatakana = 12490;
  t.nakatakanahalfwidth = 65413;
  t.napostrophe = 329;
  t.nasquare = 13185;
  t.nbopomofo = 12555;
  t.nbspace = 160;
  t.ncaron = 328;
  t.ncedilla = 326;
  t.ncircle = 9437;
  t.ncircumflexbelow = 7755;
  t.ncommaaccent = 326;
  t.ndotaccent = 7749;
  t.ndotbelow = 7751;
  t.nehiragana = 12397;
  t.nekatakana = 12493;
  t.nekatakanahalfwidth = 65416;
  t.newsheqelsign = 8362;
  t.nfsquare = 13195;
  t.ngabengali = 2457;
  t.ngadeva = 2329;
  t.ngagujarati = 2713;
  t.ngagurmukhi = 2585;
  t.ngonguthai = 3591;
  t.nhiragana = 12435;
  t.nhookleft = 626;
  t.nhookretroflex = 627;
  t.nieunacirclekorean = 12911;
  t.nieunaparenkorean = 12815;
  t.nieuncieuckorean = 12597;
  t.nieuncirclekorean = 12897;
  t.nieunhieuhkorean = 12598;
  t.nieunkorean = 12596;
  t.nieunpansioskorean = 12648;
  t.nieunparenkorean = 12801;
  t.nieunsioskorean = 12647;
  t.nieuntikeutkorean = 12646;
  t.nihiragana = 12395;
  t.nikatakana = 12491;
  t.nikatakanahalfwidth = 65414;
  t.nikhahitleftthai = 63641;
  t.nikhahitthai = 3661;
  t.nine = 57;
  t.ninearabic = 1641;
  t.ninebengali = 2543;
  t.ninecircle = 9320;
  t.ninecircleinversesansserif = 10130;
  t.ninedeva = 2415;
  t.ninegujarati = 2799;
  t.ninegurmukhi = 2671;
  t.ninehackarabic = 1641;
  t.ninehangzhou = 12329;
  t.nineideographicparen = 12840;
  t.nineinferior = 8329;
  t.ninemonospace = 65305;
  t.nineoldstyle = 63289;
  t.nineparen = 9340;
  t.nineperiod = 9360;
  t.ninepersian = 1785;
  t.nineroman = 8568;
  t.ninesuperior = 8313;
  t.nineteencircle = 9330;
  t.nineteenparen = 9350;
  t.nineteenperiod = 9370;
  t.ninethai = 3673;
  t.nj = 460;
  t.njecyrillic = 1114;
  t.nkatakana = 12531;
  t.nkatakanahalfwidth = 65437;
  t.nlegrightlong = 414;
  t.nlinebelow = 7753;
  t.nmonospace = 65358;
  t.nmsquare = 13210;
  t.nnabengali = 2467;
  t.nnadeva = 2339;
  t.nnagujarati = 2723;
  t.nnagurmukhi = 2595;
  t.nnnadeva = 2345;
  t.nohiragana = 12398;
  t.nokatakana = 12494;
  t.nokatakanahalfwidth = 65417;
  t.nonbreakingspace = 160;
  t.nonenthai = 3603;
  t.nonuthai = 3609;
  t.noonarabic = 1606;
  t.noonfinalarabic = 65254;
  t.noonghunnaarabic = 1722;
  t.noonghunnafinalarabic = 64415;
  t.nooninitialarabic = 65255;
  t.noonjeeminitialarabic = 64722;
  t.noonjeemisolatedarabic = 64587;
  t.noonmedialarabic = 65256;
  t.noonmeeminitialarabic = 64725;
  t.noonmeemisolatedarabic = 64590;
  t.noonnoonfinalarabic = 64653;
  t.notcontains = 8716;
  t.notelement = 8713;
  t.notelementof = 8713;
  t.notequal = 8800;
  t.notgreater = 8815;
  t.notgreaternorequal = 8817;
  t.notgreaternorless = 8825;
  t.notidentical = 8802;
  t.notless = 8814;
  t.notlessnorequal = 8816;
  t.notparallel = 8742;
  t.notprecedes = 8832;
  t.notsubset = 8836;
  t.notsucceeds = 8833;
  t.notsuperset = 8837;
  t.nowarmenian = 1398;
  t.nparen = 9385;
  t.nssquare = 13233;
  t.nsuperior = 8319;
  t.ntilde = 241;
  t.nu = 957;
  t.nuhiragana = 12396;
  t.nukatakana = 12492;
  t.nukatakanahalfwidth = 65415;
  t.nuktabengali = 2492;
  t.nuktadeva = 2364;
  t.nuktagujarati = 2748;
  t.nuktagurmukhi = 2620;
  t.numbersign = 35;
  t.numbersignmonospace = 65283;
  t.numbersignsmall = 65119;
  t.numeralsigngreek = 884;
  t.numeralsignlowergreek = 885;
  t.numero = 8470;
  t.nun = 1504;
  t.nundagesh = 64320;
  t.nundageshhebrew = 64320;
  t.nunhebrew = 1504;
  t.nvsquare = 13237;
  t.nwsquare = 13243;
  t.nyabengali = 2462;
  t.nyadeva = 2334;
  t.nyagujarati = 2718;
  t.nyagurmukhi = 2590;
  t.o = 111;
  t.oacute = 243;
  t.oangthai = 3629;
  t.obarred = 629;
  t.obarredcyrillic = 1257;
  t.obarreddieresiscyrillic = 1259;
  t.obengali = 2451;
  t.obopomofo = 12571;
  t.obreve = 335;
  t.ocandradeva = 2321;
  t.ocandragujarati = 2705;
  t.ocandravowelsigndeva = 2377;
  t.ocandravowelsigngujarati = 2761;
  t.ocaron = 466;
  t.ocircle = 9438;
  t.ocircumflex = 244;
  t.ocircumflexacute = 7889;
  t.ocircumflexdotbelow = 7897;
  t.ocircumflexgrave = 7891;
  t.ocircumflexhookabove = 7893;
  t.ocircumflextilde = 7895;
  t.ocyrillic = 1086;
  t.odblacute = 337;
  t.odblgrave = 525;
  t.odeva = 2323;
  t.odieresis = 246;
  t.odieresiscyrillic = 1255;
  t.odotbelow = 7885;
  t.oe = 339;
  t.oekorean = 12634;
  t.ogonek = 731;
  t.ogonekcmb = 808;
  t.ograve = 242;
  t.ogujarati = 2707;
  t.oharmenian = 1413;
  t.ohiragana = 12362;
  t.ohookabove = 7887;
  t.ohorn = 417;
  t.ohornacute = 7899;
  t.ohorndotbelow = 7907;
  t.ohorngrave = 7901;
  t.ohornhookabove = 7903;
  t.ohorntilde = 7905;
  t.ohungarumlaut = 337;
  t.oi = 419;
  t.oinvertedbreve = 527;
  t.okatakana = 12458;
  t.okatakanahalfwidth = 65397;
  t.okorean = 12631;
  t.olehebrew = 1451;
  t.omacron = 333;
  t.omacronacute = 7763;
  t.omacrongrave = 7761;
  t.omdeva = 2384;
  t.omega = 969;
  t.omega1 = 982;
  t.omegacyrillic = 1121;
  t.omegalatinclosed = 631;
  t.omegaroundcyrillic = 1147;
  t.omegatitlocyrillic = 1149;
  t.omegatonos = 974;
  t.omgujarati = 2768;
  t.omicron = 959;
  t.omicrontonos = 972;
  t.omonospace = 65359;
  t.one = 49;
  t.onearabic = 1633;
  t.onebengali = 2535;
  t.onecircle = 9312;
  t.onecircleinversesansserif = 10122;
  t.onedeva = 2407;
  t.onedotenleader = 8228;
  t.oneeighth = 8539;
  t.onefitted = 63196;
  t.onegujarati = 2791;
  t.onegurmukhi = 2663;
  t.onehackarabic = 1633;
  t.onehalf = 189;
  t.onehangzhou = 12321;
  t.oneideographicparen = 12832;
  t.oneinferior = 8321;
  t.onemonospace = 65297;
  t.onenumeratorbengali = 2548;
  t.oneoldstyle = 63281;
  t.oneparen = 9332;
  t.oneperiod = 9352;
  t.onepersian = 1777;
  t.onequarter = 188;
  t.oneroman = 8560;
  t.onesuperior = 185;
  t.onethai = 3665;
  t.onethird = 8531;
  t.oogonek = 491;
  t.oogonekmacron = 493;
  t.oogurmukhi = 2579;
  t.oomatragurmukhi = 2635;
  t.oopen = 596;
  t.oparen = 9386;
  t.openbullet = 9702;
  t.option = 8997;
  t.ordfeminine = 170;
  t.ordmasculine = 186;
  t.orthogonal = 8735;
  t.oshortdeva = 2322;
  t.oshortvowelsigndeva = 2378;
  t.oslash = 248;
  t.oslashacute = 511;
  t.osmallhiragana = 12361;
  t.osmallkatakana = 12457;
  t.osmallkatakanahalfwidth = 65387;
  t.ostrokeacute = 511;
  t.osuperior = 63216;
  t.otcyrillic = 1151;
  t.otilde = 245;
  t.otildeacute = 7757;
  t.otildedieresis = 7759;
  t.oubopomofo = 12577;
  t.overline = 8254;
  t.overlinecenterline = 65098;
  t.overlinecmb = 773;
  t.overlinedashed = 65097;
  t.overlinedblwavy = 65100;
  t.overlinewavy = 65099;
  t.overscore = 175;
  t.ovowelsignbengali = 2507;
  t.ovowelsigndeva = 2379;
  t.ovowelsigngujarati = 2763;
  t.p = 112;
  t.paampssquare = 13184;
  t.paasentosquare = 13099;
  t.pabengali = 2474;
  t.pacute = 7765;
  t.padeva = 2346;
  t.pagedown = 8671;
  t.pageup = 8670;
  t.pagujarati = 2730;
  t.pagurmukhi = 2602;
  t.pahiragana = 12401;
  t.paiyannoithai = 3631;
  t.pakatakana = 12497;
  t.palatalizationcyrilliccmb = 1156;
  t.palochkacyrillic = 1216;
  t.pansioskorean = 12671;
  t.paragraph = 182;
  t.parallel = 8741;
  t.parenleft = 40;
  t.parenleftaltonearabic = 64830;
  t.parenleftbt = 63725;
  t.parenleftex = 63724;
  t.parenleftinferior = 8333;
  t.parenleftmonospace = 65288;
  t.parenleftsmall = 65113;
  t.parenleftsuperior = 8317;
  t.parenlefttp = 63723;
  t.parenleftvertical = 65077;
  t.parenright = 41;
  t.parenrightaltonearabic = 64831;
  t.parenrightbt = 63736;
  t.parenrightex = 63735;
  t.parenrightinferior = 8334;
  t.parenrightmonospace = 65289;
  t.parenrightsmall = 65114;
  t.parenrightsuperior = 8318;
  t.parenrighttp = 63734;
  t.parenrightvertical = 65078;
  t.partialdiff = 8706;
  t.paseqhebrew = 1472;
  t.pashtahebrew = 1433;
  t.pasquare = 13225;
  t.patah = 1463;
  t.patah11 = 1463;
  t.patah1d = 1463;
  t.patah2a = 1463;
  t.patahhebrew = 1463;
  t.patahnarrowhebrew = 1463;
  t.patahquarterhebrew = 1463;
  t.patahwidehebrew = 1463;
  t.pazerhebrew = 1441;
  t.pbopomofo = 12550;
  t.pcircle = 9439;
  t.pdotaccent = 7767;
  t.pe = 1508;
  t.pecyrillic = 1087;
  t.pedagesh = 64324;
  t.pedageshhebrew = 64324;
  t.peezisquare = 13115;
  t.pefinaldageshhebrew = 64323;
  t.peharabic = 1662;
  t.peharmenian = 1402;
  t.pehebrew = 1508;
  t.pehfinalarabic = 64343;
  t.pehinitialarabic = 64344;
  t.pehiragana = 12410;
  t.pehmedialarabic = 64345;
  t.pekatakana = 12506;
  t.pemiddlehookcyrillic = 1191;
  t.perafehebrew = 64334;
  t.percent = 37;
  t.percentarabic = 1642;
  t.percentmonospace = 65285;
  t.percentsmall = 65130;
  t.period = 46;
  t.periodarmenian = 1417;
  t.periodcentered = 183;
  t.periodhalfwidth = 65377;
  t.periodinferior = 63207;
  t.periodmonospace = 65294;
  t.periodsmall = 65106;
  t.periodsuperior = 63208;
  t.perispomenigreekcmb = 834;
  t.perpendicular = 8869;
  t.perthousand = 8240;
  t.peseta = 8359;
  t.pfsquare = 13194;
  t.phabengali = 2475;
  t.phadeva = 2347;
  t.phagujarati = 2731;
  t.phagurmukhi = 2603;
  t.phi = 966;
  t.phi1 = 981;
  t.phieuphacirclekorean = 12922;
  t.phieuphaparenkorean = 12826;
  t.phieuphcirclekorean = 12908;
  t.phieuphkorean = 12621;
  t.phieuphparenkorean = 12812;
  t.philatin = 632;
  t.phinthuthai = 3642;
  t.phisymbolgreek = 981;
  t.phook = 421;
  t.phophanthai = 3614;
  t.phophungthai = 3612;
  t.phosamphaothai = 3616;
  t.pi = 960;
  t.pieupacirclekorean = 12915;
  t.pieupaparenkorean = 12819;
  t.pieupcieuckorean = 12662;
  t.pieupcirclekorean = 12901;
  t.pieupkiyeokkorean = 12658;
  t.pieupkorean = 12610;
  t.pieupparenkorean = 12805;
  t.pieupsioskiyeokkorean = 12660;
  t.pieupsioskorean = 12612;
  t.pieupsiostikeutkorean = 12661;
  t.pieupthieuthkorean = 12663;
  t.pieuptikeutkorean = 12659;
  t.pihiragana = 12404;
  t.pikatakana = 12500;
  t.pisymbolgreek = 982;
  t.piwrarmenian = 1411;
  t.planckover2pi = 8463;
  t.planckover2pi1 = 8463;
  t.plus = 43;
  t.plusbelowcmb = 799;
  t.pluscircle = 8853;
  t.plusminus = 177;
  t.plusmod = 726;
  t.plusmonospace = 65291;
  t.plussmall = 65122;
  t.plussuperior = 8314;
  t.pmonospace = 65360;
  t.pmsquare = 13272;
  t.pohiragana = 12413;
  t.pointingindexdownwhite = 9759;
  t.pointingindexleftwhite = 9756;
  t.pointingindexrightwhite = 9758;
  t.pointingindexupwhite = 9757;
  t.pokatakana = 12509;
  t.poplathai = 3611;
  t.postalmark = 12306;
  t.postalmarkface = 12320;
  t.pparen = 9387;
  t.precedes = 8826;
  t.prescription = 8478;
  t.primemod = 697;
  t.primereversed = 8245;
  t.product = 8719;
  t.projective = 8965;
  t.prolongedkana = 12540;
  t.propellor = 8984;
  t.propersubset = 8834;
  t.propersuperset = 8835;
  t.proportion = 8759;
  t.proportional = 8733;
  t.psi = 968;
  t.psicyrillic = 1137;
  t.psilipneumatacyrilliccmb = 1158;
  t.pssquare = 13232;
  t.puhiragana = 12407;
  t.pukatakana = 12503;
  t.pvsquare = 13236;
  t.pwsquare = 13242;
  t.q = 113;
  t.qadeva = 2392;
  t.qadmahebrew = 1448;
  t.qafarabic = 1602;
  t.qaffinalarabic = 65238;
  t.qafinitialarabic = 65239;
  t.qafmedialarabic = 65240;
  t.qamats = 1464;
  t.qamats10 = 1464;
  t.qamats1a = 1464;
  t.qamats1c = 1464;
  t.qamats27 = 1464;
  t.qamats29 = 1464;
  t.qamats33 = 1464;
  t.qamatsde = 1464;
  t.qamatshebrew = 1464;
  t.qamatsnarrowhebrew = 1464;
  t.qamatsqatanhebrew = 1464;
  t.qamatsqatannarrowhebrew = 1464;
  t.qamatsqatanquarterhebrew = 1464;
  t.qamatsqatanwidehebrew = 1464;
  t.qamatsquarterhebrew = 1464;
  t.qamatswidehebrew = 1464;
  t.qarneyparahebrew = 1439;
  t.qbopomofo = 12561;
  t.qcircle = 9440;
  t.qhook = 672;
  t.qmonospace = 65361;
  t.qof = 1511;
  t.qofdagesh = 64327;
  t.qofdageshhebrew = 64327;
  t.qofhebrew = 1511;
  t.qparen = 9388;
  t.quarternote = 9833;
  t.qubuts = 1467;
  t.qubuts18 = 1467;
  t.qubuts25 = 1467;
  t.qubuts31 = 1467;
  t.qubutshebrew = 1467;
  t.qubutsnarrowhebrew = 1467;
  t.qubutsquarterhebrew = 1467;
  t.qubutswidehebrew = 1467;
  t.question = 63;
  t.questionarabic = 1567;
  t.questionarmenian = 1374;
  t.questiondown = 191;
  t.questiondownsmall = 63423;
  t.questiongreek = 894;
  t.questionmonospace = 65311;
  t.questionsmall = 63295;
  t.quotedbl = 34;
  t.quotedblbase = 8222;
  t.quotedblleft = 8220;
  t.quotedblmonospace = 65282;
  t.quotedblprime = 12318;
  t.quotedblprimereversed = 12317;
  t.quotedblright = 8221;
  t.quoteleft = 8216;
  t.quoteleftreversed = 8219;
  t.quotereversed = 8219;
  t.quoteright = 8217;
  t.quoterightn = 329;
  t.quotesinglbase = 8218;
  t.quotesingle = 39;
  t.quotesinglemonospace = 65287;
  t.r = 114;
  t.raarmenian = 1404;
  t.rabengali = 2480;
  t.racute = 341;
  t.radeva = 2352;
  t.radical = 8730;
  t.radicalex = 63717;
  t.radoverssquare = 13230;
  t.radoverssquaredsquare = 13231;
  t.radsquare = 13229;
  t.rafe = 1471;
  t.rafehebrew = 1471;
  t.ragujarati = 2736;
  t.ragurmukhi = 2608;
  t.rahiragana = 12425;
  t.rakatakana = 12521;
  t.rakatakanahalfwidth = 65431;
  t.ralowerdiagonalbengali = 2545;
  t.ramiddlediagonalbengali = 2544;
  t.ramshorn = 612;
  t.ratio = 8758;
  t.rbopomofo = 12566;
  t.rcaron = 345;
  t.rcedilla = 343;
  t.rcircle = 9441;
  t.rcommaaccent = 343;
  t.rdblgrave = 529;
  t.rdotaccent = 7769;
  t.rdotbelow = 7771;
  t.rdotbelowmacron = 7773;
  t.referencemark = 8251;
  t.reflexsubset = 8838;
  t.reflexsuperset = 8839;
  t.registered = 174;
  t.registersans = 63720;
  t.registerserif = 63194;
  t.reharabic = 1585;
  t.reharmenian = 1408;
  t.rehfinalarabic = 65198;
  t.rehiragana = 12428;
  t.rekatakana = 12524;
  t.rekatakanahalfwidth = 65434;
  t.resh = 1512;
  t.reshdageshhebrew = 64328;
  t.reshhebrew = 1512;
  t.reversedtilde = 8765;
  t.reviahebrew = 1431;
  t.reviamugrashhebrew = 1431;
  t.revlogicalnot = 8976;
  t.rfishhook = 638;
  t.rfishhookreversed = 639;
  t.rhabengali = 2525;
  t.rhadeva = 2397;
  t.rho = 961;
  t.rhook = 637;
  t.rhookturned = 635;
  t.rhookturnedsuperior = 693;
  t.rhosymbolgreek = 1009;
  t.rhotichookmod = 734;
  t.rieulacirclekorean = 12913;
  t.rieulaparenkorean = 12817;
  t.rieulcirclekorean = 12899;
  t.rieulhieuhkorean = 12608;
  t.rieulkiyeokkorean = 12602;
  t.rieulkiyeoksioskorean = 12649;
  t.rieulkorean = 12601;
  t.rieulmieumkorean = 12603;
  t.rieulpansioskorean = 12652;
  t.rieulparenkorean = 12803;
  t.rieulphieuphkorean = 12607;
  t.rieulpieupkorean = 12604;
  t.rieulpieupsioskorean = 12651;
  t.rieulsioskorean = 12605;
  t.rieulthieuthkorean = 12606;
  t.rieultikeutkorean = 12650;
  t.rieulyeorinhieuhkorean = 12653;
  t.rightangle = 8735;
  t.righttackbelowcmb = 793;
  t.righttriangle = 8895;
  t.rihiragana = 12426;
  t.rikatakana = 12522;
  t.rikatakanahalfwidth = 65432;
  t.ring = 730;
  t.ringbelowcmb = 805;
  t.ringcmb = 778;
  t.ringhalfleft = 703;
  t.ringhalfleftarmenian = 1369;
  t.ringhalfleftbelowcmb = 796;
  t.ringhalfleftcentered = 723;
  t.ringhalfright = 702;
  t.ringhalfrightbelowcmb = 825;
  t.ringhalfrightcentered = 722;
  t.rinvertedbreve = 531;
  t.rittorusquare = 13137;
  t.rlinebelow = 7775;
  t.rlongleg = 636;
  t.rlonglegturned = 634;
  t.rmonospace = 65362;
  t.rohiragana = 12429;
  t.rokatakana = 12525;
  t.rokatakanahalfwidth = 65435;
  t.roruathai = 3619;
  t.rparen = 9389;
  t.rrabengali = 2524;
  t.rradeva = 2353;
  t.rragurmukhi = 2652;
  t.rreharabic = 1681;
  t.rrehfinalarabic = 64397;
  t.rrvocalicbengali = 2528;
  t.rrvocalicdeva = 2400;
  t.rrvocalicgujarati = 2784;
  t.rrvocalicvowelsignbengali = 2500;
  t.rrvocalicvowelsigndeva = 2372;
  t.rrvocalicvowelsigngujarati = 2756;
  t.rsuperior = 63217;
  t.rtblock = 9616;
  t.rturned = 633;
  t.rturnedsuperior = 692;
  t.ruhiragana = 12427;
  t.rukatakana = 12523;
  t.rukatakanahalfwidth = 65433;
  t.rupeemarkbengali = 2546;
  t.rupeesignbengali = 2547;
  t.rupiah = 63197;
  t.ruthai = 3620;
  t.rvocalicbengali = 2443;
  t.rvocalicdeva = 2315;
  t.rvocalicgujarati = 2699;
  t.rvocalicvowelsignbengali = 2499;
  t.rvocalicvowelsigndeva = 2371;
  t.rvocalicvowelsigngujarati = 2755;
  t.s = 115;
  t.sabengali = 2488;
  t.sacute = 347;
  t.sacutedotaccent = 7781;
  t.sadarabic = 1589;
  t.sadeva = 2360;
  t.sadfinalarabic = 65210;
  t.sadinitialarabic = 65211;
  t.sadmedialarabic = 65212;
  t.sagujarati = 2744;
  t.sagurmukhi = 2616;
  t.sahiragana = 12373;
  t.sakatakana = 12469;
  t.sakatakanahalfwidth = 65403;
  t.sallallahoualayhewasallamarabic = 65018;
  t.samekh = 1505;
  t.samekhdagesh = 64321;
  t.samekhdageshhebrew = 64321;
  t.samekhhebrew = 1505;
  t.saraaathai = 3634;
  t.saraaethai = 3649;
  t.saraaimaimalaithai = 3652;
  t.saraaimaimuanthai = 3651;
  t.saraamthai = 3635;
  t.saraathai = 3632;
  t.saraethai = 3648;
  t.saraiileftthai = 63622;
  t.saraiithai = 3637;
  t.saraileftthai = 63621;
  t.saraithai = 3636;
  t.saraothai = 3650;
  t.saraueeleftthai = 63624;
  t.saraueethai = 3639;
  t.saraueleftthai = 63623;
  t.sarauethai = 3638;
  t.sarauthai = 3640;
  t.sarauuthai = 3641;
  t.sbopomofo = 12569;
  t.scaron = 353;
  t.scarondotaccent = 7783;
  t.scedilla = 351;
  t.schwa = 601;
  t.schwacyrillic = 1241;
  t.schwadieresiscyrillic = 1243;
  t.schwahook = 602;
  t.scircle = 9442;
  t.scircumflex = 349;
  t.scommaaccent = 537;
  t.sdotaccent = 7777;
  t.sdotbelow = 7779;
  t.sdotbelowdotaccent = 7785;
  t.seagullbelowcmb = 828;
  t.second = 8243;
  t.secondtonechinese = 714;
  t.section = 167;
  t.seenarabic = 1587;
  t.seenfinalarabic = 65202;
  t.seeninitialarabic = 65203;
  t.seenmedialarabic = 65204;
  t.segol = 1462;
  t.segol13 = 1462;
  t.segol1f = 1462;
  t.segol2c = 1462;
  t.segolhebrew = 1462;
  t.segolnarrowhebrew = 1462;
  t.segolquarterhebrew = 1462;
  t.segoltahebrew = 1426;
  t.segolwidehebrew = 1462;
  t.seharmenian = 1405;
  t.sehiragana = 12379;
  t.sekatakana = 12475;
  t.sekatakanahalfwidth = 65406;
  t.semicolon = 59;
  t.semicolonarabic = 1563;
  t.semicolonmonospace = 65307;
  t.semicolonsmall = 65108;
  t.semivoicedmarkkana = 12444;
  t.semivoicedmarkkanahalfwidth = 65439;
  t.sentisquare = 13090;
  t.sentosquare = 13091;
  t.seven = 55;
  t.sevenarabic = 1639;
  t.sevenbengali = 2541;
  t.sevencircle = 9318;
  t.sevencircleinversesansserif = 10128;
  t.sevendeva = 2413;
  t.seveneighths = 8542;
  t.sevengujarati = 2797;
  t.sevengurmukhi = 2669;
  t.sevenhackarabic = 1639;
  t.sevenhangzhou = 12327;
  t.sevenideographicparen = 12838;
  t.seveninferior = 8327;
  t.sevenmonospace = 65303;
  t.sevenoldstyle = 63287;
  t.sevenparen = 9338;
  t.sevenperiod = 9358;
  t.sevenpersian = 1783;
  t.sevenroman = 8566;
  t.sevensuperior = 8311;
  t.seventeencircle = 9328;
  t.seventeenparen = 9348;
  t.seventeenperiod = 9368;
  t.seventhai = 3671;
  t.sfthyphen = 173;
  t.shaarmenian = 1399;
  t.shabengali = 2486;
  t.shacyrillic = 1096;
  t.shaddaarabic = 1617;
  t.shaddadammaarabic = 64609;
  t.shaddadammatanarabic = 64606;
  t.shaddafathaarabic = 64608;
  t.shaddakasraarabic = 64610;
  t.shaddakasratanarabic = 64607;
  t.shade = 9618;
  t.shadedark = 9619;
  t.shadelight = 9617;
  t.shademedium = 9618;
  t.shadeva = 2358;
  t.shagujarati = 2742;
  t.shagurmukhi = 2614;
  t.shalshelethebrew = 1427;
  t.shbopomofo = 12565;
  t.shchacyrillic = 1097;
  t.sheenarabic = 1588;
  t.sheenfinalarabic = 65206;
  t.sheeninitialarabic = 65207;
  t.sheenmedialarabic = 65208;
  t.sheicoptic = 995;
  t.sheqel = 8362;
  t.sheqelhebrew = 8362;
  t.sheva = 1456;
  t.sheva115 = 1456;
  t.sheva15 = 1456;
  t.sheva22 = 1456;
  t.sheva2e = 1456;
  t.shevahebrew = 1456;
  t.shevanarrowhebrew = 1456;
  t.shevaquarterhebrew = 1456;
  t.shevawidehebrew = 1456;
  t.shhacyrillic = 1211;
  t.shimacoptic = 1005;
  t.shin = 1513;
  t.shindagesh = 64329;
  t.shindageshhebrew = 64329;
  t.shindageshshindot = 64300;
  t.shindageshshindothebrew = 64300;
  t.shindageshsindot = 64301;
  t.shindageshsindothebrew = 64301;
  t.shindothebrew = 1473;
  t.shinhebrew = 1513;
  t.shinshindot = 64298;
  t.shinshindothebrew = 64298;
  t.shinsindot = 64299;
  t.shinsindothebrew = 64299;
  t.shook = 642;
  t.sigma = 963;
  t.sigma1 = 962;
  t.sigmafinal = 962;
  t.sigmalunatesymbolgreek = 1010;
  t.sihiragana = 12375;
  t.sikatakana = 12471;
  t.sikatakanahalfwidth = 65404;
  t.siluqhebrew = 1469;
  t.siluqlefthebrew = 1469;
  t.similar = 8764;
  t.sindothebrew = 1474;
  t.siosacirclekorean = 12916;
  t.siosaparenkorean = 12820;
  t.sioscieuckorean = 12670;
  t.sioscirclekorean = 12902;
  t.sioskiyeokkorean = 12666;
  t.sioskorean = 12613;
  t.siosnieunkorean = 12667;
  t.siosparenkorean = 12806;
  t.siospieupkorean = 12669;
  t.siostikeutkorean = 12668;
  t.six = 54;
  t.sixarabic = 1638;
  t.sixbengali = 2540;
  t.sixcircle = 9317;
  t.sixcircleinversesansserif = 10127;
  t.sixdeva = 2412;
  t.sixgujarati = 2796;
  t.sixgurmukhi = 2668;
  t.sixhackarabic = 1638;
  t.sixhangzhou = 12326;
  t.sixideographicparen = 12837;
  t.sixinferior = 8326;
  t.sixmonospace = 65302;
  t.sixoldstyle = 63286;
  t.sixparen = 9337;
  t.sixperiod = 9357;
  t.sixpersian = 1782;
  t.sixroman = 8565;
  t.sixsuperior = 8310;
  t.sixteencircle = 9327;
  t.sixteencurrencydenominatorbengali = 2553;
  t.sixteenparen = 9347;
  t.sixteenperiod = 9367;
  t.sixthai = 3670;
  t.slash = 47;
  t.slashmonospace = 65295;
  t.slong = 383;
  t.slongdotaccent = 7835;
  t.smileface = 9786;
  t.smonospace = 65363;
  t.sofpasuqhebrew = 1475;
  t.softhyphen = 173;
  t.softsigncyrillic = 1100;
  t.sohiragana = 12381;
  t.sokatakana = 12477;
  t.sokatakanahalfwidth = 65407;
  t.soliduslongoverlaycmb = 824;
  t.solidusshortoverlaycmb = 823;
  t.sorusithai = 3625;
  t.sosalathai = 3624;
  t.sosothai = 3595;
  t.sosuathai = 3626;
  t.space = 32;
  t.spacehackarabic = 32;
  t.spade = 9824;
  t.spadesuitblack = 9824;
  t.spadesuitwhite = 9828;
  t.sparen = 9390;
  t.squarebelowcmb = 827;
  t.squarecc = 13252;
  t.squarecm = 13213;
  t.squarediagonalcrosshatchfill = 9641;
  t.squarehorizontalfill = 9636;
  t.squarekg = 13199;
  t.squarekm = 13214;
  t.squarekmcapital = 13262;
  t.squareln = 13265;
  t.squarelog = 13266;
  t.squaremg = 13198;
  t.squaremil = 13269;
  t.squaremm = 13212;
  t.squaremsquared = 13217;
  t.squareorthogonalcrosshatchfill = 9638;
  t.squareupperlefttolowerrightfill = 9639;
  t.squareupperrighttolowerleftfill = 9640;
  t.squareverticalfill = 9637;
  t.squarewhitewithsmallblack = 9635;
  t.srsquare = 13275;
  t.ssabengali = 2487;
  t.ssadeva = 2359;
  t.ssagujarati = 2743;
  t.ssangcieuckorean = 12617;
  t.ssanghieuhkorean = 12677;
  t.ssangieungkorean = 12672;
  t.ssangkiyeokkorean = 12594;
  t.ssangnieunkorean = 12645;
  t.ssangpieupkorean = 12611;
  t.ssangsioskorean = 12614;
  t.ssangtikeutkorean = 12600;
  t.ssuperior = 63218;
  t.sterling = 163;
  t.sterlingmonospace = 65505;
  t.strokelongoverlaycmb = 822;
  t.strokeshortoverlaycmb = 821;
  t.subset = 8834;
  t.subsetnotequal = 8842;
  t.subsetorequal = 8838;
  t.succeeds = 8827;
  t.suchthat = 8715;
  t.suhiragana = 12377;
  t.sukatakana = 12473;
  t.sukatakanahalfwidth = 65405;
  t.sukunarabic = 1618;
  t.summation = 8721;
  t.sun = 9788;
  t.superset = 8835;
  t.supersetnotequal = 8843;
  t.supersetorequal = 8839;
  t.svsquare = 13276;
  t.syouwaerasquare = 13180;
  t.t = 116;
  t.tabengali = 2468;
  t.tackdown = 8868;
  t.tackleft = 8867;
  t.tadeva = 2340;
  t.tagujarati = 2724;
  t.tagurmukhi = 2596;
  t.taharabic = 1591;
  t.tahfinalarabic = 65218;
  t.tahinitialarabic = 65219;
  t.tahiragana = 12383;
  t.tahmedialarabic = 65220;
  t.taisyouerasquare = 13181;
  t.takatakana = 12479;
  t.takatakanahalfwidth = 65408;
  t.tatweelarabic = 1600;
  t.tau = 964;
  t.tav = 1514;
  t.tavdages = 64330;
  t.tavdagesh = 64330;
  t.tavdageshhebrew = 64330;
  t.tavhebrew = 1514;
  t.tbar = 359;
  t.tbopomofo = 12554;
  t.tcaron = 357;
  t.tccurl = 680;
  t.tcedilla = 355;
  t.tcheharabic = 1670;
  t.tchehfinalarabic = 64379;
  t.tchehinitialarabic = 64380;
  t.tchehmedialarabic = 64381;
  t.tcircle = 9443;
  t.tcircumflexbelow = 7793;
  t.tcommaaccent = 355;
  t.tdieresis = 7831;
  t.tdotaccent = 7787;
  t.tdotbelow = 7789;
  t.tecyrillic = 1090;
  t.tedescendercyrillic = 1197;
  t.teharabic = 1578;
  t.tehfinalarabic = 65174;
  t.tehhahinitialarabic = 64674;
  t.tehhahisolatedarabic = 64524;
  t.tehinitialarabic = 65175;
  t.tehiragana = 12390;
  t.tehjeeminitialarabic = 64673;
  t.tehjeemisolatedarabic = 64523;
  t.tehmarbutaarabic = 1577;
  t.tehmarbutafinalarabic = 65172;
  t.tehmedialarabic = 65176;
  t.tehmeeminitialarabic = 64676;
  t.tehmeemisolatedarabic = 64526;
  t.tehnoonfinalarabic = 64627;
  t.tekatakana = 12486;
  t.tekatakanahalfwidth = 65411;
  t.telephone = 8481;
  t.telephoneblack = 9742;
  t.telishagedolahebrew = 1440;
  t.telishaqetanahebrew = 1449;
  t.tencircle = 9321;
  t.tenideographicparen = 12841;
  t.tenparen = 9341;
  t.tenperiod = 9361;
  t.tenroman = 8569;
  t.tesh = 679;
  t.tet = 1496;
  t.tetdagesh = 64312;
  t.tetdageshhebrew = 64312;
  t.tethebrew = 1496;
  t.tetsecyrillic = 1205;
  t.tevirhebrew = 1435;
  t.tevirlefthebrew = 1435;
  t.thabengali = 2469;
  t.thadeva = 2341;
  t.thagujarati = 2725;
  t.thagurmukhi = 2597;
  t.thalarabic = 1584;
  t.thalfinalarabic = 65196;
  t.thanthakhatlowleftthai = 63640;
  t.thanthakhatlowrightthai = 63639;
  t.thanthakhatthai = 3660;
  t.thanthakhatupperleftthai = 63638;
  t.theharabic = 1579;
  t.thehfinalarabic = 65178;
  t.thehinitialarabic = 65179;
  t.thehmedialarabic = 65180;
  t.thereexists = 8707;
  t.therefore = 8756;
  t.theta = 952;
  t.theta1 = 977;
  t.thetasymbolgreek = 977;
  t.thieuthacirclekorean = 12921;
  t.thieuthaparenkorean = 12825;
  t.thieuthcirclekorean = 12907;
  t.thieuthkorean = 12620;
  t.thieuthparenkorean = 12811;
  t.thirteencircle = 9324;
  t.thirteenparen = 9344;
  t.thirteenperiod = 9364;
  t.thonangmonthothai = 3601;
  t.thook = 429;
  t.thophuthaothai = 3602;
  t.thorn = 254;
  t.thothahanthai = 3607;
  t.thothanthai = 3600;
  t.thothongthai = 3608;
  t.thothungthai = 3606;
  t.thousandcyrillic = 1154;
  t.thousandsseparatorarabic = 1644;
  t.thousandsseparatorpersian = 1644;
  t.three = 51;
  t.threearabic = 1635;
  t.threebengali = 2537;
  t.threecircle = 9314;
  t.threecircleinversesansserif = 10124;
  t.threedeva = 2409;
  t.threeeighths = 8540;
  t.threegujarati = 2793;
  t.threegurmukhi = 2665;
  t.threehackarabic = 1635;
  t.threehangzhou = 12323;
  t.threeideographicparen = 12834;
  t.threeinferior = 8323;
  t.threemonospace = 65299;
  t.threenumeratorbengali = 2550;
  t.threeoldstyle = 63283;
  t.threeparen = 9334;
  t.threeperiod = 9354;
  t.threepersian = 1779;
  t.threequarters = 190;
  t.threequartersemdash = 63198;
  t.threeroman = 8562;
  t.threesuperior = 179;
  t.threethai = 3667;
  t.thzsquare = 13204;
  t.tihiragana = 12385;
  t.tikatakana = 12481;
  t.tikatakanahalfwidth = 65409;
  t.tikeutacirclekorean = 12912;
  t.tikeutaparenkorean = 12816;
  t.tikeutcirclekorean = 12898;
  t.tikeutkorean = 12599;
  t.tikeutparenkorean = 12802;
  t.tilde = 732;
  t.tildebelowcmb = 816;
  t.tildecmb = 771;
  t.tildecomb = 771;
  t.tildedoublecmb = 864;
  t.tildeoperator = 8764;
  t.tildeoverlaycmb = 820;
  t.tildeverticalcmb = 830;
  t.timescircle = 8855;
  t.tipehahebrew = 1430;
  t.tipehalefthebrew = 1430;
  t.tippigurmukhi = 2672;
  t.titlocyrilliccmb = 1155;
  t.tiwnarmenian = 1407;
  t.tlinebelow = 7791;
  t.tmonospace = 65364;
  t.toarmenian = 1385;
  t.tohiragana = 12392;
  t.tokatakana = 12488;
  t.tokatakanahalfwidth = 65412;
  t.tonebarextrahighmod = 741;
  t.tonebarextralowmod = 745;
  t.tonebarhighmod = 742;
  t.tonebarlowmod = 744;
  t.tonebarmidmod = 743;
  t.tonefive = 445;
  t.tonesix = 389;
  t.tonetwo = 424;
  t.tonos = 900;
  t.tonsquare = 13095;
  t.topatakthai = 3599;
  t.tortoiseshellbracketleft = 12308;
  t.tortoiseshellbracketleftsmall = 65117;
  t.tortoiseshellbracketleftvertical = 65081;
  t.tortoiseshellbracketright = 12309;
  t.tortoiseshellbracketrightsmall = 65118;
  t.tortoiseshellbracketrightvertical = 65082;
  t.totaothai = 3605;
  t.tpalatalhook = 427;
  t.tparen = 9391;
  t.trademark = 8482;
  t.trademarksans = 63722;
  t.trademarkserif = 63195;
  t.tretroflexhook = 648;
  t.triagdn = 9660;
  t.triaglf = 9668;
  t.triagrt = 9658;
  t.triagup = 9650;
  t.ts = 678;
  t.tsadi = 1510;
  t.tsadidagesh = 64326;
  t.tsadidageshhebrew = 64326;
  t.tsadihebrew = 1510;
  t.tsecyrillic = 1094;
  t.tsere = 1461;
  t.tsere12 = 1461;
  t.tsere1e = 1461;
  t.tsere2b = 1461;
  t.tserehebrew = 1461;
  t.tserenarrowhebrew = 1461;
  t.tserequarterhebrew = 1461;
  t.tserewidehebrew = 1461;
  t.tshecyrillic = 1115;
  t.tsuperior = 63219;
  t.ttabengali = 2463;
  t.ttadeva = 2335;
  t.ttagujarati = 2719;
  t.ttagurmukhi = 2591;
  t.tteharabic = 1657;
  t.ttehfinalarabic = 64359;
  t.ttehinitialarabic = 64360;
  t.ttehmedialarabic = 64361;
  t.tthabengali = 2464;
  t.tthadeva = 2336;
  t.tthagujarati = 2720;
  t.tthagurmukhi = 2592;
  t.tturned = 647;
  t.tuhiragana = 12388;
  t.tukatakana = 12484;
  t.tukatakanahalfwidth = 65410;
  t.tusmallhiragana = 12387;
  t.tusmallkatakana = 12483;
  t.tusmallkatakanahalfwidth = 65391;
  t.twelvecircle = 9323;
  t.twelveparen = 9343;
  t.twelveperiod = 9363;
  t.twelveroman = 8571;
  t.twentycircle = 9331;
  t.twentyhangzhou = 21316;
  t.twentyparen = 9351;
  t.twentyperiod = 9371;
  t.two = 50;
  t.twoarabic = 1634;
  t.twobengali = 2536;
  t.twocircle = 9313;
  t.twocircleinversesansserif = 10123;
  t.twodeva = 2408;
  t.twodotenleader = 8229;
  t.twodotleader = 8229;
  t.twodotleadervertical = 65072;
  t.twogujarati = 2792;
  t.twogurmukhi = 2664;
  t.twohackarabic = 1634;
  t.twohangzhou = 12322;
  t.twoideographicparen = 12833;
  t.twoinferior = 8322;
  t.twomonospace = 65298;
  t.twonumeratorbengali = 2549;
  t.twooldstyle = 63282;
  t.twoparen = 9333;
  t.twoperiod = 9353;
  t.twopersian = 1778;
  t.tworoman = 8561;
  t.twostroke = 443;
  t.twosuperior = 178;
  t.twothai = 3666;
  t.twothirds = 8532;
  t.u = 117;
  t.uacute = 250;
  t.ubar = 649;
  t.ubengali = 2441;
  t.ubopomofo = 12584;
  t.ubreve = 365;
  t.ucaron = 468;
  t.ucircle = 9444;
  t.ucircumflex = 251;
  t.ucircumflexbelow = 7799;
  t.ucyrillic = 1091;
  t.udattadeva = 2385;
  t.udblacute = 369;
  t.udblgrave = 533;
  t.udeva = 2313;
  t.udieresis = 252;
  t.udieresisacute = 472;
  t.udieresisbelow = 7795;
  t.udieresiscaron = 474;
  t.udieresiscyrillic = 1265;
  t.udieresisgrave = 476;
  t.udieresismacron = 470;
  t.udotbelow = 7909;
  t.ugrave = 249;
  t.ugujarati = 2697;
  t.ugurmukhi = 2569;
  t.uhiragana = 12358;
  t.uhookabove = 7911;
  t.uhorn = 432;
  t.uhornacute = 7913;
  t.uhorndotbelow = 7921;
  t.uhorngrave = 7915;
  t.uhornhookabove = 7917;
  t.uhorntilde = 7919;
  t.uhungarumlaut = 369;
  t.uhungarumlautcyrillic = 1267;
  t.uinvertedbreve = 535;
  t.ukatakana = 12454;
  t.ukatakanahalfwidth = 65395;
  t.ukcyrillic = 1145;
  t.ukorean = 12636;
  t.umacron = 363;
  t.umacroncyrillic = 1263;
  t.umacrondieresis = 7803;
  t.umatragurmukhi = 2625;
  t.umonospace = 65365;
  t.underscore = 95;
  t.underscoredbl = 8215;
  t.underscoremonospace = 65343;
  t.underscorevertical = 65075;
  t.underscorewavy = 65103;
  t.union = 8746;
  t.universal = 8704;
  t.uogonek = 371;
  t.uparen = 9392;
  t.upblock = 9600;
  t.upperdothebrew = 1476;
  t.upsilon = 965;
  t.upsilondieresis = 971;
  t.upsilondieresistonos = 944;
  t.upsilonlatin = 650;
  t.upsilontonos = 973;
  t.uptackbelowcmb = 797;
  t.uptackmod = 724;
  t.uragurmukhi = 2675;
  t.uring = 367;
  t.ushortcyrillic = 1118;
  t.usmallhiragana = 12357;
  t.usmallkatakana = 12453;
  t.usmallkatakanahalfwidth = 65385;
  t.ustraightcyrillic = 1199;
  t.ustraightstrokecyrillic = 1201;
  t.utilde = 361;
  t.utildeacute = 7801;
  t.utildebelow = 7797;
  t.uubengali = 2442;
  t.uudeva = 2314;
  t.uugujarati = 2698;
  t.uugurmukhi = 2570;
  t.uumatragurmukhi = 2626;
  t.uuvowelsignbengali = 2498;
  t.uuvowelsigndeva = 2370;
  t.uuvowelsigngujarati = 2754;
  t.uvowelsignbengali = 2497;
  t.uvowelsigndeva = 2369;
  t.uvowelsigngujarati = 2753;
  t.v = 118;
  t.vadeva = 2357;
  t.vagujarati = 2741;
  t.vagurmukhi = 2613;
  t.vakatakana = 12535;
  t.vav = 1493;
  t.vavdagesh = 64309;
  t.vavdagesh65 = 64309;
  t.vavdageshhebrew = 64309;
  t.vavhebrew = 1493;
  t.vavholam = 64331;
  t.vavholamhebrew = 64331;
  t.vavvavhebrew = 1520;
  t.vavyodhebrew = 1521;
  t.vcircle = 9445;
  t.vdotbelow = 7807;
  t.vecyrillic = 1074;
  t.veharabic = 1700;
  t.vehfinalarabic = 64363;
  t.vehinitialarabic = 64364;
  t.vehmedialarabic = 64365;
  t.vekatakana = 12537;
  t.venus = 9792;
  t.verticalbar = 124;
  t.verticallineabovecmb = 781;
  t.verticallinebelowcmb = 809;
  t.verticallinelowmod = 716;
  t.verticallinemod = 712;
  t.vewarmenian = 1406;
  t.vhook = 651;
  t.vikatakana = 12536;
  t.viramabengali = 2509;
  t.viramadeva = 2381;
  t.viramagujarati = 2765;
  t.visargabengali = 2435;
  t.visargadeva = 2307;
  t.visargagujarati = 2691;
  t.vmonospace = 65366;
  t.voarmenian = 1400;
  t.voicediterationhiragana = 12446;
  t.voicediterationkatakana = 12542;
  t.voicedmarkkana = 12443;
  t.voicedmarkkanahalfwidth = 65438;
  t.vokatakana = 12538;
  t.vparen = 9393;
  t.vtilde = 7805;
  t.vturned = 652;
  t.vuhiragana = 12436;
  t.vukatakana = 12532;
  t.w = 119;
  t.wacute = 7811;
  t.waekorean = 12633;
  t.wahiragana = 12431;
  t.wakatakana = 12527;
  t.wakatakanahalfwidth = 65436;
  t.wakorean = 12632;
  t.wasmallhiragana = 12430;
  t.wasmallkatakana = 12526;
  t.wattosquare = 13143;
  t.wavedash = 12316;
  t.wavyunderscorevertical = 65076;
  t.wawarabic = 1608;
  t.wawfinalarabic = 65262;
  t.wawhamzaabovearabic = 1572;
  t.wawhamzaabovefinalarabic = 65158;
  t.wbsquare = 13277;
  t.wcircle = 9446;
  t.wcircumflex = 373;
  t.wdieresis = 7813;
  t.wdotaccent = 7815;
  t.wdotbelow = 7817;
  t.wehiragana = 12433;
  t.weierstrass = 8472;
  t.wekatakana = 12529;
  t.wekorean = 12638;
  t.weokorean = 12637;
  t.wgrave = 7809;
  t.whitebullet = 9702;
  t.whitecircle = 9675;
  t.whitecircleinverse = 9689;
  t.whitecornerbracketleft = 12302;
  t.whitecornerbracketleftvertical = 65091;
  t.whitecornerbracketright = 12303;
  t.whitecornerbracketrightvertical = 65092;
  t.whitediamond = 9671;
  t.whitediamondcontainingblacksmalldiamond = 9672;
  t.whitedownpointingsmalltriangle = 9663;
  t.whitedownpointingtriangle = 9661;
  t.whiteleftpointingsmalltriangle = 9667;
  t.whiteleftpointingtriangle = 9665;
  t.whitelenticularbracketleft = 12310;
  t.whitelenticularbracketright = 12311;
  t.whiterightpointingsmalltriangle = 9657;
  t.whiterightpointingtriangle = 9655;
  t.whitesmallsquare = 9643;
  t.whitesmilingface = 9786;
  t.whitesquare = 9633;
  t.whitestar = 9734;
  t.whitetelephone = 9743;
  t.whitetortoiseshellbracketleft = 12312;
  t.whitetortoiseshellbracketright = 12313;
  t.whiteuppointingsmalltriangle = 9653;
  t.whiteuppointingtriangle = 9651;
  t.wihiragana = 12432;
  t.wikatakana = 12528;
  t.wikorean = 12639;
  t.wmonospace = 65367;
  t.wohiragana = 12434;
  t.wokatakana = 12530;
  t.wokatakanahalfwidth = 65382;
  t.won = 8361;
  t.wonmonospace = 65510;
  t.wowaenthai = 3623;
  t.wparen = 9394;
  t.wring = 7832;
  t.wsuperior = 695;
  t.wturned = 653;
  t.wynn = 447;
  t.x = 120;
  t.xabovecmb = 829;
  t.xbopomofo = 12562;
  t.xcircle = 9447;
  t.xdieresis = 7821;
  t.xdotaccent = 7819;
  t.xeharmenian = 1389;
  t.xi = 958;
  t.xmonospace = 65368;
  t.xparen = 9395;
  t.xsuperior = 739;
  t.y = 121;
  t.yaadosquare = 13134;
  t.yabengali = 2479;
  t.yacute = 253;
  t.yadeva = 2351;
  t.yaekorean = 12626;
  t.yagujarati = 2735;
  t.yagurmukhi = 2607;
  t.yahiragana = 12420;
  t.yakatakana = 12516;
  t.yakatakanahalfwidth = 65428;
  t.yakorean = 12625;
  t.yamakkanthai = 3662;
  t.yasmallhiragana = 12419;
  t.yasmallkatakana = 12515;
  t.yasmallkatakanahalfwidth = 65388;
  t.yatcyrillic = 1123;
  t.ycircle = 9448;
  t.ycircumflex = 375;
  t.ydieresis = 255;
  t.ydotaccent = 7823;
  t.ydotbelow = 7925;
  t.yeharabic = 1610;
  t.yehbarreearabic = 1746;
  t.yehbarreefinalarabic = 64431;
  t.yehfinalarabic = 65266;
  t.yehhamzaabovearabic = 1574;
  t.yehhamzaabovefinalarabic = 65162;
  t.yehhamzaaboveinitialarabic = 65163;
  t.yehhamzaabovemedialarabic = 65164;
  t.yehinitialarabic = 65267;
  t.yehmedialarabic = 65268;
  t.yehmeeminitialarabic = 64733;
  t.yehmeemisolatedarabic = 64600;
  t.yehnoonfinalarabic = 64660;
  t.yehthreedotsbelowarabic = 1745;
  t.yekorean = 12630;
  t.yen = 165;
  t.yenmonospace = 65509;
  t.yeokorean = 12629;
  t.yeorinhieuhkorean = 12678;
  t.yerahbenyomohebrew = 1450;
  t.yerahbenyomolefthebrew = 1450;
  t.yericyrillic = 1099;
  t.yerudieresiscyrillic = 1273;
  t.yesieungkorean = 12673;
  t.yesieungpansioskorean = 12675;
  t.yesieungsioskorean = 12674;
  t.yetivhebrew = 1434;
  t.ygrave = 7923;
  t.yhook = 436;
  t.yhookabove = 7927;
  t.yiarmenian = 1397;
  t.yicyrillic = 1111;
  t.yikorean = 12642;
  t.yinyang = 9775;
  t.yiwnarmenian = 1410;
  t.ymonospace = 65369;
  t.yod = 1497;
  t.yoddagesh = 64313;
  t.yoddageshhebrew = 64313;
  t.yodhebrew = 1497;
  t.yodyodhebrew = 1522;
  t.yodyodpatahhebrew = 64287;
  t.yohiragana = 12424;
  t.yoikorean = 12681;
  t.yokatakana = 12520;
  t.yokatakanahalfwidth = 65430;
  t.yokorean = 12635;
  t.yosmallhiragana = 12423;
  t.yosmallkatakana = 12519;
  t.yosmallkatakanahalfwidth = 65390;
  t.yotgreek = 1011;
  t.yoyaekorean = 12680;
  t.yoyakorean = 12679;
  t.yoyakthai = 3618;
  t.yoyingthai = 3597;
  t.yparen = 9396;
  t.ypogegrammeni = 890;
  t.ypogegrammenigreekcmb = 837;
  t.yr = 422;
  t.yring = 7833;
  t.ysuperior = 696;
  t.ytilde = 7929;
  t.yturned = 654;
  t.yuhiragana = 12422;
  t.yuikorean = 12684;
  t.yukatakana = 12518;
  t.yukatakanahalfwidth = 65429;
  t.yukorean = 12640;
  t.yusbigcyrillic = 1131;
  t.yusbigiotifiedcyrillic = 1133;
  t.yuslittlecyrillic = 1127;
  t.yuslittleiotifiedcyrillic = 1129;
  t.yusmallhiragana = 12421;
  t.yusmallkatakana = 12517;
  t.yusmallkatakanahalfwidth = 65389;
  t.yuyekorean = 12683;
  t.yuyeokorean = 12682;
  t.yyabengali = 2527;
  t.yyadeva = 2399;
  t.z = 122;
  t.zaarmenian = 1382;
  t.zacute = 378;
  t.zadeva = 2395;
  t.zagurmukhi = 2651;
  t.zaharabic = 1592;
  t.zahfinalarabic = 65222;
  t.zahinitialarabic = 65223;
  t.zahiragana = 12374;
  t.zahmedialarabic = 65224;
  t.zainarabic = 1586;
  t.zainfinalarabic = 65200;
  t.zakatakana = 12470;
  t.zaqefgadolhebrew = 1429;
  t.zaqefqatanhebrew = 1428;
  t.zarqahebrew = 1432;
  t.zayin = 1494;
  t.zayindagesh = 64310;
  t.zayindageshhebrew = 64310;
  t.zayinhebrew = 1494;
  t.zbopomofo = 12567;
  t.zcaron = 382;
  t.zcircle = 9449;
  t.zcircumflex = 7825;
  t.zcurl = 657;
  t.zdot = 380;
  t.zdotaccent = 380;
  t.zdotbelow = 7827;
  t.zecyrillic = 1079;
  t.zedescendercyrillic = 1177;
  t.zedieresiscyrillic = 1247;
  t.zehiragana = 12380;
  t.zekatakana = 12476;
  t.zero = 48;
  t.zeroarabic = 1632;
  t.zerobengali = 2534;
  t.zerodeva = 2406;
  t.zerogujarati = 2790;
  t.zerogurmukhi = 2662;
  t.zerohackarabic = 1632;
  t.zeroinferior = 8320;
  t.zeromonospace = 65296;
  t.zerooldstyle = 63280;
  t.zeropersian = 1776;
  t.zerosuperior = 8304;
  t.zerothai = 3664;
  t.zerowidthjoiner = 65279;
  t.zerowidthnonjoiner = 8204;
  t.zerowidthspace = 8203;
  t.zeta = 950;
  t.zhbopomofo = 12563;
  t.zhearmenian = 1386;
  t.zhebrevecyrillic = 1218;
  t.zhecyrillic = 1078;
  t.zhedescendercyrillic = 1175;
  t.zhedieresiscyrillic = 1245;
  t.zihiragana = 12376;
  t.zikatakana = 12472;
  t.zinorhebrew = 1454;
  t.zlinebelow = 7829;
  t.zmonospace = 65370;
  t.zohiragana = 12382;
  t.zokatakana = 12478;
  t.zparen = 9397;
  t.zretroflexhook = 656;
  t.zstroke = 438;
  t.zuhiragana = 12378;
  t.zukatakana = 12474;
  t[".notdef"] = 0;
  t.angbracketleftbig = 9001;
  t.angbracketleftBig = 9001;
  t.angbracketleftbigg = 9001;
  t.angbracketleftBigg = 9001;
  t.angbracketrightBig = 9002;
  t.angbracketrightbig = 9002;
  t.angbracketrightBigg = 9002;
  t.angbracketrightbigg = 9002;
  t.arrowhookleft = 8618;
  t.arrowhookright = 8617;
  t.arrowlefttophalf = 8636;
  t.arrowleftbothalf = 8637;
  t.arrownortheast = 8599;
  t.arrownorthwest = 8598;
  t.arrowrighttophalf = 8640;
  t.arrowrightbothalf = 8641;
  t.arrowsoutheast = 8600;
  t.arrowsouthwest = 8601;
  t.backslashbig = 8726;
  t.backslashBig = 8726;
  t.backslashBigg = 8726;
  t.backslashbigg = 8726;
  t.bardbl = 8214;
  t.bracehtipdownleft = 65079;
  t.bracehtipdownright = 65079;
  t.bracehtipupleft = 65080;
  t.bracehtipupright = 65080;
  t.braceleftBig = 123;
  t.braceleftbig = 123;
  t.braceleftbigg = 123;
  t.braceleftBigg = 123;
  t.bracerightBig = 125;
  t.bracerightbig = 125;
  t.bracerightbigg = 125;
  t.bracerightBigg = 125;
  t.bracketleftbig = 91;
  t.bracketleftBig = 91;
  t.bracketleftbigg = 91;
  t.bracketleftBigg = 91;
  t.bracketrightBig = 93;
  t.bracketrightbig = 93;
  t.bracketrightbigg = 93;
  t.bracketrightBigg = 93;
  t.ceilingleftbig = 8968;
  t.ceilingleftBig = 8968;
  t.ceilingleftBigg = 8968;
  t.ceilingleftbigg = 8968;
  t.ceilingrightbig = 8969;
  t.ceilingrightBig = 8969;
  t.ceilingrightbigg = 8969;
  t.ceilingrightBigg = 8969;
  t.circledotdisplay = 8857;
  t.circledottext = 8857;
  t.circlemultiplydisplay = 8855;
  t.circlemultiplytext = 8855;
  t.circleplusdisplay = 8853;
  t.circleplustext = 8853;
  t.contintegraldisplay = 8750;
  t.contintegraltext = 8750;
  t.coproductdisplay = 8720;
  t.coproducttext = 8720;
  t.floorleftBig = 8970;
  t.floorleftbig = 8970;
  t.floorleftbigg = 8970;
  t.floorleftBigg = 8970;
  t.floorrightbig = 8971;
  t.floorrightBig = 8971;
  t.floorrightBigg = 8971;
  t.floorrightbigg = 8971;
  t.hatwide = 770;
  t.hatwider = 770;
  t.hatwidest = 770;
  t.intercal = 7488;
  t.integraldisplay = 8747;
  t.integraltext = 8747;
  t.intersectiondisplay = 8898;
  t.intersectiontext = 8898;
  t.logicalanddisplay = 8743;
  t.logicalandtext = 8743;
  t.logicalordisplay = 8744;
  t.logicalortext = 8744;
  t.parenleftBig = 40;
  t.parenleftbig = 40;
  t.parenleftBigg = 40;
  t.parenleftbigg = 40;
  t.parenrightBig = 41;
  t.parenrightbig = 41;
  t.parenrightBigg = 41;
  t.parenrightbigg = 41;
  t.prime = 8242;
  t.productdisplay = 8719;
  t.producttext = 8719;
  t.radicalbig = 8730;
  t.radicalBig = 8730;
  t.radicalBigg = 8730;
  t.radicalbigg = 8730;
  t.radicalbt = 8730;
  t.radicaltp = 8730;
  t.radicalvertex = 8730;
  t.slashbig = 47;
  t.slashBig = 47;
  t.slashBigg = 47;
  t.slashbigg = 47;
  t.summationdisplay = 8721;
  t.summationtext = 8721;
  t.tildewide = 732;
  t.tildewider = 732;
  t.tildewidest = 732;
  t.uniondisplay = 8899;
  t.unionmultidisplay = 8846;
  t.unionmultitext = 8846;
  t.unionsqdisplay = 8852;
  t.unionsqtext = 8852;
  t.uniontext = 8899;
  t.vextenddouble = 8741;
  t.vextendsingle = 8739;
});
var getDingbatsGlyphsUnicode = getLookupTableFactory(function(t) {
  t.space = 32;
  t.a1 = 9985;
  t.a2 = 9986;
  t.a202 = 9987;
  t.a3 = 9988;
  t.a4 = 9742;
  t.a5 = 9990;
  t.a119 = 9991;
  t.a118 = 9992;
  t.a117 = 9993;
  t.a11 = 9755;
  t.a12 = 9758;
  t.a13 = 9996;
  t.a14 = 9997;
  t.a15 = 9998;
  t.a16 = 9999;
  t.a105 = 1e4;
  t.a17 = 10001;
  t.a18 = 10002;
  t.a19 = 10003;
  t.a20 = 10004;
  t.a21 = 10005;
  t.a22 = 10006;
  t.a23 = 10007;
  t.a24 = 10008;
  t.a25 = 10009;
  t.a26 = 10010;
  t.a27 = 10011;
  t.a28 = 10012;
  t.a6 = 10013;
  t.a7 = 10014;
  t.a8 = 10015;
  t.a9 = 10016;
  t.a10 = 10017;
  t.a29 = 10018;
  t.a30 = 10019;
  t.a31 = 10020;
  t.a32 = 10021;
  t.a33 = 10022;
  t.a34 = 10023;
  t.a35 = 9733;
  t.a36 = 10025;
  t.a37 = 10026;
  t.a38 = 10027;
  t.a39 = 10028;
  t.a40 = 10029;
  t.a41 = 10030;
  t.a42 = 10031;
  t.a43 = 10032;
  t.a44 = 10033;
  t.a45 = 10034;
  t.a46 = 10035;
  t.a47 = 10036;
  t.a48 = 10037;
  t.a49 = 10038;
  t.a50 = 10039;
  t.a51 = 10040;
  t.a52 = 10041;
  t.a53 = 10042;
  t.a54 = 10043;
  t.a55 = 10044;
  t.a56 = 10045;
  t.a57 = 10046;
  t.a58 = 10047;
  t.a59 = 10048;
  t.a60 = 10049;
  t.a61 = 10050;
  t.a62 = 10051;
  t.a63 = 10052;
  t.a64 = 10053;
  t.a65 = 10054;
  t.a66 = 10055;
  t.a67 = 10056;
  t.a68 = 10057;
  t.a69 = 10058;
  t.a70 = 10059;
  t.a71 = 9679;
  t.a72 = 10061;
  t.a73 = 9632;
  t.a74 = 10063;
  t.a203 = 10064;
  t.a75 = 10065;
  t.a204 = 10066;
  t.a76 = 9650;
  t.a77 = 9660;
  t.a78 = 9670;
  t.a79 = 10070;
  t.a81 = 9687;
  t.a82 = 10072;
  t.a83 = 10073;
  t.a84 = 10074;
  t.a97 = 10075;
  t.a98 = 10076;
  t.a99 = 10077;
  t.a100 = 10078;
  t.a101 = 10081;
  t.a102 = 10082;
  t.a103 = 10083;
  t.a104 = 10084;
  t.a106 = 10085;
  t.a107 = 10086;
  t.a108 = 10087;
  t.a112 = 9827;
  t.a111 = 9830;
  t.a110 = 9829;
  t.a109 = 9824;
  t.a120 = 9312;
  t.a121 = 9313;
  t.a122 = 9314;
  t.a123 = 9315;
  t.a124 = 9316;
  t.a125 = 9317;
  t.a126 = 9318;
  t.a127 = 9319;
  t.a128 = 9320;
  t.a129 = 9321;
  t.a130 = 10102;
  t.a131 = 10103;
  t.a132 = 10104;
  t.a133 = 10105;
  t.a134 = 10106;
  t.a135 = 10107;
  t.a136 = 10108;
  t.a137 = 10109;
  t.a138 = 10110;
  t.a139 = 10111;
  t.a140 = 10112;
  t.a141 = 10113;
  t.a142 = 10114;
  t.a143 = 10115;
  t.a144 = 10116;
  t.a145 = 10117;
  t.a146 = 10118;
  t.a147 = 10119;
  t.a148 = 10120;
  t.a149 = 10121;
  t.a150 = 10122;
  t.a151 = 10123;
  t.a152 = 10124;
  t.a153 = 10125;
  t.a154 = 10126;
  t.a155 = 10127;
  t.a156 = 10128;
  t.a157 = 10129;
  t.a158 = 10130;
  t.a159 = 10131;
  t.a160 = 10132;
  t.a161 = 8594;
  t.a163 = 8596;
  t.a164 = 8597;
  t.a196 = 10136;
  t.a165 = 10137;
  t.a192 = 10138;
  t.a166 = 10139;
  t.a167 = 10140;
  t.a168 = 10141;
  t.a169 = 10142;
  t.a170 = 10143;
  t.a171 = 10144;
  t.a172 = 10145;
  t.a173 = 10146;
  t.a162 = 10147;
  t.a174 = 10148;
  t.a175 = 10149;
  t.a176 = 10150;
  t.a177 = 10151;
  t.a178 = 10152;
  t.a179 = 10153;
  t.a193 = 10154;
  t.a180 = 10155;
  t.a199 = 10156;
  t.a181 = 10157;
  t.a200 = 10158;
  t.a182 = 10159;
  t.a201 = 10161;
  t.a183 = 10162;
  t.a184 = 10163;
  t.a197 = 10164;
  t.a185 = 10165;
  t.a194 = 10166;
  t.a198 = 10167;
  t.a186 = 10168;
  t.a195 = 10169;
  t.a187 = 10170;
  t.a188 = 10171;
  t.a189 = 10172;
  t.a190 = 10173;
  t.a191 = 10174;
  t.a89 = 10088;
  t.a90 = 10089;
  t.a93 = 10090;
  t.a94 = 10091;
  t.a91 = 10092;
  t.a92 = 10093;
  t.a205 = 10094;
  t.a85 = 10095;
  t.a206 = 10096;
  t.a86 = 10097;
  t.a87 = 10098;
  t.a88 = 10099;
  t.a95 = 10100;
  t.a96 = 10101;
  t[".notdef"] = 0;
});

// src/core/stream.js
var Stream = class _Stream extends BaseStream {
  constructor(arrayBuffer, start, length, dict) {
    super();
    this.bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    this.start = start || 0;
    this.pos = this.start;
    this.end = start + length || this.bytes.length;
    this.dict = dict;
  }
  get length() {
    return this.end - this.start;
  }
  get isEmpty() {
    return this.length === 0;
  }
  getByte() {
    return this.pos >= this.end ? -1 : this.bytes[this.pos++];
  }
  getBytes(length) {
    const pos = this.pos;
    const endPos = !length ? this.end : Math.min(pos + length, this.end);
    this.pos = endPos;
    return this.bytes.subarray(pos, endPos);
  }
  getByteRange(begin, end) {
    if (begin < 0) {
      begin = 0;
    }
    if (end > this.end) {
      end = this.end;
    }
    return this.bytes.subarray(begin, end);
  }
  reset() {
    this.pos = this.start;
  }
  moveStart() {
    this.start = this.pos;
  }
  makeSubStream(start, length, dict = null) {
    return new _Stream(this.bytes.buffer, start, length, dict);
  }
  clone() {
    return new _Stream(
      this.bytes.buffer,
      this.start,
      this.length,
      this.dict?.clone()
    );
  }
};
var StringStream = class extends Stream {
  constructor(str, dict = null) {
    super(stringToBytes(str), NaN, NaN, dict);
  }
};

// src/core/font_renderer.js
function getSubroutineBias(subrs) {
  const numSubrs = subrs.length;
  if (numSubrs >= 33900) {
    return 32768;
  }
  return numSubrs < 1240 ? 107 : 1131;
}
function lookupCmap(ranges, unicode) {
  const code = unicode.codePointAt(0);
  let gid = 0, l = 0, r = ranges.length - 1;
  while (l < r) {
    const c = l + r + 1 >> 1;
    if (code < ranges[c].start) {
      r = c - 1;
    } else {
      l = c;
    }
  }
  if (ranges[l].start <= code && code <= ranges[l].end) {
    gid = ranges[l].idDelta + (ranges[l].ids ? ranges[l].ids[code - ranges[l].start] : code) & 65535;
  }
  return {
    charCode: code,
    glyphId: gid
  };
}
function* cffResolved(value) { return value instanceof Promise ? yield value : value; }
function* cffIndexValue(index, key) { return yield* cffResolved(Array.isArray(index) ? index[key] : index?.get(key)); }
function* compileCharString(charStringCode, cmds, font, glyphId) {
  cmds.depth = (cmds.depth ?? 0) + 1;
  if (cmds.streaming && cmds.depth > cmds.maxDepth) { cmds.onFrameAllocation?.(4096); cmds.maxDepth = cmds.depth; }
  try {
  cmds.onAllocation?.(512);
  function* moveTo(x2, y2) {
    if (firstPoint) {
      cmds.add(DrawOPS.lineTo, firstPoint);
    }
    firstPoint = [x2, y2];
    cmds.add(DrawOPS.moveTo, [x2, y2]);
    if (cmds.streaming) { yield cmds.getPath(); cmds.cmds.length = 0; }
  }
  function* lineTo(x2, y2) {
    cmds.add(DrawOPS.lineTo, [x2, y2]);
    if (cmds.streaming) { yield cmds.getPath(); cmds.cmds.length = 0; }
  }
  function* bezierCurveTo(x1, y1, x2, y2, x3, y3) {
    cmds.add(DrawOPS.curveTo, [x1, y1, x2, y2, x3, y3]);
    if (cmds.streaming) { yield cmds.getPath(); cmds.cmds.length = 0; }
  }
  const stack = cmds.createStack?.(cmds.depth) ?? [];
  function* pushOperand(value) {
    if (!Array.isArray(stack)) { yield stack.push(value); return; }
    if (cmds.streaming && stack.length + 1 > cmds.maxOperands) { cmds.onFrameAllocation?.(16); cmds.maxOperands = stack.length + 1; }
    stack.push(value);
  }
  function* readOperand(method) {
    return Array.isArray(stack) ? stack[method]() : yield stack[method]();
  }
  let x = 0, y = 0;
  let stems = 0;
  let firstPoint = null;
  function* parse(code, depth = 0) {
    if (cmds.streaming && depth > cmds.maxSubrDepth) { cmds.onFrameAllocation?.(256); cmds.maxSubrDepth = depth; }
    cmds.onAllocation?.(256 + code.length * 16);
    const view = ArrayBuffer.isView(code) ? new DataView(code.buffer, code.byteOffset, code.byteLength) : null;
    let i = 0;
    while (i < code.length) {
      let stackClean = false;
      let v = (ArrayBuffer.isView(code) ? code[i++] : (yield code.byte(i++)));
      let xa, xb, ya, yb, y1, y2, y3, n, subrCode;
      switch (v) {
        case 1:
          stems += stack.length >> 1;
          stackClean = true;
          break;
        case 3:
          stems += stack.length >> 1;
          stackClean = true;
          break;
        case 4:
          y += (yield* readOperand("pop"));
          yield* moveTo(x, y);
          stackClean = true;
          break;
        case 5:
          while (stack.length > 0) {
            x += (yield* readOperand("shift"));
            y += (yield* readOperand("shift"));
            yield* lineTo(x, y);
          }
          break;
        case 6:
          while (stack.length > 0) {
            x += (yield* readOperand("shift"));
            yield* lineTo(x, y);
            if (stack.length === 0) {
              break;
            }
            y += (yield* readOperand("shift"));
            yield* lineTo(x, y);
          }
          break;
        case 7:
          while (stack.length > 0) {
            y += (yield* readOperand("shift"));
            yield* lineTo(x, y);
            if (stack.length === 0) {
              break;
            }
            x += (yield* readOperand("shift"));
            yield* lineTo(x, y);
          }
          break;
        case 8:
          while (stack.length > 0) {
            xa = x + (yield* readOperand("shift"));
            ya = y + (yield* readOperand("shift"));
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb + (yield* readOperand("shift"));
            y = yb + (yield* readOperand("shift"));
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          break;
        case 10:
          n = (yield* readOperand("pop"));
          subrCode = null;
          if (font.isCFFCIDFont) {
            const fdIndex = (yield* cffResolved(font.fdSelect.getFDIndex(glyphId)));
            if (fdIndex >= 0 && fdIndex < font.fdArray.length) {
              const fontDict = (yield* cffIndexValue(font.fdArray, fdIndex));
              let subrs;
              if (fontDict.privateDict?.subrsIndex) {
                subrs = fontDict.privateDict.subrsIndex.objects;
              }
              if (subrs) {
                n += getSubroutineBias(subrs);
                subrCode = yield* cffIndexValue(subrs, n);
              }
            } else {
              warn("Invalid fd index for glyph index.");
            }
          } else {
            subrCode = (yield* cffIndexValue(font.subrs, n + font.subrsBias));
          }
          if (subrCode) {
            yield* parse(subrCode, depth + 1);
          }
          break;
        case 11:
          return;
        case 12:
          v = (ArrayBuffer.isView(code) ? code[i++] : (yield code.byte(i++)));
          switch (v) {
            case 34:
              xa = x + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              y1 = y + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, y, xb, y1, x, y1);
              xa = x + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, y1, xb, y, x, y);
              break;
            case 35:
              xa = x + (yield* readOperand("shift"));
              ya = y + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              yb = ya + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              y = yb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, ya, xb, yb, x, y);
              xa = x + (yield* readOperand("shift"));
              ya = y + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              yb = ya + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              y = yb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, ya, xb, yb, x, y);
              (yield* readOperand("pop"));
              break;
            case 36:
              xa = x + (yield* readOperand("shift"));
              y1 = y + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              y2 = y1 + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, y1, xb, y2, x, y2);
              xa = x + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              y3 = y2 + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, y2, xb, y3, x, y);
              break;
            case 37:
              const x0 = x, y0 = y;
              xa = x + (yield* readOperand("shift"));
              ya = y + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              yb = ya + (yield* readOperand("shift"));
              x = xb + (yield* readOperand("shift"));
              y = yb + (yield* readOperand("shift"));
              yield* bezierCurveTo(xa, ya, xb, yb, x, y);
              xa = x + (yield* readOperand("shift"));
              ya = y + (yield* readOperand("shift"));
              xb = xa + (yield* readOperand("shift"));
              yb = ya + (yield* readOperand("shift"));
              x = xb;
              y = yb;
              if (Math.abs(x - x0) > Math.abs(y - y0)) {
                x += (yield* readOperand("shift"));
              } else {
                y += (yield* readOperand("shift"));
              }
              yield* bezierCurveTo(xa, ya, xb, yb, x, y);
              break;
            default:
              throw new FormatError(`unknown operator: 12 ${v}`);
          }
          break;
        case 14:
          if (stack.length >= 4) {
            const achar = (yield* readOperand("pop"));
            const bchar = (yield* readOperand("pop"));
            y = (yield* readOperand("pop"));
            x = (yield* readOperand("pop"));
            cmds.save();
            cmds.translate(x, y);
            let cmap = lookupCmap(
              font.cmap,
              String.fromCharCode(font.glyphNameMap[StandardEncoding[achar]])
            );
            yield* compileCharString(
              (yield* cffIndexValue(font.glyphs, cmap.glyphId)),
              cmds,
              font,
              cmap.glyphId
            );
            cmds.restore();
            cmap = lookupCmap(
              font.cmap,
              String.fromCharCode(font.glyphNameMap[StandardEncoding[bchar]])
            );
            yield* compileCharString(
              (yield* cffIndexValue(font.glyphs, cmap.glyphId)),
              cmds,
              font,
              cmap.glyphId
            );
          }
          return;
        case 18:
          stems += stack.length >> 1;
          stackClean = true;
          break;
        case 19:
          stems += stack.length >> 1;
          i += stems + 7 >> 3;
          stackClean = true;
          break;
        case 20:
          stems += stack.length >> 1;
          i += stems + 7 >> 3;
          stackClean = true;
          break;
        case 21:
          y += (yield* readOperand("pop"));
          x += (yield* readOperand("pop"));
          yield* moveTo(x, y);
          stackClean = true;
          break;
        case 22:
          x += (yield* readOperand("pop"));
          yield* moveTo(x, y);
          stackClean = true;
          break;
        case 23:
          stems += stack.length >> 1;
          stackClean = true;
          break;
        case 24:
          while (stack.length > 2) {
            xa = x + (yield* readOperand("shift"));
            ya = y + (yield* readOperand("shift"));
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb + (yield* readOperand("shift"));
            y = yb + (yield* readOperand("shift"));
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          x += (yield* readOperand("shift"));
          y += (yield* readOperand("shift"));
          yield* lineTo(x, y);
          break;
        case 25:
          while (stack.length > 6) {
            x += (yield* readOperand("shift"));
            y += (yield* readOperand("shift"));
            yield* lineTo(x, y);
          }
          xa = x + (yield* readOperand("shift"));
          ya = y + (yield* readOperand("shift"));
          xb = xa + (yield* readOperand("shift"));
          yb = ya + (yield* readOperand("shift"));
          x = xb + (yield* readOperand("shift"));
          y = yb + (yield* readOperand("shift"));
          yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          break;
        case 26:
          if (stack.length % 2) {
            x += (yield* readOperand("shift"));
          }
          while (stack.length > 0) {
            xa = x;
            ya = y + (yield* readOperand("shift"));
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb;
            y = yb + (yield* readOperand("shift"));
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          break;
        case 27:
          if (stack.length % 2) {
            y += (yield* readOperand("shift"));
          }
          while (stack.length > 0) {
            xa = x + (yield* readOperand("shift"));
            ya = y;
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb + (yield* readOperand("shift"));
            y = yb;
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          break;
        case 28:
          yield* pushOperand((view ? view.getInt16(i) : (yield code.int(i, 2))));
          i += 2;
          break;
        case 29:
          n = (yield* readOperand("pop")) + font.gsubrsBias;
          subrCode = (yield* cffIndexValue(font.gsubrs, n));
          if (subrCode) {
            yield* parse(subrCode, depth + 1);
          }
          break;
        case 30:
          while (stack.length > 0) {
            xa = x;
            ya = y + (yield* readOperand("shift"));
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb + (yield* readOperand("shift"));
            y = yb + (stack.length === 1 ? (yield* readOperand("shift")) : 0);
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
            if (stack.length === 0) {
              break;
            }
            xa = x + (yield* readOperand("shift"));
            ya = y;
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            y = yb + (yield* readOperand("shift"));
            x = xb + (stack.length === 1 ? (yield* readOperand("shift")) : 0);
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          break;
        case 31:
          while (stack.length > 0) {
            xa = x + (yield* readOperand("shift"));
            ya = y;
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            y = yb + (yield* readOperand("shift"));
            x = xb + (stack.length === 1 ? (yield* readOperand("shift")) : 0);
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
            if (stack.length === 0) {
              break;
            }
            xa = x;
            ya = y + (yield* readOperand("shift"));
            xb = xa + (yield* readOperand("shift"));
            yb = ya + (yield* readOperand("shift"));
            x = xb + (yield* readOperand("shift"));
            y = yb + (stack.length === 1 ? (yield* readOperand("shift")) : 0);
            yield* bezierCurveTo(xa, ya, xb, yb, x, y);
          }
          break;
        default:
          if (v < 32) {
            throw new FormatError(`unknown operator: ${v}`);
          }
          if (v < 247) {
            yield* pushOperand(v - 139);
          } else if (v < 251) {
            yield* pushOperand((v - 247) * 256 + (ArrayBuffer.isView(code) ? code[i++] : (yield code.byte(i++))) + 108);
          } else if (v < 255) {
            yield* pushOperand(-(v - 251) * 256 - (ArrayBuffer.isView(code) ? code[i++] : (yield code.byte(i++))) - 108);
          } else {
            yield* pushOperand((view ? view.getInt32(i) : (yield code.int(i, 4))) / 65536);
            i += 4;
          }
          break;
      }
      if (stackClean) {
        stack.length = 0;
      }
    }
  }
  yield* parse(charStringCode);
  } finally { cmds.depth--; }
}
var Commands = class {
  constructor(onAllocation) {
    this.onAllocation = onAllocation;
  }
  cmds = [];
  hasPoints = false;
  transformStack = [];
  currentTransform = [1, 0, 0, 1, 0, 0];
  add(cmd, args) {
    this.onAllocation?.(64 + (args?.length ?? 0) * 16);
    if (args) {
      this.hasPoints = true;
      const { currentTransform } = this;
      for (let i = 0, ii = args.length; i < ii; i += 2) {
        Util.applyTransform(args, currentTransform, i);
      }
      this.cmds.push(cmd, ...args);
    } else {
      this.cmds.push(cmd);
    }
  }
  transform(transf) {
    this.onAllocation?.(128);
    this.currentTransform = Util.transform(this.currentTransform, transf);
  }
  translate(x, y) {
    this.transform([1, 0, 0, 1, x, y]);
  }
  save() {
    this.onAllocation?.(128);
    this.transformStack.push(this.currentTransform.slice());
  }
  restore() {
    this.currentTransform = this.transformStack.pop() || [1, 0, 0, 1, 0, 0];
  }
  getPath() {
    this.onAllocation?.(this.cmds.length * 4);
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL") || FeatureTest.isFloat16ArraySupported) {
      return new Float32Array(this.cmds);
    }
    return new Float32Array(this.cmds);
  }
};
var CompiledFont = class _CompiledFont {
  #compiledCharCodes = /* @__PURE__ */ new Set();
  #compiledGlyphs = /* @__PURE__ */ new Map();
  constructor(fontMatrix) {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _CompiledFont) {
      unreachable("Cannot initialize CompiledFont.");
    }
    this.fontMatrix = fontMatrix;
  }
  static get NOOP() {
    return shadow(
      this,
      "NOOP",
      typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL") || FeatureTest.isFloat16ArraySupported ? new Float32Array(0) : new Float32Array(0)
    );
  }
  getPath(unicode) {
    const { charCode, glyphId } = lookupCmap(this.cmap, unicode);
    if (this.#compiledGlyphs.has(glyphId) && this.#compiledCharCodes.has(charCode)) {
      return null;
    }
    const path = this.#compiledGlyphs.getOrInsertComputed(glyphId, () => {
      try {
        return this.compileGlyph(this.glyphs[glyphId], glyphId);
      } catch (ex) {
        return ex;
      }
    });
    this.#compiledCharCodes.add(charCode);
    if (path instanceof Error) {
      throw path;
    }
    return compileFontPathInfo(path);
  }
  compileGlyph(code, glyphId, onAllocation) {
    onAllocation?.(512);
    if (!code?.length || code[0] === 14) {
      return _CompiledFont.NOOP;
    }
    let fontMatrix = this.fontMatrix;
    if (this.isCFFCIDFont) {
      const fdIndex = this.fdSelect.getFDIndex(glyphId);
      if (fdIndex >= 0 && fdIndex < this.fdArray.length) {
        const fontDict = this.fdArray[fdIndex];
        fontMatrix = fontDict.getByName("FontMatrix") || FONT_IDENTITY_MATRIX;
      } else {
        warn("Invalid fd index for glyph index.");
      }
    }
    assert(isNumberArray(fontMatrix, 6), "Expected a valid fontMatrix.");
    const cmds = new Commands(onAllocation);
    cmds.transform(fontMatrix.slice());
    this.compileGlyphImpl(code, cmds, glyphId);
    if (cmds.hasPoints) {
      cmds.add(DrawOPS.closePath);
    }
    return cmds.getPath();
  }
  compileGlyphImpl() {
    unreachable("Children classes should implement this.");
  }
};
var Type2Compiled = class extends CompiledFont {
  constructor(cffInfo, cmap, fontMatrix) {
    super(fontMatrix || [1e-3, 0, 0, 1e-3, 0, 0]);
    this.glyphs = cffInfo.glyphs;
    this.gsubrs = cffInfo.gsubrs || [];
    this.subrs = cffInfo.subrs || [];
    this.cmap = cmap;
    this.glyphNameMap = getGlyphsUnicode();
    this.gsubrsBias = getSubroutineBias(this.gsubrs);
    this.subrsBias = getSubroutineBias(this.subrs);
    this.isCFFCIDFont = cffInfo.isCFFCIDFont;
    this.fdSelect = cffInfo.fdSelect;
    this.fdArray = cffInfo.fdArray;
  }
  *glyphCommands(code, glyphId, onAllocation, createStack) {
    onAllocation?.(16384);
    if (!code?.length) return;
    if ((ArrayBuffer.isView(code) ? code[0] : (yield code.byte(0))) === 14) return;
    let matrix = this.fontMatrix;
    if (this.isCFFCIDFont) {
      const index = yield* cffResolved(this.fdSelect.getFDIndex(glyphId));
      if (index >= 0 && index < this.fdArray.length) matrix = (yield* cffIndexValue(this.fdArray, index)).getByName("FontMatrix") || FONT_IDENTITY_MATRIX;
    }
    assert(isNumberArray(matrix, 6), "Expected a valid fontMatrix.");
    const cmds = new Commands();
    cmds.streaming = true;
    cmds.createStack = createStack;
    cmds.maxDepth = 1;
    cmds.maxSubrDepth = 10;
    cmds.maxOperands = 48;
    cmds.onFrameAllocation = onAllocation;
    cmds.transform(matrix.slice());
    yield* compileCharString(code, cmds, this, glyphId);
    if (cmds.hasPoints) {
      cmds.add(DrawOPS.closePath);
      yield cmds.getPath();
    }
  }
  compileGlyphImpl(code, cmds, glyphId) {
    for (const ignored of compileCharString(code, cmds, this, glyphId)) { /* synchronous collector */ }
  }
};

// src/core/unicode.js
var getSpecialPUASymbols = getLookupTableFactory(function(t) {
  t[63721] = 169;
  t[63193] = 169;
  t[63720] = 174;
  t[63194] = 174;
  t[63722] = 8482;
  t[63195] = 8482;
  t[63718] = 9168;
  t[63719] = 9135;
  t[63733] = 9134;
  t[63729] = 9127;
  t[63730] = 9128;
  t[63731] = 9129;
  t[63740] = 9131;
  t[63741] = 9132;
  t[63742] = 9133;
  t[63726] = 9121;
  t[63727] = 9122;
  t[63728] = 9123;
  t[63737] = 9124;
  t[63738] = 9125;
  t[63739] = 9126;
  t[63723] = 9115;
  t[63724] = 9116;
  t[63725] = 9117;
  t[63734] = 9118;
  t[63735] = 9119;
  t[63736] = 9120;
});
function getUnicodeForGlyph(name, glyphsUnicodeMap) {
  let unicode = glyphsUnicodeMap[name];
  if (unicode !== void 0) {
    return unicode;
  }
  if (!name) {
    return -1;
  }
  if (name[0] === "u") {
    const nameLen = name.length;
    let hexStr;
    if (nameLen === 7 && name[1] === "n" && name[2] === "i") {
      hexStr = name.substring(3);
    } else if (nameLen >= 5 && nameLen <= 7) {
      hexStr = name.substring(1);
    } else {
      return -1;
    }
    if (hexStr === hexStr.toUpperCase()) {
      unicode = parseInt(hexStr, 16);
      if (unicode >= 0) {
        return unicode;
      }
    }
  }
  return -1;
}

// src/core/fonts_utils.js
var SEAC_ANALYSIS_ENABLED = true;
var FontFlags = {
  FixedPitch: 1,
  Serif: 2,
  Symbolic: 4,
  Script: 8,
  Nonsymbolic: 32,
  Italic: 64,
  AllCap: 65536,
  SmallCap: 131072,
  ForceBold: 262144
};
var MacStandardGlyphOrdering = [
  ".notdef",
  ".null",
  "nonmarkingreturn",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quotesingle",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "grave",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "Adieresis",
  "Aring",
  "Ccedilla",
  "Eacute",
  "Ntilde",
  "Odieresis",
  "Udieresis",
  "aacute",
  "agrave",
  "acircumflex",
  "adieresis",
  "atilde",
  "aring",
  "ccedilla",
  "eacute",
  "egrave",
  "ecircumflex",
  "edieresis",
  "iacute",
  "igrave",
  "icircumflex",
  "idieresis",
  "ntilde",
  "oacute",
  "ograve",
  "ocircumflex",
  "odieresis",
  "otilde",
  "uacute",
  "ugrave",
  "ucircumflex",
  "udieresis",
  "dagger",
  "degree",
  "cent",
  "sterling",
  "section",
  "bullet",
  "paragraph",
  "germandbls",
  "registered",
  "copyright",
  "trademark",
  "acute",
  "dieresis",
  "notequal",
  "AE",
  "Oslash",
  "infinity",
  "plusminus",
  "lessequal",
  "greaterequal",
  "yen",
  "mu",
  "partialdiff",
  "summation",
  "product",
  "pi",
  "integral",
  "ordfeminine",
  "ordmasculine",
  "Omega",
  "ae",
  "oslash",
  "questiondown",
  "exclamdown",
  "logicalnot",
  "radical",
  "florin",
  "approxequal",
  "Delta",
  "guillemotleft",
  "guillemotright",
  "ellipsis",
  "nonbreakingspace",
  "Agrave",
  "Atilde",
  "Otilde",
  "OE",
  "oe",
  "endash",
  "emdash",
  "quotedblleft",
  "quotedblright",
  "quoteleft",
  "quoteright",
  "divide",
  "lozenge",
  "ydieresis",
  "Ydieresis",
  "fraction",
  "currency",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "daggerdbl",
  "periodcentered",
  "quotesinglbase",
  "quotedblbase",
  "perthousand",
  "Acircumflex",
  "Ecircumflex",
  "Aacute",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Oacute",
  "Ocircumflex",
  "apple",
  "Ograve",
  "Uacute",
  "Ucircumflex",
  "Ugrave",
  "dotlessi",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron",
  "Lslash",
  "lslash",
  "Scaron",
  "scaron",
  "Zcaron",
  "zcaron",
  "brokenbar",
  "Eth",
  "eth",
  "Yacute",
  "yacute",
  "Thorn",
  "thorn",
  "minus",
  "multiply",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "onehalf",
  "onequarter",
  "threequarters",
  "franc",
  "Gbreve",
  "gbreve",
  "Idotaccent",
  "Scedilla",
  "scedilla",
  "Cacute",
  "cacute",
  "Ccaron",
  "ccaron",
  "dcroat"
];
function recoverGlyphName(name, glyphsUnicodeMap) {
  if (glyphsUnicodeMap[name] !== void 0) {
    return name;
  }
  const unicode = getUnicodeForGlyph(name, glyphsUnicodeMap);
  if (unicode !== -1) {
    for (const key in glyphsUnicodeMap) {
      if (glyphsUnicodeMap[key] === unicode) {
        return key;
      }
    }
  }
  info("Unable to recover a standard glyph name for: " + name);
  return name;
}
function type1FontGlyphMapping(properties, builtInEncoding, glyphNames) {
  const charCodeToGlyphId = /* @__PURE__ */ new Map();
  let glyphId, baseEncoding;
  const isSymbolicFont = !!(properties.flags & FontFlags.Symbolic);
  if (properties.isInternalFont) {
    baseEncoding = builtInEncoding;
    for (let charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId.set(
        charCode,
        glyphId >= 0 ? glyphId : (
          /* notdef = */
          0
        )
      );
    }
  } else if (properties.baseEncodingName) {
    baseEncoding = getEncoding(properties.baseEncodingName);
    for (let charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId.set(
        charCode,
        glyphId >= 0 ? glyphId : (
          /* notdef = */
          0
        )
      );
    }
  } else if (isSymbolicFont) {
    for (const charCode in builtInEncoding) {
      charCodeToGlyphId.set(+charCode, builtInEncoding[charCode]);
    }
  } else {
    baseEncoding = StandardEncoding;
    for (let charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId.set(
        charCode,
        glyphId >= 0 ? glyphId : (
          /* notdef = */
          0
        )
      );
    }
  }
  let glyphsUnicodeMap;
  if (properties.differences) {
    for (const [charCode, glyphName] of properties.differences) {
      glyphId = glyphNames.indexOf(glyphName);
      if (glyphId === -1) {
        glyphsUnicodeMap ??= getGlyphsUnicode();
        const standardGlyphName = recoverGlyphName(glyphName, glyphsUnicodeMap);
        if (standardGlyphName !== glyphName) {
          glyphId = glyphNames.indexOf(standardGlyphName);
        }
      }
      charCodeToGlyphId.set(
        charCode,
        glyphId >= 0 ? glyphId : (
          /* notdef = */
          0
        )
      );
    }
  }
  return charCodeToGlyphId;
}
var getVerticalPresentationForm = getLookupTableFactory((t) => {
  t[8211] = 65074;
  t[8212] = 65073;
  t[8229] = 65072;
  t[8230] = 65049;
  t[12289] = 65041;
  t[12290] = 65042;
  t[12296] = 65087;
  t[12297] = 65088;
  t[12298] = 65085;
  t[12299] = 65086;
  t[12300] = 65089;
  t[12301] = 65090;
  t[12302] = 65091;
  t[12303] = 65092;
  t[12304] = 65083;
  t[12305] = 65084;
  t[12308] = 65081;
  t[12309] = 65082;
  t[12310] = 65047;
  t[12311] = 65048;
  t[65103] = 65076;
  t[65281] = 65045;
  t[65288] = 65077;
  t[65289] = 65078;
  t[65292] = 65040;
  t[65306] = 65043;
  t[65307] = 65044;
  t[65311] = 65046;
  t[65339] = 65095;
  t[65341] = 65096;
  t[65343] = 65075;
  t[65371] = 65079;
  t[65373] = 65080;
});

// src/core/type1_parser.js
var HINTING_ENABLED = false;
var COMMAND_MAP = {
  hstem: [1],
  vstem: [3],
  vmoveto: [4],
  rlineto: [5],
  hlineto: [6],
  vlineto: [7],
  rrcurveto: [8],
  callsubr: [10],
  flex: [12, 35],
  drop: [12, 18],
  endchar: [14],
  rmoveto: [21],
  hmoveto: [22],
  vhcurveto: [30],
  hvcurveto: [31]
};
var Type1CharString = class {
  constructor(onAllocation) {
    this.onAllocation = onAllocation;
  }
  width = 0;
  lsb = 0;
  flexing = false;
  output = [];
  stack = [];
  convert(encoded, subrs, seacAnalysisEnabled) {
    this.onAllocation?.(256 + encoded.length * 128);
    const count = encoded.length;
    let error = false;
    let wx, sbx, subrNumber;
    for (let i = 0; i < count; i++) {
      let value = encoded[i];
      if (value < 32) {
        if (value === 12) {
          value = (value << 8) + encoded[++i];
        }
        switch (value) {
          case 1:
            if (!HINTING_ENABLED) {
              this.stack = [];
              break;
            }
            error = this.executeCommand(2, COMMAND_MAP.hstem);
            break;
          case 3:
            if (!HINTING_ENABLED) {
              this.stack = [];
              break;
            }
            error = this.executeCommand(2, COMMAND_MAP.vstem);
            break;
          case 4:
            if (this.flexing) {
              if (this.stack.length < 1) {
                error = true;
                break;
              }
              const dy = this.stack.pop();
              this.stack.push(0, dy);
              break;
            }
            error = this.executeCommand(1, COMMAND_MAP.vmoveto);
            break;
          case 5:
            error = this.executeCommand(2, COMMAND_MAP.rlineto);
            break;
          case 6:
            error = this.executeCommand(1, COMMAND_MAP.hlineto);
            break;
          case 7:
            error = this.executeCommand(1, COMMAND_MAP.vlineto);
            break;
          case 8:
            error = this.executeCommand(6, COMMAND_MAP.rrcurveto);
            break;
          case 9:
            this.stack = [];
            break;
          case 10:
            if (this.stack.length < 1) {
              error = true;
              break;
            }
            subrNumber = this.stack.pop();
            if (!subrs[subrNumber]) {
              error = true;
              break;
            }
            error = this.convert(subrs[subrNumber], subrs, seacAnalysisEnabled);
            break;
          case 11:
            return error;
          case 13:
            if (this.stack.length < 2) {
              error = true;
              break;
            }
            wx = this.stack.pop();
            sbx = this.stack.pop();
            this.lsb = sbx;
            this.width = wx;
            this.stack.push(wx, sbx);
            error = this.executeCommand(2, COMMAND_MAP.hmoveto);
            break;
          case 14:
            this.output.push(COMMAND_MAP.endchar[0]);
            break;
          case 21:
            if (this.flexing) {
              break;
            }
            error = this.executeCommand(2, COMMAND_MAP.rmoveto);
            break;
          case 22:
            if (this.flexing) {
              this.stack.push(0);
              break;
            }
            error = this.executeCommand(1, COMMAND_MAP.hmoveto);
            break;
          case 30:
            error = this.executeCommand(4, COMMAND_MAP.vhcurveto);
            break;
          case 31:
            error = this.executeCommand(4, COMMAND_MAP.hvcurveto);
            break;
          case (12 << 8) + 0:
            this.stack = [];
            break;
          case (12 << 8) + 1:
            if (!HINTING_ENABLED) {
              this.stack = [];
              break;
            }
            error = this.executeCommand(2, COMMAND_MAP.vstem);
            break;
          case (12 << 8) + 2:
            if (!HINTING_ENABLED) {
              this.stack = [];
              break;
            }
            error = this.executeCommand(2, COMMAND_MAP.hstem);
            break;
          case (12 << 8) + 6:
            if (seacAnalysisEnabled) {
              const asb = this.stack.at(-5);
              this.seac = this.stack.splice(-4, 4);
              this.seac[0] += this.lsb - asb;
              error = this.executeCommand(0, COMMAND_MAP.endchar);
            } else {
              error = this.executeCommand(4, COMMAND_MAP.endchar);
            }
            break;
          case (12 << 8) + 7:
            if (this.stack.length < 4) {
              error = true;
              break;
            }
            this.stack.pop();
            wx = this.stack.pop();
            const sby = this.stack.pop();
            sbx = this.stack.pop();
            this.lsb = sbx;
            this.width = wx;
            this.stack.push(wx, sbx, sby);
            error = this.executeCommand(3, COMMAND_MAP.rmoveto);
            break;
          case (12 << 8) + 12:
            if (this.stack.length < 2) {
              error = true;
              break;
            }
            const num2 = this.stack.pop();
            const num1 = this.stack.pop();
            this.stack.push(num1 / num2);
            break;
          case (12 << 8) + 16:
            if (this.stack.length < 2) {
              error = true;
              break;
            }
            subrNumber = this.stack.pop();
            const numArgs = this.stack.pop();
            if (subrNumber === 0 && numArgs === 3) {
              const flexArgs = this.stack.splice(-17, 17);
              this.stack.push(
                flexArgs[2] + flexArgs[0],
                // bcp1x + rpx
                flexArgs[3] + flexArgs[1],
                // bcp1y + rpy
                flexArgs[4],
                // bcp2x
                flexArgs[5],
                // bcp2y
                flexArgs[6],
                // p2x
                flexArgs[7],
                // p2y
                flexArgs[8],
                // bcp3x
                flexArgs[9],
                // bcp3y
                flexArgs[10],
                // bcp4x
                flexArgs[11],
                // bcp4y
                flexArgs[12],
                // p3x
                flexArgs[13],
                // p3y
                flexArgs[14]
                // flexDepth
                // 15 = finalx unused by flex
                // 16 = finaly unused by flex
              );
              error = this.executeCommand(13, COMMAND_MAP.flex, true);
              this.flexing = false;
              this.stack.push(flexArgs[15], flexArgs[16]);
            } else if (subrNumber === 1 && numArgs === 0) {
              this.flexing = true;
            }
            break;
          case (12 << 8) + 17:
            break;
          case (12 << 8) + 33:
            this.stack = [];
            break;
          default:
            warn('Unknown type 1 charstring command of "' + value + '"');
            break;
        }
        if (error) {
          break;
        }
        continue;
      } else if (value <= 246) {
        value -= 139;
      } else if (value <= 250) {
        value = (value - 247) * 256 + encoded[++i] + 108;
      } else if (value <= 254) {
        value = -((value - 251) * 256) - encoded[++i] - 108;
      } else {
        value = (encoded[++i] & 255) << 24 | (encoded[++i] & 255) << 16 | (encoded[++i] & 255) << 8 | (encoded[++i] & 255) << 0;
      }
      this.stack.push(value);
    }
    return error;
  }
  executeCommand(howManyArgs, command, keepStack) {
    const stackLength = this.stack.length;
    if (howManyArgs > stackLength) {
      return true;
    }
    const start = stackLength - howManyArgs;
    for (let i = start; i < stackLength; i++) {
      let value = this.stack[i];
      if (Number.isInteger(value)) {
        this.output.push(28, value >> 8 & 255, value & 255);
      } else {
        value = 65536 * value | 0;
        this.output.push(
          255,
          value >> 24 & 255,
          value >> 16 & 255,
          value >> 8 & 255,
          value & 255
        );
      }
    }
    this.output.push(...command);
    if (keepStack) {
      this.stack.splice(start, howManyArgs);
    } else {
      this.stack.length = 0;
    }
    return false;
  }
};
var EEXEC_ENCRYPT_KEY = 55665;
var CHAR_STRS_ENCRYPT_KEY = 4330;
function isHexDigit(code) {
  return code >= 48 && code <= 57 || // '0'-'9'
  code >= 65 && code <= 70 || // 'A'-'F'
  code >= 97 && code <= 102;
}
function decrypt(data, key, discardNumber, onAllocation) {
  onAllocation?.(64 + Math.max(0, data.length - discardNumber));
  if (discardNumber >= data.length) {
    return new Uint8Array(0);
  }
  const c1 = 52845, c2 = 22719;
  let r = key | 0, i, j;
  for (i = 0; i < discardNumber; i++) {
    r = (data[i] + r) * c1 + c2 & (1 << 16) - 1;
  }
  const count = data.length - discardNumber;
  const decrypted = new Uint8Array(count);
  for (i = discardNumber, j = 0; j < count; i++, j++) {
    const value = data[i];
    decrypted[j] = value ^ r >> 8;
    r = (value + r) * c1 + c2 & (1 << 16) - 1;
  }
  return decrypted;
}
function decryptAscii(data, key, discardNumber, onAllocation) {
  onAllocation?.(256 + data.length);
  const c1 = 52845, c2 = 22719;
  let r = key | 0;
  const count = data.length, maybeLength = count >>> 1;
  const decrypted = new Uint8Array(maybeLength);
  let i, j;
  for (i = 0, j = 0; i < count; i++) {
    const digit1 = data[i];
    if (!isHexDigit(digit1)) {
      continue;
    }
    i++;
    let digit2;
    while (i < count && !isHexDigit(digit2 = data[i])) {
      i++;
    }
    if (i < count) {
      const value = parseInt(String.fromCharCode(digit1, digit2), 16);
      decrypted[j++] = value ^ r >> 8;
      r = (value + r) * c1 + c2 & (1 << 16) - 1;
    }
  }
  return decrypted.slice(discardNumber, j);
}
function isSpecial(c) {
  return c === /* '/' = */
  47 || c === /* '[' = */
  91 || c === /* ']' = */
  93 || c === /* '{' = */
  123 || c === /* '}' = */
  125 || c === /* '(' = */
  40 || c === /* ')' = */
  41;
}
var Type1Parser = class {
  constructor(stream, encrypted, seacAnalysisEnabled, onAllocation) {
    this.onAllocation = onAllocation;
    onAllocation?.(2048);
    if (encrypted) {
      const data = stream.getBytes();
      const isBinary = !((isHexDigit(data[0]) || isWhiteSpace(data[0])) && isHexDigit(data[1]) && isHexDigit(data[2]) && isHexDigit(data[3]) && isHexDigit(data[4]) && isHexDigit(data[5]) && isHexDigit(data[6]) && isHexDigit(data[7]));
      stream = new Stream(
        isBinary ? decrypt(data, EEXEC_ENCRYPT_KEY, 4, onAllocation) : decryptAscii(data, EEXEC_ENCRYPT_KEY, 4, onAllocation)
      );
    }
    this.seacAnalysisEnabled = !!seacAnalysisEnabled;
    this.stream = stream;
    this.nextChar();
  }
  readNumberArray() {
    this.onAllocation?.(64);
    this.getToken();
    const array = [];
    while (true) {
      const token = this.getToken();
      if (token === null || token === "]" || token === "}") {
        break;
      }
      this.onAllocation?.(16);
      array.push(parseFloat(token || 0));
    }
    return array;
  }
  readNumber() {
    const token = this.getToken();
    return parseFloat(token || 0);
  }
  readInt() {
    const token = this.getToken();
    return parseInt(token || 0, 10) | 0;
  }
  readBoolean() {
    const token = this.getToken();
    return token === "true" ? 1 : 0;
  }
  nextChar() {
    return this.currentChar = this.stream.getByte();
  }
  prevChar() {
    this.stream.skip(-2);
    return this.currentChar = this.stream.getByte();
  }
  getToken() {
    let comment = false;
    let ch3 = this.currentChar;
    while (true) {
      if (ch3 === -1) {
        return null;
      }
      if (comment) {
        if (ch3 === 10 || ch3 === 13) {
          comment = false;
        }
      } else if (ch3 === /* '%' = */
      37) {
        comment = true;
      } else if (!isWhiteSpace(ch3)) {
        break;
      }
      ch3 = this.nextChar();
    }
    if (isSpecial(ch3)) {
      this.nextChar();
      this.onAllocation?.(64);
      return String.fromCharCode(ch3);
    }
    let token = "";
    do {
      this.onAllocation?.(64);
      token += String.fromCharCode(ch3);
      ch3 = this.nextChar();
    } while (ch3 >= 0 && !isWhiteSpace(ch3) && !isSpecial(ch3));
    return token;
  }
  readCharStrings(bytes, lenIV) {
    if (lenIV === -1) {
      return bytes;
    }
    return decrypt(bytes, CHAR_STRS_ENCRYPT_KEY, lenIV, this.onAllocation);
  }
  /*
   * Returns an object containing a Subrs array and a CharStrings
   * array extracted from and eexec encrypted block of data
   */
  extractFontProgram(properties) {
    const stream = this.stream;
    const subrs = [], charstrings = [];
    const privateData = /* @__PURE__ */ new Map([["lenIV", 4]]);
    const program = {
      subrs: [],
      charstrings: [],
      properties: {
        privateData
      }
    };
    let token, length, data;
    let subrsParsed = false;
    let charStringsParsed = false;
    while ((token = this.getToken()) !== null) {
      if (token !== "/") {
        continue;
      }
      token = this.getToken();
      switch (token) {
        case "CharStrings":
          if (charStringsParsed) {
            break;
          }
          charStringsParsed = true;
          this.getToken();
          this.getToken();
          this.getToken();
          this.getToken();
          while (true) {
            token = this.getToken();
            if (token === null || token === "end") {
              break;
            }
            if (token !== "/") {
              continue;
            }
            const glyph = this.getToken();
            length = this.readInt();
            this.getToken();
            data = length > 0 ? stream.getBytes(length) : new Uint8Array(0);
            const encoded = this.readCharStrings(
              data,
              privateData.get("lenIV")
            );
            this.nextChar();
            token = this.getToken();
            if (token === "noaccess") {
              this.getToken();
            } else if (token === "/") {
              this.prevChar();
            }
            this.onAllocation?.(256);
            charstrings.push({
              glyph,
              encoded
            });
          }
          break;
        case "Subrs":
          if (subrsParsed) {
            break;
          }
          subrsParsed = true;
          this.readInt();
          this.getToken();
          while (this.getToken() === "dup") {
            const index = this.readInt();
            length = this.readInt();
            this.getToken();
            data = length > 0 ? stream.getBytes(length) : new Uint8Array(0);
            const encoded = this.readCharStrings(
              data,
              privateData.get("lenIV")
            );
            this.nextChar();
            token = this.getToken();
            if (token === "noaccess") {
              this.getToken();
            }
            this.onAllocation?.(128);
            subrs[index] = encoded;
          }
          break;
        case "BlueValues":
        case "OtherBlues":
        case "FamilyBlues":
        case "FamilyOtherBlues":
          const blueArray = this.readNumberArray();
          if (HINTING_ENABLED && blueArray.length > 0 && blueArray.length % 2 === 0) {
            privateData.set(token, blueArray);
          }
          break;
        case "StemSnapH":
        case "StemSnapV":
          privateData.set(token, this.readNumberArray());
          break;
        case "StdHW":
        case "StdVW":
          privateData.set(token, this.readNumberArray()[0]);
          break;
        case "BlueShift":
        case "lenIV":
        case "BlueFuzz":
        case "BlueScale":
        case "LanguageGroup":
          privateData.set(token, this.readNumber());
          break;
        case "ExpansionFactor":
          privateData.set(token, this.readNumber() || 0.06);
          break;
        case "ForceBold":
          privateData.set(token, this.readBoolean());
          break;
      }
    }
    for (const { encoded, glyph } of charstrings) {
      const charString = new Type1CharString(this.onAllocation);
      const error = charString.convert(
        encoded,
        subrs,
        this.seacAnalysisEnabled
      );
      const output = !error ? charString.output : [14];
      const charStringObject = {
        glyphName: glyph,
        charstring: output,
        width: charString.width,
        lsb: charString.lsb,
        seac: charString.seac
      };
      if (glyph === ".notdef") {
        program.charstrings.unshift(charStringObject);
      } else {
        program.charstrings.push(charStringObject);
      }
      if (properties.builtInEncoding) {
        const index = properties.builtInEncoding.indexOf(glyph);
        if (index > -1 && properties.widths[index] === void 0 && index >= properties.firstChar && index <= properties.lastChar) {
          properties.widths[index] = charString.width;
        }
      }
    }
    return program;
  }
  /*
   * Returns an object containing a Subrs array and a CharStrings array
   * extracted from a CID-keyed Type 1 font program (Adobe TechNote 5014,
   * CIDFontType 0). The stream must start at the PostScript header.
   *
   * The binary section that follows the "StartData" marker contains:
   *  - CIDMap at CIDMapOffset, with (CIDCount + 1) entries; each entry is
   *    FDBytes (FD-index) + GDBytes (glyph data offset) bytes.
   *  - SubrMap at SubrMapOffset, with (SubrCount + 1) entries of SDBytes
   *    each, holding subr data offsets.
   *  - The charstring/subr data, each encrypted with the Type 1 charstring
   *    cipher and prefixed by `lenIV` random bytes.
   *
   * Only single-FDArray fonts are supported.
   */
  extractCidKeyedFontProgram(properties) {
    const stream = this.stream;
    const privateData = /* @__PURE__ */ new Map([["lenIV", 4]]);
    const program = {
      subrs: [],
      charstrings: [],
      properties: { privateData }
    };
    let cidCount = 0;
    let cidMapOffset = -1;
    let fdBytes = 1;
    let gdBytes = 0;
    let subrMapOffset = -1;
    let sdBytes = 0;
    let subrCount = 0;
    let startDataLength = 0;
    let startDataIsHex = false;
    let foundStartData = false;
    const previousTokens = [];
    function rememberToken(value) {
      previousTokens.push(value);
      if (previousTokens.length > 4) {
        previousTokens.shift();
      }
    }
    let token;
    while ((token = this.getToken()) !== null) {
      if (token === "StartData") {
        const dataType = previousTokens.at(-3);
        const dataLength = previousTokens.at(-1);
        if (previousTokens.at(-4) !== "(" || previousTokens.at(-2) !== ")" || dataType !== "Binary" && dataType !== "Hex" || !/^\d+$/.test(dataLength)) {
          return null;
        }
        startDataLength = parseInt(dataLength, 10);
        if (startDataLength <= 0) {
          return null;
        }
        startDataIsHex = dataType === "Hex";
        foundStartData = true;
        break;
      }
      rememberToken(token);
      if (token !== "/") {
        continue;
      }
      token = this.getToken();
      rememberToken(token);
      switch (token) {
        case "FontMatrix":
          properties.fontMatrix = this.readNumberArray();
          break;
        case "FontBBox":
          const fontBBox = this.readNumberArray();
          properties.ascent = Math.max(fontBBox[3], fontBBox[1]);
          properties.descent = Math.min(fontBBox[1], fontBBox[3]);
          properties.ascentScaled = true;
          break;
        case "CIDCount":
          cidCount = this.readInt();
          break;
        case "CIDMapOffset":
          cidMapOffset = this.readInt();
          break;
        case "FDBytes":
          fdBytes = this.readInt();
          break;
        case "GDBytes":
          gdBytes = this.readInt();
          break;
        case "SubrMapOffset":
          subrMapOffset = this.readInt();
          break;
        case "SDBytes":
          sdBytes = this.readInt();
          break;
        case "SubrCount":
          subrCount = this.readInt();
          break;
        case "BlueValues":
        case "OtherBlues":
        case "FamilyBlues":
        case "FamilyOtherBlues":
          this.readNumberArray();
          break;
        case "StemSnapH":
        case "StemSnapV":
          privateData.set(token, this.readNumberArray());
          break;
        case "StdHW":
        case "StdVW":
          privateData.set(token, this.readNumberArray()[0]);
          break;
        case "BlueShift":
        case "lenIV":
        case "BlueFuzz":
        case "BlueScale":
        case "LanguageGroup":
          privateData.set(token, this.readNumber());
          break;
        case "ExpansionFactor":
          privateData.set(token, this.readNumber() || 0.06);
          break;
        case "ForceBold":
          privateData.set(token, this.readBoolean());
          break;
      }
    }
    if (!foundStartData || cidCount <= 0 || cidMapOffset < 0 || fdBytes < 0 || fdBytes > 4 || gdBytes < 1 || gdBytes > 4) {
      return null;
    }
    const maxLength = stream.end - stream.pos;
    if (startDataLength > maxLength) {
      if (!startDataIsHex) {
        startDataLength = maxLength;
      } else if (startDataLength > 2 * maxLength) {
        return null;
      }
    }
    let binary = stream.getBytes(startDataIsHex ? void 0 : startDataLength);
    if (startDataIsHex) {
      this.onAllocation?.(startDataLength);
      const decoded = new Uint8Array(startDataLength);
      let digit1 = -1, j = 0;
      for (let i = 0, ii = binary.length; i < ii && j < startDataLength; i++) {
        const digit = binary[i];
        if (!isHexDigit(digit)) {
          continue;
        }
        if (digit1 < 0) {
          digit1 = digit;
          continue;
        }
        decoded[j++] = parseInt(String.fromCharCode(digit1, digit), 16);
        digit1 = -1;
      }
      if (j !== startDataLength) {
        return null;
      }
      binary = decoded;
    }
    const lenIV = privateData.get("lenIV");
    const cidEntrySize = fdBytes + gdBytes;
    const subrs = [];
    function readUint(offset, byteCount) {
      let n = 0;
      for (let i = 0; i < byteCount; i++) {
        n = n << 8 | binary[offset + i];
      }
      return n >>> 0;
    }
    if (cidMapOffset + (cidCount + 1) * cidEntrySize > binary.length || subrCount > 0 && (subrMapOffset < 0 || sdBytes < 1 || sdBytes > 4 || subrMapOffset + (subrCount + 1) * sdBytes > binary.length)) {
      return null;
    }
    if (fdBytes > 0) {
      for (let cid = 0; cid < cidCount; cid++) {
        if (readUint(cidMapOffset + cid * cidEntrySize, fdBytes) !== 0) {
          return null;
        }
      }
    }
    if (subrCount > 0) {
      this.onAllocation?.(128 + (subrCount + 1) * 128);
      const subrOffsets = new Array(subrCount + 1);
      for (let i = 0; i <= subrCount; i++) {
        subrOffsets[i] = readUint(subrMapOffset + i * sdBytes, sdBytes);
      }
      for (let i = 0; i < subrCount; i++) {
        const start = subrOffsets[i];
        const end = subrOffsets[i + 1];
        if (end > binary.length || end < start) {
          subrs[i] = new Uint8Array(0);
          continue;
        }
        subrs[i] = this.readCharStrings(binary.subarray(start, end), lenIV);
      }
    }
    this.onAllocation?.(256 + cidCount * 512);
    const charstrings = [];
    let prevOffset = readUint(cidMapOffset + fdBytes, gdBytes);
    for (let cid = 0; cid < cidCount; cid++) {
      const nextOffset = readUint(
        cidMapOffset + (cid + 1) * cidEntrySize + fdBytes,
        gdBytes
      );
      const glyphName = cid === 0 ? ".notdef" : `cid${cid}`;
      if (nextOffset > prevOffset && nextOffset <= binary.length) {
        const encoded = this.readCharStrings(
          binary.subarray(prevOffset, nextOffset),
          lenIV
        );
        const charString = new Type1CharString(this.onAllocation);
        const error = charString.convert(
          encoded,
          subrs,
          this.seacAnalysisEnabled
        );
        charstrings.push({
          glyphName,
          charstring: error ? [14] : charString.output,
          width: charString.width,
          lsb: charString.lsb,
          seac: charString.seac
        });
      } else {
        const notDef = charstrings[0];
        this.onAllocation?.(64 + (notDef?.charstring.length ?? 2) * 16);
        charstrings.push({
          glyphName,
          charstring: notDef?.charstring.slice() || [139, 14],
          // 0 endchar
          width: notDef?.width || 0,
          lsb: notDef?.lsb || 0
        });
      }
      prevOffset = nextOffset;
    }
    program.subrs = subrs;
    program.charstrings = charstrings;
    return program;
  }
  extractFontHeader(properties) {
    let token;
    while ((token = this.getToken()) !== null) {
      if (token !== "/") {
        continue;
      }
      token = this.getToken();
      switch (token) {
        case "FontMatrix":
          const matrix = this.readNumberArray();
          properties.fontMatrix = matrix;
          break;
        case "Encoding":
          const encodingArg = this.getToken();
          let encoding;
          if (!/^\d+$/.test(encodingArg)) {
            encoding = getEncoding(encodingArg);
          } else {
            encoding = [];
            const size = parseInt(encodingArg, 10) | 0;
            this.getToken();
            for (let j = 0; j < size; j++) {
              token = this.getToken();
              while (token !== "dup" && token !== "def") {
                token = this.getToken();
                if (token === null) {
                  return;
                }
              }
              if (token === "def") {
                break;
              }
              const index = this.readInt();
              this.getToken();
              const glyph = this.getToken();
              this.onAllocation?.(64);
              encoding[index] = glyph;
              this.getToken();
            }
          }
          properties.builtInEncoding = encoding;
          break;
        case "FontBBox":
          const fontBBox = this.readNumberArray();
          properties.ascent = Math.max(fontBBox[3], fontBBox[1]);
          properties.descent = Math.min(fontBBox[1], fontBBox[3]);
          properties.ascentScaled = true;
          break;
      }
    }
  }
};

// src/core/type1_font.js
function findBlock(streamBytes, signature, startIndex) {
  const streamBytesLength = streamBytes.length;
  const signatureLength = signature.length;
  const scanLength = streamBytesLength - signatureLength;
  let i = startIndex, found = false;
  while (i < scanLength) {
    let j = 0;
    while (j < signatureLength && streamBytes[i + j] === signature[j]) {
      j++;
    }
    if (j >= signatureLength) {
      i += j;
      while (i < streamBytesLength && isWhiteSpace(streamBytes[i])) {
        i++;
      }
      found = true;
      break;
    }
    i++;
  }
  return {
    found,
    length: i
  };
}
function getHeaderBlock(stream, suggestedLength) {
  const EEXEC_SIGNATURE = [101, 101, 120, 101, 99];
  const streamStartPos = stream.pos;
  let headerBytes, headerBytesLength, block;
  try {
    headerBytes = stream.getBytes(suggestedLength);
    headerBytesLength = headerBytes.length;
  } catch {
  }
  if (headerBytesLength === suggestedLength) {
    block = findBlock(
      headerBytes,
      EEXEC_SIGNATURE,
      suggestedLength - 2 * EEXEC_SIGNATURE.length
    );
    if (block.found && block.length === suggestedLength) {
      return {
        stream: new Stream(headerBytes),
        length: suggestedLength
      };
    }
  }
  warn('Invalid "Length1" property in Type1 font -- trying to recover.');
  stream.pos = streamStartPos;
  const SCAN_BLOCK_LENGTH = 2048;
  let actualLength;
  while (true) {
    const scanBytes = stream.peekBytes(SCAN_BLOCK_LENGTH);
    block = findBlock(scanBytes, EEXEC_SIGNATURE, 0);
    if (block.length === 0) {
      break;
    }
    stream.pos += block.length;
    if (block.found) {
      actualLength = stream.pos - streamStartPos;
      break;
    }
  }
  stream.pos = streamStartPos;
  if (actualLength) {
    return {
      stream: new Stream(stream.getBytes(actualLength)),
      length: actualLength
    };
  }
  warn('Unable to recover "Length1" property in Type1 font -- using as is.');
  return {
    stream: new Stream(stream.getBytes(suggestedLength)),
    length: suggestedLength
  };
}
function getEexecBlock(stream, suggestedLength) {
  const eexecBytes = stream.getBytes();
  if (eexecBytes.length === 0) {
    throw new FormatError("getEexecBlock - no font program found.");
  }
  return {
    stream: new Stream(eexecBytes),
    length: eexecBytes.length
  };
}
function isCidKeyedType1File(file) {
  const sample = file.peekBytes(2048);
  if (sample.length < 2 || sample[0] !== 37 || sample[1] !== 33) {
    return false;
  }
  const text = bytesToString(sample);
  return text.includes("Resource-CIDFont") || /\/CIDFontType\s+0\b/.test(text);
}
var Type1Font = class {
  #data;
  get data() {
    return this.#data ??= new CFFCompiler(this.cff).compile();
  }
  #rawFileLength;
  constructor(name, file, properties, onAllocation) {
    this.onAllocation = onAllocation;
    onAllocation?.(2048 + Math.min(file.end - file.pos, 2048) * 32);
    let data;
    if (properties.composite && isCidKeyedType1File(file)) {
      data = this.#parseCidKeyedType1(file, properties);
    }
    data ||= this.#parseType1(file, properties);
    for (const key in data.properties) {
      properties[key] = data.properties[key];
    }
    const charstrings = data.charstrings;
    const type2Charstrings = this.getType2Charstrings(charstrings);
    const subrs = this.getType2Subrs(data.subrs);
    this.charstrings = charstrings;
    this.cff = this.wrap(
      name,
      type2Charstrings,
      this.charstrings,
      subrs,
      properties
    );
    this.seacs = this.getSeacs(data.charstrings);
  }
  #parseType1(file, properties) {
    const PFB_HEADER_SIZE = 6;
    let headerBlockLength = properties.length1;
    let eexecBlockLength = properties.length2;
    let pfbHeader = file.peekBytes(PFB_HEADER_SIZE);
    const pfbHeaderPresent = pfbHeader[0] === 128 && pfbHeader[1] === 1;
    if (pfbHeaderPresent) {
      file.skip(PFB_HEADER_SIZE);
      headerBlockLength = pfbHeader[5] << 24 | pfbHeader[4] << 16 | pfbHeader[3] << 8 | pfbHeader[2];
    }
    const headerBlock = getHeaderBlock(file, headerBlockLength);
    const headerBlockParser = new Type1Parser(
      headerBlock.stream,
      false,
      SEAC_ANALYSIS_ENABLED,
      this.onAllocation
    );
    headerBlockParser.extractFontHeader(properties);
    if (pfbHeaderPresent) {
      pfbHeader = file.getBytes(PFB_HEADER_SIZE);
      eexecBlockLength = pfbHeader[5] << 24 | pfbHeader[4] << 16 | pfbHeader[3] << 8 | pfbHeader[2];
    }
    const eexecBlock = getEexecBlock(file, eexecBlockLength);
    const eexecBlockParser = new Type1Parser(
      eexecBlock.stream,
      true,
      SEAC_ANALYSIS_ENABLED,
      this.onAllocation
    );
    const data = eexecBlockParser.extractFontProgram(properties);
    this.#rawFileLength = headerBlock.length + eexecBlock.length;
    return data;
  }
  #parseCidKeyedType1(file, properties) {
    const fileStart = file.pos;
    const length = file.end - fileStart;
    const parser = new Type1Parser(file, false, SEAC_ANALYSIS_ENABLED, this.onAllocation);
    const data = parser.extractCidKeyedFontProgram(properties);
    if (!data) {
      file.pos = fileStart;
      warn("Type1Font: unable to parse CID-keyed Type 1 font.");
      return null;
    }
    this.#rawFileLength = length;
    return data;
  }
  get numGlyphs() {
    return this.charstrings.length + 1;
  }
  getCharset() {
    this.onAllocation?.(256 + this.charstrings.length * 16);
    const charset = [".notdef"];
    for (const { glyphName } of this.charstrings) {
      charset.push(glyphName);
    }
    return charset;
  }
  getGlyphMapping(properties) {
    this.onAllocation?.(65536 + this.charstrings.length * 128);
    const charstrings = this.charstrings;
    if (properties.composite) {
      const charCodeToGlyphId = /* @__PURE__ */ new Map();
      for (let glyphId2 = 0, charstringsLen = charstrings.length; glyphId2 < charstringsLen; glyphId2++) {
        const charCode = properties.cMap.charCodeOf(glyphId2);
        charCodeToGlyphId.set(charCode, glyphId2 + 1);
      }
      return charCodeToGlyphId;
    }
    const glyphNames = [".notdef"];
    let builtInEncoding, glyphId;
    for (glyphId = 0; glyphId < charstrings.length; glyphId++) {
      glyphNames.push(charstrings[glyphId].glyphName);
    }
    const encoding = properties.builtInEncoding;
    if (encoding) {
      builtInEncoding = /* @__PURE__ */ Object.create(null);
      for (const charCode in encoding) {
        glyphId = glyphNames.indexOf(encoding[charCode]);
        if (glyphId >= 0) {
          builtInEncoding[charCode] = glyphId;
        }
      }
    }
    return type1FontGlyphMapping(properties, builtInEncoding, glyphNames);
  }
  hasGlyphId(id) {
    if (id < 0 || id >= this.numGlyphs) {
      return false;
    }
    if (id === 0) {
      return true;
    }
    const glyph = this.charstrings[id - 1];
    return glyph.charstring.length > 0;
  }
  getSeacs(charstrings) {
    this.onAllocation?.(256 + charstrings.length * 64);
    const seacs = /* @__PURE__ */ new Map();
    for (let i = 0, ii = charstrings.length; i < ii; i++) {
      const { seac } = charstrings[i];
      if (seac) {
        seacs.set(i + 1, seac);
      }
    }
    return seacs;
  }
  getType2Charstrings(type1Charstrings) {
    this.onAllocation?.(256 + type1Charstrings.length * 16);
    const type2Charstrings = [];
    for (const type1Charstring of type1Charstrings) {
      type2Charstrings.push(type1Charstring.charstring);
    }
    return type2Charstrings;
  }
  getType2Subrs(type1Subrs) {
    let bias = 0;
    const count = type1Subrs.length;
    if (count < 1133) {
      bias = 107;
    } else if (count < 33769) {
      bias = 1131;
    } else {
      bias = 32768;
    }
    this.onAllocation?.(256 + (count + bias) * 64);
    const type2Subrs = [];
    let i;
    for (i = 0; i < bias; i++) {
      type2Subrs.push([11]);
    }
    for (i = 0; i < count; i++) {
      type2Subrs.push(type1Subrs[i]);
    }
    return type2Subrs;
  }
  wrap(name, glyphs, charstrings, subrs, properties) {
    this.onAllocation?.(4096 + glyphs.length * 256 + subrs.length * 128);
    const cff = new CFF(this.#rawFileLength);
    cff.header = new CFFHeader(1, 0, 4, 4);
    cff.names = [name];
    const topDict = new CFFTopDict();
    topDict.setByName("version", 391);
    topDict.setByName("Notice", 392);
    topDict.setByName("FullName", 393);
    topDict.setByName("FamilyName", 394);
    topDict.setByName("Weight", 395);
    topDict.setByName("Encoding", null);
    topDict.setByName("FontMatrix", properties.fontMatrix);
    topDict.setByName("FontBBox", properties.bbox);
    topDict.setByName("charset", null);
    topDict.setByName("CharStrings", null);
    topDict.setByName("Private", null);
    cff.topDict = topDict;
    const strings = new CFFStrings();
    strings.add("Version 0.11");
    strings.add("See original notice");
    strings.add(name);
    strings.add(name);
    strings.add("Medium");
    cff.strings = strings;
    cff.globalSubrIndex = new CFFIndex();
    const count = glyphs.length;
    const charsetArray = [".notdef"];
    for (let i = 0; i < count; i++) {
      const { glyphName } = charstrings[i];
      const index = CFFStandardStrings.indexOf(glyphName);
      if (index === -1) {
        strings.add(glyphName);
      }
      charsetArray.push(glyphName);
    }
    cff.charset = new CFFCharset(false, 0, charsetArray);
    const charStringsIndex = new CFFIndex();
    charStringsIndex.add(new Uint8Array([139, 14]));
    for (let i = 0; i < count; i++) {
      this.onAllocation?.(glyphs[i].length);
      charStringsIndex.add(Uint8Array.from(glyphs[i]));
    }
    cff.charStrings = charStringsIndex;
    const privateDict = new CFFPrivateDict();
    privateDict.setByName("Subrs", null);
    const fields = [
      "BlueValues",
      "OtherBlues",
      "FamilyBlues",
      "FamilyOtherBlues",
      "StemSnapH",
      "StemSnapV",
      "BlueShift",
      "BlueFuzz",
      "BlueScale",
      "LanguageGroup",
      "ExpansionFactor",
      "ForceBold",
      "StdHW",
      "StdVW"
    ];
    for (const field of fields) {
      if (!properties.privateData.has(field)) {
        continue;
      }
      const value = properties.privateData.get(field);
      if (Array.isArray(value)) {
        for (let j = value.length - 1; j > 0; j--) {
          value[j] -= value[j - 1];
        }
      }
      privateDict.setByName(field, value);
    }
    cff.topDict.privateDict = privateDict;
    const subrIndex = new CFFIndex();
    for (const subr of subrs) {
      this.onAllocation?.(subr.length);
      subrIndex.add(Uint8Array.from(subr));
    }
    privateDict.subrsIndex = subrIndex;
    return cff;
  }
};

// src/core/calculate_sha_other.js
var Word64 = class {
  constructor(highInteger, lowInteger) {
    this.high = highInteger | 0;
    this.low = lowInteger | 0;
  }
  and(word) {
    this.high &= word.high;
    this.low &= word.low;
  }
  xor(word) {
    this.high ^= word.high;
    this.low ^= word.low;
  }
  /**
   * @param {number} places - An integer, must satisfy `places < 32`.
   * @returns {undefined}
   */
  shiftRight(places) {
    this.low = this.low >>> places | this.high << 32 - places;
    this.high = this.high >>> places | 0;
  }
  rotateRight(places) {
    let low, high;
    if (places & 32) {
      high = this.low;
      low = this.high;
    } else {
      low = this.low;
      high = this.high;
    }
    places &= 31;
    this.low = low >>> places | high << 32 - places;
    this.high = high >>> places | low << 32 - places;
  }
  not() {
    this.high = ~this.high;
    this.low = ~this.low;
  }
  add(word) {
    const lowAdd = (this.low >>> 0) + (word.low >>> 0);
    let highAdd = (this.high >>> 0) + (word.high >>> 0);
    if (lowAdd > 4294967295) {
      highAdd += 1;
    }
    this.low = lowAdd | 0;
    this.high = highAdd | 0;
  }
  copyTo(bytes, offset) {
    bytes[offset] = this.high >>> 24 & 255;
    bytes[offset + 1] = this.high >> 16 & 255;
    bytes[offset + 2] = this.high >> 8 & 255;
    bytes[offset + 3] = this.high & 255;
    bytes[offset + 4] = this.low >>> 24 & 255;
    bytes[offset + 5] = this.low >> 16 & 255;
    bytes[offset + 6] = this.low >> 8 & 255;
    bytes[offset + 7] = this.low & 255;
  }
  assign(word) {
    this.high = word.high;
    this.low = word.low;
  }
};
var PARAMS = {
  get k() {
    return shadow(this, "k", [
      new Word64(1116352408, 3609767458),
      new Word64(1899447441, 602891725),
      new Word64(3049323471, 3964484399),
      new Word64(3921009573, 2173295548),
      new Word64(961987163, 4081628472),
      new Word64(1508970993, 3053834265),
      new Word64(2453635748, 2937671579),
      new Word64(2870763221, 3664609560),
      new Word64(3624381080, 2734883394),
      new Word64(310598401, 1164996542),
      new Word64(607225278, 1323610764),
      new Word64(1426881987, 3590304994),
      new Word64(1925078388, 4068182383),
      new Word64(2162078206, 991336113),
      new Word64(2614888103, 633803317),
      new Word64(3248222580, 3479774868),
      new Word64(3835390401, 2666613458),
      new Word64(4022224774, 944711139),
      new Word64(264347078, 2341262773),
      new Word64(604807628, 2007800933),
      new Word64(770255983, 1495990901),
      new Word64(1249150122, 1856431235),
      new Word64(1555081692, 3175218132),
      new Word64(1996064986, 2198950837),
      new Word64(2554220882, 3999719339),
      new Word64(2821834349, 766784016),
      new Word64(2952996808, 2566594879),
      new Word64(3210313671, 3203337956),
      new Word64(3336571891, 1034457026),
      new Word64(3584528711, 2466948901),
      new Word64(113926993, 3758326383),
      new Word64(338241895, 168717936),
      new Word64(666307205, 1188179964),
      new Word64(773529912, 1546045734),
      new Word64(1294757372, 1522805485),
      new Word64(1396182291, 2643833823),
      new Word64(1695183700, 2343527390),
      new Word64(1986661051, 1014477480),
      new Word64(2177026350, 1206759142),
      new Word64(2456956037, 344077627),
      new Word64(2730485921, 1290863460),
      new Word64(2820302411, 3158454273),
      new Word64(3259730800, 3505952657),
      new Word64(3345764771, 106217008),
      new Word64(3516065817, 3606008344),
      new Word64(3600352804, 1432725776),
      new Word64(4094571909, 1467031594),
      new Word64(275423344, 851169720),
      new Word64(430227734, 3100823752),
      new Word64(506948616, 1363258195),
      new Word64(659060556, 3750685593),
      new Word64(883997877, 3785050280),
      new Word64(958139571, 3318307427),
      new Word64(1322822218, 3812723403),
      new Word64(1537002063, 2003034995),
      new Word64(1747873779, 3602036899),
      new Word64(1955562222, 1575990012),
      new Word64(2024104815, 1125592928),
      new Word64(2227730452, 2716904306),
      new Word64(2361852424, 442776044),
      new Word64(2428436474, 593698344),
      new Word64(2756734187, 3733110249),
      new Word64(3204031479, 2999351573),
      new Word64(3329325298, 3815920427),
      new Word64(3391569614, 3928383900),
      new Word64(3515267271, 566280711),
      new Word64(3940187606, 3454069534),
      new Word64(4118630271, 4000239992),
      new Word64(116418474, 1914138554),
      new Word64(174292421, 2731055270),
      new Word64(289380356, 3203993006),
      new Word64(460393269, 320620315),
      new Word64(685471733, 587496836),
      new Word64(852142971, 1086792851),
      new Word64(1017036298, 365543100),
      new Word64(1126000580, 2618297676),
      new Word64(1288033470, 3409855158),
      new Word64(1501505948, 4234509866),
      new Word64(1607167915, 987167468),
      new Word64(1816402316, 1246189591)
    ]);
  }
};
function ch(result, x, y, z, tmp) {
  result.assign(x);
  result.and(y);
  tmp.assign(x);
  tmp.not();
  tmp.and(z);
  result.xor(tmp);
}
function maj(result, x, y, z, tmp) {
  result.assign(x);
  result.and(y);
  tmp.assign(x);
  tmp.and(z);
  result.xor(tmp);
  tmp.assign(y);
  tmp.and(z);
  result.xor(tmp);
}
function sigma(result, x, tmp) {
  result.assign(x);
  result.rotateRight(28);
  tmp.assign(x);
  tmp.rotateRight(34);
  result.xor(tmp);
  tmp.assign(x);
  tmp.rotateRight(39);
  result.xor(tmp);
}
function sigmaPrime(result, x, tmp) {
  result.assign(x);
  result.rotateRight(14);
  tmp.assign(x);
  tmp.rotateRight(18);
  result.xor(tmp);
  tmp.assign(x);
  tmp.rotateRight(41);
  result.xor(tmp);
}
function littleSigma(result, x, tmp) {
  result.assign(x);
  result.rotateRight(1);
  tmp.assign(x);
  tmp.rotateRight(8);
  result.xor(tmp);
  tmp.assign(x);
  tmp.shiftRight(7);
  result.xor(tmp);
}
function littleSigmaPrime(result, x, tmp) {
  result.assign(x);
  result.rotateRight(19);
  tmp.assign(x);
  tmp.rotateRight(61);
  result.xor(tmp);
  tmp.assign(x);
  tmp.shiftRight(6);
  result.xor(tmp);
}
function calculateSHA512(data, offset, length, mode384 = false) {
  let h0, h1, h2, h3, h4, h5, h6, h7;
  if (!mode384) {
    h0 = new Word64(1779033703, 4089235720);
    h1 = new Word64(3144134277, 2227873595);
    h2 = new Word64(1013904242, 4271175723);
    h3 = new Word64(2773480762, 1595750129);
    h4 = new Word64(1359893119, 2917565137);
    h5 = new Word64(2600822924, 725511199);
    h6 = new Word64(528734635, 4215389547);
    h7 = new Word64(1541459225, 327033209);
  } else {
    h0 = new Word64(3418070365, 3238371032);
    h1 = new Word64(1654270250, 914150663);
    h2 = new Word64(2438529370, 812702999);
    h3 = new Word64(355462360, 4144912697);
    h4 = new Word64(1731405415, 4290775857);
    h5 = new Word64(2394180231, 1750603025);
    h6 = new Word64(3675008525, 1694076839);
    h7 = new Word64(1203062813, 3204075428);
  }
  const paddedLength = Math.ceil((length + 17) / 128) * 128;
  const padded = new Uint8Array(paddedLength);
  let i, j;
  for (i = 0; i < length; ++i) {
    padded[i] = data[offset++];
  }
  padded[i++] = 128;
  const n = paddedLength - 16;
  if (i < n) {
    i = n;
  }
  i += 11;
  padded[i++] = length >>> 29 & 255;
  padded[i++] = length >> 21 & 255;
  padded[i++] = length >> 13 & 255;
  padded[i++] = length >> 5 & 255;
  padded[i++] = length << 3 & 255;
  const w = new Array(80);
  for (i = 0; i < 80; i++) {
    w[i] = new Word64(0, 0);
  }
  const { k } = PARAMS;
  let a = new Word64(0, 0), b = new Word64(0, 0), c = new Word64(0, 0);
  let d = new Word64(0, 0), e = new Word64(0, 0), f = new Word64(0, 0);
  let g = new Word64(0, 0), h = new Word64(0, 0);
  const t1 = new Word64(0, 0), t2 = new Word64(0, 0);
  const tmp1 = new Word64(0, 0), tmp2 = new Word64(0, 0);
  let tmp3;
  for (i = 0; i < paddedLength; ) {
    for (j = 0; j < 16; ++j) {
      w[j].high = padded[i] << 24 | padded[i + 1] << 16 | padded[i + 2] << 8 | padded[i + 3];
      w[j].low = padded[i + 4] << 24 | padded[i + 5] << 16 | padded[i + 6] << 8 | padded[i + 7];
      i += 8;
    }
    for (j = 16; j < 80; ++j) {
      tmp3 = w[j];
      littleSigmaPrime(tmp3, w[j - 2], tmp2);
      tmp3.add(w[j - 7]);
      littleSigma(tmp1, w[j - 15], tmp2);
      tmp3.add(tmp1);
      tmp3.add(w[j - 16]);
    }
    a.assign(h0);
    b.assign(h1);
    c.assign(h2);
    d.assign(h3);
    e.assign(h4);
    f.assign(h5);
    g.assign(h6);
    h.assign(h7);
    for (j = 0; j < 80; ++j) {
      t1.assign(h);
      sigmaPrime(tmp1, e, tmp2);
      t1.add(tmp1);
      ch(tmp1, e, f, g, tmp2);
      t1.add(tmp1);
      t1.add(k[j]);
      t1.add(w[j]);
      sigma(t2, a, tmp2);
      maj(tmp1, a, b, c, tmp2);
      t2.add(tmp1);
      tmp3 = h;
      h = g;
      g = f;
      f = e;
      d.add(t1);
      e = d;
      d = c;
      c = b;
      b = a;
      tmp3.assign(t1);
      tmp3.add(t2);
      a = tmp3;
    }
    h0.add(a);
    h1.add(b);
    h2.add(c);
    h3.add(d);
    h4.add(e);
    h5.add(f);
    h6.add(g);
    h7.add(h);
  }
  let result;
  if (!mode384) {
    result = new Uint8Array(64);
    h0.copyTo(result, 0);
    h1.copyTo(result, 8);
    h2.copyTo(result, 16);
    h3.copyTo(result, 24);
    h4.copyTo(result, 32);
    h5.copyTo(result, 40);
    h6.copyTo(result, 48);
    h7.copyTo(result, 56);
  } else {
    result = new Uint8Array(48);
    h0.copyTo(result, 0);
    h1.copyTo(result, 8);
    h2.copyTo(result, 16);
    h3.copyTo(result, 24);
    h4.copyTo(result, 32);
    h5.copyTo(result, 40);
  }
  return result;
}
function calculateSHA384(data, offset, length) {
  return calculateSHA512(
    data,
    offset,
    length,
    /* mode384 = */
    true
  );
}

// src/core/calculate_md5.js
var PARAMS2 = {
  get r() {
    return shadow(
      this,
      "r",
      new Uint8Array([
        7,
        12,
        17,
        22,
        7,
        12,
        17,
        22,
        7,
        12,
        17,
        22,
        7,
        12,
        17,
        22,
        5,
        9,
        14,
        20,
        5,
        9,
        14,
        20,
        5,
        9,
        14,
        20,
        5,
        9,
        14,
        20,
        4,
        11,
        16,
        23,
        4,
        11,
        16,
        23,
        4,
        11,
        16,
        23,
        4,
        11,
        16,
        23,
        6,
        10,
        15,
        21,
        6,
        10,
        15,
        21,
        6,
        10,
        15,
        21,
        6,
        10,
        15,
        21
      ])
    );
  },
  get k() {
    return shadow(
      this,
      "k",
      new Int32Array([
        -680876936,
        -389564586,
        606105819,
        -1044525330,
        -176418897,
        1200080426,
        -1473231341,
        -45705983,
        1770035416,
        -1958414417,
        -42063,
        -1990404162,
        1804603682,
        -40341101,
        -1502002290,
        1236535329,
        -165796510,
        -1069501632,
        643717713,
        -373897302,
        -701558691,
        38016083,
        -660478335,
        -405537848,
        568446438,
        -1019803690,
        -187363961,
        1163531501,
        -1444681467,
        -51403784,
        1735328473,
        -1926607734,
        -378558,
        -2022574463,
        1839030562,
        -35309556,
        -1530992060,
        1272893353,
        -155497632,
        -1094730640,
        681279174,
        -358537222,
        -722521979,
        76029189,
        -640364487,
        -421815835,
        530742520,
        -995338651,
        -198630844,
        1126891415,
        -1416354905,
        -57434055,
        1700485571,
        -1894986606,
        -1051523,
        -2054922799,
        1873313359,
        -30611744,
        -1560198380,
        1309151649,
        -145523070,
        -1120210379,
        718787259,
        -343485551
      ])
    );
  }
};
function calculateMD5(data, offset, length) {
  let h0 = 1732584193, h1 = -271733879, h2 = -1732584194, h3 = 271733878;
  const paddedLength = length + 72 & ~63;
  const padded = new Uint8Array(paddedLength);
  let i, j;
  for (i = 0; i < length; ++i) {
    padded[i] = data[offset++];
  }
  padded[i++] = 128;
  const n = paddedLength - 8;
  if (i < n) {
    i = n;
  }
  padded[i++] = length << 3 & 255;
  padded[i++] = length >> 5 & 255;
  padded[i++] = length >> 13 & 255;
  padded[i++] = length >> 21 & 255;
  padded[i++] = length >>> 29 & 255;
  i += 3;
  const w = new Int32Array(16);
  const { k, r } = PARAMS2;
  for (i = 0; i < paddedLength; ) {
    for (j = 0; j < 16; ++j, i += 4) {
      w[j] = padded[i] | padded[i + 1] << 8 | padded[i + 2] << 16 | padded[i + 3] << 24;
    }
    let a = h0, b = h1, c = h2, d = h3, f, g;
    for (j = 0; j < 64; ++j) {
      if (j < 16) {
        f = b & c | ~b & d;
        g = j;
      } else if (j < 32) {
        f = d & b | ~d & c;
        g = 5 * j + 1 & 15;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = 3 * j + 5 & 15;
      } else {
        f = c ^ (b | ~d);
        g = 7 * j & 15;
      }
      const tmp = d, rotateArg = a + f + k[j] + w[g] | 0, rotate = r[j];
      d = c;
      c = b;
      b = b + (rotateArg << rotate | rotateArg >>> 32 - rotate) | 0;
      a = tmp;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
  }
  return new Uint8Array([
    h0 & 255,
    h0 >> 8 & 255,
    h0 >> 16 & 255,
    h0 >>> 24 & 255,
    h1 & 255,
    h1 >> 8 & 255,
    h1 >> 16 & 255,
    h1 >>> 24 & 255,
    h2 & 255,
    h2 >> 8 & 255,
    h2 >> 16 & 255,
    h2 >>> 24 & 255,
    h3 & 255,
    h3 >> 8 & 255,
    h3 >> 16 & 255,
    h3 >>> 24 & 255
  ]);
}

// src/core/calculate_sha256.js
var PARAMS3 = {
  get k() {
    return shadow(
      this,
      "k",
      [
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ]
    );
  }
};
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function ch2(x, y, z) {
  return x & y ^ ~x & z;
}
function maj2(x, y, z) {
  return x & y ^ x & z ^ y & z;
}
function sigma2(x) {
  return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}
function sigmaPrime2(x) {
  return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}
function littleSigma2(x) {
  return rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3;
}
function littleSigmaPrime2(x) {
  return rotr(x, 17) ^ rotr(x, 19) ^ x >>> 10;
}
function calculateSHA256(data, offset, length) {
  let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762, h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  let i, j;
  for (i = 0; i < length; ++i) {
    padded[i] = data[offset++];
  }
  padded[i++] = 128;
  const n = paddedLength - 8;
  if (i < n) {
    i = n;
  }
  i += 3;
  padded[i++] = length >>> 29 & 255;
  padded[i++] = length >> 21 & 255;
  padded[i++] = length >> 13 & 255;
  padded[i++] = length >> 5 & 255;
  padded[i++] = length << 3 & 255;
  const w = new Uint32Array(64);
  const { k } = PARAMS3;
  for (i = 0; i < paddedLength; ) {
    for (j = 0; j < 16; ++j) {
      w[j] = padded[i] << 24 | padded[i + 1] << 16 | padded[i + 2] << 8 | padded[i + 3];
      i += 4;
    }
    for (j = 16; j < 64; ++j) {
      w[j] = littleSigmaPrime2(w[j - 2]) + w[j - 7] + littleSigma2(w[j - 15]) + w[j - 16] | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7, t1, t2;
    for (j = 0; j < 64; ++j) {
      t1 = h + sigmaPrime2(e) + ch2(e, f, g) + k[j] + w[j];
      t2 = sigma2(a) + maj2(a, b, c);
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  return new Uint8Array([
    h0 >> 24 & 255,
    h0 >> 16 & 255,
    h0 >> 8 & 255,
    h0 & 255,
    h1 >> 24 & 255,
    h1 >> 16 & 255,
    h1 >> 8 & 255,
    h1 & 255,
    h2 >> 24 & 255,
    h2 >> 16 & 255,
    h2 >> 8 & 255,
    h2 & 255,
    h3 >> 24 & 255,
    h3 >> 16 & 255,
    h3 >> 8 & 255,
    h3 & 255,
    h4 >> 24 & 255,
    h4 >> 16 & 255,
    h4 >> 8 & 255,
    h4 & 255,
    h5 >> 24 & 255,
    h5 >> 16 & 255,
    h5 >> 8 & 255,
    h5 & 255,
    h6 >> 24 & 255,
    h6 >> 16 & 255,
    h6 >> 8 & 255,
    h6 & 255,
    h7 >> 24 & 255,
    h7 >> 16 & 255,
    h7 >> 8 & 255,
    h7 & 255
  ]);
}

// src/core/decode_stream.js
var emptyBuffer = new Uint8Array(0);
var DecodeStream = class extends BaseStream {
  buffer = emptyBuffer;
  bufferLength = 0;
  eof = false;
  minBufferLength = 512;
  pos = 0;
  constructor(maybeMinBufferLength) {
    super();
    this._rawMinBufferLength = maybeMinBufferLength || 0;
    if (maybeMinBufferLength) {
      while (this.minBufferLength < maybeMinBufferLength) {
        this.minBufferLength *= 2;
      }
    }
  }
  readBlock() {
    unreachable("Abstract method `readBlock` called");
  }
  get isEmpty() {
    while (!this.eof && this.bufferLength === 0) {
      this.readBlock();
    }
    return this.bufferLength === 0;
  }
  ensureBuffer(requested) {
    const buffer = this.buffer;
    if (requested <= buffer.byteLength) {
      return buffer;
    }
    let size = this.minBufferLength;
    while (size < requested) {
      size *= 2;
    }
    const buffer2 = new Uint8Array(size);
    buffer2.set(buffer);
    return this.buffer = buffer2;
  }
  getByte() {
    const pos = this.pos;
    while (this.bufferLength <= pos) {
      if (this.eof) {
        return -1;
      }
      this.readBlock();
    }
    return this.buffer[this.pos++];
  }
  getBytes(length, decoderOptions = null) {
    const pos = this.pos;
    let end;
    if (length) {
      this.ensureBuffer(pos + length);
      end = pos + length;
      while (!this.eof && this.bufferLength < end) {
        this.readBlock(decoderOptions);
      }
      const bufEnd = this.bufferLength;
      if (end > bufEnd) {
        end = bufEnd;
      }
    } else {
      while (!this.eof) {
        this.readBlock(decoderOptions);
      }
      end = this.bufferLength;
    }
    this.pos = end;
    return this.buffer.subarray(pos, end);
  }
  async getImageData(length, decoderOptions) {
    if (!this.canAsyncDecodeImageFromBuffer) {
      return this.isAsyncDecoder ? this.decodeImage(null, length, decoderOptions) : this.getBytes(length, decoderOptions);
    }
    const data = await this.stream.asyncGetBytes();
    return this.decodeImage(data, length, decoderOptions);
  }
  async asyncGetBytesFromDecompressionStream(name) {
    this.stream.reset();
    const bytes = this.stream.isAsync ? await this.stream.asyncGetBytes() : this.stream.getBytes();
    try {
      const { readable, writable } = new DecompressionStream(name);
      const writer = writable.getWriter();
      await writer.ready;
      writer.write(bytes).then(async () => {
        await writer.ready;
        await writer.close();
      }).catch(() => {
      });
      const chunks = [];
      let totalLength = 0;
      for await (const chunk of readable) {
        chunks.push(chunk);
        totalLength += chunk.byteLength;
      }
      const data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { decompressed: data, compressed: bytes };
    } catch {
      return { decompressed: null, compressed: bytes };
    }
  }
  reset() {
    this.pos = 0;
  }
  makeSubStream(start, length, dict = null) {
    if (length === void 0) {
      while (!this.eof) {
        this.readBlock();
      }
    } else {
      const end = start + length;
      while (this.bufferLength <= end && !this.eof) {
        this.readBlock();
      }
    }
    return new Stream(this.buffer, start, length, dict);
  }
  clone() {
    while (!this.eof) {
      this.readBlock();
    }
    return new Stream(this.buffer, 0, this.bufferLength, this.dict?.clone());
  }
  getBaseStreams() {
    return this.stream ? this.stream.getBaseStreams() : null;
  }
};

// src/core/decrypt_stream.js
var chunkSize = 512;
var DecryptStream = class extends DecodeStream {
  #nextChunk = null;
  constructor(str, maybeLength, decrypt2) {
    super(maybeLength);
    this.stream = str;
    this.dict = str.dict;
    this.decrypt = decrypt2;
  }
  readBlock() {
    let chunk = this.#nextChunk ?? this.stream.getBytes(chunkSize);
    if (!chunk.length) {
      this.eof = true;
      return;
    }
    this.#nextChunk = this.stream.getBytes(chunkSize);
    const hasMoreData = this.#nextChunk.length > 0;
    const decrypt2 = this.decrypt;
    chunk = decrypt2(chunk, !hasMoreData);
    const bufferLength = this.bufferLength, newLength = bufferLength + chunk.length, buffer = this.ensureBuffer(newLength);
    buffer.set(chunk, bufferLength);
    this.bufferLength = newLength;
  }
  getOriginalStream() {
    return this;
  }
};

// src/core/sasl_prep.js
var NON_ASCII_SPACES = /* @__PURE__ */ new Set([
  160,
  5760,
  8192,
  8193,
  8194,
  8195,
  8196,
  8197,
  8198,
  8199,
  8200,
  8201,
  8202,
  8203,
  8239,
  8287,
  12288
]);
var COMMONLY_MAPPED_TO_NOTHING = /* @__PURE__ */ new Set([
  173,
  847,
  6150,
  6155,
  6156,
  6157,
  8203,
  8204,
  8205,
  8288,
  65024,
  65025,
  65026,
  65027,
  65028,
  65029,
  65030,
  65031,
  65032,
  65033,
  65034,
  65035,
  65036,
  65037,
  65038,
  65039,
  65279
]);
function saslPrep(str) {
  let mapped = "";
  for (const char of str) {
    const code = char.codePointAt(0);
    if (NON_ASCII_SPACES.has(code)) {
      mapped += " ";
    } else if (!COMMONLY_MAPPED_TO_NOTHING.has(code)) {
      mapped += char;
    }
  }
  return mapped.normalize("NFKC");
}

// src/core/crypto.js
var ARCFourCipher = class {
  a = 0;
  b = 0;
  constructor(key) {
    const s = Uint8Array.from({ length: 256 }, (_, i) => i);
    const keyLength = key.length;
    for (let i = 0, j = 0; i < 256; ++i) {
      const tmp = s[i];
      j = j + tmp + key[i % keyLength] & 255;
      s[i] = s[j];
      s[j] = tmp;
    }
    this.s = s;
  }
  encryptBlock(data) {
    let a = this.a, b = this.b;
    const s = this.s;
    const n = data.length;
    const output = new Uint8Array(n);
    for (let i = 0; i < n; ++i) {
      a = a + 1 & 255;
      const tmp = s[a];
      b = b + tmp & 255;
      const tmp2 = s[b];
      s[a] = tmp2;
      s[b] = tmp;
      output[i] = data[i] ^ s[tmp + tmp2 & 255];
    }
    this.a = a;
    this.b = b;
    return output;
  }
  decryptBlock(data) {
    return this.encryptBlock(data);
  }
  encrypt(data) {
    return this.encryptBlock(data);
  }
};
var NullCipher = class {
  decryptBlock(data) {
    return data;
  }
  encrypt(data) {
    return data;
  }
};
var AESBaseCipher = class _AESBaseCipher {
  _s = new Uint8Array([
    99,
    124,
    119,
    123,
    242,
    107,
    111,
    197,
    48,
    1,
    103,
    43,
    254,
    215,
    171,
    118,
    202,
    130,
    201,
    125,
    250,
    89,
    71,
    240,
    173,
    212,
    162,
    175,
    156,
    164,
    114,
    192,
    183,
    253,
    147,
    38,
    54,
    63,
    247,
    204,
    52,
    165,
    229,
    241,
    113,
    216,
    49,
    21,
    4,
    199,
    35,
    195,
    24,
    150,
    5,
    154,
    7,
    18,
    128,
    226,
    235,
    39,
    178,
    117,
    9,
    131,
    44,
    26,
    27,
    110,
    90,
    160,
    82,
    59,
    214,
    179,
    41,
    227,
    47,
    132,
    83,
    209,
    0,
    237,
    32,
    252,
    177,
    91,
    106,
    203,
    190,
    57,
    74,
    76,
    88,
    207,
    208,
    239,
    170,
    251,
    67,
    77,
    51,
    133,
    69,
    249,
    2,
    127,
    80,
    60,
    159,
    168,
    81,
    163,
    64,
    143,
    146,
    157,
    56,
    245,
    188,
    182,
    218,
    33,
    16,
    255,
    243,
    210,
    205,
    12,
    19,
    236,
    95,
    151,
    68,
    23,
    196,
    167,
    126,
    61,
    100,
    93,
    25,
    115,
    96,
    129,
    79,
    220,
    34,
    42,
    144,
    136,
    70,
    238,
    184,
    20,
    222,
    94,
    11,
    219,
    224,
    50,
    58,
    10,
    73,
    6,
    36,
    92,
    194,
    211,
    172,
    98,
    145,
    149,
    228,
    121,
    231,
    200,
    55,
    109,
    141,
    213,
    78,
    169,
    108,
    86,
    244,
    234,
    101,
    122,
    174,
    8,
    186,
    120,
    37,
    46,
    28,
    166,
    180,
    198,
    232,
    221,
    116,
    31,
    75,
    189,
    139,
    138,
    112,
    62,
    181,
    102,
    72,
    3,
    246,
    14,
    97,
    53,
    87,
    185,
    134,
    193,
    29,
    158,
    225,
    248,
    152,
    17,
    105,
    217,
    142,
    148,
    155,
    30,
    135,
    233,
    206,
    85,
    40,
    223,
    140,
    161,
    137,
    13,
    191,
    230,
    66,
    104,
    65,
    153,
    45,
    15,
    176,
    84,
    187,
    22
  ]);
  _inv_s = new Uint8Array([
    82,
    9,
    106,
    213,
    48,
    54,
    165,
    56,
    191,
    64,
    163,
    158,
    129,
    243,
    215,
    251,
    124,
    227,
    57,
    130,
    155,
    47,
    255,
    135,
    52,
    142,
    67,
    68,
    196,
    222,
    233,
    203,
    84,
    123,
    148,
    50,
    166,
    194,
    35,
    61,
    238,
    76,
    149,
    11,
    66,
    250,
    195,
    78,
    8,
    46,
    161,
    102,
    40,
    217,
    36,
    178,
    118,
    91,
    162,
    73,
    109,
    139,
    209,
    37,
    114,
    248,
    246,
    100,
    134,
    104,
    152,
    22,
    212,
    164,
    92,
    204,
    93,
    101,
    182,
    146,
    108,
    112,
    72,
    80,
    253,
    237,
    185,
    218,
    94,
    21,
    70,
    87,
    167,
    141,
    157,
    132,
    144,
    216,
    171,
    0,
    140,
    188,
    211,
    10,
    247,
    228,
    88,
    5,
    184,
    179,
    69,
    6,
    208,
    44,
    30,
    143,
    202,
    63,
    15,
    2,
    193,
    175,
    189,
    3,
    1,
    19,
    138,
    107,
    58,
    145,
    17,
    65,
    79,
    103,
    220,
    234,
    151,
    242,
    207,
    206,
    240,
    180,
    230,
    115,
    150,
    172,
    116,
    34,
    231,
    173,
    53,
    133,
    226,
    249,
    55,
    232,
    28,
    117,
    223,
    110,
    71,
    241,
    26,
    113,
    29,
    41,
    197,
    137,
    111,
    183,
    98,
    14,
    170,
    24,
    190,
    27,
    252,
    86,
    62,
    75,
    198,
    210,
    121,
    32,
    154,
    219,
    192,
    254,
    120,
    205,
    90,
    244,
    31,
    221,
    168,
    51,
    136,
    7,
    199,
    49,
    177,
    18,
    16,
    89,
    39,
    128,
    236,
    95,
    96,
    81,
    127,
    169,
    25,
    181,
    74,
    13,
    45,
    229,
    122,
    159,
    147,
    201,
    156,
    239,
    160,
    224,
    59,
    77,
    174,
    42,
    245,
    176,
    200,
    235,
    187,
    60,
    131,
    83,
    153,
    97,
    23,
    43,
    4,
    126,
    186,
    119,
    214,
    38,
    225,
    105,
    20,
    99,
    85,
    33,
    12,
    125
  ]);
  _mix = new Uint32Array([
    0,
    235474187,
    470948374,
    303765277,
    941896748,
    908933415,
    607530554,
    708780849,
    1883793496,
    2118214995,
    1817866830,
    1649639237,
    1215061108,
    1181045119,
    1417561698,
    1517767529,
    3767586992,
    4003061179,
    4236429990,
    4069246893,
    3635733660,
    3602770327,
    3299278474,
    3400528769,
    2430122216,
    2664543715,
    2362090238,
    2193862645,
    2835123396,
    2801107407,
    3035535058,
    3135740889,
    3678124923,
    3576870512,
    3341394285,
    3374361702,
    3810496343,
    3977675356,
    4279080257,
    4043610186,
    2876494627,
    2776292904,
    3076639029,
    3110650942,
    2472011535,
    2640243204,
    2403728665,
    2169303058,
    1001089995,
    899835584,
    666464733,
    699432150,
    59727847,
    226906860,
    530400753,
    294930682,
    1273168787,
    1172967064,
    1475418501,
    1509430414,
    1942435775,
    2110667444,
    1876241833,
    1641816226,
    2910219766,
    2743034109,
    2976151520,
    3211623147,
    2505202138,
    2606453969,
    2302690252,
    2269728455,
    3711829422,
    3543599269,
    3240894392,
    3475313331,
    3843699074,
    3943906441,
    4178062228,
    4144047775,
    1306967366,
    1139781709,
    1374988112,
    1610459739,
    1975683434,
    2076935265,
    1775276924,
    1742315127,
    1034867998,
    866637845,
    566021896,
    800440835,
    92987698,
    193195065,
    429456164,
    395441711,
    1984812685,
    2017778566,
    1784663195,
    1683407248,
    1315562145,
    1080094634,
    1383856311,
    1551037884,
    101039829,
    135050206,
    437757123,
    337553864,
    1042385657,
    807962610,
    573804783,
    742039012,
    2531067453,
    2564033334,
    2328828971,
    2227573024,
    2935566865,
    2700099354,
    3001755655,
    3168937228,
    3868552805,
    3902563182,
    4203181171,
    4102977912,
    3736164937,
    3501741890,
    3265478751,
    3433712980,
    1106041591,
    1340463100,
    1576976609,
    1408749034,
    2043211483,
    2009195472,
    1708848333,
    1809054150,
    832877231,
    1068351396,
    766945465,
    599762354,
    159417987,
    126454664,
    361929877,
    463180190,
    2709260871,
    2943682380,
    3178106961,
    3009879386,
    2572697195,
    2538681184,
    2236228733,
    2336434550,
    3509871135,
    3745345300,
    3441850377,
    3274667266,
    3910161971,
    3877198648,
    4110568485,
    4211818798,
    2597806476,
    2497604743,
    2261089178,
    2295101073,
    2733856160,
    2902087851,
    3202437046,
    2968011453,
    3936291284,
    3835036895,
    4136440770,
    4169408201,
    3535486456,
    3702665459,
    3467192302,
    3231722213,
    2051518780,
    1951317047,
    1716890410,
    1750902305,
    1113818384,
    1282050075,
    1584504582,
    1350078989,
    168810852,
    67556463,
    371049330,
    404016761,
    841739592,
    1008918595,
    775550814,
    540080725,
    3969562369,
    3801332234,
    4035489047,
    4269907996,
    3569255213,
    3669462566,
    3366754619,
    3332740144,
    2631065433,
    2463879762,
    2160117071,
    2395588676,
    2767645557,
    2868897406,
    3102011747,
    3069049960,
    202008497,
    33778362,
    270040487,
    504459436,
    875451293,
    975658646,
    675039627,
    641025152,
    2084704233,
    1917518562,
    1615861247,
    1851332852,
    1147550661,
    1248802510,
    1484005843,
    1451044056,
    933301370,
    967311729,
    733156972,
    632953703,
    260388950,
    25965917,
    328671808,
    496906059,
    1206477858,
    1239443753,
    1543208500,
    1441952575,
    2144161806,
    1908694277,
    1675577880,
    1842759443,
    3610369226,
    3644379585,
    3408119516,
    3307916247,
    4011190502,
    3776767469,
    4077384432,
    4245618683,
    2809771154,
    2842737049,
    3144396420,
    3043140495,
    2673705150,
    2438237621,
    2203032232,
    2370213795
  ]);
  _mixCol = Uint8Array.from(
    { length: 256 },
    (_, i) => i < 128 ? i << 1 : i << 1 ^ 27
  );
  constructor() {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _AESBaseCipher) {
      unreachable("Cannot initialize AESBaseCipher.");
    }
    this.buffer = new Uint8Array(16);
    this.bufferPosition = 0;
  }
  _expandKey(cipherKey) {
    unreachable("Cannot call `_expandKey` on the base class");
  }
  _decrypt(input, key) {
    let t, u, v;
    const state = new Uint8Array(16);
    state.set(input);
    for (let j = 0, k = this._keySize; j < 16; ++j, ++k) {
      state[j] ^= key[k];
    }
    for (let i = this._cyclesOfRepetition - 1; i >= 1; --i) {
      t = state[13];
      state[13] = state[9];
      state[9] = state[5];
      state[5] = state[1];
      state[1] = t;
      t = state[14];
      u = state[10];
      state[14] = state[6];
      state[10] = state[2];
      state[6] = t;
      state[2] = u;
      t = state[15];
      u = state[11];
      v = state[7];
      state[15] = state[3];
      state[11] = t;
      state[7] = u;
      state[3] = v;
      for (let j = 0; j < 16; ++j) {
        state[j] = this._inv_s[state[j]];
      }
      for (let j = 0, k = i * 16; j < 16; ++j, ++k) {
        state[j] ^= key[k];
      }
      for (let j = 0; j < 16; j += 4) {
        const s0 = this._mix[state[j]];
        const s1 = this._mix[state[j + 1]];
        const s2 = this._mix[state[j + 2]];
        const s3 = this._mix[state[j + 3]];
        t = s0 ^ s1 >>> 8 ^ s1 << 24 ^ s2 >>> 16 ^ s2 << 16 ^ s3 >>> 24 ^ s3 << 8;
        state[j] = t >>> 24 & 255;
        state[j + 1] = t >> 16 & 255;
        state[j + 2] = t >> 8 & 255;
        state[j + 3] = t & 255;
      }
    }
    t = state[13];
    state[13] = state[9];
    state[9] = state[5];
    state[5] = state[1];
    state[1] = t;
    t = state[14];
    u = state[10];
    state[14] = state[6];
    state[10] = state[2];
    state[6] = t;
    state[2] = u;
    t = state[15];
    u = state[11];
    v = state[7];
    state[15] = state[3];
    state[11] = t;
    state[7] = u;
    state[3] = v;
    for (let j = 0; j < 16; ++j) {
      state[j] = this._inv_s[state[j]];
      state[j] ^= key[j];
    }
    return state;
  }
  _encrypt(input, key) {
    const s = this._s;
    let t, u, v;
    const state = new Uint8Array(16);
    state.set(input);
    for (let j = 0; j < 16; ++j) {
      state[j] ^= key[j];
    }
    for (let i = 1; i < this._cyclesOfRepetition; i++) {
      for (let j = 0; j < 16; ++j) {
        state[j] = s[state[j]];
      }
      v = state[1];
      state[1] = state[5];
      state[5] = state[9];
      state[9] = state[13];
      state[13] = v;
      v = state[2];
      u = state[6];
      state[2] = state[10];
      state[6] = state[14];
      state[10] = v;
      state[14] = u;
      v = state[3];
      u = state[7];
      t = state[11];
      state[3] = state[15];
      state[7] = v;
      state[11] = u;
      state[15] = t;
      for (let j = 0; j < 16; j += 4) {
        const s0 = state[j];
        const s1 = state[j + 1];
        const s2 = state[j + 2];
        const s3 = state[j + 3];
        t = s0 ^ s1 ^ s2 ^ s3;
        state[j] ^= t ^ this._mixCol[s0 ^ s1];
        state[j + 1] ^= t ^ this._mixCol[s1 ^ s2];
        state[j + 2] ^= t ^ this._mixCol[s2 ^ s3];
        state[j + 3] ^= t ^ this._mixCol[s3 ^ s0];
      }
      for (let j = 0, k = i * 16; j < 16; ++j, ++k) {
        state[j] ^= key[k];
      }
    }
    for (let j = 0; j < 16; ++j) {
      state[j] = s[state[j]];
    }
    v = state[1];
    state[1] = state[5];
    state[5] = state[9];
    state[9] = state[13];
    state[13] = v;
    v = state[2];
    u = state[6];
    state[2] = state[10];
    state[6] = state[14];
    state[10] = v;
    state[14] = u;
    v = state[3];
    u = state[7];
    t = state[11];
    state[3] = state[15];
    state[7] = v;
    state[11] = u;
    state[15] = t;
    for (let j = 0, k = this._keySize; j < 16; ++j, ++k) {
      state[j] ^= key[k];
    }
    return state;
  }
  _decryptBlock2(data, finalize) {
    const sourceLength = data.length;
    let buffer = this.buffer, bufferLength = this.bufferPosition;
    const result = [];
    let iv = this.iv;
    for (let i = 0; i < sourceLength; ++i) {
      buffer[bufferLength] = data[i];
      ++bufferLength;
      if (bufferLength < 16) {
        continue;
      }
      const plain = this._decrypt(buffer, this._key);
      for (let j = 0; j < 16; ++j) {
        plain[j] ^= iv[j];
      }
      iv = buffer;
      result.push(plain);
      buffer = new Uint8Array(16);
      bufferLength = 0;
    }
    this.buffer = buffer;
    this.bufferLength = bufferLength;
    this.iv = iv;
    if (result.length === 0) {
      return new Uint8Array(0);
    }
    let outputLength = 16 * result.length;
    if (finalize) {
      const lastBlock = result.at(-1);
      let psLen = lastBlock[15];
      if (psLen <= 16) {
        for (let i = 15, ii = 16 - psLen; i >= ii; --i) {
          if (lastBlock[i] !== psLen) {
            psLen = 0;
            break;
          }
        }
        outputLength -= psLen;
        result[result.length - 1] = lastBlock.subarray(0, 16 - psLen);
      }
    }
    const output = new Uint8Array(outputLength);
    for (let i = 0, j = 0, ii = result.length; i < ii; ++i, j += 16) {
      output.set(result[i], j);
    }
    return output;
  }
  decryptBlock(data, finalize, iv = null) {
    const sourceLength = data.length;
    const buffer = this.buffer;
    let bufferLength = this.bufferPosition;
    if (iv) {
      this.iv = iv;
    } else {
      for (let i = 0; bufferLength < 16 && i < sourceLength; ++i, ++bufferLength) {
        buffer[bufferLength] = data[i];
      }
      if (bufferLength < 16) {
        this.bufferLength = bufferLength;
        return new Uint8Array(0);
      }
      this.iv = buffer;
      data = data.subarray(16);
    }
    this.buffer = new Uint8Array(16);
    this.bufferLength = 0;
    this.decryptBlock = this._decryptBlock2;
    return this.decryptBlock(data, finalize);
  }
  encrypt(data, iv) {
    const sourceLength = data.length;
    let buffer = this.buffer, bufferLength = this.bufferPosition;
    const result = [];
    iv ||= new Uint8Array(16);
    for (let i = 0; i < sourceLength; ++i) {
      buffer[bufferLength] = data[i];
      ++bufferLength;
      if (bufferLength < 16) {
        continue;
      }
      for (let j = 0; j < 16; ++j) {
        buffer[j] ^= iv[j];
      }
      const cipher = this._encrypt(buffer, this._key);
      iv = cipher;
      result.push(cipher);
      buffer = new Uint8Array(16);
      bufferLength = 0;
    }
    this.buffer = buffer;
    this.bufferLength = bufferLength;
    this.iv = iv;
    if (result.length === 0) {
      return new Uint8Array(0);
    }
    const outputLength = 16 * result.length;
    const output = new Uint8Array(outputLength);
    for (let i = 0, j = 0, ii = result.length; i < ii; ++i, j += 16) {
      output.set(result[i], j);
    }
    return output;
  }
};
var AES128Cipher = class extends AESBaseCipher {
  _rcon = new Uint8Array([
    141,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    27,
    54,
    108,
    216,
    171,
    77,
    154,
    47,
    94,
    188,
    99,
    198,
    151,
    53,
    106,
    212,
    179,
    125,
    250,
    239,
    197,
    145,
    57,
    114,
    228,
    211,
    189,
    97,
    194,
    159,
    37,
    74,
    148,
    51,
    102,
    204,
    131,
    29,
    58,
    116,
    232,
    203,
    141,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    27,
    54,
    108,
    216,
    171,
    77,
    154,
    47,
    94,
    188,
    99,
    198,
    151,
    53,
    106,
    212,
    179,
    125,
    250,
    239,
    197,
    145,
    57,
    114,
    228,
    211,
    189,
    97,
    194,
    159,
    37,
    74,
    148,
    51,
    102,
    204,
    131,
    29,
    58,
    116,
    232,
    203,
    141,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    27,
    54,
    108,
    216,
    171,
    77,
    154,
    47,
    94,
    188,
    99,
    198,
    151,
    53,
    106,
    212,
    179,
    125,
    250,
    239,
    197,
    145,
    57,
    114,
    228,
    211,
    189,
    97,
    194,
    159,
    37,
    74,
    148,
    51,
    102,
    204,
    131,
    29,
    58,
    116,
    232,
    203,
    141,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    27,
    54,
    108,
    216,
    171,
    77,
    154,
    47,
    94,
    188,
    99,
    198,
    151,
    53,
    106,
    212,
    179,
    125,
    250,
    239,
    197,
    145,
    57,
    114,
    228,
    211,
    189,
    97,
    194,
    159,
    37,
    74,
    148,
    51,
    102,
    204,
    131,
    29,
    58,
    116,
    232,
    203,
    141,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    27,
    54,
    108,
    216,
    171,
    77,
    154,
    47,
    94,
    188,
    99,
    198,
    151,
    53,
    106,
    212,
    179,
    125,
    250,
    239,
    197,
    145,
    57,
    114,
    228,
    211,
    189,
    97,
    194,
    159,
    37,
    74,
    148,
    51,
    102,
    204,
    131,
    29,
    58,
    116,
    232,
    203,
    141
  ]);
  constructor(key) {
    super();
    this._cyclesOfRepetition = 10;
    this._keySize = 160;
    this._key = this._expandKey(key);
  }
  _expandKey(cipherKey) {
    const b = 176;
    const s = this._s;
    const rcon = this._rcon;
    const result = new Uint8Array(b);
    result.set(cipherKey);
    for (let j = 16, i = 1; j < b; ++i) {
      let t1 = result[j - 3];
      let t2 = result[j - 2];
      let t3 = result[j - 1];
      let t4 = result[j - 4];
      t1 = s[t1];
      t2 = s[t2];
      t3 = s[t3];
      t4 = s[t4];
      t1 ^= rcon[i];
      for (let n = 0; n < 4; ++n) {
        result[j] = t1 ^= result[j - 16];
        j++;
        result[j] = t2 ^= result[j - 16];
        j++;
        result[j] = t3 ^= result[j - 16];
        j++;
        result[j] = t4 ^= result[j - 16];
        j++;
      }
    }
    return result;
  }
};
var AES256Cipher = class extends AESBaseCipher {
  constructor(key) {
    super();
    this._cyclesOfRepetition = 14;
    this._keySize = 224;
    this._key = this._expandKey(key);
  }
  _expandKey(cipherKey) {
    const b = 240;
    const s = this._s;
    const result = new Uint8Array(b);
    result.set(cipherKey);
    let r = 1;
    let t1, t2, t3, t4;
    for (let j = 32, i = 1; j < b; ++i) {
      if (j % 32 === 16) {
        t1 = s[t1];
        t2 = s[t2];
        t3 = s[t3];
        t4 = s[t4];
      } else if (j % 32 === 0) {
        t1 = result[j - 3];
        t2 = result[j - 2];
        t3 = result[j - 1];
        t4 = result[j - 4];
        t1 = s[t1];
        t2 = s[t2];
        t3 = s[t3];
        t4 = s[t4];
        t1 ^= r;
        if ((r <<= 1) >= 256) {
          r = (r ^ 27) & 255;
        }
      }
      for (let n = 0; n < 4; ++n) {
        result[j] = t1 ^= result[j - 32];
        j++;
        result[j] = t2 ^= result[j - 32];
        j++;
        result[j] = t3 ^= result[j - 32];
        j++;
        result[j] = t4 ^= result[j - 32];
        j++;
      }
    }
    return result;
  }
};
var PDFBase = class _PDFBase {
  constructor() {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _PDFBase) {
      unreachable("Cannot initialize PDFBase.");
    }
  }
  _hash(password, input, userBytes) {
    unreachable("Abstract method `_hash` called");
  }
  checkOwnerPassword(password, ownerValidationSalt, userBytes, ownerPassword) {
    const hashData = new Uint8Array(password.length + 56);
    hashData.set(password, 0);
    hashData.set(ownerValidationSalt, password.length);
    hashData.set(userBytes, password.length + ownerValidationSalt.length);
    const result = this._hash(password, hashData, userBytes);
    return isArrayEqual(result, ownerPassword);
  }
  checkUserPassword(password, userValidationSalt, userPassword) {
    const hashData = new Uint8Array(password.length + 8);
    hashData.set(password, 0);
    hashData.set(userValidationSalt, password.length);
    const result = this._hash(password, hashData, []);
    return isArrayEqual(result, userPassword);
  }
  getOwnerKey(password, ownerKeySalt, userBytes, ownerEncryption) {
    const hashData = new Uint8Array(password.length + 56);
    hashData.set(password, 0);
    hashData.set(ownerKeySalt, password.length);
    hashData.set(userBytes, password.length + ownerKeySalt.length);
    const key = this._hash(password, hashData, userBytes);
    const cipher = new AES256Cipher(key);
    return cipher.decryptBlock(ownerEncryption, false, new Uint8Array(16));
  }
  getUserKey(password, userKeySalt, userEncryption) {
    const hashData = new Uint8Array(password.length + 8);
    hashData.set(password, 0);
    hashData.set(userKeySalt, password.length);
    const key = this._hash(password, hashData, []);
    const cipher = new AES256Cipher(key);
    return cipher.decryptBlock(userEncryption, false, new Uint8Array(16));
  }
};
var PDF17 = class extends PDFBase {
  _hash(password, input, userBytes) {
    return calculateSHA256(input, 0, input.length);
  }
};
var PDF20 = class extends PDFBase {
  _hash(password, input, userBytes) {
    let k = calculateSHA256(input, 0, input.length).subarray(0, 32);
    let e = [0];
    let i = 0;
    while (i < 64 || e.at(-1) > i - 32) {
      const combinedLength = password.length + k.length + userBytes.length, combinedArray = new Uint8Array(combinedLength);
      let writeOffset = 0;
      combinedArray.set(password, writeOffset);
      writeOffset += password.length;
      combinedArray.set(k, writeOffset);
      writeOffset += k.length;
      combinedArray.set(userBytes, writeOffset);
      const k1 = new Uint8Array(combinedLength * 64);
      for (let j = 0, pos = 0; j < 64; j++, pos += combinedLength) {
        k1.set(combinedArray, pos);
      }
      const cipher = new AES128Cipher(k.subarray(0, 16));
      e = cipher.encrypt(k1, k.subarray(16, 32));
      const remainder = e.slice(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
      if (remainder === 0) {
        k = calculateSHA256(e, 0, e.length);
      } else if (remainder === 1) {
        k = calculateSHA384(e, 0, e.length);
      } else if (remainder === 2) {
        k = calculateSHA512(e, 0, e.length);
      }
      i++;
    }
    return k.subarray(0, 32);
  }
};
var CipherTransform = class {
  /** @type {Map<string, CipherConstructors>} */
  #cipherCache = /* @__PURE__ */ new Map();
  /** @type {Name | null} */
  embeddedFilterName = null;
  /**
   * @param {ResolveCipher} resolveCipher
   *   Resolve a cipher constructor from a crypt filter name.
   * @param {Name | null} [stringFilterName]
   *   Default crypt filter for strings.
   * @param {Name | null} [streamFilterName]
   *   Default crypt filter for streams.
   */
  constructor(resolveCipher, stringFilterName = null, streamFilterName = null) {
    this.resolveCipher = resolveCipher;
    this.streamFilterName = streamFilterName;
    this.stringFilterName = stringFilterName;
  }
  /**
   * @param {Name | null} [filterName]
   *   Crypt filter name.
   * @returns {CipherConstructors}
   *   Cipher constructor.
   */
  #getCipher(filterName = null) {
    const key = filterName instanceof Name ? filterName.name : "__default__";
    if (!this.#cipherCache.has(key)) this.#cipherCache.set(key, this.resolveCipher(filterName));
    return this.#cipherCache.get(key);
  }
  /**
   * @param {BaseStream} stream
   * @param {number | null} length
   * @param {Name | null} [cryptFilterName]
   * @returns {DecryptStream}
   */
  createStream(stream, length, cryptFilterName = null) {
    const defaultFilterName = this.embeddedFilterName && isDict(stream.dict, "EmbeddedFile") ? this.embeddedFilterName : this.streamFilterName;
    const Cipher = this.#getCipher(cryptFilterName || defaultFilterName);
    const cipher = new Cipher();
    return new DecryptStream(
      stream,
      length,
      function cipherTransformDecryptStream(data, finalize) {
        return cipher.decryptBlock(data, finalize);
      }
    );
  }
  decryptString(s) {
    const Cipher = this.#getCipher(this.stringFilterName);
    const cipher = new Cipher();
    let data = stringToBytes(s);
    data = cipher.decryptBlock(data, true);
    return bytesToString(data);
  }
  encryptString(s) {
    const Cipher = this.#getCipher(this.stringFilterName);
    const cipher = new Cipher();
    if (cipher instanceof AESBaseCipher) {
      const strLen = s.length;
      const pad = 16 - strLen % 16;
      s += String.fromCharCode(pad).repeat(pad);
      const iv = new Uint8Array(16);
      crypto.getRandomValues(iv);
      let data2 = stringToBytes(s);
      data2 = cipher.encrypt(data2, iv);
      const buf = new Uint8Array(16 + data2.length);
      buf.set(iv);
      buf.set(data2, 16);
      return bytesToString(buf);
    }
    let data = stringToBytes(s);
    data = cipher.encrypt(data);
    return bytesToString(data);
  }
};
function utf8PasswordToBytes(password) {
  try {
    password = utf8StringToString(password);
  } catch {
    warn("CipherTransformFactory: Unable to convert UTF8 encoded password.");
  }
  return stringToBytes(password);
}
var CipherTransformFactory = class _CipherTransformFactory {
  #fileId;
  static get _defaultPasswordBytes() {
    return shadow(
      this,
      "_defaultPasswordBytes",
      new Uint8Array([
        40,
        191,
        78,
        94,
        78,
        117,
        138,
        65,
        100,
        0,
        78,
        86,
        255,
        250,
        1,
        8,
        46,
        46,
        0,
        182,
        208,
        104,
        62,
        128,
        47,
        12,
        169,
        254,
        100,
        83,
        105,
        122
      ])
    );
  }
  #createEncryptionKey20(revision, password, ownerPassword, ownerValidationSalt, ownerKeySalt, uBytes, userPassword, userValidationSalt, userKeySalt, ownerEncryption, userEncryption, perms) {
    if (password) {
      const passwordLength = Math.min(127, password.length);
      password = password.subarray(0, passwordLength);
    } else {
      password = [];
    }
    const pdfAlgorithm = revision === 6 ? new PDF20() : new PDF17();
    if (pdfAlgorithm.checkUserPassword(password, userValidationSalt, userPassword)) {
      return pdfAlgorithm.getUserKey(password, userKeySalt, userEncryption);
    } else if (password.length && pdfAlgorithm.checkOwnerPassword(
      password,
      ownerValidationSalt,
      uBytes,
      ownerPassword
    )) {
      return pdfAlgorithm.getOwnerKey(
        password,
        ownerKeySalt,
        uBytes,
        ownerEncryption
      );
    }
    return null;
  }
  #prepareKeyData(fileId, password, ownerPassword, userPassword, flags, revision, keyLength, encryptMetadata) {
    const hashDataSize = 40 + ownerPassword.length + fileId.length;
    const hashData = new Uint8Array(hashDataSize);
    let i = 0, j, n;
    if (password) {
      n = Math.min(32, password.length);
      for (; i < n; ++i) {
        hashData[i] = password[i];
      }
    }
    j = 0;
    while (i < 32) {
      hashData[i++] = _CipherTransformFactory._defaultPasswordBytes[j++];
    }
    hashData.set(ownerPassword, i);
    i += ownerPassword.length;
    hashData[i++] = flags & 255;
    hashData[i++] = flags >> 8 & 255;
    hashData[i++] = flags >> 16 & 255;
    hashData[i++] = flags >>> 24 & 255;
    hashData.set(fileId, i);
    i += fileId.length;
    if (revision >= 4 && !encryptMetadata) {
      hashData.fill(255, i, i + 4);
      i += 4;
    }
    let hash = calculateMD5(hashData, 0, i);
    const keyLengthInBytes = keyLength >> 3;
    if (revision >= 3) {
      for (j = 0; j < 50; ++j) {
        hash = calculateMD5(hash, 0, keyLengthInBytes);
      }
    }
    const encryptionKey = hash.subarray(0, keyLengthInBytes);
    let cipher, checkData;
    if (revision >= 3) {
      i = 0;
      hashData.set(_CipherTransformFactory._defaultPasswordBytes, i);
      i += 32;
      hashData.set(fileId, i);
      i += fileId.length;
      cipher = new ARCFourCipher(encryptionKey);
      checkData = cipher.encryptBlock(calculateMD5(hashData, 0, i));
      n = encryptionKey.length;
      const derivedKey = new Uint8Array(n);
      for (j = 1; j <= 19; ++j) {
        for (let k = 0; k < n; ++k) {
          derivedKey[k] = encryptionKey[k] ^ j;
        }
        cipher = new ARCFourCipher(derivedKey);
        checkData = cipher.encryptBlock(checkData);
      }
    } else {
      cipher = new ARCFourCipher(encryptionKey);
      checkData = cipher.encryptBlock(
        _CipherTransformFactory._defaultPasswordBytes
      );
    }
    return checkData.every((data, k) => userPassword[k] === data) ? encryptionKey : null;
  }
  #decodeUserPassword(password, ownerPassword, revision, keyLength) {
    const hashData = new Uint8Array(32);
    let i = 0;
    const n = Math.min(32, password.length);
    for (; i < n; ++i) {
      hashData[i] = password[i];
    }
    let j = 0;
    while (i < 32) {
      hashData[i++] = _CipherTransformFactory._defaultPasswordBytes[j++];
    }
    let hash = calculateMD5(hashData, 0, i);
    const keyLengthInBytes = keyLength >> 3;
    if (revision >= 3) {
      for (j = 0; j < 50; ++j) {
        hash = calculateMD5(hash, 0, hash.length);
      }
    }
    let cipher, userPassword;
    if (revision >= 3) {
      userPassword = ownerPassword;
      const derivedKey = new Uint8Array(keyLengthInBytes);
      for (j = 19; j >= 0; j--) {
        for (let k = 0; k < keyLengthInBytes; ++k) {
          derivedKey[k] = hash[k] ^ j;
        }
        cipher = new ARCFourCipher(derivedKey);
        userPassword = cipher.encryptBlock(userPassword);
      }
    } else {
      cipher = new ARCFourCipher(hash.subarray(0, keyLengthInBytes));
      userPassword = cipher.encryptBlock(ownerPassword);
    }
    return userPassword;
  }
  #buildObjectKey(num, gen, encryptionKey, isAes = false) {
    const n = encryptionKey.length;
    const key = new Uint8Array(n + 9);
    key.set(encryptionKey);
    let i = n;
    key[i++] = num & 255;
    key[i++] = num >> 8 & 255;
    key[i++] = num >> 16 & 255;
    key[i++] = gen & 255;
    key[i++] = gen >> 8 & 255;
    if (isAes) {
      key[i++] = 115;
      key[i++] = 65;
      key[i++] = 108;
      key[i++] = 84;
    }
    const hash = calculateMD5(key, 0, i);
    return hash.subarray(0, Math.min(n + 5, 16));
  }
  constructor(dict, fileId, password) {
    const filter = dict.get("Filter");
    if (!isName(filter, "Standard")) {
      throw new FormatError("unknown encryption method");
    }
    this.filterName = filter.name;
    this.dict = dict;
    this.#fileId = fileId;
    const algorithm = dict.get("V");
    if (!Number.isInteger(algorithm) || algorithm !== 1 && algorithm !== 2 && algorithm !== 4 && algorithm !== 5) {
      throw new FormatError("unsupported encryption algorithm");
    }
    this.algorithm = algorithm;
    let keyLength = dict.get("Length");
    if (!keyLength) {
      if (algorithm <= 3) {
        keyLength = 40;
      } else {
        const cfDict = dict.get("CF");
        const streamCryptoName = dict.get("StmF");
        if (cfDict instanceof Dict && streamCryptoName instanceof Name) {
          cfDict.suppressEncryption = true;
          const handlerDict = cfDict.get(streamCryptoName.name);
          keyLength = handlerDict?.get("Length") || 128;
          if (keyLength < 40) {
            keyLength <<= 3;
          }
        }
      }
    }
    if (!Number.isInteger(keyLength) || keyLength < 40 || keyLength % 8 !== 0) {
      throw new FormatError("invalid key length");
    }
    let cf = null;
    let stmf = Name.get("Identity");
    let strf = Name.get("Identity");
    let eff = stmf;
    if (algorithm >= 4) {
      cf = dict.get("CF");
      if (cf instanceof Dict) {
        cf.suppressEncryption = true;
      }
      stmf = dict.get("StmF") || Name.get("Identity");
      strf = dict.get("StrF") || Name.get("Identity");
      eff = dict.get("EFF") || stmf;
    }
    this.cf = cf;
    this.stmf = stmf;
    this.strf = strf;
    this.eff = eff;
    const ownerBytes = stringToBytes(dict.get("O")), userBytes = stringToBytes(dict.get("U"));
    const ownerPassword = ownerBytes.subarray(0, 32);
    const userPassword = userBytes.subarray(0, 32);
    const flags = dict.get("P");
    const revision = dict.get("R");
    const encryptMetadata = (algorithm === 4 || algorithm === 5) && dict.get("EncryptMetadata") !== false;
    this.encryptMetadata = encryptMetadata;
    const fileIdBytes = stringToBytes(fileId);
    let passwordBytes, rawPasswordBytes;
    if (password) {
      if (revision === 6) {
        const preppedPassword = saslPrep(password);
        passwordBytes = utf8PasswordToBytes(preppedPassword);
        if (preppedPassword !== password) {
          rawPasswordBytes = utf8PasswordToBytes(password);
        }
      } else if (algorithm === 5) {
        passwordBytes = utf8PasswordToBytes(password);
      } else {
        passwordBytes = stringToBytes(password);
      }
    }
    let encryptionKey;
    if (algorithm !== 5) {
      encryptionKey = this.#prepareKeyData(
        fileIdBytes,
        passwordBytes,
        ownerPassword,
        userPassword,
        flags,
        revision,
        keyLength,
        encryptMetadata
      );
    } else {
      const ownerValidationSalt = ownerBytes.subarray(32, 40);
      const ownerKeySalt = ownerBytes.subarray(40, 48);
      const uBytes = userBytes.subarray(0, 48);
      const userValidationSalt = userBytes.subarray(32, 40);
      const userKeySalt = userBytes.subarray(40, 48);
      const ownerEncryption = stringToBytes(dict.get("OE"));
      const userEncryption = stringToBytes(dict.get("UE"));
      const perms = stringToBytes(dict.get("Perms"));
      for (const candidate of rawPasswordBytes ? [passwordBytes, rawPasswordBytes] : [passwordBytes]) {
        encryptionKey = this.#createEncryptionKey20(
          revision,
          candidate,
          ownerPassword,
          ownerValidationSalt,
          ownerKeySalt,
          uBytes,
          userPassword,
          userValidationSalt,
          userKeySalt,
          ownerEncryption,
          userEncryption,
          perms
        );
        if (encryptionKey) {
          break;
        }
      }
    }
    if (!encryptionKey) {
      if (!password) {
        if (this.algorithm >= 4 && isName(this.stmf, "Identity") && isName(this.strf, "Identity")) {
          const effCF = this.cf?.get(this.eff.name);
          const authEvent = effCF?.get("AuthEvent");
          if (isName(authEvent, "EFOpen")) {
            this.encryptionKey = null;
            return;
          }
        }
        throw new PasswordException(
          "No password given",
          PasswordResponses.NEED_PASSWORD
        );
      }
      const decodedPassword = this.#decodeUserPassword(
        passwordBytes,
        ownerPassword,
        revision,
        keyLength
      );
      encryptionKey = this.#prepareKeyData(
        fileIdBytes,
        decodedPassword,
        ownerPassword,
        userPassword,
        flags,
        revision,
        keyLength,
        encryptMetadata
      );
    }
    if (!encryptionKey) {
      throw new PasswordException(
        "Incorrect Password",
        PasswordResponses.INCORRECT_PASSWORD
      );
    }
    if (algorithm === 4 && encryptionKey.length < 16) {
      this.encryptionKey = new Uint8Array(16);
      this.encryptionKey.set(encryptionKey);
    } else {
      this.encryptionKey = encryptionKey;
    }
  }
  /**
   * Set password.
   * @param {string} password
   *   New password.
   * @returns {undefined}
   *   Nothing.
   */
  setPassword(password) {
    const transform = new _CipherTransformFactory(
      this.dict,
      this.#fileId,
      password
    );
    this.encryptionKey = transform.encryptionKey;
  }
  /**
   * @param {number} num
   *   Object number.
   * @param {number} gen
   *   Generation number.
   * @returns {CipherTransform}
   *   Cipher transform.
   */
  createCipherTransform(num, gen) {
    if (this.algorithm === 4 || this.algorithm === 5) {
      const resolveCipher2 = (filterName) => {
        if (!(filterName instanceof Name)) {
          throw new FormatError("Invalid crypt filter name.");
        }
        const cryptFilter = this.cf.get(filterName.name);
        const cfm = cryptFilter?.get("CFM");
        if (!cfm || cfm.name === "None") {
          return NullCipher;
        }
        if (!this.encryptionKey) {
          throw new PasswordException(
            "No password given",
            PasswordResponses.NEED_PASSWORD
          );
        }
        if (this.algorithm === 5 || cfm.name === "AESV3") {
          return AES256Cipher.bind(null, this.encryptionKey);
        }
        if (cfm.name === "V2") {
          return ARCFourCipher.bind(
            null,
            this.#buildObjectKey(
              num,
              gen,
              this.encryptionKey,
              /* isAes = */
              false
            )
          );
        }
        if (cfm.name === "AESV2") {
          return AES128Cipher.bind(
            null,
            this.#buildObjectKey(
              num,
              gen,
              this.encryptionKey,
              /* isAes = */
              true
            )
          );
        }
        throw new FormatError("Unknown crypto method");
      };
      const transform = new CipherTransform(
        resolveCipher2,
        this.strf,
        this.stmf
      );
      transform.embeddedFilterName = this.eff;
      return transform;
    }
    const resolveCipher = () => ARCFourCipher.bind(
      null,
      this.#buildObjectKey(
        num,
        gen,
        this.encryptionKey,
        /* isAes = */
        false
      )
    );
    return new CipherTransform(resolveCipher);
  }
};

// src/core/flate_stream.js
var codeLenCodeMap = new Int32Array([
  16,
  17,
  18,
  0,
  8,
  7,
  9,
  6,
  10,
  5,
  11,
  4,
  12,
  3,
  13,
  2,
  14,
  1,
  15
]);
var lengthDecode = new Int32Array([
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  65547,
  65549,
  65551,
  65553,
  131091,
  131095,
  131099,
  131103,
  196643,
  196651,
  196659,
  196667,
  262211,
  262227,
  262243,
  262259,
  327811,
  327843,
  327875,
  327907,
  258,
  258,
  258
]);
var distDecode = new Int32Array([
  1,
  2,
  3,
  4,
  65541,
  65543,
  131081,
  131085,
  196625,
  196633,
  262177,
  262193,
  327745,
  327777,
  393345,
  393409,
  459009,
  459137,
  524801,
  525057,
  590849,
  591361,
  657409,
  658433,
  724993,
  727041,
  794625,
  798721,
  868353,
  876545
]);
var fixedLitCodeTab = [
  new Int32Array([
    459008,
    524368,
    524304,
    524568,
    459024,
    524400,
    524336,
    590016,
    459016,
    524384,
    524320,
    589984,
    524288,
    524416,
    524352,
    590048,
    459012,
    524376,
    524312,
    589968,
    459028,
    524408,
    524344,
    590032,
    459020,
    524392,
    524328,
    59e4,
    524296,
    524424,
    524360,
    590064,
    459010,
    524372,
    524308,
    524572,
    459026,
    524404,
    524340,
    590024,
    459018,
    524388,
    524324,
    589992,
    524292,
    524420,
    524356,
    590056,
    459014,
    524380,
    524316,
    589976,
    459030,
    524412,
    524348,
    590040,
    459022,
    524396,
    524332,
    590008,
    524300,
    524428,
    524364,
    590072,
    459009,
    524370,
    524306,
    524570,
    459025,
    524402,
    524338,
    590020,
    459017,
    524386,
    524322,
    589988,
    524290,
    524418,
    524354,
    590052,
    459013,
    524378,
    524314,
    589972,
    459029,
    524410,
    524346,
    590036,
    459021,
    524394,
    524330,
    590004,
    524298,
    524426,
    524362,
    590068,
    459011,
    524374,
    524310,
    524574,
    459027,
    524406,
    524342,
    590028,
    459019,
    524390,
    524326,
    589996,
    524294,
    524422,
    524358,
    590060,
    459015,
    524382,
    524318,
    589980,
    459031,
    524414,
    524350,
    590044,
    459023,
    524398,
    524334,
    590012,
    524302,
    524430,
    524366,
    590076,
    459008,
    524369,
    524305,
    524569,
    459024,
    524401,
    524337,
    590018,
    459016,
    524385,
    524321,
    589986,
    524289,
    524417,
    524353,
    590050,
    459012,
    524377,
    524313,
    589970,
    459028,
    524409,
    524345,
    590034,
    459020,
    524393,
    524329,
    590002,
    524297,
    524425,
    524361,
    590066,
    459010,
    524373,
    524309,
    524573,
    459026,
    524405,
    524341,
    590026,
    459018,
    524389,
    524325,
    589994,
    524293,
    524421,
    524357,
    590058,
    459014,
    524381,
    524317,
    589978,
    459030,
    524413,
    524349,
    590042,
    459022,
    524397,
    524333,
    590010,
    524301,
    524429,
    524365,
    590074,
    459009,
    524371,
    524307,
    524571,
    459025,
    524403,
    524339,
    590022,
    459017,
    524387,
    524323,
    589990,
    524291,
    524419,
    524355,
    590054,
    459013,
    524379,
    524315,
    589974,
    459029,
    524411,
    524347,
    590038,
    459021,
    524395,
    524331,
    590006,
    524299,
    524427,
    524363,
    590070,
    459011,
    524375,
    524311,
    524575,
    459027,
    524407,
    524343,
    590030,
    459019,
    524391,
    524327,
    589998,
    524295,
    524423,
    524359,
    590062,
    459015,
    524383,
    524319,
    589982,
    459031,
    524415,
    524351,
    590046,
    459023,
    524399,
    524335,
    590014,
    524303,
    524431,
    524367,
    590078,
    459008,
    524368,
    524304,
    524568,
    459024,
    524400,
    524336,
    590017,
    459016,
    524384,
    524320,
    589985,
    524288,
    524416,
    524352,
    590049,
    459012,
    524376,
    524312,
    589969,
    459028,
    524408,
    524344,
    590033,
    459020,
    524392,
    524328,
    590001,
    524296,
    524424,
    524360,
    590065,
    459010,
    524372,
    524308,
    524572,
    459026,
    524404,
    524340,
    590025,
    459018,
    524388,
    524324,
    589993,
    524292,
    524420,
    524356,
    590057,
    459014,
    524380,
    524316,
    589977,
    459030,
    524412,
    524348,
    590041,
    459022,
    524396,
    524332,
    590009,
    524300,
    524428,
    524364,
    590073,
    459009,
    524370,
    524306,
    524570,
    459025,
    524402,
    524338,
    590021,
    459017,
    524386,
    524322,
    589989,
    524290,
    524418,
    524354,
    590053,
    459013,
    524378,
    524314,
    589973,
    459029,
    524410,
    524346,
    590037,
    459021,
    524394,
    524330,
    590005,
    524298,
    524426,
    524362,
    590069,
    459011,
    524374,
    524310,
    524574,
    459027,
    524406,
    524342,
    590029,
    459019,
    524390,
    524326,
    589997,
    524294,
    524422,
    524358,
    590061,
    459015,
    524382,
    524318,
    589981,
    459031,
    524414,
    524350,
    590045,
    459023,
    524398,
    524334,
    590013,
    524302,
    524430,
    524366,
    590077,
    459008,
    524369,
    524305,
    524569,
    459024,
    524401,
    524337,
    590019,
    459016,
    524385,
    524321,
    589987,
    524289,
    524417,
    524353,
    590051,
    459012,
    524377,
    524313,
    589971,
    459028,
    524409,
    524345,
    590035,
    459020,
    524393,
    524329,
    590003,
    524297,
    524425,
    524361,
    590067,
    459010,
    524373,
    524309,
    524573,
    459026,
    524405,
    524341,
    590027,
    459018,
    524389,
    524325,
    589995,
    524293,
    524421,
    524357,
    590059,
    459014,
    524381,
    524317,
    589979,
    459030,
    524413,
    524349,
    590043,
    459022,
    524397,
    524333,
    590011,
    524301,
    524429,
    524365,
    590075,
    459009,
    524371,
    524307,
    524571,
    459025,
    524403,
    524339,
    590023,
    459017,
    524387,
    524323,
    589991,
    524291,
    524419,
    524355,
    590055,
    459013,
    524379,
    524315,
    589975,
    459029,
    524411,
    524347,
    590039,
    459021,
    524395,
    524331,
    590007,
    524299,
    524427,
    524363,
    590071,
    459011,
    524375,
    524311,
    524575,
    459027,
    524407,
    524343,
    590031,
    459019,
    524391,
    524327,
    589999,
    524295,
    524423,
    524359,
    590063,
    459015,
    524383,
    524319,
    589983,
    459031,
    524415,
    524351,
    590047,
    459023,
    524399,
    524335,
    590015,
    524303,
    524431,
    524367,
    590079
  ]),
  9
];
var fixedDistCodeTab = [
  new Int32Array([
    327680,
    327696,
    327688,
    327704,
    327684,
    327700,
    327692,
    327708,
    327682,
    327698,
    327690,
    327706,
    327686,
    327702,
    327694,
    0,
    327681,
    327697,
    327689,
    327705,
    327685,
    327701,
    327693,
    327709,
    327683,
    327699,
    327691,
    327707,
    327687,
    327703,
    327695,
    0
  ]),
  5
];
var FlateStream = class extends DecodeStream {
  #isAsync = true;
  constructor(str, maybeLength) {
    super(maybeLength);
    this.stream = str;
    this.dict = str.dict;
    const cmf = str.getByte();
    const flg = str.getByte();
    if (cmf === -1 || flg === -1) {
      throw new FormatError(`Invalid header in flate stream: ${cmf}, ${flg}`);
    }
    if ((cmf & 15) !== 8) {
      throw new FormatError(
        `Unknown compression method in flate stream: ${cmf}, ${flg}`
      );
    }
    if (((cmf << 8) + flg) % 31 !== 0) {
      throw new FormatError(`Bad FCHECK in flate stream: ${cmf}, ${flg}`);
    }
    if (flg & 32) {
      throw new FormatError(`FDICT bit set in flate stream: ${cmf}, ${flg}`);
    }
    this.codeSize = 0;
    this.codeBuf = 0;
  }
  async getImageData(length, _decoderOptions) {
    const data = await this.asyncGetBytes();
    if (!data) {
      return this.getBytes(length);
    }
    return data.length <= length ? data : data.subarray(0, length);
  }
  async asyncGetBytes() {
    const { decompressed, compressed } = await this.asyncGetBytesFromDecompressionStream("deflate");
    if (decompressed) {
      return decompressed;
    }
    this.#isAsync = false;
    this.stream = new Stream(
      compressed,
      2,
      compressed.length,
      this.stream.dict
    );
    this.reset();
    return null;
  }
  get isAsync() {
    return this.#isAsync;
  }
  getBits(bits) {
    const str = this.stream;
    let codeSize = this.codeSize;
    let codeBuf = this.codeBuf;
    let b;
    while (codeSize < bits) {
      if ((b = str.getByte()) === -1) {
        throw new FormatError("Bad encoding in flate stream");
      }
      codeBuf |= b << codeSize;
      codeSize += 8;
    }
    b = codeBuf & (1 << bits) - 1;
    this.codeBuf = codeBuf >> bits;
    this.codeSize = codeSize -= bits;
    return b;
  }
  getCode(table) {
    const str = this.stream;
    const codes = table[0];
    const maxLen = table[1];
    let codeSize = this.codeSize;
    let codeBuf = this.codeBuf;
    let b;
    while (codeSize < maxLen) {
      if ((b = str.getByte()) === -1) {
        break;
      }
      codeBuf |= b << codeSize;
      codeSize += 8;
    }
    const code = codes[codeBuf & (1 << maxLen) - 1];
    const codeLen = code >> 16;
    const codeVal = code & 65535;
    if (codeLen < 1 || codeSize < codeLen) {
      throw new FormatError("Bad encoding in flate stream");
    }
    this.codeBuf = codeBuf >> codeLen;
    this.codeSize = codeSize - codeLen;
    return codeVal;
  }
  generateHuffmanTable(lengths) {
    const n = lengths.length;
    let maxLen = 0;
    let i;
    for (i = 0; i < n; ++i) {
      if (lengths[i] > maxLen) {
        maxLen = lengths[i];
      }
    }
    const size = 1 << maxLen;
    const codes = new Int32Array(size);
    for (let len = 1, code = 0, skip = 2; len <= maxLen; ++len, code <<= 1, skip <<= 1) {
      for (let val = 0; val < n; ++val) {
        if (lengths[val] === len) {
          let code2 = 0;
          let t = code;
          for (i = 0; i < len; ++i) {
            code2 = code2 << 1 | t & 1;
            t >>= 1;
          }
          for (i = code2; i < size; i += skip) {
            codes[i] = len << 16 | val;
          }
          ++code;
        }
      }
    }
    return [codes, maxLen];
  }
  #endsStreamOnError(err) {
    info(err);
    this.eof = true;
  }
  readBlock() {
    let buffer, hdr, len;
    const str = this.stream;
    try {
      hdr = this.getBits(3);
    } catch (ex) {
      this.#endsStreamOnError(ex.message);
      return;
    }
    if (hdr & 1) {
      this.eof = true;
    }
    hdr >>= 1;
    if (hdr === 0) {
      let b;
      if ((b = str.getByte()) === -1) {
        this.#endsStreamOnError("Bad block header in flate stream");
        return;
      }
      let blockLen = b;
      if ((b = str.getByte()) === -1) {
        this.#endsStreamOnError("Bad block header in flate stream");
        return;
      }
      blockLen |= b << 8;
      if ((b = str.getByte()) === -1) {
        this.#endsStreamOnError("Bad block header in flate stream");
        return;
      }
      let check = b;
      if ((b = str.getByte()) === -1) {
        this.#endsStreamOnError("Bad block header in flate stream");
        return;
      }
      check |= b << 8;
      if (check !== (~blockLen & 65535) && (blockLen !== 0 || check !== 0)) {
        throw new FormatError("Bad uncompressed block length in flate stream");
      }
      this.codeBuf = 0;
      this.codeSize = 0;
      const bufferLength = this.bufferLength, end = bufferLength + blockLen;
      buffer = this.ensureBuffer(end);
      this.bufferLength = end;
      if (blockLen === 0) {
        if (str.peekByte() === -1) {
          this.eof = true;
        }
      } else {
        const block = str.getBytes(blockLen);
        buffer.set(block, bufferLength);
        if (block.length < blockLen) {
          this.eof = true;
        }
      }
      return;
    }
    let litCodeTable;
    let distCodeTable;
    if (hdr === 1) {
      litCodeTable = fixedLitCodeTab;
      distCodeTable = fixedDistCodeTab;
    } else if (hdr === 2) {
      const numLitCodes = this.getBits(5) + 257;
      const numDistCodes = this.getBits(5) + 1;
      const numCodeLenCodes = this.getBits(4) + 4;
      const codeLenCodeLengths = new Uint8Array(codeLenCodeMap.length);
      let i;
      for (i = 0; i < numCodeLenCodes; ++i) {
        codeLenCodeLengths[codeLenCodeMap[i]] = this.getBits(3);
      }
      const codeLenCodeTab = this.generateHuffmanTable(codeLenCodeLengths);
      len = 0;
      i = 0;
      const codes = numLitCodes + numDistCodes;
      const codeLengths = new Uint8Array(codes);
      let bitsLength, bitsOffset, what;
      while (i < codes) {
        const code = this.getCode(codeLenCodeTab);
        if (code === 16) {
          bitsLength = 2;
          bitsOffset = 3;
          what = len;
        } else if (code === 17) {
          bitsLength = 3;
          bitsOffset = 3;
          what = len = 0;
        } else if (code === 18) {
          bitsLength = 7;
          bitsOffset = 11;
          what = len = 0;
        } else {
          codeLengths[i++] = len = code;
          continue;
        }
        let repeatLength = this.getBits(bitsLength) + bitsOffset;
        while (repeatLength-- > 0) {
          codeLengths[i++] = what;
        }
      }
      litCodeTable = this.generateHuffmanTable(
        codeLengths.subarray(0, numLitCodes)
      );
      distCodeTable = this.generateHuffmanTable(
        codeLengths.subarray(numLitCodes, codes)
      );
    } else {
      throw new FormatError("Unknown block type in flate stream");
    }
    buffer = this.buffer;
    let limit = buffer ? buffer.length : 0;
    let pos = this.bufferLength;
    while (true) {
      let code1 = this.getCode(litCodeTable);
      if (code1 < 256) {
        if (pos + 1 >= limit) {
          buffer = this.ensureBuffer(pos + 1);
          limit = buffer.length;
        }
        buffer[pos++] = code1;
        continue;
      }
      if (code1 === 256) {
        this.bufferLength = pos;
        return;
      }
      code1 -= 257;
      code1 = lengthDecode[code1];
      let code2 = code1 >> 16;
      if (code2 > 0) {
        code2 = this.getBits(code2);
      }
      len = (code1 & 65535) + code2;
      code1 = this.getCode(distCodeTable);
      code1 = distDecode[code1];
      code2 = code1 >> 16;
      if (code2 > 0) {
        code2 = this.getBits(code2);
      }
      const dist = (code1 & 65535) + code2;
      if (pos + len >= limit) {
        buffer = this.ensureBuffer(pos + len);
        limit = buffer.length;
      }
      for (let k = 0; k < len; ++k, ++pos) {
        buffer[pos] = buffer[pos - dist];
      }
    }
  }
};

// src/core/metrics.js
var getMetrics = getLookupTableFactory(function(t) {
  t.Courier = 600;
  t["Courier-Bold"] = 600;
  t["Courier-BoldOblique"] = 600;
  t["Courier-Oblique"] = 600;
  t.Helvetica = getLookupTableFactory(function(t2) {
    t2.space = 278;
    t2.exclam = 278;
    t2.quotedbl = 355;
    t2.numbersign = 556;
    t2.dollar = 556;
    t2.percent = 889;
    t2.ampersand = 667;
    t2.quoteright = 222;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 389;
    t2.plus = 584;
    t2.comma = 278;
    t2.hyphen = 333;
    t2.period = 278;
    t2.slash = 278;
    t2.zero = 556;
    t2.one = 556;
    t2.two = 556;
    t2.three = 556;
    t2.four = 556;
    t2.five = 556;
    t2.six = 556;
    t2.seven = 556;
    t2.eight = 556;
    t2.nine = 556;
    t2.colon = 278;
    t2.semicolon = 278;
    t2.less = 584;
    t2.equal = 584;
    t2.greater = 584;
    t2.question = 556;
    t2.at = 1015;
    t2.A = 667;
    t2.B = 667;
    t2.C = 722;
    t2.D = 722;
    t2.E = 667;
    t2.F = 611;
    t2.G = 778;
    t2.H = 722;
    t2.I = 278;
    t2.J = 500;
    t2.K = 667;
    t2.L = 556;
    t2.M = 833;
    t2.N = 722;
    t2.O = 778;
    t2.P = 667;
    t2.Q = 778;
    t2.R = 722;
    t2.S = 667;
    t2.T = 611;
    t2.U = 722;
    t2.V = 667;
    t2.W = 944;
    t2.X = 667;
    t2.Y = 667;
    t2.Z = 611;
    t2.bracketleft = 278;
    t2.backslash = 278;
    t2.bracketright = 278;
    t2.asciicircum = 469;
    t2.underscore = 556;
    t2.quoteleft = 222;
    t2.a = 556;
    t2.b = 556;
    t2.c = 500;
    t2.d = 556;
    t2.e = 556;
    t2.f = 278;
    t2.g = 556;
    t2.h = 556;
    t2.i = 222;
    t2.j = 222;
    t2.k = 500;
    t2.l = 222;
    t2.m = 833;
    t2.n = 556;
    t2.o = 556;
    t2.p = 556;
    t2.q = 556;
    t2.r = 333;
    t2.s = 500;
    t2.t = 278;
    t2.u = 556;
    t2.v = 500;
    t2.w = 722;
    t2.x = 500;
    t2.y = 500;
    t2.z = 500;
    t2.braceleft = 334;
    t2.bar = 260;
    t2.braceright = 334;
    t2.asciitilde = 584;
    t2.exclamdown = 333;
    t2.cent = 556;
    t2.sterling = 556;
    t2.fraction = 167;
    t2.yen = 556;
    t2.florin = 556;
    t2.section = 556;
    t2.currency = 556;
    t2.quotesingle = 191;
    t2.quotedblleft = 333;
    t2.guillemotleft = 556;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 500;
    t2.fl = 500;
    t2.endash = 556;
    t2.dagger = 556;
    t2.daggerdbl = 556;
    t2.periodcentered = 278;
    t2.paragraph = 537;
    t2.bullet = 350;
    t2.quotesinglbase = 222;
    t2.quotedblbase = 333;
    t2.quotedblright = 333;
    t2.guillemotright = 556;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 611;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 1e3;
    t2.ordfeminine = 370;
    t2.Lslash = 556;
    t2.Oslash = 778;
    t2.OE = 1e3;
    t2.ordmasculine = 365;
    t2.ae = 889;
    t2.dotlessi = 278;
    t2.lslash = 222;
    t2.oslash = 611;
    t2.oe = 944;
    t2.germandbls = 611;
    t2.Idieresis = 278;
    t2.eacute = 556;
    t2.abreve = 556;
    t2.uhungarumlaut = 556;
    t2.ecaron = 556;
    t2.Ydieresis = 667;
    t2.divide = 584;
    t2.Yacute = 667;
    t2.Acircumflex = 667;
    t2.aacute = 556;
    t2.Ucircumflex = 722;
    t2.yacute = 500;
    t2.scommaaccent = 500;
    t2.ecircumflex = 556;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 556;
    t2.Uacute = 722;
    t2.uogonek = 556;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 737;
    t2.Emacron = 667;
    t2.ccaron = 500;
    t2.aring = 556;
    t2.Ncommaaccent = 722;
    t2.lacute = 222;
    t2.agrave = 556;
    t2.Tcommaaccent = 611;
    t2.Cacute = 722;
    t2.atilde = 556;
    t2.Edotaccent = 667;
    t2.scaron = 500;
    t2.scedilla = 500;
    t2.iacute = 278;
    t2.lozenge = 471;
    t2.Rcaron = 722;
    t2.Gcommaaccent = 778;
    t2.ucircumflex = 556;
    t2.acircumflex = 556;
    t2.Amacron = 667;
    t2.rcaron = 333;
    t2.ccedilla = 500;
    t2.Zdotaccent = 611;
    t2.Thorn = 667;
    t2.Omacron = 778;
    t2.Racute = 722;
    t2.Sacute = 667;
    t2.dcaron = 643;
    t2.Umacron = 722;
    t2.uring = 556;
    t2.threesuperior = 333;
    t2.Ograve = 778;
    t2.Agrave = 667;
    t2.Abreve = 667;
    t2.multiply = 584;
    t2.uacute = 556;
    t2.Tcaron = 611;
    t2.partialdiff = 476;
    t2.ydieresis = 500;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 556;
    t2.edieresis = 556;
    t2.cacute = 500;
    t2.nacute = 556;
    t2.umacron = 556;
    t2.Ncaron = 722;
    t2.Iacute = 278;
    t2.plusminus = 584;
    t2.brokenbar = 260;
    t2.registered = 737;
    t2.Gbreve = 778;
    t2.Idotaccent = 278;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 333;
    t2.omacron = 556;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 722;
    t2.lcommaaccent = 222;
    t2.tcaron = 317;
    t2.eogonek = 556;
    t2.Uogonek = 722;
    t2.Aacute = 667;
    t2.Adieresis = 667;
    t2.egrave = 556;
    t2.zacute = 500;
    t2.iogonek = 222;
    t2.Oacute = 778;
    t2.oacute = 556;
    t2.amacron = 556;
    t2.sacute = 500;
    t2.idieresis = 278;
    t2.Ocircumflex = 778;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 556;
    t2.twosuperior = 333;
    t2.Odieresis = 778;
    t2.mu = 556;
    t2.igrave = 278;
    t2.ohungarumlaut = 556;
    t2.Eogonek = 667;
    t2.dcroat = 556;
    t2.threequarters = 834;
    t2.Scedilla = 667;
    t2.lcaron = 299;
    t2.Kcommaaccent = 667;
    t2.Lacute = 556;
    t2.trademark = 1e3;
    t2.edotaccent = 556;
    t2.Igrave = 278;
    t2.Imacron = 278;
    t2.Lcaron = 556;
    t2.onehalf = 834;
    t2.lessequal = 549;
    t2.ocircumflex = 556;
    t2.ntilde = 556;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 556;
    t2.gbreve = 556;
    t2.onequarter = 834;
    t2.Scaron = 667;
    t2.Scommaaccent = 667;
    t2.Ohungarumlaut = 778;
    t2.degree = 400;
    t2.ograve = 556;
    t2.Ccaron = 722;
    t2.ugrave = 556;
    t2.radical = 453;
    t2.Dcaron = 722;
    t2.rcommaaccent = 333;
    t2.Ntilde = 722;
    t2.otilde = 556;
    t2.Rcommaaccent = 722;
    t2.Lcommaaccent = 556;
    t2.Atilde = 667;
    t2.Aogonek = 667;
    t2.Aring = 667;
    t2.Otilde = 778;
    t2.zdotaccent = 500;
    t2.Ecaron = 667;
    t2.Iogonek = 278;
    t2.kcommaaccent = 500;
    t2.minus = 584;
    t2.Icircumflex = 278;
    t2.ncaron = 556;
    t2.tcommaaccent = 278;
    t2.logicalnot = 584;
    t2.odieresis = 556;
    t2.udieresis = 556;
    t2.notequal = 549;
    t2.gcommaaccent = 556;
    t2.eth = 556;
    t2.zcaron = 500;
    t2.ncommaaccent = 556;
    t2.onesuperior = 333;
    t2.imacron = 278;
    t2.Euro = 556;
  });
  t["Helvetica-Bold"] = getLookupTableFactory(function(t2) {
    t2.space = 278;
    t2.exclam = 333;
    t2.quotedbl = 474;
    t2.numbersign = 556;
    t2.dollar = 556;
    t2.percent = 889;
    t2.ampersand = 722;
    t2.quoteright = 278;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 389;
    t2.plus = 584;
    t2.comma = 278;
    t2.hyphen = 333;
    t2.period = 278;
    t2.slash = 278;
    t2.zero = 556;
    t2.one = 556;
    t2.two = 556;
    t2.three = 556;
    t2.four = 556;
    t2.five = 556;
    t2.six = 556;
    t2.seven = 556;
    t2.eight = 556;
    t2.nine = 556;
    t2.colon = 333;
    t2.semicolon = 333;
    t2.less = 584;
    t2.equal = 584;
    t2.greater = 584;
    t2.question = 611;
    t2.at = 975;
    t2.A = 722;
    t2.B = 722;
    t2.C = 722;
    t2.D = 722;
    t2.E = 667;
    t2.F = 611;
    t2.G = 778;
    t2.H = 722;
    t2.I = 278;
    t2.J = 556;
    t2.K = 722;
    t2.L = 611;
    t2.M = 833;
    t2.N = 722;
    t2.O = 778;
    t2.P = 667;
    t2.Q = 778;
    t2.R = 722;
    t2.S = 667;
    t2.T = 611;
    t2.U = 722;
    t2.V = 667;
    t2.W = 944;
    t2.X = 667;
    t2.Y = 667;
    t2.Z = 611;
    t2.bracketleft = 333;
    t2.backslash = 278;
    t2.bracketright = 333;
    t2.asciicircum = 584;
    t2.underscore = 556;
    t2.quoteleft = 278;
    t2.a = 556;
    t2.b = 611;
    t2.c = 556;
    t2.d = 611;
    t2.e = 556;
    t2.f = 333;
    t2.g = 611;
    t2.h = 611;
    t2.i = 278;
    t2.j = 278;
    t2.k = 556;
    t2.l = 278;
    t2.m = 889;
    t2.n = 611;
    t2.o = 611;
    t2.p = 611;
    t2.q = 611;
    t2.r = 389;
    t2.s = 556;
    t2.t = 333;
    t2.u = 611;
    t2.v = 556;
    t2.w = 778;
    t2.x = 556;
    t2.y = 556;
    t2.z = 500;
    t2.braceleft = 389;
    t2.bar = 280;
    t2.braceright = 389;
    t2.asciitilde = 584;
    t2.exclamdown = 333;
    t2.cent = 556;
    t2.sterling = 556;
    t2.fraction = 167;
    t2.yen = 556;
    t2.florin = 556;
    t2.section = 556;
    t2.currency = 556;
    t2.quotesingle = 238;
    t2.quotedblleft = 500;
    t2.guillemotleft = 556;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 611;
    t2.fl = 611;
    t2.endash = 556;
    t2.dagger = 556;
    t2.daggerdbl = 556;
    t2.periodcentered = 278;
    t2.paragraph = 556;
    t2.bullet = 350;
    t2.quotesinglbase = 278;
    t2.quotedblbase = 500;
    t2.quotedblright = 500;
    t2.guillemotright = 556;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 611;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 1e3;
    t2.ordfeminine = 370;
    t2.Lslash = 611;
    t2.Oslash = 778;
    t2.OE = 1e3;
    t2.ordmasculine = 365;
    t2.ae = 889;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 611;
    t2.oe = 944;
    t2.germandbls = 611;
    t2.Idieresis = 278;
    t2.eacute = 556;
    t2.abreve = 556;
    t2.uhungarumlaut = 611;
    t2.ecaron = 556;
    t2.Ydieresis = 667;
    t2.divide = 584;
    t2.Yacute = 667;
    t2.Acircumflex = 722;
    t2.aacute = 556;
    t2.Ucircumflex = 722;
    t2.yacute = 556;
    t2.scommaaccent = 556;
    t2.ecircumflex = 556;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 556;
    t2.Uacute = 722;
    t2.uogonek = 611;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 737;
    t2.Emacron = 667;
    t2.ccaron = 556;
    t2.aring = 556;
    t2.Ncommaaccent = 722;
    t2.lacute = 278;
    t2.agrave = 556;
    t2.Tcommaaccent = 611;
    t2.Cacute = 722;
    t2.atilde = 556;
    t2.Edotaccent = 667;
    t2.scaron = 556;
    t2.scedilla = 556;
    t2.iacute = 278;
    t2.lozenge = 494;
    t2.Rcaron = 722;
    t2.Gcommaaccent = 778;
    t2.ucircumflex = 611;
    t2.acircumflex = 556;
    t2.Amacron = 722;
    t2.rcaron = 389;
    t2.ccedilla = 556;
    t2.Zdotaccent = 611;
    t2.Thorn = 667;
    t2.Omacron = 778;
    t2.Racute = 722;
    t2.Sacute = 667;
    t2.dcaron = 743;
    t2.Umacron = 722;
    t2.uring = 611;
    t2.threesuperior = 333;
    t2.Ograve = 778;
    t2.Agrave = 722;
    t2.Abreve = 722;
    t2.multiply = 584;
    t2.uacute = 611;
    t2.Tcaron = 611;
    t2.partialdiff = 494;
    t2.ydieresis = 556;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 556;
    t2.edieresis = 556;
    t2.cacute = 556;
    t2.nacute = 611;
    t2.umacron = 611;
    t2.Ncaron = 722;
    t2.Iacute = 278;
    t2.plusminus = 584;
    t2.brokenbar = 280;
    t2.registered = 737;
    t2.Gbreve = 778;
    t2.Idotaccent = 278;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 389;
    t2.omacron = 611;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 722;
    t2.lcommaaccent = 278;
    t2.tcaron = 389;
    t2.eogonek = 556;
    t2.Uogonek = 722;
    t2.Aacute = 722;
    t2.Adieresis = 722;
    t2.egrave = 556;
    t2.zacute = 500;
    t2.iogonek = 278;
    t2.Oacute = 778;
    t2.oacute = 611;
    t2.amacron = 556;
    t2.sacute = 556;
    t2.idieresis = 278;
    t2.Ocircumflex = 778;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 611;
    t2.twosuperior = 333;
    t2.Odieresis = 778;
    t2.mu = 611;
    t2.igrave = 278;
    t2.ohungarumlaut = 611;
    t2.Eogonek = 667;
    t2.dcroat = 611;
    t2.threequarters = 834;
    t2.Scedilla = 667;
    t2.lcaron = 400;
    t2.Kcommaaccent = 722;
    t2.Lacute = 611;
    t2.trademark = 1e3;
    t2.edotaccent = 556;
    t2.Igrave = 278;
    t2.Imacron = 278;
    t2.Lcaron = 611;
    t2.onehalf = 834;
    t2.lessequal = 549;
    t2.ocircumflex = 611;
    t2.ntilde = 611;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 556;
    t2.gbreve = 611;
    t2.onequarter = 834;
    t2.Scaron = 667;
    t2.Scommaaccent = 667;
    t2.Ohungarumlaut = 778;
    t2.degree = 400;
    t2.ograve = 611;
    t2.Ccaron = 722;
    t2.ugrave = 611;
    t2.radical = 549;
    t2.Dcaron = 722;
    t2.rcommaaccent = 389;
    t2.Ntilde = 722;
    t2.otilde = 611;
    t2.Rcommaaccent = 722;
    t2.Lcommaaccent = 611;
    t2.Atilde = 722;
    t2.Aogonek = 722;
    t2.Aring = 722;
    t2.Otilde = 778;
    t2.zdotaccent = 500;
    t2.Ecaron = 667;
    t2.Iogonek = 278;
    t2.kcommaaccent = 556;
    t2.minus = 584;
    t2.Icircumflex = 278;
    t2.ncaron = 611;
    t2.tcommaaccent = 333;
    t2.logicalnot = 584;
    t2.odieresis = 611;
    t2.udieresis = 611;
    t2.notequal = 549;
    t2.gcommaaccent = 611;
    t2.eth = 611;
    t2.zcaron = 500;
    t2.ncommaaccent = 611;
    t2.onesuperior = 333;
    t2.imacron = 278;
    t2.Euro = 556;
  });
  t["Helvetica-BoldOblique"] = getLookupTableFactory(function(t2) {
    t2.space = 278;
    t2.exclam = 333;
    t2.quotedbl = 474;
    t2.numbersign = 556;
    t2.dollar = 556;
    t2.percent = 889;
    t2.ampersand = 722;
    t2.quoteright = 278;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 389;
    t2.plus = 584;
    t2.comma = 278;
    t2.hyphen = 333;
    t2.period = 278;
    t2.slash = 278;
    t2.zero = 556;
    t2.one = 556;
    t2.two = 556;
    t2.three = 556;
    t2.four = 556;
    t2.five = 556;
    t2.six = 556;
    t2.seven = 556;
    t2.eight = 556;
    t2.nine = 556;
    t2.colon = 333;
    t2.semicolon = 333;
    t2.less = 584;
    t2.equal = 584;
    t2.greater = 584;
    t2.question = 611;
    t2.at = 975;
    t2.A = 722;
    t2.B = 722;
    t2.C = 722;
    t2.D = 722;
    t2.E = 667;
    t2.F = 611;
    t2.G = 778;
    t2.H = 722;
    t2.I = 278;
    t2.J = 556;
    t2.K = 722;
    t2.L = 611;
    t2.M = 833;
    t2.N = 722;
    t2.O = 778;
    t2.P = 667;
    t2.Q = 778;
    t2.R = 722;
    t2.S = 667;
    t2.T = 611;
    t2.U = 722;
    t2.V = 667;
    t2.W = 944;
    t2.X = 667;
    t2.Y = 667;
    t2.Z = 611;
    t2.bracketleft = 333;
    t2.backslash = 278;
    t2.bracketright = 333;
    t2.asciicircum = 584;
    t2.underscore = 556;
    t2.quoteleft = 278;
    t2.a = 556;
    t2.b = 611;
    t2.c = 556;
    t2.d = 611;
    t2.e = 556;
    t2.f = 333;
    t2.g = 611;
    t2.h = 611;
    t2.i = 278;
    t2.j = 278;
    t2.k = 556;
    t2.l = 278;
    t2.m = 889;
    t2.n = 611;
    t2.o = 611;
    t2.p = 611;
    t2.q = 611;
    t2.r = 389;
    t2.s = 556;
    t2.t = 333;
    t2.u = 611;
    t2.v = 556;
    t2.w = 778;
    t2.x = 556;
    t2.y = 556;
    t2.z = 500;
    t2.braceleft = 389;
    t2.bar = 280;
    t2.braceright = 389;
    t2.asciitilde = 584;
    t2.exclamdown = 333;
    t2.cent = 556;
    t2.sterling = 556;
    t2.fraction = 167;
    t2.yen = 556;
    t2.florin = 556;
    t2.section = 556;
    t2.currency = 556;
    t2.quotesingle = 238;
    t2.quotedblleft = 500;
    t2.guillemotleft = 556;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 611;
    t2.fl = 611;
    t2.endash = 556;
    t2.dagger = 556;
    t2.daggerdbl = 556;
    t2.periodcentered = 278;
    t2.paragraph = 556;
    t2.bullet = 350;
    t2.quotesinglbase = 278;
    t2.quotedblbase = 500;
    t2.quotedblright = 500;
    t2.guillemotright = 556;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 611;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 1e3;
    t2.ordfeminine = 370;
    t2.Lslash = 611;
    t2.Oslash = 778;
    t2.OE = 1e3;
    t2.ordmasculine = 365;
    t2.ae = 889;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 611;
    t2.oe = 944;
    t2.germandbls = 611;
    t2.Idieresis = 278;
    t2.eacute = 556;
    t2.abreve = 556;
    t2.uhungarumlaut = 611;
    t2.ecaron = 556;
    t2.Ydieresis = 667;
    t2.divide = 584;
    t2.Yacute = 667;
    t2.Acircumflex = 722;
    t2.aacute = 556;
    t2.Ucircumflex = 722;
    t2.yacute = 556;
    t2.scommaaccent = 556;
    t2.ecircumflex = 556;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 556;
    t2.Uacute = 722;
    t2.uogonek = 611;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 737;
    t2.Emacron = 667;
    t2.ccaron = 556;
    t2.aring = 556;
    t2.Ncommaaccent = 722;
    t2.lacute = 278;
    t2.agrave = 556;
    t2.Tcommaaccent = 611;
    t2.Cacute = 722;
    t2.atilde = 556;
    t2.Edotaccent = 667;
    t2.scaron = 556;
    t2.scedilla = 556;
    t2.iacute = 278;
    t2.lozenge = 494;
    t2.Rcaron = 722;
    t2.Gcommaaccent = 778;
    t2.ucircumflex = 611;
    t2.acircumflex = 556;
    t2.Amacron = 722;
    t2.rcaron = 389;
    t2.ccedilla = 556;
    t2.Zdotaccent = 611;
    t2.Thorn = 667;
    t2.Omacron = 778;
    t2.Racute = 722;
    t2.Sacute = 667;
    t2.dcaron = 743;
    t2.Umacron = 722;
    t2.uring = 611;
    t2.threesuperior = 333;
    t2.Ograve = 778;
    t2.Agrave = 722;
    t2.Abreve = 722;
    t2.multiply = 584;
    t2.uacute = 611;
    t2.Tcaron = 611;
    t2.partialdiff = 494;
    t2.ydieresis = 556;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 556;
    t2.edieresis = 556;
    t2.cacute = 556;
    t2.nacute = 611;
    t2.umacron = 611;
    t2.Ncaron = 722;
    t2.Iacute = 278;
    t2.plusminus = 584;
    t2.brokenbar = 280;
    t2.registered = 737;
    t2.Gbreve = 778;
    t2.Idotaccent = 278;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 389;
    t2.omacron = 611;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 722;
    t2.lcommaaccent = 278;
    t2.tcaron = 389;
    t2.eogonek = 556;
    t2.Uogonek = 722;
    t2.Aacute = 722;
    t2.Adieresis = 722;
    t2.egrave = 556;
    t2.zacute = 500;
    t2.iogonek = 278;
    t2.Oacute = 778;
    t2.oacute = 611;
    t2.amacron = 556;
    t2.sacute = 556;
    t2.idieresis = 278;
    t2.Ocircumflex = 778;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 611;
    t2.twosuperior = 333;
    t2.Odieresis = 778;
    t2.mu = 611;
    t2.igrave = 278;
    t2.ohungarumlaut = 611;
    t2.Eogonek = 667;
    t2.dcroat = 611;
    t2.threequarters = 834;
    t2.Scedilla = 667;
    t2.lcaron = 400;
    t2.Kcommaaccent = 722;
    t2.Lacute = 611;
    t2.trademark = 1e3;
    t2.edotaccent = 556;
    t2.Igrave = 278;
    t2.Imacron = 278;
    t2.Lcaron = 611;
    t2.onehalf = 834;
    t2.lessequal = 549;
    t2.ocircumflex = 611;
    t2.ntilde = 611;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 556;
    t2.gbreve = 611;
    t2.onequarter = 834;
    t2.Scaron = 667;
    t2.Scommaaccent = 667;
    t2.Ohungarumlaut = 778;
    t2.degree = 400;
    t2.ograve = 611;
    t2.Ccaron = 722;
    t2.ugrave = 611;
    t2.radical = 549;
    t2.Dcaron = 722;
    t2.rcommaaccent = 389;
    t2.Ntilde = 722;
    t2.otilde = 611;
    t2.Rcommaaccent = 722;
    t2.Lcommaaccent = 611;
    t2.Atilde = 722;
    t2.Aogonek = 722;
    t2.Aring = 722;
    t2.Otilde = 778;
    t2.zdotaccent = 500;
    t2.Ecaron = 667;
    t2.Iogonek = 278;
    t2.kcommaaccent = 556;
    t2.minus = 584;
    t2.Icircumflex = 278;
    t2.ncaron = 611;
    t2.tcommaaccent = 333;
    t2.logicalnot = 584;
    t2.odieresis = 611;
    t2.udieresis = 611;
    t2.notequal = 549;
    t2.gcommaaccent = 611;
    t2.eth = 611;
    t2.zcaron = 500;
    t2.ncommaaccent = 611;
    t2.onesuperior = 333;
    t2.imacron = 278;
    t2.Euro = 556;
  });
  t["Helvetica-Oblique"] = getLookupTableFactory(function(t2) {
    t2.space = 278;
    t2.exclam = 278;
    t2.quotedbl = 355;
    t2.numbersign = 556;
    t2.dollar = 556;
    t2.percent = 889;
    t2.ampersand = 667;
    t2.quoteright = 222;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 389;
    t2.plus = 584;
    t2.comma = 278;
    t2.hyphen = 333;
    t2.period = 278;
    t2.slash = 278;
    t2.zero = 556;
    t2.one = 556;
    t2.two = 556;
    t2.three = 556;
    t2.four = 556;
    t2.five = 556;
    t2.six = 556;
    t2.seven = 556;
    t2.eight = 556;
    t2.nine = 556;
    t2.colon = 278;
    t2.semicolon = 278;
    t2.less = 584;
    t2.equal = 584;
    t2.greater = 584;
    t2.question = 556;
    t2.at = 1015;
    t2.A = 667;
    t2.B = 667;
    t2.C = 722;
    t2.D = 722;
    t2.E = 667;
    t2.F = 611;
    t2.G = 778;
    t2.H = 722;
    t2.I = 278;
    t2.J = 500;
    t2.K = 667;
    t2.L = 556;
    t2.M = 833;
    t2.N = 722;
    t2.O = 778;
    t2.P = 667;
    t2.Q = 778;
    t2.R = 722;
    t2.S = 667;
    t2.T = 611;
    t2.U = 722;
    t2.V = 667;
    t2.W = 944;
    t2.X = 667;
    t2.Y = 667;
    t2.Z = 611;
    t2.bracketleft = 278;
    t2.backslash = 278;
    t2.bracketright = 278;
    t2.asciicircum = 469;
    t2.underscore = 556;
    t2.quoteleft = 222;
    t2.a = 556;
    t2.b = 556;
    t2.c = 500;
    t2.d = 556;
    t2.e = 556;
    t2.f = 278;
    t2.g = 556;
    t2.h = 556;
    t2.i = 222;
    t2.j = 222;
    t2.k = 500;
    t2.l = 222;
    t2.m = 833;
    t2.n = 556;
    t2.o = 556;
    t2.p = 556;
    t2.q = 556;
    t2.r = 333;
    t2.s = 500;
    t2.t = 278;
    t2.u = 556;
    t2.v = 500;
    t2.w = 722;
    t2.x = 500;
    t2.y = 500;
    t2.z = 500;
    t2.braceleft = 334;
    t2.bar = 260;
    t2.braceright = 334;
    t2.asciitilde = 584;
    t2.exclamdown = 333;
    t2.cent = 556;
    t2.sterling = 556;
    t2.fraction = 167;
    t2.yen = 556;
    t2.florin = 556;
    t2.section = 556;
    t2.currency = 556;
    t2.quotesingle = 191;
    t2.quotedblleft = 333;
    t2.guillemotleft = 556;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 500;
    t2.fl = 500;
    t2.endash = 556;
    t2.dagger = 556;
    t2.daggerdbl = 556;
    t2.periodcentered = 278;
    t2.paragraph = 537;
    t2.bullet = 350;
    t2.quotesinglbase = 222;
    t2.quotedblbase = 333;
    t2.quotedblright = 333;
    t2.guillemotright = 556;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 611;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 1e3;
    t2.ordfeminine = 370;
    t2.Lslash = 556;
    t2.Oslash = 778;
    t2.OE = 1e3;
    t2.ordmasculine = 365;
    t2.ae = 889;
    t2.dotlessi = 278;
    t2.lslash = 222;
    t2.oslash = 611;
    t2.oe = 944;
    t2.germandbls = 611;
    t2.Idieresis = 278;
    t2.eacute = 556;
    t2.abreve = 556;
    t2.uhungarumlaut = 556;
    t2.ecaron = 556;
    t2.Ydieresis = 667;
    t2.divide = 584;
    t2.Yacute = 667;
    t2.Acircumflex = 667;
    t2.aacute = 556;
    t2.Ucircumflex = 722;
    t2.yacute = 500;
    t2.scommaaccent = 500;
    t2.ecircumflex = 556;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 556;
    t2.Uacute = 722;
    t2.uogonek = 556;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 737;
    t2.Emacron = 667;
    t2.ccaron = 500;
    t2.aring = 556;
    t2.Ncommaaccent = 722;
    t2.lacute = 222;
    t2.agrave = 556;
    t2.Tcommaaccent = 611;
    t2.Cacute = 722;
    t2.atilde = 556;
    t2.Edotaccent = 667;
    t2.scaron = 500;
    t2.scedilla = 500;
    t2.iacute = 278;
    t2.lozenge = 471;
    t2.Rcaron = 722;
    t2.Gcommaaccent = 778;
    t2.ucircumflex = 556;
    t2.acircumflex = 556;
    t2.Amacron = 667;
    t2.rcaron = 333;
    t2.ccedilla = 500;
    t2.Zdotaccent = 611;
    t2.Thorn = 667;
    t2.Omacron = 778;
    t2.Racute = 722;
    t2.Sacute = 667;
    t2.dcaron = 643;
    t2.Umacron = 722;
    t2.uring = 556;
    t2.threesuperior = 333;
    t2.Ograve = 778;
    t2.Agrave = 667;
    t2.Abreve = 667;
    t2.multiply = 584;
    t2.uacute = 556;
    t2.Tcaron = 611;
    t2.partialdiff = 476;
    t2.ydieresis = 500;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 556;
    t2.edieresis = 556;
    t2.cacute = 500;
    t2.nacute = 556;
    t2.umacron = 556;
    t2.Ncaron = 722;
    t2.Iacute = 278;
    t2.plusminus = 584;
    t2.brokenbar = 260;
    t2.registered = 737;
    t2.Gbreve = 778;
    t2.Idotaccent = 278;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 333;
    t2.omacron = 556;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 722;
    t2.lcommaaccent = 222;
    t2.tcaron = 317;
    t2.eogonek = 556;
    t2.Uogonek = 722;
    t2.Aacute = 667;
    t2.Adieresis = 667;
    t2.egrave = 556;
    t2.zacute = 500;
    t2.iogonek = 222;
    t2.Oacute = 778;
    t2.oacute = 556;
    t2.amacron = 556;
    t2.sacute = 500;
    t2.idieresis = 278;
    t2.Ocircumflex = 778;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 556;
    t2.twosuperior = 333;
    t2.Odieresis = 778;
    t2.mu = 556;
    t2.igrave = 278;
    t2.ohungarumlaut = 556;
    t2.Eogonek = 667;
    t2.dcroat = 556;
    t2.threequarters = 834;
    t2.Scedilla = 667;
    t2.lcaron = 299;
    t2.Kcommaaccent = 667;
    t2.Lacute = 556;
    t2.trademark = 1e3;
    t2.edotaccent = 556;
    t2.Igrave = 278;
    t2.Imacron = 278;
    t2.Lcaron = 556;
    t2.onehalf = 834;
    t2.lessequal = 549;
    t2.ocircumflex = 556;
    t2.ntilde = 556;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 556;
    t2.gbreve = 556;
    t2.onequarter = 834;
    t2.Scaron = 667;
    t2.Scommaaccent = 667;
    t2.Ohungarumlaut = 778;
    t2.degree = 400;
    t2.ograve = 556;
    t2.Ccaron = 722;
    t2.ugrave = 556;
    t2.radical = 453;
    t2.Dcaron = 722;
    t2.rcommaaccent = 333;
    t2.Ntilde = 722;
    t2.otilde = 556;
    t2.Rcommaaccent = 722;
    t2.Lcommaaccent = 556;
    t2.Atilde = 667;
    t2.Aogonek = 667;
    t2.Aring = 667;
    t2.Otilde = 778;
    t2.zdotaccent = 500;
    t2.Ecaron = 667;
    t2.Iogonek = 278;
    t2.kcommaaccent = 500;
    t2.minus = 584;
    t2.Icircumflex = 278;
    t2.ncaron = 556;
    t2.tcommaaccent = 278;
    t2.logicalnot = 584;
    t2.odieresis = 556;
    t2.udieresis = 556;
    t2.notequal = 549;
    t2.gcommaaccent = 556;
    t2.eth = 556;
    t2.zcaron = 500;
    t2.ncommaaccent = 556;
    t2.onesuperior = 333;
    t2.imacron = 278;
    t2.Euro = 556;
  });
  t.Symbol = getLookupTableFactory(function(t2) {
    t2.space = 250;
    t2.exclam = 333;
    t2.universal = 713;
    t2.numbersign = 500;
    t2.existential = 549;
    t2.percent = 833;
    t2.ampersand = 778;
    t2.suchthat = 439;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asteriskmath = 500;
    t2.plus = 549;
    t2.comma = 250;
    t2.minus = 549;
    t2.period = 250;
    t2.slash = 278;
    t2.zero = 500;
    t2.one = 500;
    t2.two = 500;
    t2.three = 500;
    t2.four = 500;
    t2.five = 500;
    t2.six = 500;
    t2.seven = 500;
    t2.eight = 500;
    t2.nine = 500;
    t2.colon = 278;
    t2.semicolon = 278;
    t2.less = 549;
    t2.equal = 549;
    t2.greater = 549;
    t2.question = 444;
    t2.congruent = 549;
    t2.Alpha = 722;
    t2.Beta = 667;
    t2.Chi = 722;
    t2.Delta = 612;
    t2.Epsilon = 611;
    t2.Phi = 763;
    t2.Gamma = 603;
    t2.Eta = 722;
    t2.Iota = 333;
    t2.theta1 = 631;
    t2.Kappa = 722;
    t2.Lambda = 686;
    t2.Mu = 889;
    t2.Nu = 722;
    t2.Omicron = 722;
    t2.Pi = 768;
    t2.Theta = 741;
    t2.Rho = 556;
    t2.Sigma = 592;
    t2.Tau = 611;
    t2.Upsilon = 690;
    t2.sigma1 = 439;
    t2.Omega = 768;
    t2.Xi = 645;
    t2.Psi = 795;
    t2.Zeta = 611;
    t2.bracketleft = 333;
    t2.therefore = 863;
    t2.bracketright = 333;
    t2.perpendicular = 658;
    t2.underscore = 500;
    t2.radicalex = 500;
    t2.alpha = 631;
    t2.beta = 549;
    t2.chi = 549;
    t2.delta = 494;
    t2.epsilon = 439;
    t2.phi = 521;
    t2.gamma = 411;
    t2.eta = 603;
    t2.iota = 329;
    t2.phi1 = 603;
    t2.kappa = 549;
    t2.lambda = 549;
    t2.mu = 576;
    t2.nu = 521;
    t2.omicron = 549;
    t2.pi = 549;
    t2.theta = 521;
    t2.rho = 549;
    t2.sigma = 603;
    t2.tau = 439;
    t2.upsilon = 576;
    t2.omega1 = 713;
    t2.omega = 686;
    t2.xi = 493;
    t2.psi = 686;
    t2.zeta = 494;
    t2.braceleft = 480;
    t2.bar = 200;
    t2.braceright = 480;
    t2.similar = 549;
    t2.Euro = 750;
    t2.Upsilon1 = 620;
    t2.minute = 247;
    t2.lessequal = 549;
    t2.fraction = 167;
    t2.infinity = 713;
    t2.florin = 500;
    t2.club = 753;
    t2.diamond = 753;
    t2.heart = 753;
    t2.spade = 753;
    t2.arrowboth = 1042;
    t2.arrowleft = 987;
    t2.arrowup = 603;
    t2.arrowright = 987;
    t2.arrowdown = 603;
    t2.degree = 400;
    t2.plusminus = 549;
    t2.second = 411;
    t2.greaterequal = 549;
    t2.multiply = 549;
    t2.proportional = 713;
    t2.partialdiff = 494;
    t2.bullet = 460;
    t2.divide = 549;
    t2.notequal = 549;
    t2.equivalence = 549;
    t2.approxequal = 549;
    t2.ellipsis = 1e3;
    t2.arrowvertex = 603;
    t2.arrowhorizex = 1e3;
    t2.carriagereturn = 658;
    t2.aleph = 823;
    t2.Ifraktur = 686;
    t2.Rfraktur = 795;
    t2.weierstrass = 987;
    t2.circlemultiply = 768;
    t2.circleplus = 768;
    t2.emptyset = 823;
    t2.intersection = 768;
    t2.union = 768;
    t2.propersuperset = 713;
    t2.reflexsuperset = 713;
    t2.notsubset = 713;
    t2.propersubset = 713;
    t2.reflexsubset = 713;
    t2.element = 713;
    t2.notelement = 713;
    t2.angle = 768;
    t2.gradient = 713;
    t2.registerserif = 790;
    t2.copyrightserif = 790;
    t2.trademarkserif = 890;
    t2.product = 823;
    t2.radical = 549;
    t2.dotmath = 250;
    t2.logicalnot = 713;
    t2.logicaland = 603;
    t2.logicalor = 603;
    t2.arrowdblboth = 1042;
    t2.arrowdblleft = 987;
    t2.arrowdblup = 603;
    t2.arrowdblright = 987;
    t2.arrowdbldown = 603;
    t2.lozenge = 494;
    t2.angleleft = 329;
    t2.registersans = 790;
    t2.copyrightsans = 790;
    t2.trademarksans = 786;
    t2.summation = 713;
    t2.parenlefttp = 384;
    t2.parenleftex = 384;
    t2.parenleftbt = 384;
    t2.bracketlefttp = 384;
    t2.bracketleftex = 384;
    t2.bracketleftbt = 384;
    t2.bracelefttp = 494;
    t2.braceleftmid = 494;
    t2.braceleftbt = 494;
    t2.braceex = 494;
    t2.angleright = 329;
    t2.integral = 274;
    t2.integraltp = 686;
    t2.integralex = 686;
    t2.integralbt = 686;
    t2.parenrighttp = 384;
    t2.parenrightex = 384;
    t2.parenrightbt = 384;
    t2.bracketrighttp = 384;
    t2.bracketrightex = 384;
    t2.bracketrightbt = 384;
    t2.bracerighttp = 494;
    t2.bracerightmid = 494;
    t2.bracerightbt = 494;
    t2.apple = 790;
  });
  t["Times-Roman"] = getLookupTableFactory(function(t2) {
    t2.space = 250;
    t2.exclam = 333;
    t2.quotedbl = 408;
    t2.numbersign = 500;
    t2.dollar = 500;
    t2.percent = 833;
    t2.ampersand = 778;
    t2.quoteright = 333;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 500;
    t2.plus = 564;
    t2.comma = 250;
    t2.hyphen = 333;
    t2.period = 250;
    t2.slash = 278;
    t2.zero = 500;
    t2.one = 500;
    t2.two = 500;
    t2.three = 500;
    t2.four = 500;
    t2.five = 500;
    t2.six = 500;
    t2.seven = 500;
    t2.eight = 500;
    t2.nine = 500;
    t2.colon = 278;
    t2.semicolon = 278;
    t2.less = 564;
    t2.equal = 564;
    t2.greater = 564;
    t2.question = 444;
    t2.at = 921;
    t2.A = 722;
    t2.B = 667;
    t2.C = 667;
    t2.D = 722;
    t2.E = 611;
    t2.F = 556;
    t2.G = 722;
    t2.H = 722;
    t2.I = 333;
    t2.J = 389;
    t2.K = 722;
    t2.L = 611;
    t2.M = 889;
    t2.N = 722;
    t2.O = 722;
    t2.P = 556;
    t2.Q = 722;
    t2.R = 667;
    t2.S = 556;
    t2.T = 611;
    t2.U = 722;
    t2.V = 722;
    t2.W = 944;
    t2.X = 722;
    t2.Y = 722;
    t2.Z = 611;
    t2.bracketleft = 333;
    t2.backslash = 278;
    t2.bracketright = 333;
    t2.asciicircum = 469;
    t2.underscore = 500;
    t2.quoteleft = 333;
    t2.a = 444;
    t2.b = 500;
    t2.c = 444;
    t2.d = 500;
    t2.e = 444;
    t2.f = 333;
    t2.g = 500;
    t2.h = 500;
    t2.i = 278;
    t2.j = 278;
    t2.k = 500;
    t2.l = 278;
    t2.m = 778;
    t2.n = 500;
    t2.o = 500;
    t2.p = 500;
    t2.q = 500;
    t2.r = 333;
    t2.s = 389;
    t2.t = 278;
    t2.u = 500;
    t2.v = 500;
    t2.w = 722;
    t2.x = 500;
    t2.y = 500;
    t2.z = 444;
    t2.braceleft = 480;
    t2.bar = 200;
    t2.braceright = 480;
    t2.asciitilde = 541;
    t2.exclamdown = 333;
    t2.cent = 500;
    t2.sterling = 500;
    t2.fraction = 167;
    t2.yen = 500;
    t2.florin = 500;
    t2.section = 500;
    t2.currency = 500;
    t2.quotesingle = 180;
    t2.quotedblleft = 444;
    t2.guillemotleft = 500;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 556;
    t2.fl = 556;
    t2.endash = 500;
    t2.dagger = 500;
    t2.daggerdbl = 500;
    t2.periodcentered = 250;
    t2.paragraph = 453;
    t2.bullet = 350;
    t2.quotesinglbase = 333;
    t2.quotedblbase = 444;
    t2.quotedblright = 444;
    t2.guillemotright = 500;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 444;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 889;
    t2.ordfeminine = 276;
    t2.Lslash = 611;
    t2.Oslash = 722;
    t2.OE = 889;
    t2.ordmasculine = 310;
    t2.ae = 667;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 500;
    t2.oe = 722;
    t2.germandbls = 500;
    t2.Idieresis = 333;
    t2.eacute = 444;
    t2.abreve = 444;
    t2.uhungarumlaut = 500;
    t2.ecaron = 444;
    t2.Ydieresis = 722;
    t2.divide = 564;
    t2.Yacute = 722;
    t2.Acircumflex = 722;
    t2.aacute = 444;
    t2.Ucircumflex = 722;
    t2.yacute = 500;
    t2.scommaaccent = 389;
    t2.ecircumflex = 444;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 444;
    t2.Uacute = 722;
    t2.uogonek = 500;
    t2.Edieresis = 611;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 760;
    t2.Emacron = 611;
    t2.ccaron = 444;
    t2.aring = 444;
    t2.Ncommaaccent = 722;
    t2.lacute = 278;
    t2.agrave = 444;
    t2.Tcommaaccent = 611;
    t2.Cacute = 667;
    t2.atilde = 444;
    t2.Edotaccent = 611;
    t2.scaron = 389;
    t2.scedilla = 389;
    t2.iacute = 278;
    t2.lozenge = 471;
    t2.Rcaron = 667;
    t2.Gcommaaccent = 722;
    t2.ucircumflex = 500;
    t2.acircumflex = 444;
    t2.Amacron = 722;
    t2.rcaron = 333;
    t2.ccedilla = 444;
    t2.Zdotaccent = 611;
    t2.Thorn = 556;
    t2.Omacron = 722;
    t2.Racute = 667;
    t2.Sacute = 556;
    t2.dcaron = 588;
    t2.Umacron = 722;
    t2.uring = 500;
    t2.threesuperior = 300;
    t2.Ograve = 722;
    t2.Agrave = 722;
    t2.Abreve = 722;
    t2.multiply = 564;
    t2.uacute = 500;
    t2.Tcaron = 611;
    t2.partialdiff = 476;
    t2.ydieresis = 500;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 611;
    t2.adieresis = 444;
    t2.edieresis = 444;
    t2.cacute = 444;
    t2.nacute = 500;
    t2.umacron = 500;
    t2.Ncaron = 722;
    t2.Iacute = 333;
    t2.plusminus = 564;
    t2.brokenbar = 200;
    t2.registered = 760;
    t2.Gbreve = 722;
    t2.Idotaccent = 333;
    t2.summation = 600;
    t2.Egrave = 611;
    t2.racute = 333;
    t2.omacron = 500;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 667;
    t2.lcommaaccent = 278;
    t2.tcaron = 326;
    t2.eogonek = 444;
    t2.Uogonek = 722;
    t2.Aacute = 722;
    t2.Adieresis = 722;
    t2.egrave = 444;
    t2.zacute = 444;
    t2.iogonek = 278;
    t2.Oacute = 722;
    t2.oacute = 500;
    t2.amacron = 444;
    t2.sacute = 389;
    t2.idieresis = 278;
    t2.Ocircumflex = 722;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 500;
    t2.twosuperior = 300;
    t2.Odieresis = 722;
    t2.mu = 500;
    t2.igrave = 278;
    t2.ohungarumlaut = 500;
    t2.Eogonek = 611;
    t2.dcroat = 500;
    t2.threequarters = 750;
    t2.Scedilla = 556;
    t2.lcaron = 344;
    t2.Kcommaaccent = 722;
    t2.Lacute = 611;
    t2.trademark = 980;
    t2.edotaccent = 444;
    t2.Igrave = 333;
    t2.Imacron = 333;
    t2.Lcaron = 611;
    t2.onehalf = 750;
    t2.lessequal = 549;
    t2.ocircumflex = 500;
    t2.ntilde = 500;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 611;
    t2.emacron = 444;
    t2.gbreve = 500;
    t2.onequarter = 750;
    t2.Scaron = 556;
    t2.Scommaaccent = 556;
    t2.Ohungarumlaut = 722;
    t2.degree = 400;
    t2.ograve = 500;
    t2.Ccaron = 667;
    t2.ugrave = 500;
    t2.radical = 453;
    t2.Dcaron = 722;
    t2.rcommaaccent = 333;
    t2.Ntilde = 722;
    t2.otilde = 500;
    t2.Rcommaaccent = 667;
    t2.Lcommaaccent = 611;
    t2.Atilde = 722;
    t2.Aogonek = 722;
    t2.Aring = 722;
    t2.Otilde = 722;
    t2.zdotaccent = 444;
    t2.Ecaron = 611;
    t2.Iogonek = 333;
    t2.kcommaaccent = 500;
    t2.minus = 564;
    t2.Icircumflex = 333;
    t2.ncaron = 500;
    t2.tcommaaccent = 278;
    t2.logicalnot = 564;
    t2.odieresis = 500;
    t2.udieresis = 500;
    t2.notequal = 549;
    t2.gcommaaccent = 500;
    t2.eth = 500;
    t2.zcaron = 444;
    t2.ncommaaccent = 500;
    t2.onesuperior = 300;
    t2.imacron = 278;
    t2.Euro = 500;
  });
  t["Times-Bold"] = getLookupTableFactory(function(t2) {
    t2.space = 250;
    t2.exclam = 333;
    t2.quotedbl = 555;
    t2.numbersign = 500;
    t2.dollar = 500;
    t2.percent = 1e3;
    t2.ampersand = 833;
    t2.quoteright = 333;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 500;
    t2.plus = 570;
    t2.comma = 250;
    t2.hyphen = 333;
    t2.period = 250;
    t2.slash = 278;
    t2.zero = 500;
    t2.one = 500;
    t2.two = 500;
    t2.three = 500;
    t2.four = 500;
    t2.five = 500;
    t2.six = 500;
    t2.seven = 500;
    t2.eight = 500;
    t2.nine = 500;
    t2.colon = 333;
    t2.semicolon = 333;
    t2.less = 570;
    t2.equal = 570;
    t2.greater = 570;
    t2.question = 500;
    t2.at = 930;
    t2.A = 722;
    t2.B = 667;
    t2.C = 722;
    t2.D = 722;
    t2.E = 667;
    t2.F = 611;
    t2.G = 778;
    t2.H = 778;
    t2.I = 389;
    t2.J = 500;
    t2.K = 778;
    t2.L = 667;
    t2.M = 944;
    t2.N = 722;
    t2.O = 778;
    t2.P = 611;
    t2.Q = 778;
    t2.R = 722;
    t2.S = 556;
    t2.T = 667;
    t2.U = 722;
    t2.V = 722;
    t2.W = 1e3;
    t2.X = 722;
    t2.Y = 722;
    t2.Z = 667;
    t2.bracketleft = 333;
    t2.backslash = 278;
    t2.bracketright = 333;
    t2.asciicircum = 581;
    t2.underscore = 500;
    t2.quoteleft = 333;
    t2.a = 500;
    t2.b = 556;
    t2.c = 444;
    t2.d = 556;
    t2.e = 444;
    t2.f = 333;
    t2.g = 500;
    t2.h = 556;
    t2.i = 278;
    t2.j = 333;
    t2.k = 556;
    t2.l = 278;
    t2.m = 833;
    t2.n = 556;
    t2.o = 500;
    t2.p = 556;
    t2.q = 556;
    t2.r = 444;
    t2.s = 389;
    t2.t = 333;
    t2.u = 556;
    t2.v = 500;
    t2.w = 722;
    t2.x = 500;
    t2.y = 500;
    t2.z = 444;
    t2.braceleft = 394;
    t2.bar = 220;
    t2.braceright = 394;
    t2.asciitilde = 520;
    t2.exclamdown = 333;
    t2.cent = 500;
    t2.sterling = 500;
    t2.fraction = 167;
    t2.yen = 500;
    t2.florin = 500;
    t2.section = 500;
    t2.currency = 500;
    t2.quotesingle = 278;
    t2.quotedblleft = 500;
    t2.guillemotleft = 500;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 556;
    t2.fl = 556;
    t2.endash = 500;
    t2.dagger = 500;
    t2.daggerdbl = 500;
    t2.periodcentered = 250;
    t2.paragraph = 540;
    t2.bullet = 350;
    t2.quotesinglbase = 333;
    t2.quotedblbase = 500;
    t2.quotedblright = 500;
    t2.guillemotright = 500;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 500;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 1e3;
    t2.ordfeminine = 300;
    t2.Lslash = 667;
    t2.Oslash = 778;
    t2.OE = 1e3;
    t2.ordmasculine = 330;
    t2.ae = 722;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 500;
    t2.oe = 722;
    t2.germandbls = 556;
    t2.Idieresis = 389;
    t2.eacute = 444;
    t2.abreve = 500;
    t2.uhungarumlaut = 556;
    t2.ecaron = 444;
    t2.Ydieresis = 722;
    t2.divide = 570;
    t2.Yacute = 722;
    t2.Acircumflex = 722;
    t2.aacute = 500;
    t2.Ucircumflex = 722;
    t2.yacute = 500;
    t2.scommaaccent = 389;
    t2.ecircumflex = 444;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 500;
    t2.Uacute = 722;
    t2.uogonek = 556;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 747;
    t2.Emacron = 667;
    t2.ccaron = 444;
    t2.aring = 500;
    t2.Ncommaaccent = 722;
    t2.lacute = 278;
    t2.agrave = 500;
    t2.Tcommaaccent = 667;
    t2.Cacute = 722;
    t2.atilde = 500;
    t2.Edotaccent = 667;
    t2.scaron = 389;
    t2.scedilla = 389;
    t2.iacute = 278;
    t2.lozenge = 494;
    t2.Rcaron = 722;
    t2.Gcommaaccent = 778;
    t2.ucircumflex = 556;
    t2.acircumflex = 500;
    t2.Amacron = 722;
    t2.rcaron = 444;
    t2.ccedilla = 444;
    t2.Zdotaccent = 667;
    t2.Thorn = 611;
    t2.Omacron = 778;
    t2.Racute = 722;
    t2.Sacute = 556;
    t2.dcaron = 672;
    t2.Umacron = 722;
    t2.uring = 556;
    t2.threesuperior = 300;
    t2.Ograve = 778;
    t2.Agrave = 722;
    t2.Abreve = 722;
    t2.multiply = 570;
    t2.uacute = 556;
    t2.Tcaron = 667;
    t2.partialdiff = 494;
    t2.ydieresis = 500;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 500;
    t2.edieresis = 444;
    t2.cacute = 444;
    t2.nacute = 556;
    t2.umacron = 556;
    t2.Ncaron = 722;
    t2.Iacute = 389;
    t2.plusminus = 570;
    t2.brokenbar = 220;
    t2.registered = 747;
    t2.Gbreve = 778;
    t2.Idotaccent = 389;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 444;
    t2.omacron = 500;
    t2.Zacute = 667;
    t2.Zcaron = 667;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 722;
    t2.lcommaaccent = 278;
    t2.tcaron = 416;
    t2.eogonek = 444;
    t2.Uogonek = 722;
    t2.Aacute = 722;
    t2.Adieresis = 722;
    t2.egrave = 444;
    t2.zacute = 444;
    t2.iogonek = 278;
    t2.Oacute = 778;
    t2.oacute = 500;
    t2.amacron = 500;
    t2.sacute = 389;
    t2.idieresis = 278;
    t2.Ocircumflex = 778;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 556;
    t2.twosuperior = 300;
    t2.Odieresis = 778;
    t2.mu = 556;
    t2.igrave = 278;
    t2.ohungarumlaut = 500;
    t2.Eogonek = 667;
    t2.dcroat = 556;
    t2.threequarters = 750;
    t2.Scedilla = 556;
    t2.lcaron = 394;
    t2.Kcommaaccent = 778;
    t2.Lacute = 667;
    t2.trademark = 1e3;
    t2.edotaccent = 444;
    t2.Igrave = 389;
    t2.Imacron = 389;
    t2.Lcaron = 667;
    t2.onehalf = 750;
    t2.lessequal = 549;
    t2.ocircumflex = 500;
    t2.ntilde = 556;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 444;
    t2.gbreve = 500;
    t2.onequarter = 750;
    t2.Scaron = 556;
    t2.Scommaaccent = 556;
    t2.Ohungarumlaut = 778;
    t2.degree = 400;
    t2.ograve = 500;
    t2.Ccaron = 722;
    t2.ugrave = 556;
    t2.radical = 549;
    t2.Dcaron = 722;
    t2.rcommaaccent = 444;
    t2.Ntilde = 722;
    t2.otilde = 500;
    t2.Rcommaaccent = 722;
    t2.Lcommaaccent = 667;
    t2.Atilde = 722;
    t2.Aogonek = 722;
    t2.Aring = 722;
    t2.Otilde = 778;
    t2.zdotaccent = 444;
    t2.Ecaron = 667;
    t2.Iogonek = 389;
    t2.kcommaaccent = 556;
    t2.minus = 570;
    t2.Icircumflex = 389;
    t2.ncaron = 556;
    t2.tcommaaccent = 333;
    t2.logicalnot = 570;
    t2.odieresis = 500;
    t2.udieresis = 556;
    t2.notequal = 549;
    t2.gcommaaccent = 500;
    t2.eth = 500;
    t2.zcaron = 444;
    t2.ncommaaccent = 556;
    t2.onesuperior = 300;
    t2.imacron = 278;
    t2.Euro = 500;
  });
  t["Times-BoldItalic"] = getLookupTableFactory(function(t2) {
    t2.space = 250;
    t2.exclam = 389;
    t2.quotedbl = 555;
    t2.numbersign = 500;
    t2.dollar = 500;
    t2.percent = 833;
    t2.ampersand = 778;
    t2.quoteright = 333;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 500;
    t2.plus = 570;
    t2.comma = 250;
    t2.hyphen = 333;
    t2.period = 250;
    t2.slash = 278;
    t2.zero = 500;
    t2.one = 500;
    t2.two = 500;
    t2.three = 500;
    t2.four = 500;
    t2.five = 500;
    t2.six = 500;
    t2.seven = 500;
    t2.eight = 500;
    t2.nine = 500;
    t2.colon = 333;
    t2.semicolon = 333;
    t2.less = 570;
    t2.equal = 570;
    t2.greater = 570;
    t2.question = 500;
    t2.at = 832;
    t2.A = 667;
    t2.B = 667;
    t2.C = 667;
    t2.D = 722;
    t2.E = 667;
    t2.F = 667;
    t2.G = 722;
    t2.H = 778;
    t2.I = 389;
    t2.J = 500;
    t2.K = 667;
    t2.L = 611;
    t2.M = 889;
    t2.N = 722;
    t2.O = 722;
    t2.P = 611;
    t2.Q = 722;
    t2.R = 667;
    t2.S = 556;
    t2.T = 611;
    t2.U = 722;
    t2.V = 667;
    t2.W = 889;
    t2.X = 667;
    t2.Y = 611;
    t2.Z = 611;
    t2.bracketleft = 333;
    t2.backslash = 278;
    t2.bracketright = 333;
    t2.asciicircum = 570;
    t2.underscore = 500;
    t2.quoteleft = 333;
    t2.a = 500;
    t2.b = 500;
    t2.c = 444;
    t2.d = 500;
    t2.e = 444;
    t2.f = 333;
    t2.g = 500;
    t2.h = 556;
    t2.i = 278;
    t2.j = 278;
    t2.k = 500;
    t2.l = 278;
    t2.m = 778;
    t2.n = 556;
    t2.o = 500;
    t2.p = 500;
    t2.q = 500;
    t2.r = 389;
    t2.s = 389;
    t2.t = 278;
    t2.u = 556;
    t2.v = 444;
    t2.w = 667;
    t2.x = 500;
    t2.y = 444;
    t2.z = 389;
    t2.braceleft = 348;
    t2.bar = 220;
    t2.braceright = 348;
    t2.asciitilde = 570;
    t2.exclamdown = 389;
    t2.cent = 500;
    t2.sterling = 500;
    t2.fraction = 167;
    t2.yen = 500;
    t2.florin = 500;
    t2.section = 500;
    t2.currency = 500;
    t2.quotesingle = 278;
    t2.quotedblleft = 500;
    t2.guillemotleft = 500;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 556;
    t2.fl = 556;
    t2.endash = 500;
    t2.dagger = 500;
    t2.daggerdbl = 500;
    t2.periodcentered = 250;
    t2.paragraph = 500;
    t2.bullet = 350;
    t2.quotesinglbase = 333;
    t2.quotedblbase = 500;
    t2.quotedblright = 500;
    t2.guillemotright = 500;
    t2.ellipsis = 1e3;
    t2.perthousand = 1e3;
    t2.questiondown = 500;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 1e3;
    t2.AE = 944;
    t2.ordfeminine = 266;
    t2.Lslash = 611;
    t2.Oslash = 722;
    t2.OE = 944;
    t2.ordmasculine = 300;
    t2.ae = 722;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 500;
    t2.oe = 722;
    t2.germandbls = 500;
    t2.Idieresis = 389;
    t2.eacute = 444;
    t2.abreve = 500;
    t2.uhungarumlaut = 556;
    t2.ecaron = 444;
    t2.Ydieresis = 611;
    t2.divide = 570;
    t2.Yacute = 611;
    t2.Acircumflex = 667;
    t2.aacute = 500;
    t2.Ucircumflex = 722;
    t2.yacute = 444;
    t2.scommaaccent = 389;
    t2.ecircumflex = 444;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 500;
    t2.Uacute = 722;
    t2.uogonek = 556;
    t2.Edieresis = 667;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 747;
    t2.Emacron = 667;
    t2.ccaron = 444;
    t2.aring = 500;
    t2.Ncommaaccent = 722;
    t2.lacute = 278;
    t2.agrave = 500;
    t2.Tcommaaccent = 611;
    t2.Cacute = 667;
    t2.atilde = 500;
    t2.Edotaccent = 667;
    t2.scaron = 389;
    t2.scedilla = 389;
    t2.iacute = 278;
    t2.lozenge = 494;
    t2.Rcaron = 667;
    t2.Gcommaaccent = 722;
    t2.ucircumflex = 556;
    t2.acircumflex = 500;
    t2.Amacron = 667;
    t2.rcaron = 389;
    t2.ccedilla = 444;
    t2.Zdotaccent = 611;
    t2.Thorn = 611;
    t2.Omacron = 722;
    t2.Racute = 667;
    t2.Sacute = 556;
    t2.dcaron = 608;
    t2.Umacron = 722;
    t2.uring = 556;
    t2.threesuperior = 300;
    t2.Ograve = 722;
    t2.Agrave = 667;
    t2.Abreve = 667;
    t2.multiply = 570;
    t2.uacute = 556;
    t2.Tcaron = 611;
    t2.partialdiff = 494;
    t2.ydieresis = 444;
    t2.Nacute = 722;
    t2.icircumflex = 278;
    t2.Ecircumflex = 667;
    t2.adieresis = 500;
    t2.edieresis = 444;
    t2.cacute = 444;
    t2.nacute = 556;
    t2.umacron = 556;
    t2.Ncaron = 722;
    t2.Iacute = 389;
    t2.plusminus = 570;
    t2.brokenbar = 220;
    t2.registered = 747;
    t2.Gbreve = 722;
    t2.Idotaccent = 389;
    t2.summation = 600;
    t2.Egrave = 667;
    t2.racute = 389;
    t2.omacron = 500;
    t2.Zacute = 611;
    t2.Zcaron = 611;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 667;
    t2.lcommaaccent = 278;
    t2.tcaron = 366;
    t2.eogonek = 444;
    t2.Uogonek = 722;
    t2.Aacute = 667;
    t2.Adieresis = 667;
    t2.egrave = 444;
    t2.zacute = 389;
    t2.iogonek = 278;
    t2.Oacute = 722;
    t2.oacute = 500;
    t2.amacron = 500;
    t2.sacute = 389;
    t2.idieresis = 278;
    t2.Ocircumflex = 722;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 500;
    t2.twosuperior = 300;
    t2.Odieresis = 722;
    t2.mu = 576;
    t2.igrave = 278;
    t2.ohungarumlaut = 500;
    t2.Eogonek = 667;
    t2.dcroat = 500;
    t2.threequarters = 750;
    t2.Scedilla = 556;
    t2.lcaron = 382;
    t2.Kcommaaccent = 667;
    t2.Lacute = 611;
    t2.trademark = 1e3;
    t2.edotaccent = 444;
    t2.Igrave = 389;
    t2.Imacron = 389;
    t2.Lcaron = 611;
    t2.onehalf = 750;
    t2.lessequal = 549;
    t2.ocircumflex = 500;
    t2.ntilde = 556;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 667;
    t2.emacron = 444;
    t2.gbreve = 500;
    t2.onequarter = 750;
    t2.Scaron = 556;
    t2.Scommaaccent = 556;
    t2.Ohungarumlaut = 722;
    t2.degree = 400;
    t2.ograve = 500;
    t2.Ccaron = 667;
    t2.ugrave = 556;
    t2.radical = 549;
    t2.Dcaron = 722;
    t2.rcommaaccent = 389;
    t2.Ntilde = 722;
    t2.otilde = 500;
    t2.Rcommaaccent = 667;
    t2.Lcommaaccent = 611;
    t2.Atilde = 667;
    t2.Aogonek = 667;
    t2.Aring = 667;
    t2.Otilde = 722;
    t2.zdotaccent = 389;
    t2.Ecaron = 667;
    t2.Iogonek = 389;
    t2.kcommaaccent = 500;
    t2.minus = 606;
    t2.Icircumflex = 389;
    t2.ncaron = 556;
    t2.tcommaaccent = 278;
    t2.logicalnot = 606;
    t2.odieresis = 500;
    t2.udieresis = 556;
    t2.notequal = 549;
    t2.gcommaaccent = 500;
    t2.eth = 500;
    t2.zcaron = 389;
    t2.ncommaaccent = 556;
    t2.onesuperior = 300;
    t2.imacron = 278;
    t2.Euro = 500;
  });
  t["Times-Italic"] = getLookupTableFactory(function(t2) {
    t2.space = 250;
    t2.exclam = 333;
    t2.quotedbl = 420;
    t2.numbersign = 500;
    t2.dollar = 500;
    t2.percent = 833;
    t2.ampersand = 778;
    t2.quoteright = 333;
    t2.parenleft = 333;
    t2.parenright = 333;
    t2.asterisk = 500;
    t2.plus = 675;
    t2.comma = 250;
    t2.hyphen = 333;
    t2.period = 250;
    t2.slash = 278;
    t2.zero = 500;
    t2.one = 500;
    t2.two = 500;
    t2.three = 500;
    t2.four = 500;
    t2.five = 500;
    t2.six = 500;
    t2.seven = 500;
    t2.eight = 500;
    t2.nine = 500;
    t2.colon = 333;
    t2.semicolon = 333;
    t2.less = 675;
    t2.equal = 675;
    t2.greater = 675;
    t2.question = 500;
    t2.at = 920;
    t2.A = 611;
    t2.B = 611;
    t2.C = 667;
    t2.D = 722;
    t2.E = 611;
    t2.F = 611;
    t2.G = 722;
    t2.H = 722;
    t2.I = 333;
    t2.J = 444;
    t2.K = 667;
    t2.L = 556;
    t2.M = 833;
    t2.N = 667;
    t2.O = 722;
    t2.P = 611;
    t2.Q = 722;
    t2.R = 611;
    t2.S = 500;
    t2.T = 556;
    t2.U = 722;
    t2.V = 611;
    t2.W = 833;
    t2.X = 611;
    t2.Y = 556;
    t2.Z = 556;
    t2.bracketleft = 389;
    t2.backslash = 278;
    t2.bracketright = 389;
    t2.asciicircum = 422;
    t2.underscore = 500;
    t2.quoteleft = 333;
    t2.a = 500;
    t2.b = 500;
    t2.c = 444;
    t2.d = 500;
    t2.e = 444;
    t2.f = 278;
    t2.g = 500;
    t2.h = 500;
    t2.i = 278;
    t2.j = 278;
    t2.k = 444;
    t2.l = 278;
    t2.m = 722;
    t2.n = 500;
    t2.o = 500;
    t2.p = 500;
    t2.q = 500;
    t2.r = 389;
    t2.s = 389;
    t2.t = 278;
    t2.u = 500;
    t2.v = 444;
    t2.w = 667;
    t2.x = 444;
    t2.y = 444;
    t2.z = 389;
    t2.braceleft = 400;
    t2.bar = 275;
    t2.braceright = 400;
    t2.asciitilde = 541;
    t2.exclamdown = 389;
    t2.cent = 500;
    t2.sterling = 500;
    t2.fraction = 167;
    t2.yen = 500;
    t2.florin = 500;
    t2.section = 500;
    t2.currency = 500;
    t2.quotesingle = 214;
    t2.quotedblleft = 556;
    t2.guillemotleft = 500;
    t2.guilsinglleft = 333;
    t2.guilsinglright = 333;
    t2.fi = 500;
    t2.fl = 500;
    t2.endash = 500;
    t2.dagger = 500;
    t2.daggerdbl = 500;
    t2.periodcentered = 250;
    t2.paragraph = 523;
    t2.bullet = 350;
    t2.quotesinglbase = 333;
    t2.quotedblbase = 556;
    t2.quotedblright = 556;
    t2.guillemotright = 500;
    t2.ellipsis = 889;
    t2.perthousand = 1e3;
    t2.questiondown = 500;
    t2.grave = 333;
    t2.acute = 333;
    t2.circumflex = 333;
    t2.tilde = 333;
    t2.macron = 333;
    t2.breve = 333;
    t2.dotaccent = 333;
    t2.dieresis = 333;
    t2.ring = 333;
    t2.cedilla = 333;
    t2.hungarumlaut = 333;
    t2.ogonek = 333;
    t2.caron = 333;
    t2.emdash = 889;
    t2.AE = 889;
    t2.ordfeminine = 276;
    t2.Lslash = 556;
    t2.Oslash = 722;
    t2.OE = 944;
    t2.ordmasculine = 310;
    t2.ae = 667;
    t2.dotlessi = 278;
    t2.lslash = 278;
    t2.oslash = 500;
    t2.oe = 667;
    t2.germandbls = 500;
    t2.Idieresis = 333;
    t2.eacute = 444;
    t2.abreve = 500;
    t2.uhungarumlaut = 500;
    t2.ecaron = 444;
    t2.Ydieresis = 556;
    t2.divide = 675;
    t2.Yacute = 556;
    t2.Acircumflex = 611;
    t2.aacute = 500;
    t2.Ucircumflex = 722;
    t2.yacute = 444;
    t2.scommaaccent = 389;
    t2.ecircumflex = 444;
    t2.Uring = 722;
    t2.Udieresis = 722;
    t2.aogonek = 500;
    t2.Uacute = 722;
    t2.uogonek = 500;
    t2.Edieresis = 611;
    t2.Dcroat = 722;
    t2.commaaccent = 250;
    t2.copyright = 760;
    t2.Emacron = 611;
    t2.ccaron = 444;
    t2.aring = 500;
    t2.Ncommaaccent = 667;
    t2.lacute = 278;
    t2.agrave = 500;
    t2.Tcommaaccent = 556;
    t2.Cacute = 667;
    t2.atilde = 500;
    t2.Edotaccent = 611;
    t2.scaron = 389;
    t2.scedilla = 389;
    t2.iacute = 278;
    t2.lozenge = 471;
    t2.Rcaron = 611;
    t2.Gcommaaccent = 722;
    t2.ucircumflex = 500;
    t2.acircumflex = 500;
    t2.Amacron = 611;
    t2.rcaron = 389;
    t2.ccedilla = 444;
    t2.Zdotaccent = 556;
    t2.Thorn = 611;
    t2.Omacron = 722;
    t2.Racute = 611;
    t2.Sacute = 500;
    t2.dcaron = 544;
    t2.Umacron = 722;
    t2.uring = 500;
    t2.threesuperior = 300;
    t2.Ograve = 722;
    t2.Agrave = 611;
    t2.Abreve = 611;
    t2.multiply = 675;
    t2.uacute = 500;
    t2.Tcaron = 556;
    t2.partialdiff = 476;
    t2.ydieresis = 444;
    t2.Nacute = 667;
    t2.icircumflex = 278;
    t2.Ecircumflex = 611;
    t2.adieresis = 500;
    t2.edieresis = 444;
    t2.cacute = 444;
    t2.nacute = 500;
    t2.umacron = 500;
    t2.Ncaron = 667;
    t2.Iacute = 333;
    t2.plusminus = 675;
    t2.brokenbar = 275;
    t2.registered = 760;
    t2.Gbreve = 722;
    t2.Idotaccent = 333;
    t2.summation = 600;
    t2.Egrave = 611;
    t2.racute = 389;
    t2.omacron = 500;
    t2.Zacute = 556;
    t2.Zcaron = 556;
    t2.greaterequal = 549;
    t2.Eth = 722;
    t2.Ccedilla = 667;
    t2.lcommaaccent = 278;
    t2.tcaron = 300;
    t2.eogonek = 444;
    t2.Uogonek = 722;
    t2.Aacute = 611;
    t2.Adieresis = 611;
    t2.egrave = 444;
    t2.zacute = 389;
    t2.iogonek = 278;
    t2.Oacute = 722;
    t2.oacute = 500;
    t2.amacron = 500;
    t2.sacute = 389;
    t2.idieresis = 278;
    t2.Ocircumflex = 722;
    t2.Ugrave = 722;
    t2.Delta = 612;
    t2.thorn = 500;
    t2.twosuperior = 300;
    t2.Odieresis = 722;
    t2.mu = 500;
    t2.igrave = 278;
    t2.ohungarumlaut = 500;
    t2.Eogonek = 611;
    t2.dcroat = 500;
    t2.threequarters = 750;
    t2.Scedilla = 500;
    t2.lcaron = 300;
    t2.Kcommaaccent = 667;
    t2.Lacute = 556;
    t2.trademark = 980;
    t2.edotaccent = 444;
    t2.Igrave = 333;
    t2.Imacron = 333;
    t2.Lcaron = 611;
    t2.onehalf = 750;
    t2.lessequal = 549;
    t2.ocircumflex = 500;
    t2.ntilde = 500;
    t2.Uhungarumlaut = 722;
    t2.Eacute = 611;
    t2.emacron = 444;
    t2.gbreve = 500;
    t2.onequarter = 750;
    t2.Scaron = 500;
    t2.Scommaaccent = 500;
    t2.Ohungarumlaut = 722;
    t2.degree = 400;
    t2.ograve = 500;
    t2.Ccaron = 667;
    t2.ugrave = 500;
    t2.radical = 453;
    t2.Dcaron = 722;
    t2.rcommaaccent = 389;
    t2.Ntilde = 667;
    t2.otilde = 500;
    t2.Rcommaaccent = 611;
    t2.Lcommaaccent = 556;
    t2.Atilde = 611;
    t2.Aogonek = 611;
    t2.Aring = 611;
    t2.Otilde = 722;
    t2.zdotaccent = 389;
    t2.Ecaron = 611;
    t2.Iogonek = 333;
    t2.kcommaaccent = 444;
    t2.minus = 675;
    t2.Icircumflex = 333;
    t2.ncaron = 500;
    t2.tcommaaccent = 278;
    t2.logicalnot = 675;
    t2.odieresis = 500;
    t2.udieresis = 500;
    t2.notequal = 549;
    t2.gcommaaccent = 500;
    t2.eth = 500;
    t2.zcaron = 389;
    t2.ncommaaccent = 500;
    t2.onesuperior = 300;
    t2.imacron = 278;
    t2.Euro = 500;
  });
  t.ZapfDingbats = getLookupTableFactory(function(t2) {
    t2.space = 278;
    t2.a1 = 974;
    t2.a2 = 961;
    t2.a202 = 974;
    t2.a3 = 980;
    t2.a4 = 719;
    t2.a5 = 789;
    t2.a119 = 790;
    t2.a118 = 791;
    t2.a117 = 690;
    t2.a11 = 960;
    t2.a12 = 939;
    t2.a13 = 549;
    t2.a14 = 855;
    t2.a15 = 911;
    t2.a16 = 933;
    t2.a105 = 911;
    t2.a17 = 945;
    t2.a18 = 974;
    t2.a19 = 755;
    t2.a20 = 846;
    t2.a21 = 762;
    t2.a22 = 761;
    t2.a23 = 571;
    t2.a24 = 677;
    t2.a25 = 763;
    t2.a26 = 760;
    t2.a27 = 759;
    t2.a28 = 754;
    t2.a6 = 494;
    t2.a7 = 552;
    t2.a8 = 537;
    t2.a9 = 577;
    t2.a10 = 692;
    t2.a29 = 786;
    t2.a30 = 788;
    t2.a31 = 788;
    t2.a32 = 790;
    t2.a33 = 793;
    t2.a34 = 794;
    t2.a35 = 816;
    t2.a36 = 823;
    t2.a37 = 789;
    t2.a38 = 841;
    t2.a39 = 823;
    t2.a40 = 833;
    t2.a41 = 816;
    t2.a42 = 831;
    t2.a43 = 923;
    t2.a44 = 744;
    t2.a45 = 723;
    t2.a46 = 749;
    t2.a47 = 790;
    t2.a48 = 792;
    t2.a49 = 695;
    t2.a50 = 776;
    t2.a51 = 768;
    t2.a52 = 792;
    t2.a53 = 759;
    t2.a54 = 707;
    t2.a55 = 708;
    t2.a56 = 682;
    t2.a57 = 701;
    t2.a58 = 826;
    t2.a59 = 815;
    t2.a60 = 789;
    t2.a61 = 789;
    t2.a62 = 707;
    t2.a63 = 687;
    t2.a64 = 696;
    t2.a65 = 689;
    t2.a66 = 786;
    t2.a67 = 787;
    t2.a68 = 713;
    t2.a69 = 791;
    t2.a70 = 785;
    t2.a71 = 791;
    t2.a72 = 873;
    t2.a73 = 761;
    t2.a74 = 762;
    t2.a203 = 762;
    t2.a75 = 759;
    t2.a204 = 759;
    t2.a76 = 892;
    t2.a77 = 892;
    t2.a78 = 788;
    t2.a79 = 784;
    t2.a81 = 438;
    t2.a82 = 138;
    t2.a83 = 277;
    t2.a84 = 415;
    t2.a97 = 392;
    t2.a98 = 392;
    t2.a99 = 668;
    t2.a100 = 668;
    t2.a89 = 390;
    t2.a90 = 390;
    t2.a93 = 317;
    t2.a94 = 317;
    t2.a91 = 276;
    t2.a92 = 276;
    t2.a205 = 509;
    t2.a85 = 509;
    t2.a206 = 410;
    t2.a86 = 410;
    t2.a87 = 234;
    t2.a88 = 234;
    t2.a95 = 334;
    t2.a96 = 334;
    t2.a101 = 732;
    t2.a102 = 544;
    t2.a103 = 544;
    t2.a104 = 910;
    t2.a106 = 667;
    t2.a107 = 760;
    t2.a108 = 760;
    t2.a112 = 776;
    t2.a111 = 595;
    t2.a110 = 694;
    t2.a109 = 626;
    t2.a120 = 788;
    t2.a121 = 788;
    t2.a122 = 788;
    t2.a123 = 788;
    t2.a124 = 788;
    t2.a125 = 788;
    t2.a126 = 788;
    t2.a127 = 788;
    t2.a128 = 788;
    t2.a129 = 788;
    t2.a130 = 788;
    t2.a131 = 788;
    t2.a132 = 788;
    t2.a133 = 788;
    t2.a134 = 788;
    t2.a135 = 788;
    t2.a136 = 788;
    t2.a137 = 788;
    t2.a138 = 788;
    t2.a139 = 788;
    t2.a140 = 788;
    t2.a141 = 788;
    t2.a142 = 788;
    t2.a143 = 788;
    t2.a144 = 788;
    t2.a145 = 788;
    t2.a146 = 788;
    t2.a147 = 788;
    t2.a148 = 788;
    t2.a149 = 788;
    t2.a150 = 788;
    t2.a151 = 788;
    t2.a152 = 788;
    t2.a153 = 788;
    t2.a154 = 788;
    t2.a155 = 788;
    t2.a156 = 788;
    t2.a157 = 788;
    t2.a158 = 788;
    t2.a159 = 788;
    t2.a160 = 894;
    t2.a161 = 838;
    t2.a163 = 1016;
    t2.a164 = 458;
    t2.a196 = 748;
    t2.a165 = 924;
    t2.a192 = 748;
    t2.a166 = 918;
    t2.a167 = 927;
    t2.a168 = 928;
    t2.a169 = 928;
    t2.a170 = 834;
    t2.a171 = 873;
    t2.a172 = 828;
    t2.a173 = 924;
    t2.a162 = 924;
    t2.a174 = 917;
    t2.a175 = 930;
    t2.a176 = 931;
    t2.a177 = 463;
    t2.a178 = 883;
    t2.a179 = 836;
    t2.a193 = 836;
    t2.a180 = 867;
    t2.a199 = 867;
    t2.a181 = 696;
    t2.a200 = 696;
    t2.a182 = 874;
    t2.a201 = 874;
    t2.a183 = 760;
    t2.a184 = 946;
    t2.a197 = 771;
    t2.a185 = 865;
    t2.a194 = 771;
    t2.a198 = 888;
    t2.a186 = 967;
    t2.a195 = 888;
    t2.a187 = 831;
    t2.a188 = 873;
    t2.a189 = 927;
    t2.a190 = 970;
    t2.a191 = 918;
  });
});
var getFontBasicMetrics = getLookupTableFactory(function(t) {
  t.Courier = {
    ascent: 629,
    descent: -157,
    capHeight: 562,
    xHeight: -426
  };
  t["Courier-Bold"] = {
    ascent: 629,
    descent: -157,
    capHeight: 562,
    xHeight: 439
  };
  t["Courier-Oblique"] = {
    ascent: 629,
    descent: -157,
    capHeight: 562,
    xHeight: 426
  };
  t["Courier-BoldOblique"] = {
    ascent: 629,
    descent: -157,
    capHeight: 562,
    xHeight: 426
  };
  t.Helvetica = {
    ascent: 718,
    descent: -207,
    capHeight: 718,
    xHeight: 523
  };
  t["Helvetica-Bold"] = {
    ascent: 718,
    descent: -207,
    capHeight: 718,
    xHeight: 532
  };
  t["Helvetica-Oblique"] = {
    ascent: 718,
    descent: -207,
    capHeight: 718,
    xHeight: 523
  };
  t["Helvetica-BoldOblique"] = {
    ascent: 718,
    descent: -207,
    capHeight: 718,
    xHeight: 532
  };
  t["Times-Roman"] = {
    ascent: 683,
    descent: -217,
    capHeight: 662,
    xHeight: 450
  };
  t["Times-Bold"] = {
    ascent: 683,
    descent: -217,
    capHeight: 676,
    xHeight: 461
  };
  t["Times-Italic"] = {
    ascent: 683,
    descent: -217,
    capHeight: 653,
    xHeight: 441
  };
  t["Times-BoldItalic"] = {
    ascent: 683,
    descent: -217,
    capHeight: 669,
    xHeight: 462
  };
  t.Symbol = {
    ascent: Math.NaN,
    descent: Math.NaN,
    capHeight: Math.NaN,
    xHeight: Math.NaN
  };
  t.ZapfDingbats = {
    ascent: Math.NaN,
    descent: Math.NaN,
    capHeight: Math.NaN,
    xHeight: Math.NaN
  };
});

// src/display/page_viewport.js
var PageViewport = class _PageViewport {
  /**
   * @param {PageViewportParameters} params
   */
  constructor({
    viewBox,
    userUnit,
    scale,
    rotation,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false
  }) {
    this.viewBox = viewBox;
    this.userUnit = userUnit;
    this.scale = scale;
    this.rotation = rotation;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    scale *= userUnit;
    const centerX = (viewBox[2] + viewBox[0]) / 2;
    const centerY = (viewBox[3] + viewBox[1]) / 2;
    let rotateA, rotateB, rotateC, rotateD;
    rotation %= 360;
    if (rotation < 0) {
      rotation += 360;
    }
    switch (rotation) {
      case 180:
        rotateA = -1;
        rotateB = 0;
        rotateC = 0;
        rotateD = 1;
        break;
      case 90:
        rotateA = 0;
        rotateB = 1;
        rotateC = 1;
        rotateD = 0;
        break;
      case 270:
        rotateA = 0;
        rotateB = -1;
        rotateC = -1;
        rotateD = 0;
        break;
      case 0:
        rotateA = 1;
        rotateB = 0;
        rotateC = 0;
        rotateD = -1;
        break;
      default:
        throw new Error(
          "PageViewport: Invalid rotation, must be a multiple of 90 degrees."
        );
    }
    if (dontFlip) {
      rotateC = -rotateC;
      rotateD = -rotateD;
    }
    let offsetCanvasX, offsetCanvasY;
    let width, height;
    if (rotateA === 0) {
      offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale + offsetY;
      width = (viewBox[3] - viewBox[1]) * scale;
      height = (viewBox[2] - viewBox[0]) * scale;
    } else {
      offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale + offsetY;
      width = (viewBox[2] - viewBox[0]) * scale;
      height = (viewBox[3] - viewBox[1]) * scale;
    }
    this.transform = [
      rotateA * scale,
      rotateB * scale,
      rotateC * scale,
      rotateD * scale,
      offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
      offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY
    ];
    this.width = width;
    this.height = height;
  }
  /**
   * The original, un-scaled, viewport dimensions.
   * @type {object}
   */
  get rawDims() {
    const dims = this.viewBox;
    return shadow(this, "rawDims", {
      pageWidth: dims[2] - dims[0],
      pageHeight: dims[3] - dims[1],
      pageX: dims[0],
      pageY: dims[1]
    });
  }
  /**
   * Clones viewport, with optional additional properties.
   * @param {PageViewportCloneParameters} [params]
   * @returns {PageViewport} Cloned viewport.
   */
  clone({
    scale = this.scale,
    rotation = this.rotation,
    offsetX = this.offsetX,
    offsetY = this.offsetY,
    dontFlip = false
  } = {}) {
    return new _PageViewport({
      viewBox: this.viewBox.slice(),
      userUnit: this.userUnit,
      scale,
      rotation,
      offsetX,
      offsetY,
      dontFlip
    });
  }
  /**
   * Converts PDF point to the viewport coordinates. For examples, useful for
   * converting PDF location into canvas pixel coordinates.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @returns {Array} Array containing `x`- and `y`-coordinates of the
   *   point in the viewport coordinate space.
   * @see {@link convertToPdfPoint}
   */
  convertToViewportPoint(x, y) {
    const p = [x, y];
    Util.applyTransform(p, this.transform);
    return p;
  }
  /**
   * Converts viewport coordinates to the PDF location. For examples, useful
   * for converting canvas pixel location into PDF one.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @returns {Array} Array containing `x`- and `y`-coordinates of the
   *   point in the PDF coordinate space.
   * @see {@link convertToViewportPoint}
   */
  convertToPdfPoint(x, y) {
    const p = [x, y];
    Util.applyInverseTransform(p, this.transform);
    return p;
  }
};

// src/core/colorspace.js
function resizeRgbImage(src, dest, w1, h1, w2, h2, alpha01) {
  const COMPONENTS = 3;
  alpha01 = alpha01 !== 1 ? 0 : alpha01;
  const xRatio = w1 / w2;
  const yRatio = h1 / h2;
  let newIndex = 0, oldIndex;
  const xScaled = new Uint16Array(w2);
  const w1Scanline = w1 * COMPONENTS;
  for (let i = 0; i < w2; i++) {
    xScaled[i] = Math.floor(i * xRatio) * COMPONENTS;
  }
  for (let i = 0; i < h2; i++) {
    const py = Math.floor(i * yRatio) * w1Scanline;
    for (let j = 0; j < w2; j++) {
      oldIndex = py + xScaled[j];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      newIndex += alpha01;
    }
  }
}
function isDefaultDecodeHelper(decode, expectedLen) {
  if (!Array.isArray(decode)) {
    return true;
  }
  const decodeLen = decode.length;
  if (decodeLen < expectedLen) {
    warn("Decode map length is too short.");
    return true;
  }
  if (decodeLen > expectedLen) {
    info("Truncating too long decode map.");
    decode.length = expectedLen;
  }
  return false;
}
var ColorSpace = class _ColorSpace {
  static #rgbBuf = new Uint8ClampedArray(3);
  constructor(name, numComps) {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _ColorSpace) {
      unreachable("Cannot initialize ColorSpace.");
    }
    this.name = name;
    this.numComps = numComps;
  }
  /**
   * Converts the color value to the RGB color. The color components are
   * located in the src array starting from the srcOffset. Returns the array
   * of the rgb components, each value ranging from [0,255].
   */
  getRgb(src, srcOffset, output = new Uint8ClampedArray(3)) {
    this.getRgbItem(src, srcOffset, output, 0);
    return output;
  }
  getRgbHex(src, srcOffset) {
    const buffer = this.getRgb(src, srcOffset, _ColorSpace.#rgbBuf);
    return Util.makeHexColor(buffer[0], buffer[1], buffer[2]);
  }
  /**
   * Converts the color value to the RGB color, similar to the getRgb method.
   * The result placed into the dest array starting from the destOffset.
   */
  getRgbItem(src, srcOffset, dest, destOffset) {
    unreachable("Should not call ColorSpace.getRgbItem");
  }
  /**
   * Converts the specified number of the color values to the RGB colors.
   * The colors are located in the src array starting from the srcOffset.
   * The result is placed into the dest array starting from the destOffset.
   * The src array items shall be in [0,2^bits) range, the dest array items
   * will be in [0,255] range. alpha01 indicates how many alpha components
   * there are in the dest array; it will be either 0 (RGB array) or 1 (RGBA
   * array).
   */
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    unreachable("Should not call ColorSpace.getRgbBuffer");
  }
  /**
   * Converts `count` unscaled colors to RGB, starting at `destOffset`.
   * Components use the native color-space ranges expected by `getRgbItem`,
   * and each output has a `3 + alpha01` byte stride.
   * Subclasses may override this to batch expensive conversions.
   */
  getRgbItems(src, count, dest, destOffset, alpha01) {
    const { numComps } = this;
    for (let i = 0, srcOffset = 0; i < count; i++, srcOffset += numComps) {
      this.getRgbItem(src, srcOffset, dest, destOffset);
      destOffset += 3 + alpha01;
    }
  }
  /**
   * Returns true if source data will be equal the result/output data.
   */
  isPassthrough(bits) {
    return false;
  }
  /**
   * Refer to the static `ColorSpace.isDefaultDecode` method below.
   */
  isDefaultDecode(decode, bpc) {
    return _ColorSpace.isDefaultDecode(decode, this.numComps);
  }
  /**
   * Fills in the RGB colors in the destination buffer.  alpha01 indicates
   * how many alpha components there are in the dest array; it will be either
   * 0 (RGB array) or 1 (RGBA array).
   */
  fillRgb(dest, originalWidth, originalHeight, width, height, actualHeight, bpc, comps, alpha01) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'ColorSpace.fillRgb: Unsupported "dest" type.'
      );
    }
    const count = originalWidth * originalHeight;
    let rgbBuf = null;
    const numComponentColors = 1 << bpc;
    const needsResizing = originalHeight !== height || originalWidth !== width;
    if (this.isPassthrough(bpc)) {
      rgbBuf = comps;
    } else if (this.numComps === 1 && count > numComponentColors && this.name !== "DeviceGray" && this.name !== "DeviceRGB") {
      const allColors = bpc <= 8 ? new Uint8Array(numComponentColors) : new Uint16Array(numComponentColors);
      for (let i = 0; i < numComponentColors; i++) {
        allColors[i] = i;
      }
      const colorMap = new Uint8ClampedArray(numComponentColors * 3);
      this.getRgbBuffer(
        allColors,
        0,
        numComponentColors,
        colorMap,
        0,
        bpc,
        /* alpha01 = */
        0
      );
      if (!needsResizing) {
        let destPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          dest[destPos++] = colorMap[key];
          dest[destPos++] = colorMap[key + 1];
          dest[destPos++] = colorMap[key + 2];
          destPos += alpha01;
        }
      } else {
        rgbBuf = new Uint8Array(count * 3);
        let rgbPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          rgbBuf[rgbPos++] = colorMap[key];
          rgbBuf[rgbPos++] = colorMap[key + 1];
          rgbBuf[rgbPos++] = colorMap[key + 2];
        }
      }
    } else if (!needsResizing) {
      this.getRgbBuffer(comps, 0, width * actualHeight, dest, 0, bpc, alpha01);
    } else {
      rgbBuf = new Uint8ClampedArray(count * 3);
      this.getRgbBuffer(
        comps,
        0,
        count,
        rgbBuf,
        0,
        bpc,
        /* alpha01 = */
        0
      );
    }
    if (rgbBuf) {
      if (needsResizing) {
        resizeRgbImage(
          rgbBuf,
          dest,
          originalWidth,
          originalHeight,
          width,
          height,
          alpha01
        );
      } else {
        let destPos = 0, rgbPos = 0;
        for (let i = 0, ii = width * actualHeight; i < ii; i++) {
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          destPos += alpha01;
        }
      }
    }
  }
  /**
   * True if the colorspace has components in the default range of [0, 1].
   * This should be true for all colorspaces except for lab color spaces
   * which are [0,100], [-128, 127], [-128, 127].
   */
  get usesZeroToOneRange() {
    return shadow(this, "usesZeroToOneRange", true);
  }
  /**
   * Checks if a decode map matches the default decode map for a color space.
   * This handles the general decode maps where there are two values per
   * component, e.g. [0, 1, 0, 1, 0, 1] for a RGB color.
   * This does not handle Lab, Indexed, or Pattern decode maps since they are
   * slightly different.
   * @param {Array} decode - Decode map (usually from an image).
   * @param {number} numComps - Number of components the color space has.
   */
  static isDefaultDecode(decode, numComps) {
    if (isDefaultDecodeHelper(decode, numComps * 2)) {
      return true;
    }
    for (let i = 0, ii = decode.length; i < ii; i += 2) {
      if (decode[i] !== 0 || decode[i + 1] !== 1) {
        return false;
      }
    }
    return true;
  }
};
var DeviceCmykCS = class extends ColorSpace {
  constructor() {
    super("DeviceCMYK", 4);
  }
  // The coefficients below was found using numerical analysis: the method of
  // steepest descent for the sum((f_i - color_value_i)^2) for r/g/b colors,
  // where color_value is the tabular value from the table of sampled RGB colors
  // from CMYK US Web Coated (SWOP) colorspace, and f_i is the corresponding
  // CMYK color conversion using the estimation below:
  //   f(A, B,.. N) = Acc+Bcm+Ccy+Dck+c+Fmm+Gmy+Hmk+Im+Jyy+Kyk+Ly+Mkk+Nk+255
  #toRgb(src, srcOffset, srcScale, dest, destOffset) {
    const c = src[srcOffset] * srcScale;
    const m = src[srcOffset + 1] * srcScale;
    const y = src[srcOffset + 2] * srcScale;
    const k = src[srcOffset + 3] * srcScale;
    dest[destOffset] = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k + -285.2331026137004) + m * (1.7149763477362134 * m - 5.6096736904047315 * y + -17.873870861415444 * k - 5.497006427196366) + y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) + k * (-21.86122147463605 * k - 189.48180835922747);
    dest[destOffset + 1] = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k + -79.2970844816548) + m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) + y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) + k * (-20.737325471181034 * k - 187.80453709719578);
    dest[destOffset + 2] = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k + -14.183576799673286) + m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) + y * (0.03296041114873217 * y + 115.60384449646641 * k + -193.58209356861505) + k * (-22.33816807309886 * k - 180.12613974708367);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceCmykCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    this.#toRgb(src, srcOffset, 1, dest, destOffset);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceCmykCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; i++) {
      this.#toRgb(src, srcOffset, scale, dest, destOffset);
      srcOffset += 4;
      destOffset += 3 + alpha01;
    }
  }
};
var CalGrayCS = class extends ColorSpace {
  constructor(whitePoint, blackPoint, gamma) {
    super("CalGray", 1);
    if (!whitePoint) {
      throw new FormatError(
        "WhitePoint missing - required for color space CalGray"
      );
    }
    [this.XW, this.YW, this.ZW] = whitePoint;
    [this.XB, this.YB, this.ZB] = blackPoint || [0, 0, 0];
    this.G = gamma || 1;
    if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
      throw new FormatError(
        `Invalid WhitePoint components for ${this.name}, no fallback available`
      );
    }
    if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
      info(`Invalid BlackPoint for ${this.name}, falling back to default.`);
      this.XB = this.YB = this.ZB = 0;
    }
    if (this.XB !== 0 || this.YB !== 0 || this.ZB !== 0) {
      warn(
        `${this.name}, BlackPoint: XB: ${this.XB}, YB: ${this.YB}, ZB: ${this.ZB}, only default values are supported.`
      );
    }
    if (this.G < 1) {
      info(
        `Invalid Gamma: ${this.G} for ${this.name}, falling back to default.`
      );
      this.G = 1;
    }
  }
  #toRgb(src, srcOffset, dest, destOffset, scale) {
    const A = src[srcOffset] * scale;
    const AG = A ** this.G;
    const L = this.YW * AG;
    const val = Math.max(295.8 * L ** 0.3333333333333333 - 40.8, 0);
    dest[destOffset] = val;
    dest[destOffset + 1] = val;
    dest[destOffset + 2] = val;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalGrayCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    this.#toRgb(src, srcOffset, dest, destOffset, 1);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalGrayCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; ++i) {
      this.#toRgb(src, srcOffset, dest, destOffset, scale);
      srcOffset += 1;
      destOffset += 3 + alpha01;
    }
  }
};
var CalRGBCS = class _CalRGBCS extends ColorSpace {
  // See http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html for these
  // matrices.
  // prettier-ignore
  static #BRADFORD_SCALE_MATRIX = new Float32Array([
    0.8951,
    0.2664,
    -0.1614,
    -0.7502,
    1.7135,
    0.0367,
    0.0389,
    -0.0685,
    1.0296
  ]);
  // prettier-ignore
  static #BRADFORD_SCALE_INVERSE_MATRIX = new Float32Array([
    0.9869929,
    -0.1470543,
    0.1599627,
    0.4323053,
    0.5183603,
    0.0492912,
    -85287e-7,
    0.0400428,
    0.9684867
  ]);
  // See http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html.
  // prettier-ignore
  static #SRGB_D65_XYZ_TO_RGB_MATRIX = new Float32Array([
    3.2404542,
    -1.5371385,
    -0.4985314,
    -0.969266,
    1.8760108,
    0.041556,
    0.0556434,
    -0.2040259,
    1.0572252
  ]);
  static #FLAT_WHITEPOINT_MATRIX = new Float32Array([1, 1, 1]);
  static #tempNormalizeMatrix = new Float32Array(3);
  static #tempConvertMatrix1 = new Float32Array(3);
  static #tempConvertMatrix2 = new Float32Array(3);
  static #DECODE_L_CONSTANT = ((8 + 16) / 116) ** 3 / 8;
  constructor(whitePoint, blackPoint, gamma, matrix) {
    super("CalRGB", 3);
    if (!whitePoint) {
      throw new FormatError(
        "WhitePoint missing - required for color space CalRGB"
      );
    }
    const [XW, YW, ZW] = this.whitePoint = whitePoint;
    const [XB, YB, ZB] = this.blackPoint = blackPoint || new Float32Array(3);
    [this.GR, this.GG, this.GB] = gamma || new Float32Array([1, 1, 1]);
    [
      this.MXA,
      this.MYA,
      this.MZA,
      this.MXB,
      this.MYB,
      this.MZB,
      this.MXC,
      this.MYC,
      this.MZC
    ] = matrix || new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    if (XW < 0 || ZW < 0 || YW !== 1) {
      throw new FormatError(
        `Invalid WhitePoint components for ${this.name}, no fallback available`
      );
    }
    if (XB < 0 || YB < 0 || ZB < 0) {
      info(
        `Invalid BlackPoint for ${this.name} [${XB}, ${YB}, ${ZB}], falling back to default.`
      );
      this.blackPoint = new Float32Array(3);
    }
    if (this.GR < 0 || this.GG < 0 || this.GB < 0) {
      info(
        `Invalid Gamma [${this.GR}, ${this.GG}, ${this.GB}] for ${this.name}, falling back to default.`
      );
      this.GR = this.GG = this.GB = 1;
    }
  }
  #matrixProduct(a, b, result) {
    result[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    result[1] = a[3] * b[0] + a[4] * b[1] + a[5] * b[2];
    result[2] = a[6] * b[0] + a[7] * b[1] + a[8] * b[2];
  }
  #toFlat(sourceWhitePoint, LMS, result) {
    result[0] = LMS[0] * 1 / sourceWhitePoint[0];
    result[1] = LMS[1] * 1 / sourceWhitePoint[1];
    result[2] = LMS[2] * 1 / sourceWhitePoint[2];
  }
  #toD65(sourceWhitePoint, LMS, result) {
    const D65X = 0.95047;
    const D65Y = 1;
    const D65Z = 1.08883;
    result[0] = LMS[0] * D65X / sourceWhitePoint[0];
    result[1] = LMS[1] * D65Y / sourceWhitePoint[1];
    result[2] = LMS[2] * D65Z / sourceWhitePoint[2];
  }
  #sRGBTransferFunction(color) {
    if (color <= 31308e-7) {
      return MathClamp(12.92 * color, 0, 1);
    }
    return color >= 0.99554525 ? 1 : MathClamp((1 + 0.055) * color ** (1 / 2.4) - 0.055, 0, 1);
  }
  #decodeL(L) {
    if (L < 0) {
      return -this.#decodeL(-L);
    }
    return L > 8 ? ((L + 16) / 116) ** 3 : L * _CalRGBCS.#DECODE_L_CONSTANT;
  }
  #compensateBlackPoint(sourceBlackPoint, XYZ_Flat, result) {
    if (sourceBlackPoint[0] === 0 && sourceBlackPoint[1] === 0 && sourceBlackPoint[2] === 0) {
      result[0] = XYZ_Flat[0];
      result[1] = XYZ_Flat[1];
      result[2] = XYZ_Flat[2];
      return;
    }
    const zeroDecodeL = this.#decodeL(0);
    const X_DST = zeroDecodeL;
    const X_SRC = this.#decodeL(sourceBlackPoint[0]);
    const Y_DST = zeroDecodeL;
    const Y_SRC = this.#decodeL(sourceBlackPoint[1]);
    const Z_DST = zeroDecodeL;
    const Z_SRC = this.#decodeL(sourceBlackPoint[2]);
    const X_Scale = (1 - X_DST) / (1 - X_SRC);
    const X_Offset = 1 - X_Scale;
    const Y_Scale = (1 - Y_DST) / (1 - Y_SRC);
    const Y_Offset = 1 - Y_Scale;
    const Z_Scale = (1 - Z_DST) / (1 - Z_SRC);
    const Z_Offset = 1 - Z_Scale;
    result[0] = XYZ_Flat[0] * X_Scale + X_Offset;
    result[1] = XYZ_Flat[1] * Y_Scale + Y_Offset;
    result[2] = XYZ_Flat[2] * Z_Scale + Z_Offset;
  }
  #normalizeWhitePointToFlat(sourceWhitePoint, XYZ_In, result) {
    if (sourceWhitePoint[0] === 1 && sourceWhitePoint[2] === 1) {
      result[0] = XYZ_In[0];
      result[1] = XYZ_In[1];
      result[2] = XYZ_In[2];
      return;
    }
    const LMS = result;
    this.#matrixProduct(_CalRGBCS.#BRADFORD_SCALE_MATRIX, XYZ_In, LMS);
    const LMS_Flat = _CalRGBCS.#tempNormalizeMatrix;
    this.#toFlat(sourceWhitePoint, LMS, LMS_Flat);
    this.#matrixProduct(
      _CalRGBCS.#BRADFORD_SCALE_INVERSE_MATRIX,
      LMS_Flat,
      result
    );
  }
  #normalizeWhitePointToD65(sourceWhitePoint, XYZ_In, result) {
    const LMS = result;
    this.#matrixProduct(_CalRGBCS.#BRADFORD_SCALE_MATRIX, XYZ_In, LMS);
    const LMS_D65 = _CalRGBCS.#tempNormalizeMatrix;
    this.#toD65(sourceWhitePoint, LMS, LMS_D65);
    this.#matrixProduct(
      _CalRGBCS.#BRADFORD_SCALE_INVERSE_MATRIX,
      LMS_D65,
      result
    );
  }
  #toRgb(src, srcOffset, dest, destOffset, scale) {
    const A = MathClamp(src[srcOffset] * scale, 0, 1);
    const B = MathClamp(src[srcOffset + 1] * scale, 0, 1);
    const C = MathClamp(src[srcOffset + 2] * scale, 0, 1);
    const AGR = A === 1 ? 1 : A ** this.GR;
    const BGG = B === 1 ? 1 : B ** this.GG;
    const CGB = C === 1 ? 1 : C ** this.GB;
    const X = this.MXA * AGR + this.MXB * BGG + this.MXC * CGB;
    const Y = this.MYA * AGR + this.MYB * BGG + this.MYC * CGB;
    const Z = this.MZA * AGR + this.MZB * BGG + this.MZC * CGB;
    const XYZ = _CalRGBCS.#tempConvertMatrix1;
    XYZ[0] = X;
    XYZ[1] = Y;
    XYZ[2] = Z;
    const XYZ_Flat = _CalRGBCS.#tempConvertMatrix2;
    this.#normalizeWhitePointToFlat(this.whitePoint, XYZ, XYZ_Flat);
    const XYZ_Black = _CalRGBCS.#tempConvertMatrix1;
    this.#compensateBlackPoint(this.blackPoint, XYZ_Flat, XYZ_Black);
    const XYZ_D65 = _CalRGBCS.#tempConvertMatrix2;
    this.#normalizeWhitePointToD65(
      _CalRGBCS.#FLAT_WHITEPOINT_MATRIX,
      XYZ_Black,
      XYZ_D65
    );
    const SRGB = _CalRGBCS.#tempConvertMatrix1;
    this.#matrixProduct(_CalRGBCS.#SRGB_D65_XYZ_TO_RGB_MATRIX, XYZ_D65, SRGB);
    dest[destOffset] = this.#sRGBTransferFunction(SRGB[0]) * 255;
    dest[destOffset + 1] = this.#sRGBTransferFunction(SRGB[1]) * 255;
    dest[destOffset + 2] = this.#sRGBTransferFunction(SRGB[2]) * 255;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalRGBCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    this.#toRgb(src, srcOffset, dest, destOffset, 1);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalRGBCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; ++i) {
      this.#toRgb(src, srcOffset, dest, destOffset, scale);
      srcOffset += 3;
      destOffset += 3 + alpha01;
    }
  }
};
var LabCS = class extends ColorSpace {
  constructor(whitePoint, blackPoint, range) {
    super("Lab", 3);
    if (!whitePoint) {
      throw new FormatError(
        "WhitePoint missing - required for color space Lab"
      );
    }
    [this.XW, this.YW, this.ZW] = whitePoint;
    [this.amin, this.amax, this.bmin, this.bmax] = range || [
      -100,
      100,
      -100,
      100
    ];
    [this.XB, this.YB, this.ZB] = blackPoint || [0, 0, 0];
    if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
      throw new FormatError(
        "Invalid WhitePoint components, no fallback available"
      );
    }
    if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
      info("Invalid BlackPoint, falling back to default");
      this.XB = this.YB = this.ZB = 0;
    }
    if (this.amin > this.amax || this.bmin > this.bmax) {
      info("Invalid Range, falling back to defaults");
      this.amin = -100;
      this.amax = 100;
      this.bmin = -100;
      this.bmax = 100;
    }
  }
  // Function g(x) from spec
  #fn_g(x) {
    return x >= 6 / 29 ? x ** 3 : 108 / 841 * (x - 4 / 29);
  }
  #decode(value, high1, low2, high2) {
    return low2 + value * (high2 - low2) / high1;
  }
  // If decoding is needed maxVal should be 2^bits per component - 1.
  #toRgb(src, srcOffset, maxVal, dest, destOffset) {
    let Ls = src[srcOffset];
    let as = src[srcOffset + 1];
    let bs = src[srcOffset + 2];
    if (maxVal !== false) {
      Ls = this.#decode(Ls, maxVal, 0, 100);
      as = this.#decode(as, maxVal, this.amin, this.amax);
      bs = this.#decode(bs, maxVal, this.bmin, this.bmax);
    }
    if (as > this.amax) {
      as = this.amax;
    } else if (as < this.amin) {
      as = this.amin;
    }
    if (bs > this.bmax) {
      bs = this.bmax;
    } else if (bs < this.bmin) {
      bs = this.bmin;
    }
    const M = (Ls + 16) / 116;
    const L = M + as / 500;
    const N = M - bs / 200;
    const X = this.XW * this.#fn_g(L);
    const Y = this.YW * this.#fn_g(M);
    const Z = this.ZW * this.#fn_g(N);
    let r, g, b;
    if (this.ZW < 1) {
      r = X * 3.1339 + Y * -1.617 + Z * -0.4906;
      g = X * -0.9785 + Y * 1.916 + Z * 0.0333;
      b = X * 0.072 + Y * -0.229 + Z * 1.4057;
    } else {
      r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      b = X * 0.0557 + Y * -0.204 + Z * 1.057;
    }
    dest[destOffset] = Math.sqrt(r) * 255;
    dest[destOffset + 1] = Math.sqrt(g) * 255;
    dest[destOffset + 2] = Math.sqrt(b) * 255;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'LabCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    this.#toRgb(src, srcOffset, false, dest, destOffset);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        dest instanceof Uint8ClampedArray,
        'LabCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const maxVal = (1 << bits) - 1;
    for (let i = 0; i < count; i++) {
      this.#toRgb(src, srcOffset, maxVal, dest, destOffset);
      srcOffset += 3;
      destOffset += 3 + alpha01;
    }
  }
  isDefaultDecode(decode, bpc) {
    return true;
  }
  get usesZeroToOneRange() {
    return shadow(this, "usesZeroToOneRange", false);
  }
};

// src/core/postscript/lexer.js
var TOKEN = {
  // Structural tokens — not keyword operators
  number: 0,
  lbrace: 1,
  rbrace: 2,
  // Boolean literals
  true: 3,
  false: 4,
  // Arithmetic binary operators
  add: 5,
  sub: 6,
  mul: 7,
  div: 8,
  idiv: 9,
  mod: 10,
  exp: 11,
  // Comparison binary operators
  eq: 12,
  ne: 13,
  gt: 14,
  ge: 15,
  lt: 16,
  le: 17,
  // Bitwise / boolean binary operators
  and: 18,
  or: 19,
  xor: 20,
  bitshift: 21,
  // Unary arithmetic operators
  abs: 22,
  neg: 23,
  ceiling: 24,
  floor: 25,
  round: 26,
  truncate: 27,
  // Unary boolean / bitwise operator
  not: 28,
  // Mathematical functions — unary
  sqrt: 29,
  sin: 30,
  cos: 31,
  ln: 32,
  log: 33,
  // Mathematical function — binary
  atan: 34,
  // Type conversion operators
  cvi: 35,
  cvr: 36,
  // Stack operators
  dup: 37,
  exch: 38,
  pop: 39,
  copy: 40,
  index: 41,
  roll: 42,
  // Control flow
  if: 43,
  ifelse: 44,
  // End of input
  eof: 45,
  // Synthetic: produced by the optimizer, never emitted by the lexer.
  min: 46,
  max: 47
};
var Token = class {
  constructor(id, value = null) {
    this.id = id;
    this.value = value;
  }
};
var Lexer = class _Lexer {
  // Singletons for every non-number token, built lazily on first construction.
  // Keyword operator tokens carry their name as `value`; structural tokens
  // (lbrace, rbrace, eof) carry null.
  static #singletons = null;
  static #operatorSingletons = null;
  static #initSingletons() {
    const singletons = /* @__PURE__ */ Object.create(null);
    const operatorSingletons = /* @__PURE__ */ Object.create(null);
    for (const [name, id] of Object.entries(TOKEN)) {
      if (name === "number") {
        continue;
      }
      const isOperator = id >= TOKEN.true && id <= TOKEN.ifelse;
      const token = new Token(id, isOperator ? name : null);
      singletons[name] = token;
      if (isOperator) {
        operatorSingletons[name] = token;
      }
    }
    this.#singletons = singletons;
    this.#operatorSingletons = operatorSingletons;
  }
  constructor(data) {
    if (!_Lexer.#singletons) {
      _Lexer.#initSingletons();
    }
    this.data = data;
    this.pos = 0;
    this.len = data.length;
    this._numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iy;
    this._identifierPattern = /[a-z]+/y;
  }
  // Skip a % comment, advancing past the next \n or \r (or to EOF).
  _skipComment() {
    const lf = this.data.indexOf("\n", this.pos);
    const cr = this.data.indexOf("\r", this.pos);
    const eol = Math.min(lf < 0 ? this.len : lf, cr < 0 ? this.len : cr);
    this.pos = Math.min(eol + 1, this.len);
  }
  _getNumber() {
    this._numberPattern.lastIndex = this.pos;
    const match = this._numberPattern.exec(this.data);
    if (!match) {
      this.pos++;
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._numberPattern.lastIndex;
    const number = parseFloat(match[0]);
    if (!Number.isFinite(number)) {
      return new Token(TOKEN.number, 0);
    }
    return new Token(TOKEN.number, number);
  }
  _getOperator() {
    this._identifierPattern.lastIndex = this.pos;
    const match = this._identifierPattern.exec(this.data);
    if (!match) {
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._identifierPattern.lastIndex;
    const op = match[0];
    const token = _Lexer.#operatorSingletons[op];
    return token ?? new Token(TOKEN.number, 0);
  }
  // Return the next token, or Lexer.#singletons.eof at end of input.
  next() {
    while (this.pos < this.len) {
      const ch3 = this.data.charCodeAt(this.pos++);
      switch (ch3) {
        // PostScript white-space characters (PDF32000 §7.2.2)
        case 0:
        case 9:
        case 10:
        case 12:
        case 13:
        case 32:
          break;
        case 37:
          this._skipComment();
          break;
        case 123:
          return _Lexer.#singletons.lbrace;
        case 125:
          return _Lexer.#singletons.rbrace;
        case 43:
        case 45:
          this.pos--;
          return this._getNumber();
        case 46:
          this.pos--;
          return this._getNumber();
        default:
          if (ch3 >= 48 && ch3 <= 57) {
            this.pos--;
            return this._getNumber();
          }
          if (ch3 >= 97 && ch3 <= 122) {
            this.pos--;
            return this._getOperator();
          }
          return new Token(TOKEN.number, 0);
      }
    }
    return _Lexer.#singletons.eof;
  }
};

// src/core/postscript/ast.js
var PS_VALUE_TYPE = {
  numeric: 0,
  // known to be a number (f64 in Wasm)
  boolean: 1,
  // known to be a boolean (0.0 = false, 1.0 = true in f64)
  unknown: 2
  // indeterminate at compile time
};
var PS_NODE = {
  // Parser AST node types (produced by Parser / parsePostScriptFunction)
  program: 0,
  block: 1,
  number: 2,
  operator: 3,
  if: 4,
  ifelse: 5,
  // Tree AST node types (produced by PSStackToTree)
  arg: 6,
  const: 7,
  unary: 8,
  binary: 9,
  ternary: 10
};
var PsNode = class {
  constructor(type) {
    this.type = type;
  }
};
var PsProgram = class extends PsNode {
  constructor(body) {
    super(PS_NODE.program);
    this.body = body;
  }
};
var PsBlock = class extends PsNode {
  constructor(instructions) {
    super(PS_NODE.block);
    this.instructions = instructions;
  }
};
var PsNumber = class extends PsNode {
  /** @param {number} value */
  constructor(value) {
    super(PS_NODE.number);
    this.value = value;
  }
};
var PsOperator = class extends PsNode {
  /** @param {number} op — one of the TOKEN.* constants from lexer.js */
  constructor(op) {
    super(PS_NODE.operator);
    this.op = op;
  }
};
var PsIf = class extends PsNode {
  /** @param {PsBlock} then */
  constructor(then) {
    super(PS_NODE.if);
    this.then = then;
  }
};
var PsIfElse = class extends PsNode {
  /**
   * @param {PsBlock} then
   * @param {PsBlock} otherwise
   */
  constructor(then, otherwise) {
    super(PS_NODE.ifelse);
    this.then = then;
    this.otherwise = otherwise;
  }
};
var PsArgNode = class extends PsNode {
  /** @param {number} index */
  constructor(index) {
    super(PS_NODE.arg);
    this.index = index;
    this.valueType = PS_VALUE_TYPE.numeric;
  }
};
var PsConstNode = class extends PsNode {
  /** @param {number|boolean} value */
  constructor(value) {
    super(PS_NODE.const);
    this.value = value;
    this.valueType = typeof value === "boolean" ? PS_VALUE_TYPE.boolean : PS_VALUE_TYPE.numeric;
  }
};
var PsUnaryNode = class extends PsNode {
  /**
   * @param {number} op — TOKEN.* constant
   * @param {PsNode} operand
   * @param {number} [valueType]
   */
  constructor(op, operand, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.unary);
    this.op = op;
    this.operand = operand;
    this.valueType = valueType;
  }
};
var PsBinaryNode = class extends PsNode {
  /**
   * @param {number} op — TOKEN.* constant
   * @param {PsNode} first — was on top of stack
   * @param {PsNode} second — was below top
   * @param {number} [valueType]
   */
  constructor(op, first, second, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.binary);
    this.op = op;
    this.first = first;
    this.second = second;
    this.valueType = valueType;
  }
};
var PsTernaryNode = class extends PsNode {
  /**
   * @param {PsNode} cond
   * @param {PsNode} then
   * @param {PsNode} otherwise
   * @param {number} [valueType]
   */
  constructor(cond, then, otherwise, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.ternary);
    this.cond = cond;
    this.then = then;
    this.otherwise = otherwise;
    this.valueType = valueType;
  }
};
var Parser = class _Parser {
  constructor(lexer) {
    this.lexer = lexer;
    this._token = null;
  }
  static _isRegularOperator(id) {
    return id >= TOKEN.true && id < TOKEN.if;
  }
  // Fetch the next token from the lexer.
  _advance() {
    this._token = this.lexer.next();
  }
  // Assert that the current token has the given id, consume it, and return it.
  _expect(id) {
    if (this._token.id !== id) {
      throw new FormatError(
        `PostScript function: expected token id ${id}, got ${this._token.id}.`
      );
    }
    const tok = this._token;
    this._advance();
    return tok;
  }
  /**
   * Parse the full Type 4 function body.
   *
   * Grammar (simplified):
   *   program   ::= '{' block '}'
   *   block     ::= instruction*
   *   instruction ::= number
   *                 | operator          (any PS_OPERATOR except if / ifelse)
   *                 | '{' block '}' 'if'
   *                 | '{' block '}' '{' block '}' 'ifelse'
   * @returns {PsProgram}
   */
  parse() {
    this._advance();
    this._expect(TOKEN.lbrace);
    const block = this._parseBlock();
    this._expect(TOKEN.rbrace);
    if (this._token.id !== TOKEN.eof) {
      warn("PostScript function: unexpected content after closing brace.");
    }
    return new PsProgram(block);
  }
  _parseBlock() {
    const instructions = [];
    while (true) {
      const tok = this._token;
      switch (tok.id) {
        case TOKEN.number:
          instructions.push(new PsNumber(tok.value));
          this._advance();
          break;
        case TOKEN.lbrace: {
          this._advance();
          const thenBlock = this._parseBlock();
          this._expect(TOKEN.rbrace);
          if (this._token.id === TOKEN.if) {
            this._advance();
            instructions.push(new PsIf(thenBlock));
          } else if (this._token.id === TOKEN.lbrace) {
            this._advance();
            const elseBlock = this._parseBlock();
            this._expect(TOKEN.rbrace);
            this._expect(TOKEN.ifelse);
            instructions.push(new PsIfElse(thenBlock, elseBlock));
          } else {
            throw new FormatError(
              "PostScript function: a procedure block must be followed by 'if' or '{\u2026} ifelse'."
            );
          }
          break;
        }
        case TOKEN.rbrace:
        case TOKEN.eof:
          return new PsBlock(instructions);
        case TOKEN.if:
        case TOKEN.ifelse:
          throw new FormatError(
            `PostScript function: unexpected '${tok.value}' operator.`
          );
        default:
          if (_Parser._isRegularOperator(tok.id)) {
            instructions.push(new PsOperator(tok.id));
            this._advance();
            break;
          }
          throw new FormatError(
            `PostScript function: unexpected token id ${tok.id}.`
          );
      }
    }
  }
};
function parsePostScriptFunction(source) {
  return new Parser(new Lexer(source)).parse();
}
function _nodesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case PS_NODE.arg:
      return a.index === b.index;
    case PS_NODE.const:
      return a.value === b.value;
    case PS_NODE.unary:
      return a.op === b.op && _nodesEqual(a.operand, b.operand);
    case PS_NODE.binary:
      return a.op === b.op && _nodesEqual(a.first, b.first) && _nodesEqual(a.second, b.second);
    case PS_NODE.ternary:
      return _nodesEqual(a.cond, b.cond) && _nodesEqual(a.then, b.then) && _nodesEqual(a.otherwise, b.otherwise);
    default:
      return false;
  }
}
function _evalBinaryConst(op, a, b) {
  switch (op) {
    case TOKEN.add:
      return a + b;
    case TOKEN.sub:
      return a - b;
    case TOKEN.mul:
      return a * b;
    case TOKEN.div:
      return b !== 0 ? a / b : 0;
    // div by zero → 0
    case TOKEN.idiv:
      return b !== 0 ? Math.trunc(a / b) : 0;
    // div by zero → 0
    case TOKEN.mod:
      return b !== 0 ? a - Math.trunc(a / b) * b : 0;
    // div by zero → 0
    case TOKEN.exp: {
      const r = a ** b;
      return Number.isFinite(r) ? r : void 0;
    }
    case TOKEN.atan: {
      let deg = Math.atan2(a, b) * (180 / Math.PI);
      if (deg < 0) {
        deg += 360;
      }
      return deg;
    }
    case TOKEN.eq:
      return a === b;
    case TOKEN.ne:
      return a !== b;
    case TOKEN.gt:
      return a > b;
    case TOKEN.ge:
      return a >= b;
    case TOKEN.lt:
      return a < b;
    case TOKEN.le:
      return a <= b;
    case TOKEN.and:
      return typeof a === "boolean" ? a && b : a & b | 0;
    case TOKEN.or:
      return typeof a === "boolean" ? a || b : a | b | 0;
    case TOKEN.xor:
      return typeof a === "boolean" ? a !== b : a ^ b | 0;
    case TOKEN.bitshift:
      return b >= 0 ? a << b | 0 : a >> -b | 0;
    case TOKEN.min:
      return Math.min(a, b);
    case TOKEN.max:
      return Math.max(a, b);
    default:
      return void 0;
  }
}
function _evalUnaryConst(op, v) {
  switch (op) {
    case TOKEN.abs:
      return Math.abs(v);
    case TOKEN.neg:
      return -v;
    case TOKEN.ceiling:
      return Math.ceil(v);
    case TOKEN.floor:
      return Math.floor(v);
    case TOKEN.round:
      return Math.round(v);
    case TOKEN.truncate:
      return Math.trunc(v);
    case TOKEN.sqrt: {
      const r = Math.sqrt(v);
      return Number.isFinite(r) ? r : void 0;
    }
    case TOKEN.sin:
      return Math.sin(v % 360 * Math.PI / 180);
    case TOKEN.cos:
      return Math.cos(v % 360 * Math.PI / 180);
    case TOKEN.ln: {
      const r = Math.log(v);
      return Number.isFinite(r) ? r : void 0;
    }
    case TOKEN.log: {
      const r = Math.log10(v);
      return Number.isFinite(r) ? r : void 0;
    }
    case TOKEN.cvi:
      return Math.trunc(v);
    case TOKEN.cvr:
      return v;
    case TOKEN.not:
      return typeof v === "boolean" ? !v : ~v;
    default:
      return void 0;
  }
}
var MAX_STACK_SIZE = 100;
function _unaryValueType(op, operandType) {
  return op === TOKEN.not ? operandType : PS_VALUE_TYPE.numeric;
}
function _binaryValueType(op, firstType, secondType) {
  switch (op) {
    // Comparison operators always produce a boolean.
    case TOKEN.eq:
    case TOKEN.ne:
    case TOKEN.gt:
    case TOKEN.ge:
    case TOKEN.lt:
    case TOKEN.le:
      return PS_VALUE_TYPE.boolean;
    // and / or / xor preserve the type when both operands are the same known
    // type (both boolean or both numeric); otherwise the type is unknown.
    case TOKEN.and:
    case TOKEN.or:
    case TOKEN.xor:
      return firstType === secondType && firstType !== PS_VALUE_TYPE.unknown ? firstType : PS_VALUE_TYPE.unknown;
    // All arithmetic / bitshift operators produce a numeric result.
    default:
      return PS_VALUE_TYPE.numeric;
  }
}
var PSStackToTree = class _PSStackToTree {
  static #binaryOps = null;
  static #unaryOps = null;
  static #idempotentUnary = null;
  static #negatedComparison = null;
  static #init() {
    this.#binaryOps = /* @__PURE__ */ new Set([
      TOKEN.add,
      TOKEN.sub,
      TOKEN.mul,
      TOKEN.div,
      TOKEN.idiv,
      TOKEN.mod,
      TOKEN.exp,
      TOKEN.atan,
      TOKEN.eq,
      TOKEN.ne,
      TOKEN.gt,
      TOKEN.ge,
      TOKEN.lt,
      TOKEN.le,
      TOKEN.and,
      TOKEN.or,
      TOKEN.xor,
      TOKEN.bitshift
    ]);
    this.#unaryOps = /* @__PURE__ */ new Set([
      TOKEN.abs,
      TOKEN.neg,
      TOKEN.ceiling,
      TOKEN.floor,
      TOKEN.round,
      TOKEN.truncate,
      TOKEN.sqrt,
      TOKEN.sin,
      TOKEN.cos,
      TOKEN.ln,
      TOKEN.log,
      TOKEN.cvi,
      TOKEN.cvr,
      TOKEN.not
    ]);
    this.#idempotentUnary = /* @__PURE__ */ new Set([
      TOKEN.abs,
      TOKEN.ceiling,
      TOKEN.cvi,
      TOKEN.cvr,
      TOKEN.floor,
      TOKEN.round,
      TOKEN.truncate
    ]);
    this.#negatedComparison = /* @__PURE__ */ new Map([
      [TOKEN.eq, TOKEN.ne],
      [TOKEN.ne, TOKEN.eq],
      [TOKEN.lt, TOKEN.ge],
      [TOKEN.le, TOKEN.gt],
      [TOKEN.gt, TOKEN.le],
      [TOKEN.ge, TOKEN.lt]
    ]);
  }
  /**
   * @param {PsProgram} program
   * @param {number} numInputs — number of domain values placed on the stack
   *   before the program runs (i.e. the length of the domain array / 2).
   * @returns {Array<PsNode>} — one tree node per output value.
   */
  evaluate(program, numInputs) {
    if (!_PSStackToTree.#binaryOps) {
      _PSStackToTree.#init();
    }
    this._failed = false;
    if (numInputs > MAX_STACK_SIZE) {
      return null;
    }
    const stack = [];
    for (let i = 0; i < numInputs; i++) {
      stack.push(new PsArgNode(i));
    }
    this._evalBlock(program.body, stack);
    if (this._failed) {
      return null;
    }
    _PSStackToTree.#markShared(stack);
    return stack;
  }
  // Set node.shared / sharedCount on non-atomic nodes referenced more than
  // once.  arg/const are excluded — they are cheap to re-emit inline.
  static #markShared(outputs) {
    const refCount = /* @__PURE__ */ new Map();
    const visit = (node) => {
      if (!node || node.type === PS_NODE.arg || node.type === PS_NODE.const) {
        return;
      }
      const prev = refCount.get(node) ?? 0;
      refCount.set(node, prev + 1);
      if (prev > 0) {
        return;
      }
      switch (node.type) {
        case PS_NODE.unary:
          visit(node.operand);
          break;
        case PS_NODE.binary:
          visit(node.first);
          visit(node.second);
          break;
        case PS_NODE.ternary:
          visit(node.cond);
          visit(node.then);
          visit(node.otherwise);
          break;
      }
    };
    for (const output of outputs) {
      visit(output);
    }
    for (const [node, count] of refCount) {
      if (count > 1) {
        node.shared = true;
        node.sharedCount = count;
      }
    }
  }
  _evalBlock(block, stack) {
    this._evalBlockFrom(block.instructions, 0, stack);
  }
  /**
   * Core evaluation loop.  Processes `instructions[startIdx…]` in order,
   * mutating `stack` as each instruction executes.
   *
   * When a `{ body } if` instruction grows the stack (the PostScript "early
   * exit / guard" idiom), the remaining instructions in the current array are
   * evaluated on **both** the true-branch stack and the false-branch stack,
   * then the two results are merged into PsTernaryNodes.  This handles
   * patterns like:
   *
   *   cond { pop R G B sentinel } if
   *   … more guards …
   *   sentinel 0 gt { defaultR defaultG defaultB } if
   */
  _evalBlockFrom(instructions, startIdx, stack) {
    for (let idx = startIdx; idx < instructions.length; idx++) {
      if (this._failed) {
        break;
      }
      const instr = instructions[idx];
      switch (instr.type) {
        case PS_NODE.number:
          stack.push(new PsConstNode(instr.value));
          if (stack.length > MAX_STACK_SIZE) {
            this._failed = true;
          }
          break;
        case PS_NODE.operator:
          this._evalOp(instr.op, stack);
          break;
        case PS_NODE.if: {
          if (stack.length < 1) {
            this._failed = true;
            break;
          }
          const cond = stack.pop();
          const saved = stack.slice();
          this._evalBlock(instr.then, stack);
          if (this._failed) {
            break;
          }
          if (stack.length === saved.length) {
            for (let i = 0; i < stack.length; i++) {
              if (stack[i] !== saved[i]) {
                stack[i] = this._makeTernary(cond, stack[i], saved[i]);
              }
            }
          } else if (stack.length > saved.length) {
            if (cond.type === PS_NODE.const) {
              if (!cond.value) {
                stack.length = 0;
                stack.push(...saved);
              }
              break;
            }
            const trueStack = stack.slice();
            this._evalBlockFrom(instructions, idx + 1, trueStack);
            if (this._failed) {
              break;
            }
            const falseStack = saved;
            this._evalBlockFrom(instructions, idx + 1, falseStack);
            if (this._failed) {
              break;
            }
            if (trueStack.length !== falseStack.length) {
              const zero = new PsConstNode(0);
              while (trueStack.length < falseStack.length) {
                trueStack.push(zero);
              }
              while (falseStack.length < trueStack.length) {
                falseStack.push(zero);
              }
            }
            stack.length = 0;
            for (let i = 0; i < trueStack.length; i++) {
              stack.push(this._makeTernary(cond, trueStack[i], falseStack[i]));
            }
            return;
          } else {
            this._failed = true;
          }
          break;
        }
        case PS_NODE.ifelse: {
          if (stack.length < 1) {
            this._failed = true;
            break;
          }
          const cond = stack.pop();
          const snapshot = stack.slice();
          const thenStack = snapshot.slice();
          this._evalBlock(instr.then, thenStack);
          if (this._failed) {
            break;
          }
          const elseStack = snapshot.slice();
          this._evalBlock(instr.otherwise, elseStack);
          if (this._failed) {
            break;
          }
          if (thenStack.length !== elseStack.length) {
            const zero = new PsConstNode(0);
            while (thenStack.length < elseStack.length) {
              thenStack.push(zero);
            }
            while (elseStack.length < thenStack.length) {
              elseStack.push(zero);
            }
          }
          stack.length = 0;
          for (let i = 0; i < thenStack.length; i++) {
            stack.push(this._makeTernary(cond, thenStack[i], elseStack[i]));
          }
          break;
        }
      }
    }
  }
  _evalOp(op, stack) {
    if (_PSStackToTree.#binaryOps.has(op)) {
      if (stack.length < 2) {
        this._failed = true;
        return;
      }
      const first = stack.pop();
      const second = stack.pop();
      stack.push(this._makeBinary(op, first, second));
      return;
    }
    if (_PSStackToTree.#unaryOps.has(op)) {
      if (stack.length < 1) {
        this._failed = true;
        return;
      }
      stack.push(this._makeUnary(op, stack.pop()));
      return;
    }
    switch (op) {
      case TOKEN.true:
        stack.push(new PsConstNode(true));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.false:
        stack.push(new PsConstNode(false));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.dup:
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        stack.push(stack.at(-1));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.exch: {
        if (stack.length < 2) {
          this._failed = true;
          break;
        }
        const a = stack.pop();
        const b = stack.pop();
        stack.push(a, b);
        break;
      }
      case TOKEN.pop:
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        stack.pop();
        break;
      case TOKEN.copy: {
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        const nNode = stack.pop();
        if (nNode.type === PS_NODE.const) {
          const n = nNode.value | 0;
          if (n === 0) {
          } else if (n < 0 || n > stack.length) {
            this._failed = true;
          } else {
            stack.push(...stack.slice(-n));
            if (stack.length > MAX_STACK_SIZE) {
              this._failed = true;
            }
          }
        } else {
          this._failed = true;
        }
        break;
      }
      case TOKEN.index: {
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        const nNode = stack.pop();
        if (nNode.type === PS_NODE.const) {
          const n = nNode.value | 0;
          if (n < 0 || n >= stack.length) {
            this._failed = true;
          } else {
            stack.push(stack.at(-n - 1));
          }
        } else {
          this._failed = true;
        }
        break;
      }
      case TOKEN.roll: {
        if (stack.length < 2) {
          this._failed = true;
          break;
        }
        const jNode = stack.pop();
        const nNode = stack.pop();
        if (nNode.type === PS_NODE.const && jNode.type === PS_NODE.const) {
          const n = nNode.value | 0;
          if (n === 0) {
          } else if (n < 0 || n > stack.length) {
            this._failed = true;
          } else {
            const j = ((jNode.value | 0) % n + n) % n;
            if (j > 0) {
              const slice = stack.splice(-n, n);
              stack.push(...slice.slice(n - j), ...slice.slice(0, n - j));
            }
          }
        } else {
          this._failed = true;
        }
        break;
      }
      default:
        this._failed = true;
        break;
    }
  }
  /**
   * Create a binary tree node, applying optimizations eagerly:
   *
   * 1. Constant folding — both operands are PsConstNode → fold to PsConstNode.
   * 2. Reflexive simplifications — x−x→0, x xor x→0, x eq x→true, etc.
   * 3. Algebraic simplifications with one known operand — identity elements
   *    (x+0→x, x*1→x, …), absorbing elements (x*0→0, x and false→false, …),
   *    and strength reductions (x*-1→neg(x), x^0.5→sqrt(x), x^2→x*x, …).
   *
   * Recall: `first` was on top of the stack (right operand for non-commutative
   * ops), `second` was below (left operand). So `a b sub` → second=a, first=b
   * → a − b.
   */
  _makeBinary(op, first, second) {
    if (first.type === PS_NODE.const && second.type === PS_NODE.const) {
      const v = _evalBinaryConst(op, second.value, first.value);
      if (v !== void 0) {
        return new PsConstNode(v);
      }
    }
    if (_nodesEqual(first, second)) {
      switch (op) {
        case TOKEN.sub:
          return new PsConstNode(0);
        // x − x → 0
        case TOKEN.xor:
          return new PsConstNode(
            /* eslint-disable unicorn/prefer-logical-operator-over-ternary */
            first.valueType === PS_VALUE_TYPE.boolean ? false : 0
            /* eslint-enable unicorn/prefer-logical-operator-over-ternary */
          );
        // TOKEN.mod, TOKEN.div, TOKEN.idiv are NOT simplified here:
        // x op x is undefined when x = 0, so we cannot fold without knowing
        // that x is non-zero.
        case TOKEN.and:
        case TOKEN.or:
          return first;
        // x and x → x; x or x → x
        case TOKEN.min:
        case TOKEN.max:
          return first;
        // min(x,x) → x; max(x,x) → x
        case TOKEN.eq:
        case TOKEN.ge:
        case TOKEN.le:
          return new PsConstNode(true);
        case TOKEN.ne:
        case TOKEN.gt:
        case TOKEN.lt:
          return new PsConstNode(false);
      }
    }
    if (first.type === PS_NODE.const) {
      const b = first.value;
      switch (op) {
        case TOKEN.add:
          if (b === 0) {
            return second;
          }
          break;
        case TOKEN.sub:
          if (b === 0) {
            return second;
          }
          break;
        case TOKEN.mul:
          if (b === 1) {
            return second;
          }
          if (b === 0) {
            return first;
          }
          if (b === -1) {
            return this._makeUnary(TOKEN.neg, second);
          }
          break;
        case TOKEN.div:
          if (b !== 0) {
            return this._makeBinary(TOKEN.mul, new PsConstNode(1 / b), second);
          }
          break;
        case TOKEN.idiv:
          if (b === 1) {
            return second;
          }
          break;
        case TOKEN.exp:
          if (b === 1) {
            return second;
          }
          if (b === -1) {
            return this._makeBinary(TOKEN.div, second, new PsConstNode(1));
          }
          if (b === 0.5) {
            return this._makeUnary(TOKEN.sqrt, second);
          }
          if (b === 0.25) {
            const sqrtOnce = this._makeUnary(TOKEN.sqrt, second);
            return this._makeUnary(TOKEN.sqrt, sqrtOnce);
          }
          if (b === 2) {
            return this._makeBinary(TOKEN.mul, second, second);
          }
          if (b === 3) {
            return this._makeBinary(
              TOKEN.mul,
              this._makeBinary(TOKEN.mul, second, second),
              second
            );
          }
          if (b === 4) {
            const square = this._makeBinary(TOKEN.mul, second, second);
            return this._makeBinary(TOKEN.mul, square, square);
          }
          if (b === 0) {
            return new PsConstNode(1);
          }
          break;
        case TOKEN.and:
          if (b === true) {
            return second;
          }
          if (b === false) {
            return first;
          }
          break;
        case TOKEN.or:
          if (b === false) {
            return second;
          }
          if (b === true) {
            return first;
          }
          break;
        case TOKEN.min:
          if (second.type === PS_NODE.binary && second.op === TOKEN.max && second.first.type === PS_NODE.const && second.first.value >= b) {
            return first;
          }
          break;
        case TOKEN.max:
          if (second.type === PS_NODE.binary && second.op === TOKEN.min && second.first.type === PS_NODE.const && second.first.value <= b) {
            return first;
          }
          break;
      }
    }
    if (second.type === PS_NODE.const) {
      const a = second.value;
      switch (op) {
        case TOKEN.add:
          if (a === 0) {
            return first;
          }
          break;
        case TOKEN.sub:
          if (a === 0) {
            return this._makeUnary(TOKEN.neg, first);
          }
          break;
        case TOKEN.mul:
          if (a === 1) {
            return first;
          }
          if (a === 0) {
            return second;
          }
          if (a === -1) {
            return this._makeUnary(TOKEN.neg, first);
          }
          break;
        case TOKEN.and:
          if (a === true) {
            return first;
          }
          if (a === false) {
            return second;
          }
          break;
        case TOKEN.or:
          if (a === false) {
            return first;
          }
          if (a === true) {
            return second;
          }
          break;
      }
    }
    return new PsBinaryNode(
      op,
      first,
      second,
      _binaryValueType(op, first.valueType, second.valueType)
    );
  }
  /**
   * Create a unary tree node, applying optimizations eagerly:
   *
   * 1. Constant folding.
   * 2. not(comparison) → negated comparison: not(a eq b) → a ne b, etc.
   * 3. neg(a − b) → b − a.
   * 4. Double-negation: neg(neg(x)) → x, not(not(x)) → x.
   * 5. abs(neg(x)) → abs(x).
   * 6. Idempotent: f(f(x)) → f(x) for abs, ceiling, floor, round, etc.
   */
  _makeUnary(op, operand) {
    if (operand.type === PS_NODE.const) {
      const v = _evalUnaryConst(op, operand.value);
      if (v !== void 0) {
        return new PsConstNode(v);
      }
    }
    if (op === TOKEN.not && operand.type === PS_NODE.binary) {
      const negated = _PSStackToTree.#negatedComparison.get(operand.op);
      if (negated !== void 0) {
        return new PsBinaryNode(
          negated,
          operand.first,
          operand.second,
          PS_VALUE_TYPE.boolean
        );
      }
    }
    if (op === TOKEN.neg && operand.type === PS_NODE.binary && operand.op === TOKEN.sub) {
      return this._makeBinary(TOKEN.sub, operand.second, operand.first);
    }
    if (operand.type === PS_NODE.unary) {
      if (op === TOKEN.neg && operand.op === TOKEN.neg || op === TOKEN.not && operand.op === TOKEN.not) {
        return operand.operand;
      }
      if (op === TOKEN.abs && operand.op === TOKEN.neg) {
        return this._makeUnary(TOKEN.abs, operand.operand);
      }
      if (_PSStackToTree.#idempotentUnary.has(op) && op === operand.op) {
        return operand;
      }
    }
    return new PsUnaryNode(op, operand, _unaryValueType(op, operand.valueType));
  }
  /**
   * Create a ternary node, applying optimizations eagerly:
   *
   * 1. Constant condition — fold to the live branch.
   * 2. Identical branches — the condition is irrelevant, return either branch.
   * 3. Boolean branch constants — `cond ? true : false` → cond,
   *    `cond ? false : true` → not(cond).
   * 4. Ternary → branchless min/max when the condition compares two numeric
   *    expressions that are also the two branches.
   */
  _makeTernary(cond, then, otherwise) {
    if (cond.type === PS_NODE.const) {
      return cond.value ? then : otherwise;
    }
    if (_nodesEqual(then, otherwise)) {
      return then;
    }
    if (then.type === PS_NODE.const && otherwise.type === PS_NODE.const) {
      if (then.value === true && otherwise.value === false) {
        return cond;
      }
      if (then.value === false && otherwise.value === true) {
        return this._makeUnary(TOKEN.not, cond);
      }
    }
    if (cond.type === PS_NODE.binary) {
      const { op: cop, first: cf, second: cs } = cond;
      if (cop === TOKEN.gt || cop === TOKEN.ge) {
        if (_nodesEqual(then, cf) && _nodesEqual(otherwise, cs)) {
          return this._makeBinary(TOKEN.min, cf, cs);
        }
        if (_nodesEqual(then, cs) && _nodesEqual(otherwise, cf)) {
          return this._makeBinary(TOKEN.max, cf, cs);
        }
      } else if (cop === TOKEN.lt || cop === TOKEN.le) {
        if (_nodesEqual(then, cf) && _nodesEqual(otherwise, cs)) {
          return this._makeBinary(TOKEN.max, cf, cs);
        }
        if (_nodesEqual(then, cs) && _nodesEqual(otherwise, cf)) {
          return this._makeBinary(TOKEN.min, cf, cs);
        }
      }
    }
    return new PsTernaryNode(
      cond,
      then,
      otherwise,
      then.valueType === otherwise.valueType ? then.valueType : PS_VALUE_TYPE.unknown
    );
  }
};

// src/core/postscript/js_evaluator.js
var OP = {
  ARG: 0,
  // [ARG, idx]
  CONST: 1,
  // [CONST, val]
  STORE: 2,
  // [STORE, slot, min, max]  clamp(pop()) → mem[slot]
  IF: 3,
  // [IF, target]  jump when top-of-stack === 0
  JUMP: 4,
  // [JUMP, target]  unconditional
  ABS: 5,
  NEG: 6,
  CEIL: 7,
  FLOOR: 8,
  ROUND: 9,
  // floor(x + 0.5)
  TRUNC: 10,
  NOT_B: 11,
  // boolean NOT
  NOT_N: 12,
  // bitwise NOT
  SQRT: 13,
  SIN: 14,
  // degrees in/out
  COS: 15,
  LN: 16,
  LOG10: 17,
  CVI: 18,
  SHIFT: 19,
  // [SHIFT, amount]  +ve = left, −ve = right
  // Binary ops: second below, first on top; result = second OP first.
  ADD: 20,
  SUB: 21,
  MUL: 22,
  DIV: 23,
  // 0 when divisor is 0
  IDIV: 24,
  // 0 when divisor is 0
  MOD: 25,
  // 0 when divisor is 0
  POW: 26,
  EQ: 27,
  NE: 28,
  GT: 29,
  GE: 30,
  LT: 31,
  LE: 32,
  AND: 33,
  OR: 34,
  XOR: 35,
  ATAN: 36,
  // atan2(second, first) → degrees [0, 360)
  MIN: 37,
  MAX: 38,
  TEE_TMP: 39,
  // [TEE_TMP, slot]  peek top of stack → tmp[slot], leave on stack
  LOAD_TMP: 40
  // [LOAD_TMP, slot]  push tmp[slot]
};
var _DEG_TO_RAD = Math.PI / 180;
var _RAD_TO_DEG = 180 / Math.PI;
var PsJsCompiler = class {
  // Safe because JS is single-threaded.
  static #stack = new Float64Array(64);
  static #tmp = new Float64Array(64);
  constructor(domain, range) {
    this.nIn = domain.length >> 1;
    this.nOut = range.length >> 1;
    this.range = range;
    this.ir = [];
    this._tmpMap = /* @__PURE__ */ new Map();
    this._nextTmp = 0;
  }
  _compileNode(node) {
    if (node.shared) {
      const cached = this._tmpMap.get(node);
      if (cached !== void 0) {
        this.ir.push(OP.LOAD_TMP, cached);
        return true;
      }
      if (!this._compileNodeImpl(node)) {
        return false;
      }
      const slot = this._nextTmp++;
      this._tmpMap.set(node, slot);
      this.ir.push(OP.TEE_TMP, slot);
      return true;
    }
    return this._compileNodeImpl(node);
  }
  _compileNodeImpl(node) {
    switch (node.type) {
      case PS_NODE.arg:
        this.ir.push(OP.ARG, node.index);
        return true;
      case PS_NODE.const: {
        const v = node.value;
        this.ir.push(OP.CONST, typeof v === "boolean" ? Number(v) : v);
        return true;
      }
      case PS_NODE.unary:
        return this._compileUnary(node);
      case PS_NODE.binary:
        return this._compileBinary(node);
      case PS_NODE.ternary:
        return this._compileTernary(node);
      default:
        return false;
    }
  }
  _compileUnary(node) {
    const { op, operand, valueType } = node;
    if (op === TOKEN.cvr) {
      return this._compileNode(operand);
    }
    if (!this._compileNode(operand)) {
      return false;
    }
    switch (op) {
      case TOKEN.abs:
        this.ir.push(OP.ABS);
        break;
      case TOKEN.neg:
        this.ir.push(OP.NEG);
        break;
      case TOKEN.ceiling:
        this.ir.push(OP.CEIL);
        break;
      case TOKEN.floor:
        this.ir.push(OP.FLOOR);
        break;
      case TOKEN.round:
        this.ir.push(OP.ROUND);
        break;
      case TOKEN.truncate:
        this.ir.push(OP.TRUNC);
        break;
      case TOKEN.sqrt:
        this.ir.push(OP.SQRT);
        break;
      case TOKEN.sin:
        this.ir.push(OP.SIN);
        break;
      case TOKEN.cos:
        this.ir.push(OP.COS);
        break;
      case TOKEN.ln:
        this.ir.push(OP.LN);
        break;
      case TOKEN.log:
        this.ir.push(OP.LOG10);
        break;
      case TOKEN.cvi:
        this.ir.push(OP.CVI);
        break;
      case TOKEN.not:
        if (valueType === PS_VALUE_TYPE.boolean) {
          this.ir.push(OP.NOT_B);
        } else if (valueType === PS_VALUE_TYPE.numeric) {
          this.ir.push(OP.NOT_N);
        } else {
          return false;
        }
        break;
      default:
        return false;
    }
    return true;
  }
  _compileBinary(node) {
    const { op, first, second } = node;
    if (op === TOKEN.bitshift) {
      if (first.type !== PS_NODE.const || !Number.isInteger(first.value) || !this._compileNode(second)) {
        return false;
      }
      this.ir.push(OP.SHIFT, first.value);
      return true;
    }
    if (!this._compileNode(second) || !this._compileNode(first)) {
      return false;
    }
    switch (op) {
      case TOKEN.add:
        this.ir.push(OP.ADD);
        break;
      case TOKEN.sub:
        this.ir.push(OP.SUB);
        break;
      case TOKEN.mul:
        this.ir.push(OP.MUL);
        break;
      case TOKEN.div:
        this.ir.push(OP.DIV);
        break;
      case TOKEN.idiv:
        this.ir.push(OP.IDIV);
        break;
      case TOKEN.mod:
        this.ir.push(OP.MOD);
        break;
      case TOKEN.exp:
        this.ir.push(OP.POW);
        break;
      case TOKEN.eq:
        this.ir.push(OP.EQ);
        break;
      case TOKEN.ne:
        this.ir.push(OP.NE);
        break;
      case TOKEN.gt:
        this.ir.push(OP.GT);
        break;
      case TOKEN.ge:
        this.ir.push(OP.GE);
        break;
      case TOKEN.lt:
        this.ir.push(OP.LT);
        break;
      case TOKEN.le:
        this.ir.push(OP.LE);
        break;
      case TOKEN.and:
        this.ir.push(OP.AND);
        break;
      case TOKEN.or:
        this.ir.push(OP.OR);
        break;
      case TOKEN.xor:
        this.ir.push(OP.XOR);
        break;
      case TOKEN.atan:
        this.ir.push(OP.ATAN);
        break;
      case TOKEN.min:
        this.ir.push(OP.MIN);
        break;
      case TOKEN.max:
        this.ir.push(OP.MAX);
        break;
      default:
        return false;
    }
    return true;
  }
  _compileTernary(node) {
    if (!this._compileNode(node.cond)) {
      return false;
    }
    this.ir.push(OP.IF, 0);
    const ifPatch = this.ir.length - 1;
    if (!this._compileNode(node.then)) {
      return false;
    }
    this.ir.push(OP.JUMP, 0);
    const jumpPatch = this.ir.length - 1;
    this.ir[ifPatch] = this.ir.length;
    if (!this._compileNode(node.otherwise)) {
      return false;
    }
    this.ir[jumpPatch] = this.ir.length;
    return true;
  }
  compile(program) {
    const outputs = new PSStackToTree().evaluate(program, this.nIn);
    if (!outputs || outputs.length < this.nOut) {
      return null;
    }
    for (let i = 0; i < this.nOut; i++) {
      if (!this._compileNode(outputs[i])) {
        return null;
      }
      const min = this.range[i * 2];
      const max = this.range[i * 2 + 1];
      this.ir.push(OP.STORE, i, min, max);
    }
    return new Float64Array(this.ir);
  }
  static execute(ir, src, srcOffset, dest, destOffset) {
    let ip = 0, sp = 0;
    const n = ir.length;
    const stack = this.#stack;
    const tmp = this.#tmp;
    while (ip < n) {
      switch (ir[ip++] | 0) {
        case OP.ARG:
          stack[sp++] = src[srcOffset + (ir[ip++] | 0)];
          break;
        case OP.CONST:
          stack[sp++] = ir[ip++];
          break;
        case OP.STORE: {
          const slot = ir[ip++] | 0;
          const min = ir[ip++];
          const max = ir[ip++];
          dest[destOffset + slot] = MathClamp(stack[--sp], min, max);
          break;
        }
        case OP.IF: {
          const tgt = ir[ip++];
          if (stack[--sp] === 0) {
            ip = tgt;
          }
          break;
        }
        case OP.JUMP:
          ip = ir[ip];
          break;
        case OP.ABS:
          stack[sp - 1] = Math.abs(stack[sp - 1]);
          break;
        case OP.NEG:
          stack[sp - 1] = -stack[sp - 1];
          break;
        case OP.CEIL:
          stack[sp - 1] = Math.ceil(stack[sp - 1]);
          break;
        case OP.FLOOR:
          stack[sp - 1] = Math.floor(stack[sp - 1]);
          break;
        case OP.ROUND:
          stack[sp - 1] = Math.floor(stack[sp - 1] + 0.5);
          break;
        case OP.TRUNC:
          stack[sp - 1] = Math.trunc(stack[sp - 1]);
          break;
        case OP.NOT_B:
          stack[sp - 1] = stack[sp - 1] !== 0 ? 0 : 1;
          break;
        case OP.NOT_N:
          stack[sp - 1] = ~(stack[sp - 1] | 0);
          break;
        case OP.SQRT:
          stack[sp - 1] = Math.sqrt(stack[sp - 1]);
          break;
        case OP.SIN:
          stack[sp - 1] = Math.sin(stack[sp - 1] % 360 * _DEG_TO_RAD);
          break;
        case OP.COS:
          stack[sp - 1] = Math.cos(stack[sp - 1] % 360 * _DEG_TO_RAD);
          break;
        case OP.LN:
          stack[sp - 1] = Math.log(stack[sp - 1]);
          break;
        case OP.LOG10:
          stack[sp - 1] = Math.log10(stack[sp - 1]);
          break;
        case OP.CVI:
          stack[sp - 1] = Math.trunc(stack[sp - 1]) | 0;
          break;
        case OP.SHIFT: {
          const amt = ir[ip++];
          const v = stack[sp - 1] | 0;
          if (amt > 0) {
            stack[sp - 1] = v << amt;
          } else if (amt < 0) {
            stack[sp - 1] = v >> -amt;
          } else {
            stack[sp - 1] = v;
          }
          break;
        }
        case OP.ADD: {
          const b = stack[--sp];
          stack[sp - 1] += b;
          break;
        }
        case OP.SUB: {
          const b = stack[--sp];
          stack[sp - 1] -= b;
          break;
        }
        case OP.MUL: {
          const b = stack[--sp];
          stack[sp - 1] *= b;
          break;
        }
        case OP.DIV: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? stack[sp - 1] / b : 0;
          break;
        }
        case OP.IDIV: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? Math.trunc(stack[sp - 1] / b) : 0;
          break;
        }
        case OP.MOD: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? stack[sp - 1] % b : 0;
          break;
        }
        case OP.POW: {
          const b = stack[--sp];
          stack[sp - 1] **= b;
          break;
        }
        case OP.EQ: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] === b ? 1 : 0;
          break;
        }
        case OP.NE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] !== b ? 1 : 0;
          break;
        }
        case OP.GT: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] > b ? 1 : 0;
          break;
        }
        case OP.GE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] >= b ? 1 : 0;
          break;
        }
        case OP.LT: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] < b ? 1 : 0;
          break;
        }
        case OP.LE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] <= b ? 1 : 0;
          break;
        }
        case OP.AND: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = (stack[sp - 1] | 0) & b;
          break;
        }
        case OP.OR: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = stack[sp - 1] | 0 | b;
          break;
        }
        case OP.XOR: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = (stack[sp - 1] | 0) ^ b;
          break;
        }
        case OP.ATAN: {
          const b = stack[--sp];
          const deg = Math.atan2(stack[sp - 1], b) * _RAD_TO_DEG;
          stack[sp - 1] = deg < 0 ? deg + 360 : deg;
          break;
        }
        case OP.MIN: {
          const b = stack[--sp];
          stack[sp - 1] = Math.min(stack[sp - 1], b);
          break;
        }
        case OP.MAX: {
          const b = stack[--sp];
          stack[sp - 1] = Math.max(stack[sp - 1], b);
          break;
        }
        case OP.TEE_TMP:
          tmp[ir[ip++] | 0] = stack[sp - 1];
          break;
        case OP.LOAD_TMP:
          stack[sp++] = tmp[ir[ip++] | 0];
          break;
      }
    }
  }
};
var PSStackBasedInterpreter = class {
  #stack = new Float64Array(100);
  #sp = 0;
  #push(v) {
    if (this.#sp < this.#stack.length) {
      this.#stack[this.#sp++] = v;
    }
  }
  #execOp(op) {
    const stack = this.#stack;
    switch (op) {
      case TOKEN.true:
        this.#push(1);
        break;
      case TOKEN.false:
        this.#push(0);
        break;
      case TOKEN.abs:
        stack[this.#sp - 1] = Math.abs(stack[this.#sp - 1]);
        break;
      case TOKEN.neg:
        stack[this.#sp - 1] = -stack[this.#sp - 1];
        break;
      case TOKEN.ceiling:
        stack[this.#sp - 1] = Math.ceil(stack[this.#sp - 1]);
        break;
      case TOKEN.floor:
        stack[this.#sp - 1] = Math.floor(stack[this.#sp - 1]);
        break;
      case TOKEN.round:
        stack[this.#sp - 1] = Math.floor(stack[this.#sp - 1] + 0.5);
        break;
      case TOKEN.truncate:
        stack[this.#sp - 1] = Math.trunc(stack[this.#sp - 1]);
        break;
      case TOKEN.sqrt:
        stack[this.#sp - 1] = Math.sqrt(stack[this.#sp - 1]);
        break;
      case TOKEN.sin:
        stack[this.#sp - 1] = Math.sin(
          stack[this.#sp - 1] % 360 * _DEG_TO_RAD
        );
        break;
      case TOKEN.cos:
        stack[this.#sp - 1] = Math.cos(
          stack[this.#sp - 1] % 360 * _DEG_TO_RAD
        );
        break;
      case TOKEN.ln:
        stack[this.#sp - 1] = Math.log(stack[this.#sp - 1]);
        break;
      case TOKEN.log:
        stack[this.#sp - 1] = Math.log10(stack[this.#sp - 1]);
        break;
      case TOKEN.cvi:
        stack[this.#sp - 1] = Math.trunc(stack[this.#sp - 1]) | 0;
        break;
      case TOKEN.cvr:
        break;
      // values are already f64
      case TOKEN.not: {
        const v = stack[this.#sp - 1];
        stack[this.#sp - 1] = v === 0 || v === 1 ? 1 - v : ~(v | 0);
        break;
      }
      case TOKEN.add: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] += b;
        break;
      }
      case TOKEN.sub: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] -= b;
        break;
      }
      case TOKEN.mul: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] *= b;
        break;
      }
      case TOKEN.div: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = b !== 0 ? stack[this.#sp - 1] / b : 0;
        break;
      }
      case TOKEN.idiv: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = b !== 0 ? Math.trunc(stack[this.#sp - 1] / b) : 0;
        break;
      }
      case TOKEN.mod: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = b !== 0 ? stack[this.#sp - 1] % b : 0;
        break;
      }
      case TOKEN.exp: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] **= b;
        break;
      }
      case TOKEN.atan: {
        const dx = stack[--this.#sp];
        const deg = Math.atan2(stack[this.#sp - 1], dx) * _RAD_TO_DEG;
        stack[this.#sp - 1] = deg < 0 ? deg + 360 : deg;
        break;
      }
      case TOKEN.eq: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] === b ? 1 : 0;
        break;
      }
      case TOKEN.ne: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] !== b ? 1 : 0;
        break;
      }
      case TOKEN.gt: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] > b ? 1 : 0;
        break;
      }
      case TOKEN.ge: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] >= b ? 1 : 0;
        break;
      }
      case TOKEN.lt: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] < b ? 1 : 0;
        break;
      }
      case TOKEN.le: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = stack[this.#sp - 1] <= b ? 1 : 0;
        break;
      }
      case TOKEN.and: {
        const b = stack[--this.#sp] | 0;
        stack[this.#sp - 1] = (stack[this.#sp - 1] | 0) & b;
        break;
      }
      case TOKEN.or: {
        const b = stack[--this.#sp] | 0;
        stack[this.#sp - 1] = stack[this.#sp - 1] | 0 | b;
        break;
      }
      case TOKEN.xor: {
        const b = stack[--this.#sp] | 0;
        stack[this.#sp - 1] = (stack[this.#sp - 1] | 0) ^ b;
        break;
      }
      case TOKEN.bitshift: {
        const amt = stack[--this.#sp] | 0;
        const v = stack[this.#sp - 1] | 0;
        stack[this.#sp - 1] = amt > 0 ? v << amt : v >> -amt;
        break;
      }
      case TOKEN.min: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = Math.min(stack[this.#sp - 1], b);
        break;
      }
      case TOKEN.max: {
        const b = stack[--this.#sp];
        stack[this.#sp - 1] = Math.max(stack[this.#sp - 1], b);
        break;
      }
      case TOKEN.dup:
        this.#push(stack[this.#sp - 1]);
        break;
      case TOKEN.exch: {
        const a = stack[--this.#sp];
        const b = stack[--this.#sp];
        this.#push(a);
        this.#push(b);
        break;
      }
      case TOKEN.pop:
        this.#sp--;
        break;
      case TOKEN.copy: {
        const n = Math.trunc(stack[--this.#sp]);
        const base = this.#sp - n;
        for (let k = 0; k < n; k++) {
          this.#push(stack[base + k]);
        }
        break;
      }
      case TOKEN.index: {
        const i = Math.trunc(stack[--this.#sp]);
        this.#push(stack[this.#sp - 1 - i]);
        break;
      }
      case TOKEN.roll: {
        const j = Math.trunc(stack[--this.#sp]);
        const n = Math.trunc(stack[--this.#sp]);
        if (n > 1 && j !== 0) {
          const mod = (j % n + n) % n;
          if (mod !== 0) {
            const base = this.#sp - n;
            const sub = stack.slice(base, this.#sp);
            for (let k = 0; k < n; k++) {
              stack[base + k] = sub[(k - mod + n) % n];
            }
          }
        }
        break;
      }
    }
  }
  #execBlock(instructions) {
    for (const instr of instructions) {
      switch (instr.type) {
        case PS_NODE.number:
          this.#push(instr.value);
          break;
        case PS_NODE.operator:
          this.#execOp(instr.op);
          break;
        case PS_NODE.if:
          if (this.#stack[--this.#sp] !== 0) {
            this.#execBlock(instr.then.instructions);
          }
          break;
        case PS_NODE.ifelse:
          if (this.#stack[--this.#sp] !== 0) {
            this.#execBlock(instr.then.instructions);
          } else {
            this.#execBlock(instr.otherwise.instructions);
          }
          break;
      }
    }
  }
  /**
   * @param {import("./ast.js").PsProgram} program
   * @param {number[]} domain  – flat [min0,max0, …]
   * @param {number[]} range   – flat [min0,max0, …]
   * @returns {Function}  – `(src, srcOffset, dest, destOffset) => void`
   */
  push(value) { this.#push(value); }
  execute(op) { this.#execOp(op); }
  pop() { return this.#stack[--this.#sp]; }
  result(range) {
    const count=range.length>>1,base=this.#sp-count,output=[];
    for(let i=0;i<count;i++)output.push(MathClamp(base+i>=0?this.#stack[base+i]:0,range[i*2],range[i*2+1]));
    return output;
  }
  static build(program, domain, range) {
    const machine = new PSStackBasedInterpreter();
    const nIn = domain.length >> 1;
    const nOut = range.length >> 1;
    const { instructions } = program.body;
    return (src, srcOffset, dest, destOffset) => {
      machine.#sp = 0;
      for (let i = 0; i < nIn; i++) {
        machine.#push(src[srcOffset + i]);
      }
      machine.#execBlock(instructions);
      const base = machine.#sp - nOut;
      for (let i = 0; i < nOut; i++) {
        const v = base + i >= 0 ? machine.#stack[base + i] : 0;
        dest[destOffset + i] = MathClamp(v, range[i * 2], range[i * 2 + 1]);
      }
    };
  }
};
function buildPostScriptJsFunction(source, domain, range, forceInterpreter = false) {
  const program = parsePostScriptFunction(source);
  const ir = !forceInterpreter && new PsJsCompiler(domain, range).compile(program);
  if (ir) {
    return (src, srcOffset, dest, destOffset) => {
      PsJsCompiler.execute(ir, src, srcOffset, dest, destOffset);
    };
  }
  return PSStackBasedInterpreter.build(program, domain, range);
}

// src/core/pattern.js
var ShadingType = {
  FUNCTION_BASED: 1,
  AXIAL: 2,
  RADIAL: 3,
  FREE_FORM_MESH: 4,
  LATTICE_FORM_MESH: 5,
  COONS_PATCH_MESH: 6,
  TENSOR_PATCH_MESH: 7
};
var BaseShading = class _BaseShading {
  // A small number to offset the first/last color stops so we can insert ones
  // to support extend. Number.MIN_VALUE is too small and breaks the extend.
  static SMALL_NUMBER = 1e-6;
  constructor() {
    if ((typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) && this.constructor === _BaseShading) {
      unreachable("Cannot initialize BaseShading.");
    }
  }
  getIR() {
    unreachable("Abstract method `getIR` called.");
  }
};
function meshUpdateBounds(self) {
  let minX = self.coords[0][0], minY = self.coords[0][1], maxX = minX, maxY = minY;
  for (let i = 1, ii = self.coords.length; i < ii; i++) {
    const x = self.coords[i][0], y = self.coords[i][1];
    minX = minX > x ? x : minX;
    minY = minY > y ? y : minY;
    maxX = maxX < x ? x : maxX;
    maxY = maxY < y ? y : maxY;
  }
  self.bounds = [minX, minY, maxX, maxY];
}
function meshPackData(self) {
  let i, j, ii;
  const coords = self.coords;
  self.onAllocation?.(coords.length * 8);
  const coordsPacked = new Float32Array(coords.length * 2);
  for (i = 0, j = 0, ii = coords.length; i < ii; i++) {
    const xy = coords[i];
    coordsPacked[j++] = xy[0];
    coordsPacked[j++] = xy[1];
  }
  self.coords = coordsPacked;
  const colors = self.colors;
  self.onAllocation?.(colors.length * 4);
  const colorsPacked = new Uint8Array(colors.length * 4);
  for (i = 0, j = 0, ii = colors.length; i < ii; i++) {
    const c = colors[i];
    colorsPacked[j++] = c[0];
    colorsPacked[j++] = c[1];
    colorsPacked[j++] = c[2];
    j++;
  }
  self.colors = colorsPacked;
  for (const figure of self.figures) {
    self.onAllocation?.((figure.coords.length + figure.colors.length) * 4);
    figure.coords = new Uint32Array(figure.coords);
    figure.colors = new Uint32Array(figure.colors);
  }
}
function buildMeshVertexData(coords, colors, figures, onAllocation) {
  let vertexCount = 0;
  for (const figure of figures) {
    if (figure.type === MeshFigureType.TRIANGLES) {
      vertexCount += figure.coords.length;
    } else if (figure.type === MeshFigureType.LATTICE) {
      const vpr = figure.verticesPerRow;
      vertexCount += (Math.floor(figure.coords.length / vpr) - 1) * (vpr - 1) * 6;
    }
  }
  onAllocation?.(vertexCount * 12);
  const posData = new Float32Array(vertexCount * 2);
  const colData = new Uint8Array(vertexCount * 4);
  let pOff = 0, cOff = 0;
  const addVertex = (pi, ci) => {
    posData[pOff++] = coords[pi * 2];
    posData[pOff++] = coords[pi * 2 + 1];
    colData[cOff++] = colors[ci * 4];
    colData[cOff++] = colors[ci * 4 + 1];
    colData[cOff++] = colors[ci * 4 + 2];
    cOff++;
  };
  for (const figure of figures) {
    const ps = figure.coords;
    const cs = figure.colors;
    if (figure.type === MeshFigureType.TRIANGLES) {
      for (let i = 0, ii = ps.length; i < ii; i++) {
        addVertex(ps[i], cs[i]);
      }
    } else if (figure.type === MeshFigureType.LATTICE) {
      const vpr = figure.verticesPerRow;
      const rows = Math.floor(ps.length / vpr) - 1;
      const cols = vpr - 1;
      for (let i = 0; i < rows; i++) {
        let q = i * vpr;
        for (let j = 0; j < cols; j++, q++) {
          addVertex(ps[q], cs[q]);
          addVertex(ps[q + 1], cs[q + 1]);
          addVertex(ps[q + vpr], cs[q + vpr]);
          addVertex(ps[q + vpr + 1], cs[q + vpr + 1]);
          addVertex(ps[q + 1], cs[q + 1]);
          addVertex(ps[q + vpr], cs[q + vpr]);
        }
      }
    }
  }
  return { posData, colData, vertexCount };
}
var MeshStreamReader = class {
  constructor(stream, context) {
    this.stream = stream;
    this.context = context;
    this.buffer = 0;
    this.bufferLength = 0;
    const numComps = context.numComps;
    context.onAllocation?.(numComps * 4 + (context.colorFn ? context.colorSpace.numComps * 4 : 0));
    this.tmpCompsBuf = new Float32Array(numComps);
    const csNumComps = context.colorSpace.numComps;
    this.tmpCsCompsBuf = context.colorFn ? new Float32Array(csNumComps) : this.tmpCompsBuf;
  }
  get hasData() {
    if (this.stream.end) {
      return this.stream.pos < this.stream.end;
    }
    if (this.bufferLength > 0) {
      return true;
    }
    const nextByte = this.stream.getByte();
    if (nextByte < 0) {
      return false;
    }
    this.buffer = nextByte;
    this.bufferLength = 8;
    return true;
  }
  readBits(n) {
    const { stream } = this;
    let { buffer, bufferLength } = this;
    if (n === 32) {
      if (bufferLength === 0) {
        return stream.getInt32() >>> 0;
      }
      buffer = buffer << 24 | stream.getByte() << 16 | stream.getByte() << 8 | stream.getByte();
      const nextByte = stream.getByte();
      this.buffer = nextByte & (1 << bufferLength) - 1;
      return (buffer << 8 - bufferLength | (nextByte & 255) >> bufferLength) >>> 0;
    }
    if (n === 8 && bufferLength === 0) {
      return stream.getByte();
    }
    while (bufferLength < n) {
      buffer = buffer << 8 | stream.getByte();
      bufferLength += 8;
    }
    bufferLength -= n;
    this.bufferLength = bufferLength;
    this.buffer = buffer & (1 << bufferLength) - 1;
    return buffer >> bufferLength;
  }
  align() {
    this.buffer = 0;
    this.bufferLength = 0;
  }
  readFlag() {
    return this.readBits(this.context.bitsPerFlag);
  }
  readCoordinate() {
    this.context.onAllocation?.(64);
    const { bitsPerCoordinate, decode } = this.context;
    const xi = this.readBits(bitsPerCoordinate);
    const yi = this.readBits(bitsPerCoordinate);
    const scale = bitsPerCoordinate < 32 ? 1 / ((1 << bitsPerCoordinate) - 1) : 23283064365386963e-26;
    return [
      xi * scale * (decode[1] - decode[0]) + decode[0],
      yi * scale * (decode[3] - decode[2]) + decode[2]
    ];
  }
  readComponentValues() {
    this.context.onAllocation?.(64);
    const { bitsPerComponent, decode, numComps } = this.context;
    const scale = bitsPerComponent < 32 ? 1 / ((1 << bitsPerComponent) - 1) : 23283064365386963e-26;
    const components = this.tmpCompsBuf;
    for (let i = 0, j = 4; i < numComps; i++, j += 2) {
      const ci = this.readBits(bitsPerComponent);
      components[i] = ci * scale * (decode[j + 1] - decode[j]) + decode[j];
    }
    return components;
  }
  readComponents() {
    const components = this.readComponentValues();
    const {colorFn, colorSpace} = this.context;
    const color = this.tmpCsCompsBuf;
    colorFn?.(components, 0, color, 0);
    return colorSpace.getRgb(color, 0);
  }
};
var bCache = null;
function getB(count, onAllocation) {
  if (!onAllocation && bCache?.has(count)) return bCache.get(count);
  onAllocation?.(64 + (count + 1) * 64);
  const values = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, t_ = 1 - t;
    return new Float32Array([
      t_ ** 3,
      3 * t * t_ ** 2,
      3 * t ** 2 * t_,
      t ** 3
    ]);
  });
  if (!onAllocation) (bCache ??= /* @__PURE__ */ new Map()).set(count, values);
  return values;
}
var MeshShading = class _MeshShading extends BaseShading {
  static MIN_SPLIT_PATCH_CHUNKS_AMOUNT = 3;
  static MAX_SPLIT_PATCH_CHUNKS_AMOUNT = 20;
  // Count of triangles per entire mesh bounds.
  static TRIANGLE_DENSITY = 20;
  constructor(shadingType, stream, context, rowVertices) {
    super();
    context.onAllocation?.(512);
    this.onAllocation = context.onAllocation;
    this.shadingType = shadingType;
    this.bbox = this.background = null;
    this.coords = [];
    this.colors = [];
    this.figures = [];
    const reader = new MeshStreamReader(stream, context);
    let patchMesh = false;
    switch (this.shadingType) {
      case ShadingType.FREE_FORM_MESH:
        this._decodeType4Shading(reader);
        break;
      case ShadingType.LATTICE_FORM_MESH:
        const verticesPerRow = rowVertices | 0;
        if (verticesPerRow < 2) {
          throw new FormatError("Invalid VerticesPerRow");
        }
        this._decodeType5Shading(reader, verticesPerRow);
        break;
      case ShadingType.COONS_PATCH_MESH:
        this._decodeType6Shading(reader);
        patchMesh = true;
        break;
      case ShadingType.TENSOR_PATCH_MESH:
        this._decodeType7Shading(reader);
        patchMesh = true;
        break;
      default:
        unreachable("Unsupported mesh type.");
        break;
    }
    if (patchMesh) {
      this._updateBounds();
      for (let i = 0, ii = this.figures.length; i < ii; i++) {
        this._buildFigureFromPatch(i);
      }
    }
    this._updateBounds();
    this._packData();
  }
  _decodeType4Shading(reader) {
    const coords = this.coords;
    const colors = this.colors;
    const ps = [];
    let verticesLeft = 0;
    while (reader.hasData) {
      this.onAllocation?.(128);
      const f = reader.readFlag();
      const coord = reader.readCoordinate();
      const color = reader.readComponents();
      if (verticesLeft === 0) {
        if (!(0 <= f && f <= 2)) {
          throw new FormatError("Unknown type4 flag");
        }
        switch (f) {
          case 0:
            verticesLeft = 3;
            break;
          case 1:
            ps.push(ps.at(-2), ps.at(-1));
            verticesLeft = 1;
            break;
          case 2:
            ps.push(ps.at(-3), ps.at(-1));
            verticesLeft = 1;
            break;
        }
      }
      ps.push(coords.length);
      coords.push(coord);
      colors.push(color);
      verticesLeft--;
      reader.align();
    }
    this.onAllocation?.(128 + ps.length * 8);
    this.figures.push({
      type: MeshFigureType.TRIANGLES,
      coords: new Int32Array(ps),
      colors: new Int32Array(ps)
    });
  }
  _decodeType5Shading(reader, verticesPerRow) {
    const coords = this.coords;
    const colors = this.colors;
    const ps = [];
    while (reader.hasData) {
      this.onAllocation?.(128);
      const coord = reader.readCoordinate();
      const color = reader.readComponents();
      ps.push(coords.length);
      coords.push(coord);
      colors.push(color);
    }
    this.onAllocation?.(128 + ps.length * 8);
    this.figures.push({
      type: MeshFigureType.LATTICE,
      coords: new Int32Array(ps),
      colors: new Int32Array(ps),
      verticesPerRow
    });
  }
  _decodeType6Shading(reader, single = false) {
    const coords = this.coords;
    const colors = this.colors;
    this.onAllocation?.(80);
    const ps = new Int32Array(16);
    const cs = new Int32Array(4);
    if (single && coords.length) {
      for (let i = 0; i < 16; i++) ps[i] = i;
      for (let i = 0; i < 4; i++) cs[i] = i;
    }
    while (reader.hasData) {
      this.onAllocation?.(128);
      const f = reader.readFlag();
      if (!(0 <= f && f <= 3)) {
        throw new FormatError("Unknown type6 flag");
      }
      const pi = coords.length;
      for (let i = 0, ii = f !== 0 ? 8 : 12; i < ii; i++) {
        coords.push(reader.readCoordinate());
      }
      const ci = colors.length;
      for (let i = 0, ii = f !== 0 ? 2 : 4; i < ii; i++) {
        colors.push(reader.readComponents());
      }
      let tmp1, tmp2, tmp3, tmp4;
      switch (f) {
        // prettier-ignore
        case 0:
          ps[12] = pi + 3;
          ps[13] = pi + 4;
          ps[14] = pi + 5;
          ps[15] = pi + 6;
          ps[8] = pi + 2;
          ps[11] = pi + 7;
          ps[4] = pi + 1;
          ps[7] = pi + 8;
          ps[0] = pi;
          ps[1] = pi + 11;
          ps[2] = pi + 10;
          ps[3] = pi + 9;
          cs[2] = ci + 1;
          cs[3] = ci + 2;
          cs[0] = ci;
          cs[1] = ci + 3;
          break;
        // prettier-ignore
        case 1:
          tmp1 = ps[12];
          tmp2 = ps[13];
          tmp3 = ps[14];
          tmp4 = ps[15];
          ps[12] = tmp4;
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = tmp3;
          ps[11] = pi + 3;
          ps[4] = tmp2;
          ps[7] = pi + 4;
          ps[0] = tmp1;
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          tmp1 = cs[2];
          tmp2 = cs[3];
          cs[2] = tmp2;
          cs[3] = ci;
          cs[0] = tmp1;
          cs[1] = ci + 1;
          break;
        // prettier-ignore
        case 2:
          tmp1 = ps[15];
          tmp2 = ps[11];
          ps[12] = ps[3];
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = ps[7];
          ps[11] = pi + 3;
          ps[4] = tmp2;
          ps[7] = pi + 4;
          ps[0] = tmp1;
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          tmp1 = cs[3];
          cs[2] = cs[1];
          cs[3] = ci;
          cs[0] = tmp1;
          cs[1] = ci + 1;
          break;
        // prettier-ignore
        case 3:
          ps[12] = ps[0];
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = ps[1];
          ps[11] = pi + 3;
          ps[4] = ps[2];
          ps[7] = pi + 4;
          ps[0] = ps[3];
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          cs[2] = cs[0];
          cs[3] = ci;
          cs[0] = cs[1];
          cs[1] = ci + 1;
          break;
      }
      this.onAllocation?.(256);
      ps[5] = coords.length;
      coords.push([
        (-4 * coords[ps[0]][0] - coords[ps[15]][0] + 6 * (coords[ps[4]][0] + coords[ps[1]][0]) - 2 * (coords[ps[12]][0] + coords[ps[3]][0]) + 3 * (coords[ps[13]][0] + coords[ps[7]][0])) / 9,
        (-4 * coords[ps[0]][1] - coords[ps[15]][1] + 6 * (coords[ps[4]][1] + coords[ps[1]][1]) - 2 * (coords[ps[12]][1] + coords[ps[3]][1]) + 3 * (coords[ps[13]][1] + coords[ps[7]][1])) / 9
      ]);
      ps[6] = coords.length;
      coords.push([
        (-4 * coords[ps[3]][0] - coords[ps[12]][0] + 6 * (coords[ps[2]][0] + coords[ps[7]][0]) - 2 * (coords[ps[0]][0] + coords[ps[15]][0]) + 3 * (coords[ps[4]][0] + coords[ps[14]][0])) / 9,
        (-4 * coords[ps[3]][1] - coords[ps[12]][1] + 6 * (coords[ps[2]][1] + coords[ps[7]][1]) - 2 * (coords[ps[0]][1] + coords[ps[15]][1]) + 3 * (coords[ps[4]][1] + coords[ps[14]][1])) / 9
      ]);
      ps[9] = coords.length;
      coords.push([
        (-4 * coords[ps[12]][0] - coords[ps[3]][0] + 6 * (coords[ps[8]][0] + coords[ps[13]][0]) - 2 * (coords[ps[0]][0] + coords[ps[15]][0]) + 3 * (coords[ps[11]][0] + coords[ps[1]][0])) / 9,
        (-4 * coords[ps[12]][1] - coords[ps[3]][1] + 6 * (coords[ps[8]][1] + coords[ps[13]][1]) - 2 * (coords[ps[0]][1] + coords[ps[15]][1]) + 3 * (coords[ps[11]][1] + coords[ps[1]][1])) / 9
      ]);
      ps[10] = coords.length;
      coords.push([
        (-4 * coords[ps[15]][0] - coords[ps[0]][0] + 6 * (coords[ps[11]][0] + coords[ps[14]][0]) - 2 * (coords[ps[12]][0] + coords[ps[3]][0]) + 3 * (coords[ps[2]][0] + coords[ps[8]][0])) / 9,
        (-4 * coords[ps[15]][1] - coords[ps[0]][1] + 6 * (coords[ps[11]][1] + coords[ps[14]][1]) - 2 * (coords[ps[12]][1] + coords[ps[3]][1]) + 3 * (coords[ps[2]][1] + coords[ps[8]][1])) / 9
      ]);
      this.onAllocation?.(128 + (ps.length + cs.length) * 4);
      this.figures.push({
        type: MeshFigureType.PATCH,
        coords: new Int32Array(ps),
        // making copies of ps and cs
        colors: new Int32Array(cs)
      });
      if (single) break;
    }
  }
  _decodeType7Shading(reader, single = false) {
    const coords = this.coords;
    const colors = this.colors;
    this.onAllocation?.(80);
    const ps = new Int32Array(16);
    const cs = new Int32Array(4);
    if (single && coords.length) {
      for (let i = 0; i < 16; i++) ps[i] = i;
      for (let i = 0; i < 4; i++) cs[i] = i;
    }
    while (reader.hasData) {
      this.onAllocation?.(128);
      const f = reader.readFlag();
      if (!(0 <= f && f <= 3)) {
        throw new FormatError("Unknown type7 flag");
      }
      const pi = coords.length;
      for (let i = 0, ii = f !== 0 ? 12 : 16; i < ii; i++) {
        coords.push(reader.readCoordinate());
      }
      const ci = colors.length;
      for (let i = 0, ii = f !== 0 ? 2 : 4; i < ii; i++) {
        colors.push(reader.readComponents());
      }
      let tmp1, tmp2, tmp3, tmp4;
      switch (f) {
        // prettier-ignore
        case 0:
          ps[12] = pi + 3;
          ps[13] = pi + 4;
          ps[14] = pi + 5;
          ps[15] = pi + 6;
          ps[8] = pi + 2;
          ps[9] = pi + 13;
          ps[10] = pi + 14;
          ps[11] = pi + 7;
          ps[4] = pi + 1;
          ps[5] = pi + 12;
          ps[6] = pi + 15;
          ps[7] = pi + 8;
          ps[0] = pi;
          ps[1] = pi + 11;
          ps[2] = pi + 10;
          ps[3] = pi + 9;
          cs[2] = ci + 1;
          cs[3] = ci + 2;
          cs[0] = ci;
          cs[1] = ci + 3;
          break;
        // prettier-ignore
        case 1:
          tmp1 = ps[12];
          tmp2 = ps[13];
          tmp3 = ps[14];
          tmp4 = ps[15];
          ps[12] = tmp4;
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = tmp3;
          ps[9] = pi + 9;
          ps[10] = pi + 10;
          ps[11] = pi + 3;
          ps[4] = tmp2;
          ps[5] = pi + 8;
          ps[6] = pi + 11;
          ps[7] = pi + 4;
          ps[0] = tmp1;
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          tmp1 = cs[2];
          tmp2 = cs[3];
          cs[2] = tmp2;
          cs[3] = ci;
          cs[0] = tmp1;
          cs[1] = ci + 1;
          break;
        // prettier-ignore
        case 2:
          tmp1 = ps[15];
          tmp2 = ps[11];
          ps[12] = ps[3];
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = ps[7];
          ps[9] = pi + 9;
          ps[10] = pi + 10;
          ps[11] = pi + 3;
          ps[4] = tmp2;
          ps[5] = pi + 8;
          ps[6] = pi + 11;
          ps[7] = pi + 4;
          ps[0] = tmp1;
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          tmp1 = cs[3];
          cs[2] = cs[1];
          cs[3] = ci;
          cs[0] = tmp1;
          cs[1] = ci + 1;
          break;
        // prettier-ignore
        case 3:
          ps[12] = ps[0];
          ps[13] = pi + 0;
          ps[14] = pi + 1;
          ps[15] = pi + 2;
          ps[8] = ps[1];
          ps[9] = pi + 9;
          ps[10] = pi + 10;
          ps[11] = pi + 3;
          ps[4] = ps[2];
          ps[5] = pi + 8;
          ps[6] = pi + 11;
          ps[7] = pi + 4;
          ps[0] = ps[3];
          ps[1] = pi + 7;
          ps[2] = pi + 6;
          ps[3] = pi + 5;
          cs[2] = cs[0];
          cs[3] = ci;
          cs[0] = cs[1];
          cs[1] = ci + 1;
          break;
      }
      this.onAllocation?.(128 + (ps.length + cs.length) * 4);
      this.figures.push({
        type: MeshFigureType.PATCH,
        coords: new Int32Array(ps),
        // making copies of ps and cs
        colors: new Int32Array(cs)
      });
      if (single) break;
    }
  }
  _buildFigureFromPatch(index) {
    const figure = this.figures[index];
    assert(
      figure.type === MeshFigureType.PATCH,
      "Unexpected patch mesh figure"
    );
    const coords = this.coords, colors = this.colors;
    const pi = figure.coords;
    const ci = figure.colors;
    const figureMinX = Math.min(
      coords[pi[0]][0],
      coords[pi[3]][0],
      coords[pi[12]][0],
      coords[pi[15]][0]
    );
    const figureMinY = Math.min(
      coords[pi[0]][1],
      coords[pi[3]][1],
      coords[pi[12]][1],
      coords[pi[15]][1]
    );
    const figureMaxX = Math.max(
      coords[pi[0]][0],
      coords[pi[3]][0],
      coords[pi[12]][0],
      coords[pi[15]][0]
    );
    const figureMaxY = Math.max(
      coords[pi[0]][1],
      coords[pi[3]][1],
      coords[pi[12]][1],
      coords[pi[15]][1]
    );
    let splitXBy = Math.ceil(
      (figureMaxX - figureMinX) * _MeshShading.TRIANGLE_DENSITY / (this.bounds[2] - this.bounds[0])
    );
    splitXBy = MathClamp(
      splitXBy,
      _MeshShading.MIN_SPLIT_PATCH_CHUNKS_AMOUNT,
      _MeshShading.MAX_SPLIT_PATCH_CHUNKS_AMOUNT
    );
    let splitYBy = Math.ceil(
      (figureMaxY - figureMinY) * _MeshShading.TRIANGLE_DENSITY / (this.bounds[3] - this.bounds[1])
    );
    splitYBy = MathClamp(
      splitYBy,
      _MeshShading.MIN_SPLIT_PATCH_CHUNKS_AMOUNT,
      _MeshShading.MAX_SPLIT_PATCH_CHUNKS_AMOUNT
    );
    const verticesPerRow = splitXBy + 1;
    this.onAllocation?.(128 + (splitYBy + 1) * verticesPerRow * 8);
    const figureCoords = new Int32Array((splitYBy + 1) * verticesPerRow);
    const figureColors = new Int32Array((splitYBy + 1) * verticesPerRow);
    let k = 0;
    const cl = new Uint8Array(3), cr = new Uint8Array(3);
    const c0 = colors[ci[0]], c1 = colors[ci[1]], c2 = colors[ci[2]], c3 = colors[ci[3]];
    const bRow = getB(splitYBy, this.onAllocation), bCol = getB(splitXBy, this.onAllocation);
    for (let row = 0; row <= splitYBy; row++) {
      cl[0] = (c0[0] * (splitYBy - row) + c2[0] * row) / splitYBy | 0;
      cl[1] = (c0[1] * (splitYBy - row) + c2[1] * row) / splitYBy | 0;
      cl[2] = (c0[2] * (splitYBy - row) + c2[2] * row) / splitYBy | 0;
      cr[0] = (c1[0] * (splitYBy - row) + c3[0] * row) / splitYBy | 0;
      cr[1] = (c1[1] * (splitYBy - row) + c3[1] * row) / splitYBy | 0;
      cr[2] = (c1[2] * (splitYBy - row) + c3[2] * row) / splitYBy | 0;
      for (let col = 0; col <= splitXBy; col++, k++) {
        if ((row === 0 || row === splitYBy) && (col === 0 || col === splitXBy)) {
          continue;
        }
        let x = 0, y = 0;
        let q = 0;
        for (let i = 0; i <= 3; i++) {
          for (let j = 0; j <= 3; j++, q++) {
            const m = bRow[row][i] * bCol[col][j];
            x += coords[pi[q]][0] * m;
            y += coords[pi[q]][1] * m;
          }
        }
        this.onAllocation?.(128);
        figureCoords[k] = coords.length;
        coords.push([x, y]);
        figureColors[k] = colors.length;
        const newColor = new Uint8Array(3);
        newColor[0] = (cl[0] * (splitXBy - col) + cr[0] * col) / splitXBy | 0;
        newColor[1] = (cl[1] * (splitXBy - col) + cr[1] * col) / splitXBy | 0;
        newColor[2] = (cl[2] * (splitXBy - col) + cr[2] * col) / splitXBy | 0;
        colors.push(newColor);
      }
    }
    figureCoords[0] = pi[0];
    figureColors[0] = ci[0];
    figureCoords[splitXBy] = pi[3];
    figureColors[splitXBy] = ci[1];
    figureCoords[verticesPerRow * splitYBy] = pi[12];
    figureColors[verticesPerRow * splitYBy] = ci[2];
    figureCoords[verticesPerRow * splitYBy + splitXBy] = pi[15];
    figureColors[verticesPerRow * splitYBy + splitXBy] = ci[3];
    this.figures[index] = {
      type: MeshFigureType.LATTICE,
      coords: figureCoords,
      colors: figureColors,
      verticesPerRow
    };
  }
  _updateBounds() {
    meshUpdateBounds(this);
  }
  _packData() {
    meshPackData(this);
  }
  getIR() {
    const { posData, colData, vertexCount } = buildMeshVertexData(
      this.coords,
      this.colors,
      this.figures,
      this.onAllocation
    );
    return [
      "Mesh",
      this.shadingType,
      posData,
      colData,
      vertexCount,
      this.bounds,
      this.bbox,
      this.background
    ];
  }
};
/** Incremental patch decoder and bounded tessellator using the same native
 * patch math as MeshShading. The owner supplies complete record bits and stages
 * patches when global bounds are needed for subdivision density. */
var MeshPatchDecoder = class {
  constructor() {
    this.mesh = Object.create(MeshShading.prototype);
    this.mesh.coords = []; this.mesh.colors = []; this.mesh.figures = [];
  }
  decode(type, reader, flag) {
    const mesh = this.mesh;
    const record = {hasData: true, readFlag: () => flag,
      readCoordinate: () => reader.readCoordinate(), readComponents: () => reader.readComponents()};
    mesh.figures.length = 0;
    if (type === 6) mesh._decodeType6Shading(record, true);
    else mesh._decodeType7Shading(record, true);
    const figure = mesh.figures[0];
    mesh.coords = Array.from(figure.coords, i => mesh.coords[i]);
    mesh.colors = Array.from(figure.colors, i => mesh.colors[i]);
    return {coordinates: new Float64Array(mesh.coords.flat()), colors: new Uint8Array(mesh.colors.flatMap(c => Array.from(c)))};
  }
  static vertices(patch, bounds) {
    const mesh = Object.create(MeshShading.prototype);
    mesh.coords = Array.from({length: 16}, (_, i) => [patch.coordinates[i * 2], patch.coordinates[i * 2 + 1]]);
    mesh.colors = Array.from({length: 4}, (_, i) => patch.colors.subarray(i * 3, i * 3 + 3));
    mesh.figures = [{type: MeshFigureType.PATCH, coords: Int32Array.from({length: 16}, (_, i) => i), colors: new Int32Array([0, 1, 2, 3])}];
    mesh.bounds = bounds;
    mesh._buildFigureFromPatch(0); mesh._packData();
    const {posData, colData, vertexCount} = buildMeshVertexData(mesh.coords, mesh.colors, mesh.figures);
    return {positions: posData, colors: colData, vertexCount};
  }
};
export {
  PSStackBasedInterpreter,
  TOKEN as PostScriptToken,
  MeshPatchDecoder,
  MeshStreamReader,
  CFFCompiler,
  CFFParser,
  CFFStrings,
  CMap,
  CalGrayCS,
  CalRGBCS,
  CipherTransformFactory,
  DeviceCmykCS,
  Dict,
  DrawOPS,
  FlateStream,
  LabCS,
  MacStandardGlyphOrdering,
  MeshShading,
  Name,
  PDF17,
  PDF20,
  PageViewport,
  Stream,
  StringStream,
  SymbolSetEncoding,
  Type1Font,
  Type1Parser,
  Type2Compiled,
  WinAnsiEncoding,
  ZapfDingbatsEncoding,
  buildPostScriptJsFunction,
  encodeToXmlString,
  getDingbatsGlyphsUnicode,
  getEncoding,
  getGlyphsUnicode,
  getMetrics,
  saslPrep
};

export class StoredType1CharString extends Type1CharString {
    constructor(stack, output) { super(); this.stack = stack; this.output = output; }
    *convertStep(encoded, subrs, seacAnalysisEnabled, position) {
    let i = position;
    ;
    ;
    let error = false;
    let wx, sbx, subrNumber;
    do {
        let value = (yield encoded.byte(i));
        if (value < 32) {
            if (value === 12) {
                value = (value << 8) + (yield encoded.byte(++i));
            }
            switch (value) {
                case 1:
                    if (!HINTING_ENABLED) {
                        (yield this.stack.clear());
                        break;
                    }
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.hstem));
                    break;
                case 3:
                    if (!HINTING_ENABLED) {
                        (yield this.stack.clear());
                        break;
                    }
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.vstem));
                    break;
                case 4:
                    if (this.flexing) {
                        if (this.stack.length < 1) {
                            error = true;
                            break;
                        }
                        const dy = (yield this.stack.pop());
                        (yield this.stack.push(0, dy));
                        break;
                    }
                    error = (yield* this.executeCommandSteps(1, COMMAND_MAP.vmoveto));
                    break;
                case 5:
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.rlineto));
                    break;
                case 6:
                    error = (yield* this.executeCommandSteps(1, COMMAND_MAP.hlineto));
                    break;
                case 7:
                    error = (yield* this.executeCommandSteps(1, COMMAND_MAP.vlineto));
                    break;
                case 8:
                    error = (yield* this.executeCommandSteps(6, COMMAND_MAP.rrcurveto));
                    break;
                case 9:
                    (yield this.stack.clear());
                    break;
                case 10:
                    if (this.stack.length < 1) {
                        error = true;
                        break;
                    }
                    subrNumber = (yield this.stack.pop());
                    if (!(yield subrs.get(subrNumber))) {
                        error = true;
                        break;
                    }
                    return { call: (yield subrs.get(subrNumber)), next: i + 1, error: false };
                    break;
                case 11: return { done: true, error: error };
                case 13:
                    if (this.stack.length < 2) {
                        error = true;
                        break;
                    }
                    wx = (yield this.stack.pop());
                    sbx = (yield this.stack.pop());
                    this.lsb = sbx;
                    this.width = wx;
                    (yield this.stack.push(wx, sbx));
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.hmoveto));
                    break;
                case 14:
                    (yield this.output.push(COMMAND_MAP.endchar[0]));
                    break;
                case 21:
                    if (this.flexing) {
                        break;
                    }
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.rmoveto));
                    break;
                case 22:
                    if (this.flexing) {
                        (yield this.stack.push(0));
                        break;
                    }
                    error = (yield* this.executeCommandSteps(1, COMMAND_MAP.hmoveto));
                    break;
                case 30:
                    error = (yield* this.executeCommandSteps(4, COMMAND_MAP.vhcurveto));
                    break;
                case 31:
                    error = (yield* this.executeCommandSteps(4, COMMAND_MAP.hvcurveto));
                    break;
                case (12 << 8) + 0:
                    (yield this.stack.clear());
                    break;
                case (12 << 8) + 1:
                    if (!HINTING_ENABLED) {
                        (yield this.stack.clear());
                        break;
                    }
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.vstem));
                    break;
                case (12 << 8) + 2:
                    if (!HINTING_ENABLED) {
                        (yield this.stack.clear());
                        break;
                    }
                    error = (yield* this.executeCommandSteps(2, COMMAND_MAP.hstem));
                    break;
                case (12 << 8) + 6:
                    if (seacAnalysisEnabled) {
                        const asb = (yield this.stack.at(-5));
                        this.seac = (yield this.stack.splice(-4, 4));
                        this.seac[0] += this.lsb - asb;
                        error = (yield* this.executeCommandSteps(0, COMMAND_MAP.endchar));
                    }
                    else {
                        error = (yield* this.executeCommandSteps(4, COMMAND_MAP.endchar));
                    }
                    break;
                case (12 << 8) + 7:
                    if (this.stack.length < 4) {
                        error = true;
                        break;
                    }
                    (yield this.stack.pop());
                    wx = (yield this.stack.pop());
                    const sby = (yield this.stack.pop());
                    sbx = (yield this.stack.pop());
                    this.lsb = sbx;
                    this.width = wx;
                    (yield this.stack.push(wx, sbx, sby));
                    error = (yield* this.executeCommandSteps(3, COMMAND_MAP.rmoveto));
                    break;
                case (12 << 8) + 12:
                    if (this.stack.length < 2) {
                        error = true;
                        break;
                    }
                    const num2 = (yield this.stack.pop());
                    const num1 = (yield this.stack.pop());
                    (yield this.stack.push(num1 / num2));
                    break;
                case (12 << 8) + 16:
                    if (this.stack.length < 2) {
                        error = true;
                        break;
                    }
                    subrNumber = (yield this.stack.pop());
                    const numArgs = (yield this.stack.pop());
                    if (subrNumber === 0 && numArgs === 3) {
                        const flexArgs = (yield this.stack.splice(-17, 17));
                        (yield this.stack.push(flexArgs[2] + flexArgs[0],
                        // bcp1x + rpx
                        flexArgs[3] + flexArgs[1],
                        // bcp1y + rpy
                        flexArgs[4],
                        // bcp2x
                        flexArgs[5],
                        // bcp2y
                        flexArgs[6],
                        // p2x
                        flexArgs[7],
                        // p2y
                        flexArgs[8],
                        // bcp3x
                        flexArgs[9],
                        // bcp3y
                        flexArgs[10],
                        // bcp4x
                        flexArgs[11],
                        // bcp4y
                        flexArgs[12],
                        // p3x
                        flexArgs[13],
                        // p3y
                        flexArgs[14]
                        // flexDepth
                        // 15 = finalx unused by flex
                        // 16 = finaly unused by flex
                        ));
                        error = (yield* this.executeCommandSteps(13, COMMAND_MAP.flex, true));
                        this.flexing = false;
                        (yield this.stack.push(flexArgs[15], flexArgs[16]));
                    }
                    else if (subrNumber === 1 && numArgs === 0) {
                        this.flexing = true;
                    }
                    break;
                case (12 << 8) + 17:
                    break;
                case (12 << 8) + 33:
                    (yield this.stack.clear());
                    break;
                default:
                    warn('Unknown type 1 charstring command of "' + value + '"');
                    break;
            }
            if (error) {
                break;
            }
            continue;
        }
        else if (value <= 246) {
            value -= 139;
        }
        else if (value <= 250) {
            value = (value - 247) * 256 + (yield encoded.byte(++i)) + 108;
        }
        else if (value <= 254) {
            value = -((value - 251) * 256) - (yield encoded.byte(++i)) - 108;
        }
        else {
            value = ((yield encoded.byte(++i)) & 255) << 24 | ((yield encoded.byte(++i)) & 255) << 16 | ((yield encoded.byte(++i)) & 255) << 8 | ((yield encoded.byte(++i)) & 255) << 0;
        }
        (yield this.stack.push(value));
    } while (false);
    return { next: i + 1, error: error };
}
*executeCommandSteps(howManyArgs, command, keepStack) {
    const stackLength = this.stack.length;
    if (howManyArgs > stackLength) {
        return true;
    }
    const start = stackLength - howManyArgs;
    for (let i = start; i < stackLength; i++) {
        let value = (yield this.stack.get(i));
        if (Number.isInteger(value)) {
            (yield this.output.push(28, value >> 8 & 255, value & 255));
        }
        else {
            value = 65536 * value | 0;
            (yield this.output.push(255, value >> 24 & 255, value >> 16 & 255, value >> 8 & 255, value & 255));
        }
    }
    (yield this.output.push(...command));
    if (keepStack) {
        (yield this.stack.splice(start, howManyArgs));
    }
    else {
        (yield this.stack.clear());
    }
    return false;
}
  }

export { recoverGlyphName };
