# Compact CR/BOM/malformed byte decision table v3

Current root-approved PROJECT PROFILE; independent Dirac freeze pending.
Supersedes conflicting v2 policy at b9ce9e61115c7d99dfa6a76591b3dcfdaee9ce21.
Original v2/native evidence remains byte-preserved; no new observations.

Eleven representative families, not a Cartesian acceptance suite. H = headers -j;
C = count; S = select *; L = slice, except explicit overrides below. Omitted input
means stdin; no -o; comma delimiters unless stated. All input/stdout cells below
are EXACT JSON-escaped UTF-8 bytes: \uFEFF means efbbbf, \r=0d, \n=0a, \"=22.
Empty string means zero bytes. Default PROJECT PROFILE status 0, stderr hex empty.
M exceptions mean status 1, exact stderr
`xan <subcommand>: unsupported malformed CSV quoting\n` (select or slice).
The valid already-emitted header remains as tabulated; no stdout rollback.

O = original row; V = additional-v2 row; these are native observations, NOT passes.
I = primary-source inference/prediction for this exact input, NOT a native run.
U = native unmeasured with no safe prediction. A = approved PROJECT PROFILE,
not native proof or independent acceptance. Only O/V cells are native evidence;
I/U remain unmeasured even where the root now approves the declared policy.

| Family / exact input bytes | H proposed stdout | C proposed stdout | S proposed stdout | L proposed stdout | Native evidence / PROJECT PROFILE distinction |
|---|---|---|---|---|---|
| 1 CRLF: `"a,b\r\n1,2\r\n"` | `"a\nb\n"` | `"1\n"` | `"a,b\n1,2\n"` | `"a,b\n1,2\n"` | H/C/S/L I; ordinary dialect A; I unmeasured |
| 2 CR start/interior/EOF: `"\ra,b\r\nx\ry,z\r\nu,v\r"` | `"a\nb\n"` | `"2\n"` | `"a,b\n\"x\ry\",z\nu,\"v\r\"\n"` | `"a,b\n\"x\ry\",z\nu,v\n"` | H/C/L match V06/07/09. S V08 native `"a,b\nx\ry,z\nu,v\r\n"`, status0/empty stderr. S proposed output is approved writer-safe BYTE deviation; logical values below are PROJECT PROFILE |
| 3 initial/split BOM: `"\uFEFFa,b\n1,2\n"` | `"a\nb\n"` | `"1\n"` | `"a,b\n1,2\n"` | `"a,b\n1,2\n"` | H/C/S/L I; all chunk splits U; chunk-invariance A |
| 4 BOM only: `"\uFEFF"` | `"<stdin>\n"` | `"0\n"` | `"\n"` | `"\n"` | H uses --csv: V14; C O12; S/L I, synthetic zero-column header |
| 5 noninitial BOM moved first: `"x,\uFEFFz\n"` | `"x\n\uFEFFz\n"` | `"0\n"` | `"\"\uFEFFz\",x\n"` | `"x,\uFEFFz\n"` | S uses -n 1,0: V13 native efbbbf7a2c780a; proposed 22efbbbf7a222c780a. H/C/L I. Faithfulness A; repair detail A |
| 6 embedded header quote: `"a\"b,c\n"` | `"a\"b\nc\n"` | `"0\n"` | `""` | `""` | H V10; C I; S/L proposed status1 M, native U; malformed restriction A |
| 7 embedded body quote: `"a,b\n1,x\"y\n2,z\n"` | `"a\nb\n"` | `"1\n"` | `"a,b\n"` | `"a,b\n"` | C V11; H I; S/L proposed status1 M, native U; malformed restriction A |
| 8 postquote text: `"a,b\n1,\"x\"z\n"` | `"a\nb\n"` | `"1\n"` | `"a,b\n"` | `"a,b\n"` | S V16 native 612c620a312c2278227a0a status0; proposed S/L status1 M. H/C I; native L U; M refusal A |
| 9 unterminated EOF: `"a,b\n1,\"x\ny"` | `"a\nb\n"` | `"1\n"` | `"a,b\n1,\"x\ny\"\n"` | `"a,b\n1,\"x\ny\"\n"` | S O21 native 612c620a312c22780a790a, missing closing quote; L V12 matches proposal; H/C I; S repair A |
| 10 multiline/escaped/single-empty: `"\"\"\r\n\"a\nb\"\r\n\"q\"\"r\"\r\n"` | `"\n"` | `"2\n"` | `"\"\"\n\"a\nb\"\n\"q\"\"r\"\n"` | `"\"\"\n\"a\nb\"\n\"q\"\"r\"\n"` | H/C/S/L I; exact fixture unmeasured; ordinary quote grammar A |
| 11 semicolon→comma: `"\"a;b\";\"x,y\"\r\n\"\";\"\"\r\n\"q\"\"r\";\"u\r\nv\"\r\n"` | `"a;b\nx,y\n"` | `"2\n"` | `"\"x,y\",a;b\n,\n\"u\r\nv\",\"q\"\"r\"\n"` | `"a;b,\"x,y\"\n,\n\"q\"\"r\",\"u\r\nv\"\n"` | All -d ;. S -n 1,0; L -n. S V15 native has FOUR inner quote bytes, hex below; H/C/L I. Safe reserialization A; I remains unmeasured |

## Family 2 exact logical values and status

Input is exactly \ra,b\r\nx\ry,z\r\nu,v\r (escaped bytes).
These decoded-value declarations are PROJECT PROFILE, not a new native run.

| Command | Logical header / body or extent | Exact stdout | Status / native distinction |
|---|---|---|---|
| H -j | ["a","b"]; body unread | `"a\nb\n"` | 0, empty stderr; V06 output observed |
| C | Splitter counts 2 body records; no decoded-cell claim | `"2\n"` | 0, empty stderr; V07 observed |
| S * | ["a","b"] / [["x\ry","z"],["u","v\r"]] | `"a,b\n\"x\ry\",z\nu,\"v\r\"\n"` | 0, empty stderr; approved serialization differs from V08 |
| L | ["a","b"] / [["x\ry","z"],["u","v"]] | `"a,b\n\"x\ry\",z\nu,v\n"` | 0, empty stderr; V09 output observed |

Select MUST retain both CR values and quote both CR-containing cells. Slice
retains its separately declared final-record CR removal. Native Select byte
copying is not enough: its EOF CR followed by added LF is ambiguous as a record
terminator. Same-comma raw must satisfy writer grammar AND exact reversibility.
No original native bytes/status have been corrected or rescored.

Family 11 native S stdout hex (status0, stderr empty):
`22782c79222c613b620a2c0a22750d0a76222c22712222222272220a`.
Proposed S stdout hex:
`22782c79222c613b620a2c0a22750d0a76222c2271222272220a`.
Decode doubled quotes once: logical cell q"r, not q""r. Native observations are
retained verbatim; safe reserialization is an explicit native BYTE deviation.

## Gaps and interpretation

- Family 2 H stops after a,b: later CR bytes are not observed by H. Source says
  lone CR terminates outside quotes for H; a first-record interior-CR fixture
  remains an independent freeze obligation. Native S preserves final raw CR, L removes final decoded CR. V3 Select
  retains the VALUE but quotes it: approved profile, explicit native BYTE gap.
- Family 3 is one byte sequence with many schedules; native chunk schedules were
  NOT controlled. Proposed every split, including ef / bb / bf, has identical
  stdout/status. Partial ef or efbb at EOF remains data; its exact H invalid-UTF8
  diagnostic is U. Do not turn csv-core's initial-buffer limitation into policy.
- Family 5 requires first-output-cell quoting so a fresh reader does not strip a
  value BOM moved to byte zero. Noninitial BOM is literal data, not globally
  removed. The same rule applies to reordered headers and decoded slice output.
- H reads only the header, hence no body diagnostic in families 7–9. C uses
  quote-state splitting; S/L embedded/postquote refusal is the approved bounded
  dialect, not inferred native rejection. No unsafe SIMD lookahead artifacts.
- Family 10 single-empty must stay one cell. Additional source-only subcase:
  input hex 2222; -n S/L => 22220a; -n C => 310a; H -j => 0a. Exact native
  subcase U. Two empty cells => 2c0a; zero cells => 0a, never conflate them.
- Same-comma raw preservation requires exact reparse cell count/bytes and owned
  storage AND writer grammar, not blindly copying native lexemes. PROFILE-V3.md gives the criterion
  and comma→semicolon counterexample. Family 9's proposed repair intentionally
  differs from original native raw selection and is approved policy, not native proof.
- Original failures (ragged/UTF-8/argv) remain separate, immutable observations;
  nothing here rescored them or claimed all diagnostics qualified. H --csv is
  transposed CSV, not -j display; only family 4 overrides H to --csv.

Primary tag 0.54.0 => 2f9156c8ec79a3ecc09e0879735ac68ec8997b7a. Pinned primary
cmd/{headers,count,select,slice}.rs, config/util; locked simd-csv 0.9.0 core,
records, utils, writer/readers; csv/csv-core readers establish I predictions.
SOURCE-MAP.md and additional-v2/BINDING.json bind exact source bytes. Different
reviewer must freeze I/U cells, every split and producer-reuse schedule, not
promote this author's predictions to acceptance. No more native calls authorized.
