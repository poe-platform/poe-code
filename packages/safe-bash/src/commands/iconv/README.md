# iconv

Convert virtual-file or stdin bytes between ASCII, Latin-1, UTF-8, UTF-16,
UTF-16LE and UTF-16BE with the bounded safe-bash engine. UTF-16 byte order
is determined independently for each input file. UTF-8 accepts Unicode scalar
values through U+10FFFF; obsolete five- and six-byte sequences are invalid.
Use `-c` or a target suffix such as `ASCII//IGNORE` to discard invalid or
unrepresentable characters. `//TRANSLIT//IGNORE` combines transliteration
with discarding; invalid input is never transliterated.

```sh
iconv -f UTF-8 -t UTF-16BE input.txt
iconv --list
iconv --help
```

`--list` / `-l` lists only the encodings and aliases accepted by this engine.
`--help` / `-?`, `--usage`, and `--version` / `-V` print information without
reading input or opening an output file. The identity describes safe-bash;
this engine does not expose the host's native iconv or gconv codec registry.
