# UnRTF independent-control qualification

Manual QA plan and executed receipt, 2026-09-20. Native programs are manual
controls only. Unit tests use memory bytes/VFS and never spawn or fetch controls.
The package-pattern document was already relocated to
`docs/plans/archive/safe-bash-command-package-pattern.md`; no deleted file was restored.

## Reproduction plan

1. Download the official GNU UnRTF 0.21.10 archive from
   `https://ftp.gnu.org/gnu/unrtf/unrtf-0.21.10.tar.gz`. Verify SHA256
   `b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`.
   Extract into task-owned ignored output, run `./configure --disable-dependency-tracking`
   and `make -j2`. Use the released `outputs/*.conf` without modification.
2. Feed each exact fixture below to `src/unrtf --text --quiet --nopict` and
   `src/unrtf --html --quiet --nopict`, crossing piped stdin with one seekable
   file operand. Set only PATH=/usr/bin:/bin, LC_ALL=C and
   UNRTF_SEARCH_PATH to the absolute released outputs directory. Capture raw
   stdout/stderr and status; timeout each cell at 10 seconds, output cap 1 MB.
   Keep native effects in the task output directory; disable picture export.
3. Feed the same bytes into `renderRtf`, seven-byte chunks, fresh cancellation
   signal and the explicit limits in `src/compatibility.test.ts`. Preserve yielded
   prefix on failure; record structured error code/status. Compare complete bytes
   without stripping headers, normalizing entities or decoding legacy output.
4. Run memory controls for original binary sizes, quota denial, Unicode fallback,
   code-page/group changes, malformed input, decoder buffer neighbors and cleanup.
   Execute real Shell pipelines into `rg -F` and `fmt -w 12` through CLI and SDK.
   Run command workspace lint/unit and maintained selected Safe Bash build closure.
5. Record required but unavailable profiles/runtime cells separately. Keep
   deterministic semantic evidence separate from performance. Purge task-owned
   temporary source, executable, fixtures and logs after this durable record.

## Candidate and tools

HEAD `35d01c57f8078d8afa916dc59929395d857e9c55` plus existing uncommitted
command/integration work. Production source SHA256
`6fbd8b763589b61900e0b91f6392c9e783710ae5118ba85a69a406e1d816a3ae`:
sort non-test `.ts` basenames in the command src directory, hash each basename
plus NUL followed by complete source bytes. No production repair was made.
Command remains `safe-bash-command-unrtf`, private:true, dependencies:{};
Safe Bash composes/re-exports it through `commands/unrtf/index.ts`.

Node v22.22.2, npm 10.9.7, TypeScript 5.9.3; macOS 15.7.7 (24G720), arm64;
Apple clang 17.0.0 (clang-1700.0.13.5), target arm64-apple-darwin24.6.0.
Native executable reports 0.21.10; configure selected system `-liconv`.
System iconv's independent library revision is unverified. Candidate uses the
Node realm WHATWG fatal TextDecoder, not that iconv. Source archive and personality
files are pinned together, not inferred from a modern RTF specification.

## Exact fixture set and matrix

34 ordered fixtures × text/html × stdin/file = 136 configured native cells.
All executed; no timeouts, missing cells or process-start errors. Zero exact
full-byte/status matches, 136 differences. This rejects GNU compatibility
admission; differences are not all implementation defects in the declared strict
profile. Candidate matrix uses one stream per fixture/format; its result is
reused across native file/stdin cells. There is no candidate seekability branch.

Fixture-set SHA256 `0fce6ccf50ce29aabb922a1bca462727e695b0258735a48552cd9c71c61cda26`:
hash each ordered name plus NUL plus decimal byte length plus LF plus raw input.
The following hex is exact. `xx*N` means N repetitions of that byte; ` + `
concatenates byte sequences; `(hex)*N` repeats an entire byte sequence. This notation also describes outputs without
lossy UTF-8 presentation. Every named output below is an exact byte sequence.

| Fixture | Input bytes (hex/RLE) |
| --- | --- |
| nested | `7b5c7274663120417b5c6220427b5c6920437d447d457d` |
| uc0 | `7b5c727466315c7563305c75393435206162587d` |
| uc1 | `7b5c727466315c7563315c75393435206162587d` |
| uc2 | `7b5c727466315c7563325c75393435206162587d` |
| codepage | `7b5c727466315c616e7369637067313235315c2763307b5c616e7369637067313235325c2738307d5c2763307d` |
| table | `7b5c727466315c74726f776420415c63656c6c20425c63656c6c5c726f777d` |
| plain | `504c41494e` |
| truncated | `7b5c7274663120505245464958` |
| hex | `7b5c727466315c27787a7d` |
| ignorable | `7b5c7274663120417b5c2a5c756e6b6e6f776e205345435245547d5a7d` |
| field | `7b5c727466317b5c6669656c647b5c2a5c666c64696e73742048595045524c494e4b202268747470733a2f2f6578616d706c652e696e76616c6964227d7b5c666c6472736c74206c6162656c7d7d7d` |
| bin0 | `7b5c72746631204245464f52455c62696e302041465445527d` |
| bin1 | `7b5c72746631204245464f52455c62696e31204141465445527d` |
| bin4 | `7b5c72746631204245464f52455c62696e34204141414141465445527d` |
| bin2000 | `7b5c72746631204245464f52455c62696e3230303020 + 41*2001 + 465445527d` |
| bin2020 | `7b5c72746631204245464f52455c62696e3230323020 + 41*2021 + 465445527d` |
| bin2030 | `7b5c72746631204245464f52455c62696e3230333020 + 41*2031 + 465445527d` |
| bin2040 | `7b5c72746631204245464f52455c62696e3230343020 + 41*2041 + 465445527d` |
| bin2048 | `7b5c72746631204245464f52455c62696e3230343820 + 41*2049 + 465445527d` |
| bin2050 | `7b5c72746631204245464f52455c62696e3230353020 + 41*2051 + 465445527d` |
| bin4096 | `7b5c72746631204245464f52455c62696e3430393620 + 41*4097 + 465445527d` |
| bin8192 | `7b5c72746631204245464f52455c62696e3831393220 + 41*8193 + 465445527d` |
| binary-opaque | `7b5c72746631204245464f52455c62696e37207b7d5c000d0a0941465445527d` |
| binary-truncated | `7b5c72746631204245464f52455c62696e342078` |
| large-group | `7b5c7274663120 + 7b*101 + 58 + 7d*102` |
| dbcs10237-\'82\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10237 + 5c2738325c2761307d` |
| dbcs10237-\'82 | `7b5c727466315c616e736963706739333220 + (5c273431)*10237 + 5c2738327d` |
| dbcs10237-\'82\b\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10237 + 5c2738325c625c2761307d` |
| dbcs10238-\'82\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10238 + 5c2738325c2761307d` |
| dbcs10238-\'82 | `7b5c727466315c616e736963706739333220 + (5c273431)*10238 + 5c2738327d` |
| dbcs10238-\'82\b\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10238 + 5c2738325c625c2761307d` |
| dbcs10239-\'82\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10239 + 5c2738325c2761307d` |
| dbcs10239-\'82 | `7b5c727466315c616e736963706739333220 + (5c273431)*10239 + 5c2738327d` |
| dbcs10239-\'82\b\'a0 | `7b5c727466315c616e736963706739333220 + (5c273431)*10239 + 5c2738325c625c2761307d` |

| Byte sequence | Exact hex/RLE |
| --- | --- |
| B0 | `0a + 2d*17 + 0a4142434445` |
| B1 | `empty` |
| B2 | `4142434445` |
| B3 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e413c623e423c693e433c2f693e3c2f623e3c623e443c2f623e453c2f626f64793e0a3c2f68746d6c3e0a` |
| B4 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e413c7374726f6e673e423c2f7374726f6e673e3c7374726f6e673e3c656d3e433c2f656d3e3c2f7374726f6e673e3c7374726f6e673e443c2f7374726f6e673e453c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B5 | `0a + 2d*17 + 0a616258` |
| B6 | `ceb1616258` |
| B7 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a26616c7068613b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B8 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703eceb16162583c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B9 | `ceb16258` |
| B10 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703eceb162583c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B11 | `ceb158` |
| B12 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703eceb1583c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B13 | `1002c0` |
| B14 | `d090e282acd090` |
| B15 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a2623313034303b2623313032363b264167726176653b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B16 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703ed090e282acd0903c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B17 | `0a + 2d*17 + 0a41094209` |
| B18 | `410942090a` |
| B19 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e413c74643e3c2f74643e0a423c74643e3c2f74643e0a3c2f626f64793e0a3c2f68746d6c3e0a` |
| B20 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c7461626c653e3c74626f64793e3c74723e3c74643e413c2f74643e3c74643e423c2f74643e3c2f74723e3c2f74626f64793e3c2f7461626c653e3c2f626f64793e3c2f68746d6c3e` |
| B21 | `0a + 2d*17 + 0a504c41494e` |
| B22 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e504c41494e3c2f626f64793e0a3c2f68746d6c3e0a` |
| B23 | `0a + 2d*17 + 0a505245464958` |
| B24 | `505245464958` |
| B25 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e5052454649583c2f626f64793e0a3c2f68746d6c3e0a` |
| B26 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e505245464958` |
| B27 | `33` |
| B28 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a333c2f626f64793e0a3c2f68746d6c3e0a` |
| B29 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e` |
| B30 | `0a + 2d*17 + 0a415a` |
| B31 | `415a` |
| B32 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e415a3c2f626f64793e0a3c2f68746d6c3e0a` |
| B33 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e415a3c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B34 | `0a + 2d*17 + 0a6c6162656c` |
| B35 | `6c6162656c` |
| B36 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e6c6162656c3c2f626f64793e0a3c2f68746d6c3e0a` |
| B37 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e6c6162656c3c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B38 | `0a + 2d*17 + 0a4245464f52454146544552` |
| B39 | `4245464f52454146544552` |
| B40 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e4245464f524541465445523c2f626f64793e0a3c2f68746d6c3e0a` |
| B41 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e4245464f524541465445523c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B42 | `4572726f7220286c696e652030293a2043616e6e6f74207365656b0a` |
| B43 | `0a + 2d*17 + 0a4245464f5245` |
| B44 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e4245464f52453c2f626f64793e0a3c2f68746d6c3e0a` |
| B45 | `4245464f5245` |
| B46 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e4245464f5245` |
| B47 | `0a + 2d*17 + 0a58` |
| B48 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a3c2f686561643e0a3c626f64793e583c2f626f64793e0a3c2f68746d6c3e0a` |
| B49 | `41*10237 + 42` |
| B50 | `41*10237 + e38182` |
| B51 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*10237 + 262331323335343b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B52 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10237 + e381823c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B53 | `41*7680` |
| B54 | `41*10237` |
| B55 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*7680 + 3c2f626f64793e0a3c2f68746d6c3e0a` |
| B56 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10237` |
| B57 | `41*7680 + 0a + 2d*17 + 0a42` |
| B58 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*7680 + 3c2f686561643e0a3c626f64793e3c623e3c2f623e262331323335343b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B59 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10237 + 3c7374726f6e673ee381823c2f7374726f6e673e3c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B60 | `41*7680 + 42` |
| B61 | `41*10238 + e38182` |
| B62 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*7680 + 262331323335343b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B63 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10238 + e381823c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B64 | `41*10238` |
| B65 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10238` |
| B66 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10238 + 3c7374726f6e673ee381823c2f7374726f6e673e3c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B67 | `41*10239 + 42` |
| B68 | `41*10239 + e38182` |
| B69 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*10239 + 262331323335343b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B70 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10239 + e381823c2f703e3c2f626f64793e3c2f68746d6c3e` |
| B71 | `41*10239` |
| B72 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*10239 + 3c2f626f64793e0a3c2f68746d6c3e0a` |
| B73 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10239` |
| B74 | `41*10239 + 0a + 2d*17 + 0a42` |
| B75 | `3c21444f43545950452068746d6c205055424c494320222d2f2f5733432f2f4454442048544d4c20342e3031205472616e736974696f6e616c2f2f454e223e0a3c68746d6c3e0a3c686561643e0a3c6d65746120687474702d65717569763d22636f6e74656e742d747970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d7574662d38223e0a + 41*10239 + 3c2f686561643e0a3c626f64793e3c623e3c2f623e262331323335343b3c2f626f64793e0a3c2f68746d6c3e0a` |
| B76 | `3c21444f43545950452068746d6c3e3c68746d6c3e3c626f64793e3c703e + 41*10239 + 3c7374726f6e673ee381823c2f7374726f6e673e3c2f703e3c2f626f64793e3c2f68746d6c3e` |

| Fixture | Format/input | Native status / stdout / stderr | Candidate status / stdout / error |
| --- | --- | --- | --- |
| nested | text/stdin | 0 / B0 / B1 | 0 / B2 / none |
| nested | text/file | 0 / B0 / B1 | 0 / B2 / none |
| nested | html/stdin | 0 / B3 / B1 | 0 / B4 / none |
| nested | html/file | 0 / B3 / B1 | 0 / B4 / none |
| uc0 | text/stdin | 0 / B5 / B1 | 0 / B6 / none |
| uc0 | text/file | 0 / B5 / B1 | 0 / B6 / none |
| uc0 | html/stdin | 0 / B7 / B1 | 0 / B8 / none |
| uc0 | html/file | 0 / B7 / B1 | 0 / B8 / none |
| uc1 | text/stdin | 0 / B5 / B1 | 0 / B9 / none |
| uc1 | text/file | 0 / B5 / B1 | 0 / B9 / none |
| uc1 | html/stdin | 0 / B7 / B1 | 0 / B10 / none |
| uc1 | html/file | 0 / B7 / B1 | 0 / B10 / none |
| uc2 | text/stdin | 0 / B5 / B1 | 0 / B11 / none |
| uc2 | text/file | 0 / B5 / B1 | 0 / B11 / none |
| uc2 | html/stdin | 0 / B7 / B1 | 0 / B12 / none |
| uc2 | html/file | 0 / B7 / B1 | 0 / B12 / none |
| codepage | text/stdin | 0 / B13 / B1 | 0 / B14 / none |
| codepage | text/file | 0 / B13 / B1 | 0 / B14 / none |
| codepage | html/stdin | 0 / B15 / B1 | 0 / B16 / none |
| codepage | html/file | 0 / B15 / B1 | 0 / B16 / none |
| table | text/stdin | 0 / B17 / B1 | 0 / B18 / none |
| table | text/file | 0 / B17 / B1 | 0 / B18 / none |
| table | html/stdin | 0 / B19 / B1 | 0 / B20 / none |
| table | html/file | 0 / B19 / B1 | 0 / B20 / none |
| plain | text/stdin | 0 / B21 / B1 | 1 / B1 / E_PARSE |
| plain | text/file | 0 / B21 / B1 | 1 / B1 / E_PARSE |
| plain | html/stdin | 0 / B22 / B1 | 1 / B1 / E_PARSE |
| plain | html/file | 0 / B22 / B1 | 1 / B1 / E_PARSE |
| truncated | text/stdin | 0 / B23 / B1 | 1 / B24 / E_PARSE |
| truncated | text/file | 0 / B23 / B1 | 1 / B24 / E_PARSE |
| truncated | html/stdin | 0 / B25 / B1 | 1 / B26 / E_PARSE |
| truncated | html/file | 0 / B25 / B1 | 1 / B26 / E_PARSE |
| hex | text/stdin | 0 / B27 / B1 | 1 / B1 / E_PARSE |
| hex | text/file | 0 / B27 / B1 | 1 / B1 / E_PARSE |
| hex | html/stdin | 0 / B28 / B1 | 1 / B29 / E_PARSE |
| hex | html/file | 0 / B28 / B1 | 1 / B29 / E_PARSE |
| ignorable | text/stdin | 0 / B30 / B1 | 0 / B31 / none |
| ignorable | text/file | 0 / B30 / B1 | 0 / B31 / none |
| ignorable | html/stdin | 0 / B32 / B1 | 0 / B33 / none |
| ignorable | html/file | 0 / B32 / B1 | 0 / B33 / none |
| field | text/stdin | 0 / B34 / B1 | 0 / B35 / none |
| field | text/file | 0 / B34 / B1 | 0 / B35 / none |
| field | html/stdin | 0 / B36 / B1 | 0 / B37 / none |
| field | html/file | 0 / B36 / B1 | 0 / B37 / none |
| bin0 | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| bin0 | text/file | 0 / B38 / B1 | 0 / B39 / none |
| bin0 | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| bin0 | html/file | 0 / B40 / B1 | 0 / B41 / none |
| bin1 | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| bin1 | text/file | 0 / B38 / B1 | 0 / B39 / none |
| bin1 | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| bin1 | html/file | 0 / B40 / B1 | 0 / B41 / none |
| bin4 | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| bin4 | text/file | 0 / B38 / B1 | 0 / B39 / none |
| bin4 | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| bin4 | html/file | 0 / B40 / B1 | 0 / B41 / none |
| bin2000 | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| bin2000 | text/file | 0 / B38 / B1 | 0 / B39 / none |
| bin2000 | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| bin2000 | html/file | 0 / B40 / B1 | 0 / B41 / none |
| bin2020 | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| bin2020 | text/file | 0 / B38 / B1 | 0 / B39 / none |
| bin2020 | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| bin2020 | html/file | 0 / B40 / B1 | 0 / B41 / none |
| bin2030 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin2030 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin2030 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin2030 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| bin2040 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin2040 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin2040 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin2040 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| bin2048 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin2048 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin2048 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin2048 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| bin2050 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin2050 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin2050 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin2050 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| bin4096 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin4096 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin4096 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin4096 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| bin8192 | text/stdin | 10 / B1 / B42 | 0 / B39 / none |
| bin8192 | text/file | 0 / B43 / B1 | 0 / B39 / none |
| bin8192 | html/stdin | 10 / B1 / B42 | 0 / B41 / none |
| bin8192 | html/file | 0 / B44 / B1 | 0 / B41 / none |
| binary-opaque | text/stdin | 0 / B38 / B1 | 0 / B39 / none |
| binary-opaque | text/file | 0 / B38 / B1 | 0 / B39 / none |
| binary-opaque | html/stdin | 0 / B40 / B1 | 0 / B41 / none |
| binary-opaque | html/file | 0 / B40 / B1 | 0 / B41 / none |
| binary-truncated | text/stdin | 10 / B1 / B42 | 1 / B45 / E_PARSE |
| binary-truncated | text/file | 0 / B43 / B1 | 1 / B45 / E_PARSE |
| binary-truncated | html/stdin | 10 / B1 / B42 | 1 / B46 / E_PARSE |
| binary-truncated | html/file | 0 / B44 / B1 | 1 / B46 / E_PARSE |
| large-group | text/stdin | 0 / B47 / B1 | 1 / B1 / E_LIMIT |
| large-group | text/file | 0 / B47 / B1 | 1 / B1 / E_LIMIT |
| large-group | html/stdin | 0 / B48 / B1 | 1 / B29 / E_LIMIT |
| large-group | html/file | 0 / B48 / B1 | 1 / B29 / E_LIMIT |
| dbcs10237-\'82\'a0 | text/stdin | 0 / B49 / B1 | 0 / B50 / none |
| dbcs10237-\'82\'a0 | text/file | 0 / B49 / B1 | 0 / B50 / none |
| dbcs10237-\'82\'a0 | html/stdin | 0 / B51 / B1 | 0 / B52 / none |
| dbcs10237-\'82\'a0 | html/file | 0 / B51 / B1 | 0 / B52 / none |
| dbcs10237-\'82 | text/stdin | 0 / B53 / B1 | 1 / B54 / E_ENCODING |
| dbcs10237-\'82 | text/file | 0 / B53 / B1 | 1 / B54 / E_ENCODING |
| dbcs10237-\'82 | html/stdin | 0 / B55 / B1 | 1 / B56 / E_ENCODING |
| dbcs10237-\'82 | html/file | 0 / B55 / B1 | 1 / B56 / E_ENCODING |
| dbcs10237-\'82\b\'a0 | text/stdin | 0 / B57 / B1 | 0 / B50 / none |
| dbcs10237-\'82\b\'a0 | text/file | 0 / B57 / B1 | 0 / B50 / none |
| dbcs10237-\'82\b\'a0 | html/stdin | 0 / B58 / B1 | 0 / B59 / none |
| dbcs10237-\'82\b\'a0 | html/file | 0 / B58 / B1 | 0 / B59 / none |
| dbcs10238-\'82\'a0 | text/stdin | 0 / B60 / B1 | 0 / B61 / none |
| dbcs10238-\'82\'a0 | text/file | 0 / B60 / B1 | 0 / B61 / none |
| dbcs10238-\'82\'a0 | html/stdin | 0 / B62 / B1 | 0 / B63 / none |
| dbcs10238-\'82\'a0 | html/file | 0 / B62 / B1 | 0 / B63 / none |
| dbcs10238-\'82 | text/stdin | 0 / B53 / B1 | 1 / B64 / E_ENCODING |
| dbcs10238-\'82 | text/file | 0 / B53 / B1 | 1 / B64 / E_ENCODING |
| dbcs10238-\'82 | html/stdin | 0 / B55 / B1 | 1 / B65 / E_ENCODING |
| dbcs10238-\'82 | html/file | 0 / B55 / B1 | 1 / B65 / E_ENCODING |
| dbcs10238-\'82\b\'a0 | text/stdin | 0 / B57 / B1 | 0 / B61 / none |
| dbcs10238-\'82\b\'a0 | text/file | 0 / B57 / B1 | 0 / B61 / none |
| dbcs10238-\'82\b\'a0 | html/stdin | 0 / B58 / B1 | 0 / B66 / none |
| dbcs10238-\'82\b\'a0 | html/file | 0 / B58 / B1 | 0 / B66 / none |
| dbcs10239-\'82\'a0 | text/stdin | 0 / B67 / B1 | 0 / B68 / none |
| dbcs10239-\'82\'a0 | text/file | 0 / B67 / B1 | 0 / B68 / none |
| dbcs10239-\'82\'a0 | html/stdin | 0 / B69 / B1 | 0 / B70 / none |
| dbcs10239-\'82\'a0 | html/file | 0 / B69 / B1 | 0 / B70 / none |
| dbcs10239-\'82 | text/stdin | 0 / B71 / B1 | 1 / B71 / E_ENCODING |
| dbcs10239-\'82 | text/file | 0 / B71 / B1 | 1 / B71 / E_ENCODING |
| dbcs10239-\'82 | html/stdin | 0 / B72 / B1 | 1 / B73 / E_ENCODING |
| dbcs10239-\'82 | html/file | 0 / B72 / B1 | 1 / B73 / E_ENCODING |
| dbcs10239-\'82\b\'a0 | text/stdin | 0 / B74 / B1 | 0 / B68 / none |
| dbcs10239-\'82\b\'a0 | text/file | 0 / B74 / B1 | 0 / B68 / none |
| dbcs10239-\'82\b\'a0 | html/stdin | 0 / B75 / B1 | 0 / B76 / none |
| dbcs10239-\'82\b\'a0 | html/file | 0 / B75 / B1 | 0 / B76 / none |

## Interpretation and authority effects

- GNU text personality has its own body separator and low-byte/C-string output;
  candidate is UTF-8 without the separator. `uc0/uc1/uc2` native text all retain
  `abX`; strict emits respectively `αabX`, `αbX`, `αX`. HTML remains a separate
  personality: native token skipping is not scoped standards fallback.
- Native binary lengths through 2020 preserve BEFOREAFTER. At 2030 and above,
  stdin fails status10/empty stdout/`Error (line 0): Cannot seek` plus LF;
  file succeeds while losing AFTER. Strict preserves BEFOREAFTER for all lengths.
  Opaque braces/backslash/NUL/CR/LF/TAB remain raw binary bytes. Truncation is a
  strict E_PARSE, not native seek/recovery behavior. No native defect was copied.
- Native malformed hex `xz` emits byte33/status0; strict rejects with no text.
  Plain input and unterminated groups succeed natively but fail strict E_PARSE.
  Streaming strict failures retain already emitted PREFIX/BEFORE, not atomic output.
- Native DBCS 10238 complete loses thousands of As while neighbors can retain
  them. Incomplete/split-format runs also lose prefixes, status0. Strict preserves
  every A, emits UTF-8 Japanese for complete/split runs and fails E_ENCODING at
  incomplete EOF. Native output-buffer effects are visible in exact rows above.
- Native codepage/group and table output differ beyond headers. Candidate restores
  scoped codepages and adds a row LF. These are declared strict behavior, not
  proof of GNU rendering. Nested groups, ignorable destinations and field results
  were compared, not merely inspected. Fields/links were never opened/executed.

Read released parse.c my_skip/read_word (READ_BUF_LEN=2048), convert.c cmd_u
(SKIP_ONE_WORD only with alias/template; no cmd_uc entry), flush_iconv_input
(IIBS=10240, EINVAL returns before printing completed output), and text.conf body_begin.
These confirm the observed binary/Unicode/decoder mechanisms. Source findings
from the request about other subsystems remain historical/source evidence unless
covered by this receipt; no claim of independently rerunning all prior cells.

Native runs read only explicit QA fixtures/configuration and write captured output;
--nopict prevented image exports. Candidate created no document/image files.
Memory Shell tests verify unchanged input and SDK/CLI parity. Existing boundary
controls verify literal VFS-only inputs, zero fetch calls for inert links/fields,
no executable fallback, partial redirected prefixes and destructive same-file aliases.
Resource checks deny large groups and excessive binary lengths, and confirm iterator
cleanup plus subsequent fresh invocations. Existing unit coverage additionally
checks cancellation, reentrancy, non-byte/forged/cross-realm views and other budgets.
Randomized chunk controls retain seed12345 in engine.test.ts; this native matrix
uses deterministic fixtures only. No performance claim or timing threshold was used.

## Verification and admission limits

- Command workspace `npm run test:unit --workspace=safe-bash-command-unrtf`:
  79 passed, zero failures/skips/cancellations. Twelve new independent qualification
  tests exercise multiple exact fixture/chunk/quota cells; test counts are not
  native matrix cell counts. Workspace lint and both production/test typechecks passed.
- Maintained `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
  passed, 19 selected dependency-closure builds, no cache hits. Manifestless
  directories reported by the maintained runner are not passes. This selected
  workspace route is not a root `npm run build` receipt.
- Direct memory Shell controls `node --import tsx --test` on
  `unrtf-compatibility.test.ts` and `unrtf-boundaries.test.ts`: final 4/4 passed,
  zero failures/skips/cancellations, after the selected build. ESLint on the added
  Shell test passed. No production code, shared contracts, workflow or build
  configuration changed; repository-wide tests/lint/build were not rerun.
- Investigated initial QA harness failures: explicit fmt registration collided
  with agentCommands' existing fmt; fixed the harness with explicit replace:true.
  `rg alpha` returned status2 and diagnostic
  `rg: bounded regex unsupported: rg regex modes are unsupported; use fixed UTF-8 patterns`
  plus LF. This is an unsupported downstream regex profile, not an unrtf repair.
  Repeated both CLI and SDK pipelines with the admitted `rg -F alpha`; all six
  selected/wrapped/chained output cells passed exact bytes. These focused passes
  do not establish regex support or replace an omitted broad gate.

Required admission cells still unverified/unsupported:

| Cell | Current result |
| --- | --- |
| GNU text/html byte-personality parity | Failed: 136 differences in executed matrix |
| --rtf/--vt/--latex, arbitrary --name, ordered -P/-t | Unsupported E_PROFILE; no independent configured native comparisons here |
| --inline/--simple/--noremap/debug/dump/verbose | Unsupported; independent profiles not executed |
| quiet/nopict switches | Used in native matrix; strict no-op semantics are not full native profile proof |
| VFS picture output, collision/partial-image rollback | Unimplemented; no export/cleanup admission |
| Nested/merged tables and complete font/color/style parity | Unimplemented/unqualified; flat table and scoped codepage controls only |
| Full fcharset/charmap inventory and iconv platform matrix | Existing explicit mapping/refusal unit tests passed; native six-page/charset observations from the request were not freshly rerun |
| Strict/recovery/native-legacy separate profiles | Strict executed; recovery/native-legacy refused, not qualified |
| Actual browser/workerd/Bun runtime | Not executed; Node cross-realm tests are not these runtimes |
| Original/checkpoint/replay command execution | Original Shell execution passed; checkpoint/replay not executed |
| Fresh installed tarball implementation/declaration qualification | Not rerun; historical packed receipts do not identify this candidate |
| CLI screenshots | Not run: no visible product behavior changed; textual Shell QA does not constitute screenshot evidence |
| Performance | Not measured; native timeouts/output caps are harness limits, not performance results |

Compatibility qualification is complete for the explicit matrix, with a rejected
full-GNU admission result. Broader command completion remains pending the unsupported
cells above; passing strict regressions does not resolve them. Added tests capture
safe deliberate deviations before any future repair. No runtime dependency,
native fallback, network capability or ambient configuration search was introduced.
Unrelated working-tree edits remain preserved. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. Nothing was published.
Task output used ignored `out/compatibility-unrtf` (the existing documented host
fallback for unavailable `/out`); task-owned temporary output was purged after capture.
