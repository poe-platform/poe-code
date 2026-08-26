import test from "node:test";
import { compare, native, virtual, type Probe } from "./harness.js";

const records = "zero\nfoo foo\nFOO\nfood\n\nother\nfoo!\nlast\n";
const probes: Probe[] = [];
const patterns = ["foo", "^foo", "foo|other", "", "o+", "missing"];
const flags = [[], ["-n"], ["-nbo"], ["-vc"], ["-vo"], ["-oi"], ["-w"], ["-x"], ["-C1"], ["-oC1"], ["--column", "-C1"], ["-m1", "-A2"], ["--count-matches", "-m2"], ["--json", "-C1"], ["--json", "-v", "-C1"], ["-c", "--include-zero"], ["--files-without-match"], ["-l0"], ["-q"]];
for (const pattern of patterns) for (const options of flags) probes.push({
  name: `matrix ${JSON.stringify([pattern, ...options])}`, args: [...options, pattern, "input"], files: { input: records },
});

for (const options of [["--crlf", "-nbo"], ["--crlf", "--json"], ["--null-data", "-nbo"], ["--null-data", "--json"], ["-a", "--json"], ["-a", "-nbo"]]) {
  for (const content of ["foo\r\nFOO\r\nfoo\r", "éfoo🙂foo\n", "foo\0other\0foo", [255, 102, 111, 111, 10, 195, 102, 111, 111]]) probes.push({
    name: `bytes ${JSON.stringify(options)} ${JSON.stringify(content)}`, args: [...options, "foo", "-"], stdin: content,
  });
}

const tree = {
  "a.txt": "foo\n", "b.log": "foo\n", ".dot": "foo\n", "src/a.txt": "foo\n", "src/b.log": "foo\n",
  "src/.dot": "foo\n", "src/deep/c.txt": "foo\n", ".hidden/a.txt": "foo\n", "build/a.txt": "foo\n",
};
for (const glob of ["*.txt", "!*.txt", "src/", "!src/", "src/**", "**/a.txt", "/src/*.txt", "!**/deep/**", "{src,build}/**", "[ab].*", "*", "**", ".hidden/**"]) {
  for (const options of [[], ["--hidden"], ["-g", "!src/**"]]) probes.push({
    name: `glob ${glob} ${options.join(" ")}`, args: ["--files", ...options, "-g", glob, "."], files: tree,
  });
}
for (const ignore of ["*.txt\n!src/a.txt\n", "src/\n!src/a.txt\n", "src/*\n!src/deep/\n", "**/a.txt\n", "[ab].*\n", "!.*\n", "build/**\n", "src\n!src/\n", "*.log\n!b.log\n"]) {
  for (const options of [[], ["--hidden"], ["-g", "*.txt"], ["--no-ignore"]]) probes.push({
    name: `ignore ${JSON.stringify(ignore)} ${options.join(" ")}`, args: ["--files", ...options, "."], files: { ...tree, ".ignore": ignore },
  });
}
for (const options of [[], ["-L"], ["-L", "--max-depth", "1"], ["-L", "-g", "*.txt"]]) probes.push({
  name: `links ${options.join(" ")}`, args: [...options, "foo", "."], files: tree, links: { "alias.txt": "a.txt", "dir-link": "src" },
});

for (const options of [["-c", "-l"], ["-l", "-c"], ["-v", "--count-matches"], ["-o", "--count-matches"], ["--column", "-N"], ["-N", "--column"], ["-w", "-x"], ["-x", "-w"], ["--json", "-q"]]) probes.push({
  name: `precedence ${options.join(" ")}`, args: [...options, "foo", "a", "b"], files: { a: records, b: "foo\n" },
});

let seed = 0x5eed;
const words = ["foo", "FOO", "café", "🙂foo", "other", "food", "", "foo foo"];
for (let sample = 0; sample < 12; sample++) {
  const content = Array.from({ length: 16 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return words[seed >>> 24 & 7]!;
  }).join("\n") + (sample % 2 ? "\n" : "");
  for (const options of [["--json", "-m2", "-C2"], ["--json", "-v", "-m2", "-C2"], ["-nbo", "-C2"], ["--column", "-v", "-C2"], ["-c", "-o", "-i"], ["-H", "--heading", "-C1"]]) probes.push({
    name: `seeded ${sample} ${options.join(" ")}`, args: [...options, "foo", "input"], files: { input: content },
  });
}
for (const options of [[], ["-a"], ["--binary"], ["--json"], ["-c"], ["--count-matches"], ["-l"], ["--files-without-match"], ["-q"], ["--json", "-q"]]) {
  for (const content of ["foo\0bar\nfoo\n", "no\nfoo\0bar\n", "no\0foo\n", "no\0bar\n", "foo\n" + "x".repeat(70000) + "\0foo\n"]) probes.push({
    name: `binary ${options.join(" ")} ${content.length} ${content.slice(0, 3)}`, args: [...options, "foo", "input"], files: { input: content },
  });
}
for (const chunkSize of [1, 2, 7]) for (const options of [["-nbo"], ["--json", "-C1"], ["--null-data", "-nbo"], ["--crlf", "--json"]]) probes.push({
  name: `chunks ${chunkSize} ${options.join(" ")}`, args: [...options, "foo", "-"], stdin: "éfoo🙂foo\r\nother\nfoo\n", chunkSize,
});
for (const options of [["--column", "--no-column"], ["--crlf", "--null-data", "-o"], ["-A1", "-C2"], ["-C2", "-A1"], ["-B1", "-C2"], ["--heading", "-n", "-C1"], ["--null", "-n", "-C1"], ["--json", "-q", "-m1"]]) probes.push({
  name: `extra precedence ${options.join(" ")}`, args: [...options, "foo", "input"], files: { input: records },
});

for (const options of [[], ["-q"], ["-l"], ["-c"], ["--files-without-match"], ["--json"], ["--json", "-q"]]) for (const paths of [["missing", "good"], ["good", "missing"]]) probes.push({
  name: `status ${options.join(" ")} ${paths.join(" ")}`, args: ["--no-messages", ...options, "foo", ...paths], files: { good: "foo\n" },
});
for (const options of [[], ["-q"], ["--files"], ["-g", "!loop"], ["--max-depth", "1"]]) probes.push({
  name: `loop continuation ${options.join(" ")}`, args: ["--no-messages", "-L", ...options, ...(options.includes("--files") ? [] : ["foo"]), "."],
  files: { "sub/inside": "foo\n", "z-good": "foo\n" }, links: { loop: "sub", "sub/back": ".." },
});
for (const options of [[], ["--hidden"], ["--no-ignore-dot"], ["--no-ignore-vcs"], ["-g", "*.txt"]]) probes.push({
  name: `ignore precedence ${options.join(" ")}`, args: ["--files", ...options, "."], files: {
    ...tree, ".gitignore": "*.txt\n", ".ignore": "!*.txt\n", ".rgignore": "src/a.txt\n", "src/.ignore": "*.txt\n", "src/.rgignore": "!a.txt\n",
  },
});
for (const content of ["foo\nx\ny\n", "foo\nx\ny", "foo\nx\n", "foo\nx\nfoo\n", "foo\nx\nfoo"]) for (const invert of [[], ["-v"]]) probes.push({
  name: `limited context ending ${JSON.stringify(content)} ${invert.join(" ")}`, args: ["--json", "-m1", "-A2", ...invert, "foo", "-"], stdin: content,
});
for (const pattern of [".", "�", ".*foo", "foo.*", "^foo", "foo$", "", "[^x]", "\\s", "foo|^foo", "\\$|foo", "[\\^$]|foo"]) for (const content of [[255, 102, 111, 111, 10], [102, 111, 111, 255, 10], [195, 102, 111, 111, 10], [...Buffer.from("�foo\n")], [226, 130, 102, 111, 111, 255, 10], [255, 255, 10]]) probes.push({
  name: `invalid UTF8 ${pattern} ${content.join(",")}`, args: ["-nbo", pattern, "-"], stdin: content,
});
for (const stdin of ["🙂é", "🙂é\n", "foo", "foo\n"]) for (const options of [["-nbo"], ["--json"], ["--count-matches"]]) probes.push({
  name: `empty byte matches ${JSON.stringify(stdin)} ${options.join(" ")}`, args: [...options, "", "-"], stdin,
});

const actual = virtual(probes);
for (const [index, probe] of probes.entries()) test(probe.name, () => compare(actual[index]!, native(probe), probe));
