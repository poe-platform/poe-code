# iconv

Convert virtual-file or stdin bytes between ASCII, Latin-1, UTF-8, UTF-16,
UTF-16LE and UTF-16BE with the bounded safe-bash engine.

```sh
iconv -f UTF-8 -t UTF-16BE input.txt
iconv --list
iconv --help
```

`--list` / `-l` lists only the encodings and aliases accepted by this engine.
`--help` / `-?`, `--usage`, and `--version` / `-V` print information without
reading input or opening an output file. The identity describes safe-bash;
this engine does not expose the host's native iconv or gconv codec registry.
