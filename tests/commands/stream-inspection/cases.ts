import { fixture } from "./helpers.js";

const hex = (text: string): string => Buffer.from(text).toString("hex");

export const nativeCases = [
  fixture("log-newest-first", "tac", [], "one\ntwo\nthree\n"),
  fixture("unterminated-log", "tac", [], "one\ntwo"),
  fixture("before-records", "tac", ["--before", "--separator=::"], "::one::two::"),
  fixture("literal-overlapping", "tac", ["-s", "aba"], "XababababaYabaZ"),
  fixture("nul-records", "tac", ["-s", ""], Buffer.from([97, 0, 255, 0, 98])),
  fixture("binary-crlf", "tac", [], Buffer.from([255, 0, 128, 13, 10, 65, 10])),
  fixture("unicode-separator", "tac", ["-s", "💠"], "α💠東京💠z"),
  fixture("independent-files", "tac", ["left", "right"], "", { left: hex("a\nb"), right: hex("c\nd\n") }),
  fixture("shared-stdin-cursor", "tac", ["-", "-"], "a\nb\n"),
  fixture("literal-dash-file", "tac", ["--", "-named"], "", { "-named": hex("a\nb\n") }),
  fixture("default-stops", "expand", [], "name\tvalue\n\tindented\n"),
  fixture("initial-only", "expand", ["-it4"], " \tword\tkeep\n\t\tmore\n"),
  fixture("finite-stops", "expand", ["--tabs=2,5,9"], "\tX\tY\tZ\tQ\t\n"),
  fixture("repeat-origin", "expand", ["-t", "1,+8"], "\tX\tY\tZ\n"),
  fixture("repeat-multiple", "expand", ["-t", "2,4,/8"], "\tX\tY\tZ\n"),
  fixture("repeated-tab-options", "expand", ["-t", "2", "-t", "4", "-t", "+8"], "\tX\tY\tZ\n"),
  fixture("loose-stop-delimiters", "expand", ["-t", ",2,, 5, "], "\tX\tY\tZ"),
  fixture("backspace-carriage", "expand", ["-t4"], "abc\b\tX\r\tY\n"),
  fixture("binary-unicode", "expand", ["-t4"], Buffer.concat([Buffer.from("é東京\t"), Buffer.from([0, 255, 128, 9, 10])])),
  fixture("continuous-files", "expand", ["left", "right"], "", { left: hex("abc"), right: hex("\tZ\n") }),
  fixture("empty-tab-list", "expand", ["-t", ""], "\tX"),
  fixture("hard-wrap", "fold", ["--width=4"], "abcdefghij\n"),
  fixture("word-wrap", "fold", ["-sw5"], "ab cd ef ghijk\n"),
  fixture("tab-wide", "fold", ["-w4"], "abc\tX\rYZ\n"),
  fixture("byte-controls", "fold", ["-bw3"], "ab\r\b\tc\n"),
  fixture("column-controls", "fold", ["-w3"], "ab\bcd\refghi"),
  fixture("binary-unicode-width", "fold", ["-w3"], Buffer.concat([Buffer.from("é東京"), Buffer.from([0, 255, 128, 13, 10])])),
  fixture("blank-remainder", "fold", ["-sw7"], "abcd xy zzz\tq\n"),
  fixture("independent-file-width", "fold", ["-w4", "left", "right"], "", { left: hex("abc"), right: hex("def\n") }),
  fixture("one-column", "fold", ["-w1"], "\txy\b\rZ\n"),
  fixture("long-chunked-record", "fold", ["-bw127"], "X".repeat(33001)),
  fixture("raw-binary-markers", "strings", ["-a"], Buffer.from([0, 65, 66, 67, 68, 0, 255, 69, 70, 71, 72, 10])),
  fixture("minimum-runs", "strings", ["-a", "-n", "2"], "a\0bc\0def\0g"),
  fixture("invalid-utf8-splits", "strings", ["-a", "-n", "2"], Buffer.from([65, 66, 255, 67, 68, 128, 69, 70])),
  fixture("separate-files", "strings", ["-a", "left", "right"], "", { left: hex("abcd\0"), right: hex("efgh\0") }),
  fixture("unicode-ascii-markers", "strings", ["-a"], "αname東京value💠"),
];

export const appleDifferenceCases = [
  fixture("tab-in-string", "strings", ["-a", "-n", "2"], "ab\tcd\0"),
  fixture("offset-padding", "strings", ["-a", "-n", "2", "-t", "x"], "\0ab\0"),
  fixture("carriage-expand", "expand", ["-t4"], "X\r\tY\n"),
];
