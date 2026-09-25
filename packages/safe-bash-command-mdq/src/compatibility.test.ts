import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { mdq } from "./index.js";

// Independently captured from the pinned native mdq v0.10.0 oracle. Runtime
// verification uses only literal expectations and an in-memory filesystem.
const fixtures = [
  {
    "id": "argv-0",
    "argv": [
      "--wrap-width"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: a value is required for '--wrap-width <WRAP_WIDTH>' but none was supplied\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-1",
    "argv": [
      "--wrap-width",
      "-1"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '-1' found\n\n  tip: to pass '-1' as a value, use '-- -1'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-2",
    "argv": [
      "--wrap-width",
      "+2"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "hello\n",
    "stderr": ""
  },
  {
    "id": "argv-3",
    "argv": [
      "--wrap-width",
      "0"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "hello\n",
    "stderr": ""
  },
  {
    "id": "argv-4",
    "argv": [
      "--output"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: a value is required for '--output <OUTPUT>' but none was supplied\n  [possible values: markdown, md, json, plain]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-5",
    "argv": [
      "--output",
      "bogus"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'bogus' for '--output <OUTPUT>'\n  [possible values: markdown, md, json, plain]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-6",
    "argv": [
      "--output",
      "JSON"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'JSON' for '--output <OUTPUT>'\n  [possible values: markdown, md, json, plain]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-7",
    "argv": [
      "--output",
      "--quiet"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: a value is required for '--output <OUTPUT>' but none was supplied\n  [possible values: markdown, md, json, plain]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-8",
    "argv": [
      "--renumber-footnotes"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: a value is required for '--renumber-footnotes <RENUMBER_FOOTNOTES>' but none was supplied\n  [possible values: true, false]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-9",
    "argv": [
      "--renumber-footnotes",
      "1"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value '1' for '--renumber-footnotes <RENUMBER_FOOTNOTES>'\n  [possible values: true, false]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-10",
    "argv": [
      "--link-pos",
      "bogus"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'bogus' for '--link-pos <LINK_POS>'\n  [possible values: section, doc]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-11",
    "argv": [
      "--footnote-pos",
      "bad"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'bad' for '--footnote-pos <FOOTNOTE_POS>'\n  [possible values: section, doc]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-12",
    "argv": [
      "--link-format",
      "bad"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'bad' for '--link-format <LINK_FORMAT>'\n  [possible values: keep, inline, never-inline]\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-13",
    "argv": [
      "--quiet=true"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'true' for '--quiet' found; no more were expected\n\nUsage: mdq --quiet [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-14",
    "argv": [
      "--quiet",
      "--quiet"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: the argument '--quiet' cannot be used multiple times\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-15",
    "argv": [
      "-qq"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: the argument '--quiet' cannot be used multiple times\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-16",
    "argv": [
      "--output=md",
      "--output=plain"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: the argument '--output <OUTPUT>' cannot be used multiple times\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-17",
    "argv": [
      "--br",
      "--no-br"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: the argument '--br' cannot be used with '--no-br'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-18",
    "argv": [
      "--no-br",
      "--br"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: the argument '--no-br' cannot be used with '--br'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-19",
    "argv": [
      "--br=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--br' found; no more were expected\n\nUsage: mdq --br [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-20",
    "argv": [
      "--wat"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--wat' found\n\n  tip: to pass '--wat' as a value, use '-- --wat'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-21",
    "argv": [
      "--outputx"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--outputx' found\n\n  tip: a similar argument exists: '--output'\n\nUsage: mdq --output <OUTPUT> [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-22",
    "argv": [
      "-x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '-x' found\n\n  tip: to pass '-x' as a value, use '-- -x'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-23",
    "argv": [
      "-qojson"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "argv-24",
    "argv": [
      "-qh"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "Select and render specific elements in a Markdown document\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nArguments:\n  [selectors]               The selectors string\n  [MARKDOWN_FILE_PATHS]...  An optional list of Markdown files to parse, by path. If not provided, standard input will be used\n\nOptions:\n      --link-pos <LINK_POS>\n          Where to put link references [default: section] [possible values: section, doc]\n      --footnote-pos <FOOTNOTE_POS>\n          Where to put footnote references. Defaults to be same as --link-pos [possible values: section, doc]\n  -l, --link-format <LINK_FORMAT>\n          [default: never-inline] [possible values: keep, inline, never-inline]\n      --renumber-footnotes <RENUMBER_FOOTNOTES>\n          [default: true] [possible values: true, false]\n  -o, --output <OUTPUT>\n          Specifies the output format. Defaults to markdown [default: markdown] [possible values: markdown, md, json, plain]\n      --wrap-width <WRAP_WIDTH>\n          The number of characters to wrap text at. This is only valid when the output format is markdown\n  -q, --quiet\n          Quiet: do not print anything to stdout. The exit code will still be 0 if any elements match, and non-0 if none do\n      --[no]-br\n          Include breaks between elements in plain and markdown output mode\n  -h, --help\n          Print help (see more with '--help')\n  -V, --version\n          Print version\n",
    "stderr": ""
  },
  {
    "id": "argv-25",
    "argv": [
      "-qV"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "mdq 0.10.0\n",
    "stderr": ""
  },
  {
    "id": "argv-26",
    "argv": [
      "-hq"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "Select and render specific elements in a Markdown document\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nArguments:\n  [selectors]               The selectors string\n  [MARKDOWN_FILE_PATHS]...  An optional list of Markdown files to parse, by path. If not provided, standard input will be used\n\nOptions:\n      --link-pos <LINK_POS>\n          Where to put link references [default: section] [possible values: section, doc]\n      --footnote-pos <FOOTNOTE_POS>\n          Where to put footnote references. Defaults to be same as --link-pos [possible values: section, doc]\n  -l, --link-format <LINK_FORMAT>\n          [default: never-inline] [possible values: keep, inline, never-inline]\n      --renumber-footnotes <RENUMBER_FOOTNOTES>\n          [default: true] [possible values: true, false]\n  -o, --output <OUTPUT>\n          Specifies the output format. Defaults to markdown [default: markdown] [possible values: markdown, md, json, plain]\n      --wrap-width <WRAP_WIDTH>\n          The number of characters to wrap text at. This is only valid when the output format is markdown\n  -q, --quiet\n          Quiet: do not print anything to stdout. The exit code will still be 0 if any elements match, and non-0 if none do\n      --[no]-br\n          Include breaks between elements in plain and markdown output mode\n  -h, --help\n          Print help (see more with '--help')\n  -V, --version\n          Print version\n",
    "stderr": ""
  },
  {
    "id": "argv-27",
    "argv": [
      "-ojson"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"hello\"}]}]}",
    "stderr": ""
  },
  {
    "id": "argv-28",
    "argv": [
      "-lkeep"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "hello\n",
    "stderr": ""
  },
  {
    "id": "argv-29",
    "argv": [
      "--[no]-br"
    ],
    "stdin": "hello\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "error: invalid argument '--[no]-br'; use '--br' or '--no-br'.\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "argv-30",
    "argv": [
      "--output",
      "json",
      "--wrap-width",
      "2"
    ],
    "stdin": "hello\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "error: Can't set text width with JSON output format\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "query-0",
    "argv": [
      "# 猫"
    ],
    "stdin": "# 猫\n",
    "exitCode": 0,
    "stdout": "# 猫\n",
    "stderr": ""
  },
  {
    "id": "query-1",
    "argv": [
      "# Δ"
    ],
    "stdin": "# δ\n",
    "exitCode": 0,
    "stdout": "# δ\n",
    "stderr": ""
  },
  {
    "id": "query-2",
    "argv": [
      "# Σ"
    ],
    "stdin": "# ς\n",
    "exitCode": 0,
    "stdout": "# ς\n",
    "stderr": ""
  },
  {
    "id": "query-3",
    "argv": [
      "# s"
    ],
    "stdin": "# ſ\n",
    "exitCode": 0,
    "stdout": "# ſ\n",
    "stderr": ""
  },
  {
    "id": "query-4",
    "argv": [
      "# i"
    ],
    "stdin": "# İ\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "query-5",
    "argv": [
      "# I"
    ],
    "stdin": "# ı\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "query-6",
    "argv": [
      "# k"
    ],
    "stdin": "# K\n",
    "exitCode": 0,
    "stdout": "# K\n",
    "stderr": ""
  },
  {
    "id": "query-7",
    "argv": [
      "# ^ hello $"
    ],
    "stdin": "# hello\n",
    "exitCode": 0,
    "stdout": "# hello\n",
    "stderr": ""
  },
  {
    "id": "query-8",
    "argv": [
      "# ^ \"hello\" $"
    ],
    "stdin": "# hello\n",
    "exitCode": 0,
    "stdout": "# hello\n",
    "stderr": ""
  },
  {
    "id": "query-9",
    "argv": [
      "# \"\\`\""
    ],
    "stdin": "# ' quote\n",
    "exitCode": 0,
    "stdout": "# ' quote\n",
    "stderr": ""
  },
  {
    "id": "query-10",
    "argv": [
      "# /^\\w+$/"
    ],
    "stdin": "# 猫\n",
    "exitCode": 0,
    "stdout": "# 猫\n",
    "stderr": ""
  },
  {
    "id": "query-11",
    "argv": [
      "# /^\\d+$/"
    ],
    "stdin": "# ١٢\n",
    "exitCode": 0,
    "stdout": "# ١٢\n",
    "stderr": ""
  },
  {
    "id": "query-12",
    "argv": [
      "# /(?i)Σ/"
    ],
    "stdin": "# ς\n",
    "exitCode": 0,
    "stdout": "# ς\n",
    "stderr": ""
  },
  {
    "id": "query-13",
    "argv": [
      "# /(?s)hello.world/"
    ],
    "stdin": "# hello world\n",
    "exitCode": 0,
    "stdout": "# hello world\n",
    "stderr": ""
  },
  {
    "id": "query-14",
    "argv": [
      "P: /(?s)hello.world/"
    ],
    "stdin": "hello\nworld\n",
    "exitCode": 0,
    "stdout": "hello\nworld\n",
    "stderr": ""
  },
  {
    "id": "query-15",
    "argv": [
      "P: /(?m)^world/"
    ],
    "stdin": "hello\nworld\n",
    "exitCode": 0,
    "stdout": "hello\nworld\n",
    "stderr": ""
  },
  {
    "id": "query-16",
    "argv": [
      "P: /(?x) hello \\s+ world /"
    ],
    "stdin": "hello world\n",
    "exitCode": 0,
    "stdout": "hello world\n",
    "stderr": ""
  },
  {
    "id": "query-17",
    "argv": [
      "P: /(?i:hello)/"
    ],
    "stdin": "HELLO\n",
    "exitCode": 0,
    "stdout": "HELLO\n",
    "stderr": ""
  },
  {
    "id": "query-18",
    "argv": [
      "P: /\\p{Greek}+/"
    ],
    "stdin": "Καλημέρα\n",
    "exitCode": 0,
    "stdout": "Καλημέρα\n",
    "stderr": ""
  },
  {
    "id": "query-19",
    "argv": [
      "P: /\\p{Han}+/"
    ],
    "stdin": "猫\n",
    "exitCode": 0,
    "stdout": "猫\n",
    "stderr": ""
  },
  {
    "id": "query-20",
    "argv": [
      "P: /[a-z&&[^b]]+/"
    ],
    "stdin": "b\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "query-21",
    "argv": [
      "P: /(?<=a)b/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "query-22",
    "argv": [
      "P: /(a)\\1/"
    ],
    "stdin": "aa\n",
    "exitCode": 0,
    "stdout": "aa\n",
    "stderr": ""
  },
  {
    "id": "query-23",
    "argv": [
      "P: !s/(?P<word>hello)/${word}!/"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "hello!\n",
    "stderr": ""
  },
  {
    "id": "query-24",
    "argv": [
      "P: !s/^/x/"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "xhello\n",
    "stderr": ""
  },
  {
    "id": "query-25",
    "argv": [
      "P: !s/$/x/"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "hellox\n",
    "stderr": ""
  },
  {
    "id": "query-26",
    "argv": [
      "P: !s/()/x/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "xaxbx\n",
    "stderr": ""
  },
  {
    "id": "query-27",
    "argv": [
      "P: !s/o*/x/"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "xhxexlxlx\n",
    "stderr": ""
  },
  {
    "id": "query-28",
    "argv": [
      "P: !s/hello/hi/"
    ],
    "stdin": "**hello**\n",
    "exitCode": 0,
    "stdout": "**hi**\n",
    "stderr": ""
  },
  {
    "id": "query-29",
    "argv": [
      "P: !s/hello/hi/"
    ],
    "stdin": "he**ll**o\n",
    "exitCode": 0,
    "stdout": "hi\n",
    "stderr": ""
  },
  {
    "id": "query-30",
    "argv": [
      "P: /hello\\nworld/"
    ],
    "stdin": "hello\nworld\n",
    "exitCode": 0,
    "stdout": "hello\nworld\n",
    "stderr": ""
  },
  {
    "id": "query-31",
    "argv": [
      "> needle"
    ],
    "stdin": "> ```\n> needle\n> ```\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "query-32",
    "argv": [
      "- needle"
    ],
    "stdin": "- ```\n  needle\n  ```\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "query-33",
    "argv": [
      "> needle"
    ],
    "stdin": "> | h |\n> | --- |\n> | needle |\n",
    "exitCode": 0,
    "stdout": "> | h      |\n> |--------|\n> | needle |\n",
    "stderr": ""
  },
  {
    "id": "query-34",
    "argv": [
      "- needle"
    ],
    "stdin": "- | h |\n  | --- |\n  | needle |\n",
    "exitCode": 0,
    "stdout": "- | h      |\n  |--------|\n  | needle |\n",
    "stderr": ""
  },
  {
    "id": "parser-md-0",
    "argv": [],
    "stdin": "\\*literal\\* &amp; &copy;\n",
    "exitCode": 0,
    "stdout": "*literal* & ©\n",
    "stderr": ""
  },
  {
    "id": "parser-json-0",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "\\*literal\\* &amp; &copy;\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"*literal* & ©\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-1",
    "argv": [],
    "stdin": "Hello  \nworld\n",
    "exitCode": 0,
    "stdout": "Hello\nworld\n",
    "stderr": ""
  },
  {
    "id": "parser-json-1",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "Hello  \nworld\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"Hello\\nworld\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-2",
    "argv": [],
    "stdin": "Hello\\\nworld\n",
    "exitCode": 0,
    "stdout": "Hello\nworld\n",
    "stderr": ""
  },
  {
    "id": "parser-json-2",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "Hello\\\nworld\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"Hello\\nworld\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-3",
    "argv": [],
    "stdin": "a ~strike~ b\n",
    "exitCode": 0,
    "stdout": "a ~~strike~~ b\n",
    "stderr": ""
  },
  {
    "id": "parser-json-3",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "a ~strike~ b\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"a ~~strike~~ b\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-4",
    "argv": [],
    "stdin": "a ~~strike~~ b\n",
    "exitCode": 0,
    "stdout": "a ~~strike~~ b\n",
    "stderr": ""
  },
  {
    "id": "parser-json-4",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "a ~~strike~~ b\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"a ~~strike~~ b\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-5",
    "argv": [],
    "stdin": "<https://example.com> <me@example.com>\n",
    "exitCode": 0,
    "stdout": "<https://example.com> <me@example.com>\n",
    "stderr": ""
  },
  {
    "id": "parser-json-5",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "<https://example.com> <me@example.com>\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"<https://example.com> <me@example.com>\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-6",
    "argv": [],
    "stdin": "www.example.com and foo@example.com\n",
    "exitCode": 0,
    "stdout": "[www.example.com][1] and foo@example.com\n\n[1]: http://www.example.com\n",
    "stderr": ""
  },
  {
    "id": "parser-json-6",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "www.example.com and foo@example.com\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"[www.example.com][1] and foo@example.com\"}]}],\"links\":{\"1\":{\"url\":\"http://www.example.com\"}}}",
    "stderr": ""
  },
  {
    "id": "parser-md-7",
    "argv": [],
    "stdin": "https://example.com/page(foo).\n",
    "exitCode": 0,
    "stdout": "https://example.com/page(foo).\n",
    "stderr": ""
  },
  {
    "id": "parser-json-7",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "https://example.com/page(foo).\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"https://example.com/page(foo).\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-8",
    "argv": [],
    "stdin": "```python\tname\nhello\n```\n",
    "exitCode": 0,
    "stdout": "```python name\nhello\n```\n",
    "stderr": ""
  },
  {
    "id": "parser-json-8",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "```python\tname\nhello\n```\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"code_block\":{\"code\":\"hello\",\"type\":\"code\",\"language\":\"python\",\"metadata\":\"name\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-9",
    "argv": [],
    "stdin": "```python    name\nhello\n```\n",
    "exitCode": 0,
    "stdout": "```python name\nhello\n```\n",
    "stderr": ""
  },
  {
    "id": "parser-json-9",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "```python    name\nhello\n```\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"code_block\":{\"code\":\"hello\",\"type\":\"code\",\"language\":\"python\",\"metadata\":\"name\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-10",
    "argv": [],
    "stdin": "    code\n",
    "exitCode": 0,
    "stdout": "```\ncode\n```\n",
    "stderr": ""
  },
  {
    "id": "parser-json-10",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "    code\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"code_block\":{\"code\":\"code\",\"type\":\"code\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-11",
    "argv": [],
    "stdin": "~~~\na ``` b\n~~~\n",
    "exitCode": 0,
    "stdout": "```\na ``` b\n```\n",
    "stderr": ""
  },
  {
    "id": "parser-json-11",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "~~~\na ``` b\n~~~\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"code_block\":{\"code\":\"a ``` b\",\"type\":\"code\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-12",
    "argv": [],
    "stdin": "`a``b`\n",
    "exitCode": 0,
    "stdout": "```a``b```\n",
    "stderr": ""
  },
  {
    "id": "parser-json-12",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "`a``b`\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"```a``b```\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-13",
    "argv": [],
    "stdin": "`` `hi` ``\n",
    "exitCode": 0,
    "stdout": "`` `hi` ``\n",
    "stderr": ""
  },
  {
    "id": "parser-json-13",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "`` `hi` ``\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"`` `hi` ``\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-14",
    "argv": [],
    "stdin": "##\n",
    "exitCode": 0,
    "stdout": "##\n",
    "stderr": ""
  },
  {
    "id": "parser-json-14",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "##\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"section\":{\"depth\":2,\"title\":\"\",\"body\":[]}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-15",
    "argv": [],
    "stdin": "---\ntitle: a\n...\n",
    "exitCode": 0,
    "stdout": "   -----\n\ntitle: a\n...\n",
    "stderr": ""
  },
  {
    "id": "parser-json-15",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "---\ntitle: a\n...\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"thematic_break\":null},{\"paragraph\":\"title: a\\n...\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-16",
    "argv": [],
    "stdin": "# header\n\n---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "# header\n\n   -----\n\n## x: y\n",
    "stderr": ""
  },
  {
    "id": "parser-json-16",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "# header\n\n---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"section\":{\"depth\":1,\"title\":\"header\",\"body\":[{\"thematic_break\":null},{\"section\":{\"depth\":2,\"title\":\"x: y\",\"body\":[]}}]}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-17",
    "argv": [],
    "stdin": "  ---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "   -----\n\n## x: y\n",
    "stderr": ""
  },
  {
    "id": "parser-json-17",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "  ---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"thematic_break\":null},{\"section\":{\"depth\":2,\"title\":\"x: y\",\"body\":[]}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-18",
    "argv": [],
    "stdin": "\n---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "---\nx: y\n---\n",
    "stderr": ""
  },
  {
    "id": "parser-json-18",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "\n---\nx: y\n---\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"front_matter\":{\"body\":\"x: y\",\"variant\":\"yaml\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-19",
    "argv": [],
    "stdin": "+++\ntitle = \"A\"\n+++\n",
    "exitCode": 0,
    "stdout": "+++\ntitle = \"A\"\n+++\n",
    "stderr": ""
  },
  {
    "id": "parser-json-19",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "+++\ntitle = \"A\"\n+++\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"front_matter\":{\"body\":\"title = \\\"A\\\"\",\"variant\":\"toml\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-20",
    "argv": [],
    "stdin": "- [X] uppercase\n- [ ] unchecked\n",
    "exitCode": 0,
    "stdout": "- [x] uppercase\n- [ ] unchecked\n",
    "stderr": ""
  },
  {
    "id": "parser-json-20",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "- [X] uppercase\n- [ ] unchecked\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"list\":[{\"item\":[{\"paragraph\":\"uppercase\"}],\"checked\":true},{\"item\":[{\"paragraph\":\"unchecked\"}],\"checked\":false}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-21",
    "argv": [],
    "stdin": "- [x]\n- [] empty\n",
    "exitCode": 0,
    "stdout": "- [x]\n- [] empty\n",
    "stderr": ""
  },
  {
    "id": "parser-json-21",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "- [x]\n- [] empty\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"list\":[{\"item\":[{\"paragraph\":\"[x]\"}]},{\"item\":[{\"paragraph\":\"[] empty\"}]}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-22",
    "argv": [],
    "stdin": "- outer\n  - inner\n    - deep\n",
    "exitCode": 0,
    "stdout": "- outer\n\n  - inner\n\n    - deep\n",
    "stderr": ""
  },
  {
    "id": "parser-json-22",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "- outer\n  - inner\n    - deep\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"list\":[{\"item\":[{\"paragraph\":\"outer\"},{\"list\":[{\"item\":[{\"paragraph\":\"inner\"},{\"list\":[{\"item\":[{\"paragraph\":\"deep\"}]}]}]}]}]}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-23",
    "argv": [],
    "stdin": "1. outer\n   1. inner\n",
    "exitCode": 0,
    "stdout": "1. outer\n\n   1. inner\n",
    "stderr": ""
  },
  {
    "id": "parser-json-23",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "1. outer\n   1. inner\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"list\":[{\"item\":[{\"paragraph\":\"outer\"},{\"list\":[{\"item\":[{\"paragraph\":\"inner\"}],\"index\":1}]}],\"index\":1}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-24",
    "argv": [],
    "stdin": "> - nested\n>   - inner\n",
    "exitCode": 0,
    "stdout": "> - nested\n>\n>   - inner\n",
    "stderr": ""
  },
  {
    "id": "parser-json-24",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "> - nested\n>   - inner\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"block_quote\":[{\"list\":[{\"item\":[{\"paragraph\":\"nested\"},{\"list\":[{\"item\":[{\"paragraph\":\"inner\"}]}]}]}]}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-25",
    "argv": [],
    "stdin": "- ## heading\n\n  para\n",
    "exitCode": 0,
    "stdout": "- ## heading\n\n  para\n",
    "stderr": ""
  },
  {
    "id": "parser-json-25",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "- ## heading\n\n  para\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"list\":[{\"item\":[{\"section\":{\"depth\":2,\"title\":\"heading\",\"body\":[{\"paragraph\":\"para\"}]}}]}]}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-26",
    "argv": [],
    "stdin": "| A | B |\n| - | - |\n| 1 | 2 | 3 |\n",
    "exitCode": 0,
    "stdout": "| A | B |\n|---|---|\n| 1 | 2 | 3 |",
    "stderr": ""
  },
  {
    "id": "parser-json-26",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "| A | B |\n| - | - |\n| 1 | 2 | 3 |\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"table\":{\"alignments\":[\"none\",\"none\"],\"rows\":[[\"A\",\"B\"],[\"1\",\"2\",\"3\"]]}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-27",
    "argv": [],
    "stdin": "| A | B |\n| - | - |\n| 1 |\n",
    "exitCode": 0,
    "stdout": "| A | B |\n|---|---|\n| 1 |",
    "stderr": ""
  },
  {
    "id": "parser-json-27",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "| A | B |\n| - | - |\n| 1 |\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"table\":{\"alignments\":[\"none\",\"none\"],\"rows\":[[\"A\",\"B\"],[\"1\"]]}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-28",
    "argv": [],
    "stdin": "foot[^NOTE]\n\n[^note]: body\n",
    "exitCode": 0,
    "stdout": "foot[^1]\n\n[^1]: \n",
    "stderr": ""
  },
  {
    "id": "parser-json-28",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "foot[^NOTE]\n\n[^note]: body\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"foot[^1]\"}]}],\"footnotes\":{\"1\":[]}}",
    "stderr": ""
  },
  {
    "id": "parser-md-29",
    "argv": [],
    "stdin": "foot[^ Note ]\n\n[^Note]: body\n",
    "exitCode": 0,
    "stdout": "foot[^1]\n\n[^1]: \n",
    "stderr": ""
  },
  {
    "id": "parser-json-29",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "foot[^ Note ]\n\n[^Note]: body\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"foot[^1]\"}]}],\"footnotes\":{\"1\":[]}}",
    "stderr": ""
  },
  {
    "id": "parser-md-30",
    "argv": [],
    "stdin": "[display][Ä]\n\n[ä]: /url\n",
    "exitCode": 0,
    "stdout": "[display][Ä]\n\n[Ä]: /url\n",
    "stderr": ""
  },
  {
    "id": "parser-json-30",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "[display][Ä]\n\n[ä]: /url\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"[display][Ä]\"}]}],\"links\":{\"Ä\":{\"url\":\"/url\"}}}",
    "stderr": ""
  },
  {
    "id": "parser-md-31",
    "argv": [],
    "stdin": "![**alt**](image.png \"title\")\n",
    "exitCode": 0,
    "stdout": "![alt][1]\n\n[1]: image.png \"title\"\n",
    "stderr": ""
  },
  {
    "id": "parser-json-31",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "![**alt**](image.png \"title\")\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"![alt][1]\"}]}],\"links\":{\"1\":{\"url\":\"image.png\",\"title\":\"title\"}}}",
    "stderr": ""
  },
  {
    "id": "parser-md-32",
    "argv": [],
    "stdin": "<span>a</span>\n",
    "exitCode": 0,
    "stdout": "<span>a</span>\n",
    "stderr": ""
  },
  {
    "id": "parser-json-32",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "<span>a</span>\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"<span>a</span>\"}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-33",
    "argv": [],
    "stdin": "<!-- comment -->\n",
    "exitCode": 0,
    "stdout": "<!-- comment -->\n",
    "stderr": ""
  },
  {
    "id": "parser-json-33",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "<!-- comment -->\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"html\":{\"value\":\"<!-- comment -->\"}}]}]}",
    "stderr": ""
  },
  {
    "id": "parser-md-34",
    "argv": [],
    "stdin": "$math$\n\n$$\nmath\n$$\n",
    "exitCode": 0,
    "stdout": "$math$\n\n$$\nmath\n$$\n",
    "stderr": ""
  },
  {
    "id": "parser-json-34",
    "argv": [
      "--output",
      "json"
    ],
    "stdin": "$math$\n\n$$\nmath\n$$\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"$math$\"},{\"paragraph\":\"$$\\nmath\\n$$\"}]}]}",
    "stderr": ""
  }
];

const extraFixtures = [
  {
    "id": "insert-before-emphasis",
    "argv": [
      "P: !s/^/x/"
    ],
    "stdin": "**hi**\n",
    "exitCode": 0,
    "stdout": "**xhi**\n",
    "stderr": ""
  },
  {
    "id": "insert-after-emphasis",
    "argv": [
      "P: !s/$/x/"
    ],
    "stdin": "**hi**\n",
    "exitCode": 0,
    "stdout": "**hi**x\n",
    "stderr": ""
  },
  {
    "id": "empty-matches-around-emphasis",
    "argv": [
      "P: !s/()/x/"
    ],
    "stdin": "a**b**c\n",
    "exitCode": 0,
    "stdout": "xaxbx**c**x\n",
    "stderr": ""
  },
  {
    "id": "empty-matches-within-code",
    "argv": [
      "P: !s/()/x/"
    ],
    "stdin": "`ab`\n",
    "exitCode": 0,
    "stdout": "`xaxbx`\n",
    "stderr": ""
  },
  {
    "id": "replace-within-code",
    "argv": [
      "P: !s/ab/x/"
    ],
    "stdin": "`ab`\n",
    "exitCode": 0,
    "stdout": "`x`\n",
    "stderr": ""
  },
  {
    "id": "replace-within-link",
    "argv": [
      "P: !s/ab/x/"
    ],
    "stdin": "[ab](/url)\n",
    "exitCode": 0,
    "stdout": "[x][1]\n\n[1]: /url\n",
    "stderr": ""
  },
  {
    "id": "insert-before-code",
    "argv": [
      "P: !s/^/x/"
    ],
    "stdin": "`ab`\n",
    "exitCode": 0,
    "stdout": "`xab`\n",
    "stderr": ""
  },
  {
    "id": "insert-after-code",
    "argv": [
      "P: !s/$/x/"
    ],
    "stdin": "`ab`\n",
    "exitCode": 0,
    "stdout": "`ab`x\n",
    "stderr": ""
  },
  {
    "id": "insert-before-autolink",
    "argv": [
      "P: !s/^/x/"
    ],
    "stdin": "<https://example.com>\n",
    "exitCode": 0,
    "stdout": "<xhttps://example.com>\n",
    "stderr": ""
  },
  {
    "id": "replace-within-autolink",
    "argv": [
      "P: !s/https:/http:/"
    ],
    "stdin": "<https://example.com>\n",
    "exitCode": 0,
    "stdout": "<http://example.com>\n",
    "stderr": ""
  },
  {
    "id": "quote-code-not-text",
    "argv": [
      "> *"
    ],
    "stdin": "> ```\n> needle\n> ```\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "list-code-not-text",
    "argv": [
      "- *"
    ],
    "stdin": "- ```\n  needle\n  ```\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "replace-unicode-within-emphasis",
    "argv": [
      "P: !s/./x/"
    ],
    "stdin": "α**β**γ\n",
    "exitCode": 0,
    "stdout": "x**x**x\n",
    "stderr": ""
  },
  {
    "id": "regex-class-intersection",
    "argv": [
      "P: /[a-z&&[^b]]+/"
    ],
    "stdin": "a\n",
    "exitCode": 0,
    "stdout": "a\n",
    "stderr": ""
  }
];

const deepFixtures = [
  {
    "id": "lookahead",
    "argv": [
      "P: /foo(?=bar)/"
    ],
    "stdin": "foobar\n",
    "exitCode": 0,
    "stdout": "foobar\n",
    "stderr": ""
  },
  {
    "id": "lookahead-negative",
    "argv": [
      "P: /foo(?!bar)/"
    ],
    "stdin": "foobaz\n",
    "exitCode": 0,
    "stdout": "foobaz\n",
    "stderr": ""
  },
  {
    "id": "lookbehind",
    "argv": [
      "P: /(?<=foo)bar/"
    ],
    "stdin": "foobar\n",
    "exitCode": 0,
    "stdout": "foobar\n",
    "stderr": ""
  },
  {
    "id": "lookbehind-negative",
    "argv": [
      "P: /(?<!foo)bar/"
    ],
    "stdin": "xbar\n",
    "exitCode": 0,
    "stdout": "xbar\n",
    "stderr": ""
  },
  {
    "id": "backreference",
    "argv": [
      "P: /(ab)\\1/"
    ],
    "stdin": "abab\n",
    "exitCode": 0,
    "stdout": "abab\n",
    "stderr": ""
  },
  {
    "id": "named-angle",
    "argv": [
      "P: /(?<w>ab)\\k<w>/"
    ],
    "stdin": "abab\n",
    "exitCode": 0,
    "stdout": "abab\n",
    "stderr": ""
  },
  {
    "id": "named-python",
    "argv": [
      "P: /(?P<w>ab)(?P=w)/"
    ],
    "stdin": "abab\n",
    "exitCode": 0,
    "stdout": "abab\n",
    "stderr": ""
  },
  {
    "id": "numeric-g-backref",
    "argv": [
      "P: /(ab)\\g{1}/"
    ],
    "stdin": "abab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:11\n  |\n1 | P: /(ab)\\g{1}/\n  |           ^\n  |\n  = regex parse error: Could not parse group name\n"
  },
  {
    "id": "relative-backref",
    "argv": [
      "P: /(ab)\\k<-1>/"
    ],
    "stdin": "abab\n",
    "exitCode": 0,
    "stdout": "abab\n",
    "stderr": ""
  },
  {
    "id": "atomic-reject",
    "argv": [
      "P: /(?>a|ab)c/"
    ],
    "stdin": "abc\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "atomic-accept",
    "argv": [
      "P: /(?>ab|a)c/"
    ],
    "stdin": "abc\n",
    "exitCode": 0,
    "stdout": "abc\n",
    "stderr": ""
  },
  {
    "id": "possessive-reject",
    "argv": [
      "P: /a++a/"
    ],
    "stdin": "aaa\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "conditional-capture-yes",
    "argv": [
      "P: /(a)?(?(1)b|c)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "conditional-capture-no",
    "argv": [
      "P: /(a)?(?(1)b|c)/"
    ],
    "stdin": "c\n",
    "exitCode": 0,
    "stdout": "c\n",
    "stderr": ""
  },
  {
    "id": "conditional-named",
    "argv": [
      "P: /(?<a>a)?(?(a)b|c)/"
    ],
    "stdin": "c\n",
    "exitCode": 0,
    "stdout": "c\n",
    "stderr": ""
  },
  {
    "id": "conditional-lookahead",
    "argv": [
      "P: /(?(?=a)a|b)/"
    ],
    "stdin": "b\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:8\n  |\n1 | P: /(?(?=a)a|b)/\n  |        ^\n  |\n  = regex parse error: Target of repeat operator is invalid\n"
  },
  {
    "id": "comment",
    "argv": [
      "P: /a(?# ignored)b/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "continue",
    "argv": [
      "P: /\\Gabc/"
    ],
    "stdin": "xabc\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "reset",
    "argv": [
      "P: /a\\Kb/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "newline-sequence",
    "argv": [
      "P: /a\\Rb/"
    ],
    "stdin": "a\r\nb\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:6\n  |\n1 | P: /a\\Rb/\n  |      ^\n  |\n  = regex parse error: Invalid escape: \\R\n"
  },
  {
    "id": "hex-class",
    "argv": [
      "P: /\\h+/"
    ],
    "stdin": "abc123\n",
    "exitCode": 0,
    "stdout": "abc123\n",
    "stderr": ""
  },
  {
    "id": "not-hex-class",
    "argv": [
      "P: /\\H+/"
    ],
    "stdin": "xyz\n",
    "exitCode": 0,
    "stdout": "xyz\n",
    "stderr": ""
  },
  {
    "id": "digit-no-unicode",
    "argv": [
      "P: /(?-u)\\d/"
    ],
    "stdin": "١\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:8\n  |\n1 | P: /(?-u)\\d/\n  |        ^\n  |\n  = regex parse error: Disabling Unicode not supported\n"
  },
  {
    "id": "unicode-disabled-dot",
    "argv": [
      "P: /(?-u)./"
    ],
    "stdin": "é\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:8\n  |\n1 | P: /(?-u)./\n  |        ^\n  |\n  = regex parse error: Disabling Unicode not supported\n"
  },
  {
    "id": "unsupported-flag",
    "argv": [
      "P: /(?z)a/"
    ],
    "stdin": "a\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /(?z)a/\n  |       ^\n  |\n  = regex parse error: Unknown group flag: (?z\n"
  },
  {
    "id": "vertical-tab",
    "argv": [
      "P: /\\v/"
    ],
    "stdin": "\u000b\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "null-byte",
    "argv": [
      "P: /\\0/"
    ],
    "stdin": "\u0000\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /\\0/\n  |    ^--^\n  |\n  = Error compiling regex: Invalid back reference to group 0\n"
  },
  {
    "id": "octal",
    "argv": [
      "P: /\\012/"
    ],
    "stdin": "\n\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:6\n  |\n1 | P: /\\012/\n  |      ^\n  |\n  = regex parse error: Invalid back reference\n"
  },
  {
    "id": "quoted-literal",
    "argv": [
      "P: /\\Q[a]\\E/"
    ],
    "stdin": "[a]\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:5\n  |\n1 | P: /\\Q[a]\\E/\n  |     ^\n  |\n  = regex parse error: Invalid escape: \\Q\n"
  },
  {
    "id": "literal-closebrace",
    "argv": [
      "P: /a}/"
    ],
    "stdin": "a}\n",
    "exitCode": 0,
    "stdout": "a}\n",
    "stderr": ""
  },
  {
    "id": "literal-openbrace",
    "argv": [
      "P: /a{wat/"
    ],
    "stdin": "a{wat\n",
    "exitCode": 0,
    "stdout": "a{wat\n",
    "stderr": ""
  },
  {
    "id": "blank-group-repeated",
    "argv": [
      "P: /(?:)*a/"
    ],
    "stdin": "a\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | P: /(?:)*a/\n  |         ^\n  |\n  = regex parse error: Target of repeat operator is invalid\n"
  },
  {
    "id": "nested-quantifier",
    "argv": [
      "P: /a**/"
    ],
    "stdin": "a\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /a**/\n  |       ^\n  |\n  = regex parse error: Target of repeat operator is invalid\n"
  },
  {
    "id": "multiline-crlf",
    "argv": [
      "P: /(?mR)^b$/"
    ],
    "stdin": "a\r\nb\r\nc\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /(?mR)^b$/\n  |       ^\n  |\n  = regex parse error: Unknown group flag: (?mR\n"
  },
  {
    "id": "end-z",
    "argv": [
      "P: /a\\Z/"
    ],
    "stdin": "a\n\n\n",
    "exitCode": 0,
    "stdout": "a\n",
    "stderr": ""
  },
  {
    "id": "word-boundary-start",
    "argv": [
      "P: /\\<cat\\>/"
    ],
    "stdin": "cat\n",
    "exitCode": 0,
    "stdout": "cat\n",
    "stderr": ""
  },
  {
    "id": "property-category",
    "argv": [
      "P: /\\p{Ll}+/"
    ],
    "stdin": "abc\n",
    "exitCode": 0,
    "stdout": "abc\n",
    "stderr": ""
  },
  {
    "id": "property-lower",
    "argv": [
      "P: /\\p{greek}+/"
    ],
    "stdin": "αβ\n",
    "exitCode": 0,
    "stdout": "αβ\n",
    "stderr": ""
  },
  {
    "id": "property-sc-alias",
    "argv": [
      "P: /\\p{sc=Grek}+/"
    ],
    "stdin": "αβ\n",
    "exitCode": 0,
    "stdout": "αβ\n",
    "stderr": ""
  },
  {
    "id": "property-assigned",
    "argv": [
      "P: /\\p{Assigned}/"
    ],
    "stdin": "a\n",
    "exitCode": 0,
    "stdout": "a\n",
    "stderr": ""
  },
  {
    "id": "class-leading-close",
    "argv": [
      "P: /][]/"
    ],
    "stdin": "[\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:8\n  |\n1 | P: /][]/\n  |        ^\n  |\n  = regex parse error: Invalid character class\n"
  },
  {
    "id": "class-subtract",
    "argv": [
      "P: /[a-c--b]+/"
    ],
    "stdin": "abc\n",
    "exitCode": 0,
    "stdout": "abc\n",
    "stderr": ""
  },
  {
    "id": "class-symdiff",
    "argv": [
      "P: /[ab~~bc]+/"
    ],
    "stdin": "abc\n",
    "exitCode": 0,
    "stdout": "abc\n",
    "stderr": ""
  },
  {
    "id": "empty-class",
    "argv": [
      "P: /[]/"
    ],
    "stdin": "a\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /[]/\n  |       ^\n  |\n  = regex parse error: Invalid character class\n"
  },
  {
    "id": "empty-negative-class",
    "argv": [
      "P: /[^]/"
    ],
    "stdin": "a\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:8\n  |\n1 | P: /[^]/\n  |        ^\n  |\n  = regex parse error: Invalid character class\n"
  },
  {
    "id": "noncapture-empty",
    "argv": [
      "P: /(?i)/"
    ],
    "stdin": "a\n",
    "exitCode": 0,
    "stdout": "a\n",
    "stderr": ""
  },
  {
    "id": "flags-ignore-unicode-whitespace",
    "argv": [
      "P: /(?x) a  b/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "extended-escaped-space",
    "argv": [
      "P: /(?x)a\\ b/"
    ],
    "stdin": "a b\n",
    "exitCode": 0,
    "stdout": "a b\n",
    "stderr": ""
  },
  {
    "id": "extended-class-space",
    "argv": [
      "P: /(?x)[a b]+/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "unicode-group-name",
    "argv": [
      "P: /(?<猫>a)/"
    ],
    "stdin": "a\n",
    "exitCode": 0,
    "stdout": "a\n",
    "stderr": ""
  },
  {
    "id": "reset-replacement",
    "argv": [
      "P: !s/a\\Kb/x/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ax\n",
    "stderr": ""
  },
  {
    "id": "continue-replacement",
    "argv": [
      "P: !s/\\G./x/"
    ],
    "stdin": "abcd\n",
    "exitCode": 0,
    "stdout": "xxxx\n",
    "stderr": ""
  },
  {
    "id": "autolink-label-gates",
    "argv": [
      "[!s/example/wrong/]()"
    ],
    "stdin": "<https://example.com>\n",
    "exitCode": 0,
    "stdout": "<https://example.com>",
    "stderr": ""
  },
  {
    "id": "autolink-url-changes",
    "argv": [
      "[](!s/https/http/)"
    ],
    "stdin": "<https://example.com>\n",
    "exitCode": 0,
    "stdout": "<http://example.com>",
    "stderr": ""
  }
];

const validationFixtures = [
  {
    "id": "validation-0",
    "argv": [
      "P: /(?(2)a|b)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(?(2)a|b)/\n  |    ^---------^\n  |\n  = Error compiling regex: Invalid back reference to group 2\n"
  },
  {
    "id": "validation-1",
    "argv": [
      "P: /(?(0)a|b)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(?(0)a|b)/\n  |    ^---------^\n  |\n  = Error compiling regex: Invalid back reference to group 0\n"
  },
  {
    "id": "validation-2",
    "argv": [
      "P: /(?<w>a)\\k<missing>/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:14\n  |\n1 | P: /(?<w>a)\\k<missing>/\n  |              ^\n  |\n  = regex parse error: Invalid group name in back reference: missing\n"
  },
  {
    "id": "validation-3",
    "argv": [
      "P: /(?<w>a)(?(<missing>)b|c)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:15\n  |\n1 | P: /(?<w>a)(?(<missing>)b|c)/\n  |               ^\n  |\n  = regex parse error: Invalid group name in back reference: missing\n"
  },
  {
    "id": "validation-4",
    "argv": [
      "P: /(?P=missing)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | P: /(?P=missing)/\n  |         ^\n  |\n  = regex parse error: Invalid group name in back reference: missing\n"
  },
  {
    "id": "validation-5",
    "argv": [
      "P: /(/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:6\n  |\n1 | P: /(/\n  |      ^\n  |\n  = regex parse error: Opening parenthesis without closing parenthesis\n"
  },
  {
    "id": "validation-6",
    "argv": [
      "P: /a)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:6\n  |\n1 | P: /a)/\n  |      ^\n  |\n  = regex parse error: General parsing error: end of string not reached\n"
  },
  {
    "id": "validation-7",
    "argv": [
      "P: /[a/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /[a/\n  |       ^\n  |\n  = regex parse error: Invalid character class\n"
  },
  {
    "id": "validation-8",
    "argv": [
      "P: /[z-a]/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /[z-a]/\n  |    ^-----^\n  |\n  = Error compiling regex: Regex error: error parsing pattern 0\n"
  },
  {
    "id": "validation-9",
    "argv": [
      "P: /a{,2}/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-10",
    "argv": [
      "P: /a{,}/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-11",
    "argv": [
      "P: /\\x/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /\\x/\n  |       ^\n  |\n  = regex parse error: Invalid hex escape\n"
  },
  {
    "id": "validation-12",
    "argv": [
      "P: /\\x{ZZ}/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /\\x{ZZ}/\n  |       ^\n  |\n  = regex parse error: Invalid hex escape\n"
  },
  {
    "id": "validation-13",
    "argv": [
      "P: /\\p{NotAThing}/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /\\p{NotAThing}/\n  |    ^-------------^\n  |\n  = Error compiling regex: Regex error: error parsing pattern 0\n"
  },
  {
    "id": "validation-14",
    "argv": [
      "P: /(?q)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:7\n  |\n1 | P: /(?q)/\n  |       ^\n  |\n  = regex parse error: Unknown group flag: (?q\n"
  },
  {
    "id": "validation-15",
    "argv": [
      "P: /(?i-i)a/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-16",
    "argv": [
      "P: /(?i:a)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-17",
    "argv": [
      "P: /(?i:a/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:10\n  |\n1 | P: /(?i:a/\n  |          ^\n  |\n  = regex parse error: Opening parenthesis without closing parenthesis\n"
  },
  {
    "id": "validation-18",
    "argv": [
      "P: /(?:)*/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | P: /(?:)*/\n  |         ^\n  |\n  = regex parse error: Target of repeat operator is invalid\n"
  },
  {
    "id": "validation-19",
    "argv": [
      "P: /(a)\\k<+1>/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(a)\\k<+1>/\n  |    ^---------^\n  |\n  = Error compiling regex: Invalid back reference to group 2\n"
  },
  {
    "id": "validation-20",
    "argv": [
      "P: /\\1(a)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-21",
    "argv": [
      "P: /(\\1a)/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-22",
    "argv": [
      "P: /(?<a>ab)\\1/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(?<a>ab)\\1/\n  |    ^----------^\n  |\n  = Error compiling regex: Numbered backref/call not allowed because named group was used, use a named backref instead\n"
  },
  {
    "id": "validation-23",
    "argv": [
      "P: /(?<w>ab)\\g<w>/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(?<w>ab)\\g<w>/\n  |    ^-------------^\n  |\n  = Error compiling regex: Regex uses currently unimplemented feature: Subroutine Call\n"
  },
  {
    "id": "validation-24",
    "argv": [
      "P: /(ab)\\g<1>/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /(ab)\\g<1>/\n  |    ^---------^\n  |\n  = Error compiling regex: Regex uses currently unimplemented feature: Subroutine Call\n"
  },
  {
    "id": "validation-25",
    "argv": [
      "P: /(ab)\\k<1>/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-26",
    "argv": [
      "P: /(ab)\\k'1'/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-27",
    "argv": [
      "P: /(?<w>a)(?(<w>)b|c)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-28",
    "argv": [
      "P: /(?(a)b|c)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-29",
    "argv": [
      "P: /(?((?=a))a|b)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-30",
    "argv": [
      "P: /(a)?(?(1)b)/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-31",
    "argv": [
      "P: /(?<=a+)b/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-32",
    "argv": [
      "P: /(?<=a|bc)d/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-33",
    "argv": [
      "P: /(?<=(a))\\1/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-34",
    "argv": [
      "P: /[\\b]/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-35",
    "argv": [
      "P: /a{2,1}/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:4\n  |\n1 | P: /a{2,1}/\n  |    ^------^\n  |\n  = Error compiling regex: Regex error: error parsing pattern 0\n"
  },
  {
    "id": "validation-36",
    "argv": [
      "P: /a{2/"
    ],
    "stdin": "ab\n",
    "exitCode": 1,
    "stdout": "",
    "stderr": ""
  },
  {
    "id": "validation-37",
    "argv": [
      "P: /^*/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  },
  {
    "id": "validation-38",
    "argv": [
      "P: /()*/"
    ],
    "stdin": "ab\n",
    "exitCode": 0,
    "stdout": "ab\n",
    "stderr": ""
  }
];

const clapFixtures = [
  {
    "id": "clap-0",
    "argv": [
      "--quiet",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-1",
    "argv": [
      "--quiet",
      "--version=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--version' found; no more were expected\n\nUsage: mdq --version <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-2",
    "argv": [
      "--output",
      "json",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-3",
    "argv": [
      "# a",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-4",
    "argv": [
      "--br",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-5",
    "argv": [
      "--quiet",
      "--quiet=true"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'true' for '--quiet' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-6",
    "argv": [
      "--output",
      "json",
      "--quiet=true"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'true' for '--quiet' found; no more were expected\n\nUsage: mdq --quiet [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-7",
    "argv": [
      "--quiet",
      "--bogus"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--bogus' found\n\n  tip: to pass '--bogus' as a value, use '-- --bogus'\n\nUsage: mdq --quiet [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-8",
    "argv": [
      "# a",
      "--outputx"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--outputx' found\n\n  tip: a similar argument exists: '--output'\n\nUsage: mdq --output <OUTPUT> <selectors> [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-9",
    "argv": [
      "- item",
      "--wat"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--wat' found\n\n  tip: to pass '--wat' as a value, use '-- --wat'\n\nUsage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-10",
    "argv": [
      "--output",
      "mdx"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'mdx' for '--output <OUTPUT>'\n  [possible values: markdown, md, json, plain]\n\n  tip: a similar value exists: 'md'\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-11",
    "argv": [
      "-o=json"
    ],
    "stdin": "hello\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"document\":[{\"paragraph\":\"hello\"}]}]}",
    "stderr": ""
  },
  {
    "id": "clap-12",
    "argv": [
      "--wrap-width=bad"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value 'bad' for '--wrap-width <WRAP_WIDTH>': invalid digit found in string\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-13",
    "argv": [
      "--wrap-width="
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value '' for '--wrap-width <WRAP_WIDTH>': cannot parse integer from empty string\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-14",
    "argv": [
      "--wrap-width=18446744073709551616"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: invalid value '18446744073709551616' for '--wrap-width <WRAP_WIDTH>': number too large to fit in target type\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-15",
    "argv": [
      "--output",
      "json",
      "--bogus"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--bogus' found\n\n  tip: to pass '--bogus' as a value, use '-- --bogus'\n\nUsage: mdq --output <OUTPUT> [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-16",
    "argv": [
      "--br",
      "--quiet",
      "--bogus"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--bogus' found\n\n  tip: to pass '--bogus' as a value, use '-- --bogus'\n\nUsage: mdq --quiet [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-17",
    "argv": [
      "--quiet",
      "--outputx"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected argument '--outputx' found\n\n  tip: a similar argument exists: '--output'\n\nUsage: mdq --quiet --output <OUTPUT> [selectors] [MARKDOWN_FILE_PATHS]...\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-18",
    "argv": [
      "--quiet",
      "--br=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--br' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-19",
    "argv": [
      "--br",
      "--quiet=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--quiet' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-20",
    "argv": [
      "--quiet",
      "--br",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-21",
    "argv": [
      "--quiet",
      "--br",
      "--br=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--br' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-22",
    "argv": [
      "--output",
      "json",
      "--quiet",
      "--help=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--help' found; no more were expected\n\nUsage: mdq --help <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-23",
    "argv": [
      "--br",
      "--quiet=true"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'true' for '--quiet' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  },
  {
    "id": "clap-24",
    "argv": [
      "--br",
      "--quiet",
      "--no-br=x"
    ],
    "stdin": "hello\n",
    "exitCode": 2,
    "stdout": "",
    "stderr": "error: unexpected value 'x' for '--no-br' found; no more were expected\n\nUsage: mdq <--link-pos <LINK_POS>|--footnote-pos <FOOTNOTE_POS>|--link-format <LINK_FORMAT>|--renumber-footnotes <RENUMBER_FOOTNOTES>|--output <OUTPUT>|--wrap-width <WRAP_WIDTH>|--quiet|--allow-unknown-markdown|--[no]-br|--br|--no-br|-  <selectors starting with list>|selectors|MARKDOWN_FILE_PATHS>\n\nFor more information, try '--help'.\n"
  }
];

for (const fixture of [...fixtures, ...extraFixtures, ...deepFixtures, ...validationFixtures, ...clapFixtures]) {
  test(`mdq independent v0.10.0: ${fixture.id} ${JSON.stringify(fixture.argv)}`, async () => {
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await mdq({
      command: "mdq", args: fixture.argv, cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(new TextEncoder().encode(fixture.stdin)),
      stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }
    });
    assert.equal(result.exitCode, fixture.exitCode);
    const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
    // Native reference-map serialization order is randomized.
    if (fixture.argv.includes("json") && out && fixture.stdout) {
      assert.deepEqual(JSON.parse(out), JSON.parse(fixture.stdout));
    } else assert.equal(out, fixture.stdout);
    assert.equal(err, fixture.stderr);
  });
}

// The pinned v0.10.0 oracle exits 101 for both inputs: its formatting-event
// reconstruction slices inside a UTF-8 scalar. These are controlled-error
// regressions, deliberately separate from successful native comparisons.
for (const selector of ["P: !s/()/x/", "P: !s/./😀/"]) {
  test(`controlled error for native mdq UTF-8 replacement panic: ${selector}`, async () => {
    let stdout = "", stderr = "";
    const result = await mdq({
      command: "mdq", args: [selector], cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(new TextEncoder().encode("α**β**γ\n")),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "");
    assert.equal(stderr, "Selection error:\nregex replacement error in paragraph selector: internal error: formatting boundary is not a UTF-8 boundary\n");
  });
}
