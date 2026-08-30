export interface Fixture {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly encoding: string;
  readonly semantic: string;
}

function fixture(name: string, bytes: Uint8Array | string, mime: string, encoding: string, semantic: string): Fixture {
  return { name, bytes: typeof bytes === "string" ? Buffer.from(bytes) : bytes, mime, encoding, semantic };
}

const tar = Buffer.alloc(1024);
tar.write("hello.txt"); tar.write("0000644\0", 100); tar.write("0000000\0", 108); tar.write("0000000\0", 116);
tar.write("00000000000\0", 124); tar.write("00000000000\0", 136); tar.fill(32, 148, 156); tar[156] = 48;
tar.write("ustar\0", 257); tar.write("00", 263);
tar.write(tar.subarray(0, 512).reduce((total, value) => total + value, 0).toString(8).padStart(6, "0") + "\0 ", 148);
const elf = Buffer.alloc(64);
elf.set([127, 69, 76, 70, 2, 1, 1]); elf.writeUInt16LE(2, 16); elf.writeUInt16LE(62, 18); elf.writeUInt32LE(1, 20); elf.writeUInt16LE(64, 52);
const sqlite = Buffer.alloc(512);
sqlite.write("SQLite format 3\0"); sqlite.writeUInt16BE(512, 16); sqlite.set([1, 1, 0, 64, 32, 32], 18);
sqlite.writeUInt32BE(1, 28); sqlite.writeUInt32BE(4, 44); sqlite.writeUInt32BE(1, 56); sqlite.writeUInt32BE(3040000, 96);
const utf16le = Buffer.concat([Buffer.from([255, 254]), Buffer.from("Hello, 雪!\n", "utf16le")]);
const utf16be = Buffer.from(utf16le); utf16be.swap16();
const zip = Buffer.alloc(22); zip.set([80, 75, 5, 6]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=", "base64");
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const tiff = Buffer.from("49492a0008000000000000000000", "hex");
const webp = Buffer.alloc(30); webp.write("RIFF"); webp.writeUInt32LE(22, 4); webp.write("WEBPVP8X", 8); webp.writeUInt32LE(10, 16);
const pe = Buffer.alloc(256); pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64); pe.writeUInt16LE(0x8664, 68); pe.writeUInt16LE(2, 86);
const xz = Buffer.from("fd377a585a000000ff12d941000000001cdf44211fb6f37d010000000000595a", "hex");
const bzip = Buffer.from("425a683917724538509000000000", "hex");

export const fixtures: readonly Fixture[] = [
  fixture("empty", "", "inode/x-empty", "binary", "empty"),
  fixture("ascii", "Hello world.\n", "text/plain", "us-ascii", "ASCII text"),
  fixture("crlf", "Hello world.\r\nSecond line.\r\n", "text/plain", "us-ascii", "ASCII text"),
  fixture("utf8", "Hello, 雪!\n", "text/plain", "utf-8", "UTF-8"),
  fixture("utf8-bom", "\ufeffHello, 雪!\n", "text/plain", "utf-8", "UTF-8"),
  fixture("utf16le", utf16le, "text/plain", "utf-16le", "UTF-16.*little-endian"),
  fixture("utf16be", utf16be, "text/plain", "utf-16be", "UTF-16.*big-endian"),
  fixture("json-object", '{"hello":[1,true,null]}\n', "application/json", "us-ascii", "JSON"),
  fixture("json-array", '[1,{"snow":"雪"}]\n', "application/json", "utf-8", "JSON"),
  fixture("invalid-json", '{"hello":}\n', "text/plain", "us-ascii", "ASCII text"),
  fixture("nul", Buffer.from([0, 1, 2, 3, 255, 0]), "application/octet-stream", "binary", "data"),
  fixture("png", png, "image/png", "binary", "PNG image"),
  fixture("gif", gif, "image/gif", "binary", "GIF image"),
  fixture("jpeg", jpeg, "image/jpeg", "binary", "JPEG image"),
  fixture("webp", webp, "image/webp", "binary", "Web/P|WebP"),
  fixture("tiff", tiff, "image/tiff", "binary", "TIFF image"),
  fixture("pdf", Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1"), "application/pdf", "binary", "PDF document"),
  fixture("gzip", Buffer.from("1f8b0800000000000013f348cdc9c95728cf2fca49d1e302008ef831350d000000", "hex"), "application/gzip", "binary", "gzip compressed"),
  fixture("zip-empty", zip, "application/zip", "binary", "Zip archive"),
  fixture("xz-empty", xz, "application/x-xz", "binary", "XZ compressed"),
  fixture("bzip-empty", bzip, "application/x-bzip2", "binary", "bzip2 compressed"),
  fixture("tar", tar, "application/x-tar", "binary", "tar archive"),
  fixture("elf-header", elf, "application/x-executable", "binary", "ELF 64-bit.*executable"),
  fixture("pe-header", pe, "application/vnd.microsoft.portable-executable", "binary", "PE.*executable|executable.*PE"),
  fixture("wasm-empty", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), "application/wasm", "binary", "WebAssembly"),
  fixture("sqlite-header", sqlite, "application/vnd.sqlite3", "binary", "SQLite 3.x database"),
];
