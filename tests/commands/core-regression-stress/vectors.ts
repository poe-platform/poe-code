export interface Vector {
  name: string;
  command: "wc" | "realpath" | "cksum" | "sort";
  args: string[];
  stdin?: string;
  files?: Record<string, string>;
  directories?: string[];
  links?: Record<string, string>;
  env?: Record<string, string>;
}
const encoded = (text: string) => Buffer.from(text).toString("base64");
export const vectors: Vector[] = [];
for (const locale of ["C", "en_US.UTF-8"]) for (const [name, input] of [
  ["ascii", Buffer.from("one\ttwo\nthree\vfour\r\n")],
  ["unicode-spaces", Buffer.from("one\u2003two\u00a0three\u2060four\n")],
  ["bom", Buffer.from("\ufeffa\n")],
  ["invalid", Buffer.from([255, 97, 32, 195, 169, 10, 226, 130])],
  ["literal-replacement", Buffer.from("a\ufffdb\n")],
  ["empty", Buffer.alloc(0)],
] as const) for (const args of [["-m"], ["-w"], ["-lwmc"]]) {
  vectors.push({ name: `wc/${locale}/${name}/${args.join("")}`, command: "wc", args, stdin: input.toString("base64"), env: { LC_ALL: locale } });
}
vectors.push(
  { name: "wc/files-width", command: "wc", args: ["-lw", "one", "two", "empty"], files: { one: encoded("a b\n"), two: encoded("x\n".repeat(90)), empty: "" } },
  { name: "wc/posix-spaces", command: "wc", args: ["-w"], stdin: encoded("a\u00a0b\u2060c\n"), env: { LC_ALL: "en_US.UTF-8", POSIXLY_CORRECT: "1" } },
  { name: "wc/invalid-only", command: "wc", args: ["-wm"], stdin: "/w==", env: { LC_ALL: "en_US.UTF-8" } },
);
for (const [name, args, input] of [
  ["byte", [], "z\nA\na\n\n"],
  ["numeric", ["-n"], "99999999999999999999999\n-99999999999999999999999\n01\n1.0000000000000000001\n1\n"],
  ["numeric-stable", ["-sn"], "001 second\n1 first\n-0 last\n0 next\n"],
  ["key-reverse", ["-k2,2n", "-r"], "a 12\nz 2\nb -3\nc 12\n"],
  ["fold-unique", ["-fu"], "beta\nAlpha\nalpha\nBETA\n"],
  ["separator-key", ["-t:", "-k2,2n"], "a:12:x\nz:2:y\nb:-3:q\n"],
  ["zero", ["-z"], "z\u0000a\u0000\u0000a"],
  ["check-disorder", ["-c"], "b\na\n"],
  ["reverse", ["-r"], "1\n100\n2\n"],
] as const) vectors.push({ name: `sort/${name}`, command: "sort", args: [...args], stdin: encoded(input) });
vectors.push(
  { name: "sort/invalid-bytes", command: "sort", args: [], stdin: Buffer.from([255, 10, 128, 10, 65, 10]).toString("base64") },
  { name: "sort/inplace", command: "sort", args: ["-o", "input", "input"], files: { input: encoded("z\na\nb\n") } },
  { name: "sort/inplace-read-error", command: "sort", args: ["-o", "input", "input", "missing"], files: { input: encoded("z\na\nb\n") } },
  { name: "sort/stdout-read-error", command: "sort", args: ["input", "missing"], files: { input: encoded("z\na\nb\n") } },
);
for (const algorithm of ["crc", "md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) for (const file of [false, true]) {
  vectors.push({ name: `cksum/${algorithm}/${file ? "file" : "stdin"}`, command: "cksum", args: ["-a", algorithm, ...(file ? ["data"] : [])],
    ...(file ? { files: { data: "AP/DqQoNACo=" } } : { stdin: "AP/DqQoNACo=" }) });
}
vectors.push(
  { name: "cksum/empty", command: "cksum", args: [], stdin: "" },
  { name: "cksum/explicit-stdin-twice", command: "cksum", args: ["-a", "sha256", "-", "-"], stdin: encoded("abc") },
  { name: "cksum/escaped", command: "cksum", args: ["-a", "sha256", "line\nslash\\name"], files: { "line\nslash\\name": encoded("abc") } },
  { name: "cksum/zero", command: "cksum", args: ["-z", "-a", "sha256", "line\nslash\\name"], files: { "line\nslash\\name": encoded("abc") } },
);
for (const [name, args] of [
  ["relative", ["--relative-to=tree", "tree/file"]],
  ["symlink-parent", ["--relative-to=tree", "alias/../file"]],
  ["base-contained", ["--relative-base=tree", "tree/file"]],
  ["base-outside", ["--relative-to=tree", "--relative-base=elsewhere", "tree/file"]],
  ["missing-parent", ["-m", "--relative-to=tree", "tree/missing/sub/file"]],
  ["literal-dashes", ["--relative-to=.", "--", "--relative-to=literal"]],
  ["same", ["--relative-to=tree", "tree"]],
] as const) vectors.push({ name: `realpath/${name}`, command: "realpath", args: [...args], directories: ["tree/sub", "elsewhere"],
  files: { "tree/file": encoded("data"), "--relative-to=literal": encoded("literal") }, links: { alias: "tree/sub" } });
