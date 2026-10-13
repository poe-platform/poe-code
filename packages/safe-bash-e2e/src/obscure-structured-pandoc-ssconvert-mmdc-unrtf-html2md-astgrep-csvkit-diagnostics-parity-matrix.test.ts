import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

const createEnv = () => SafeBashE2EHarness.create();

describe("obscure structured pandoc ssconvert mmdc unrtf html2md astgrep csvkit diagnostics parity matrix", () => {
  test("1. html-to-markdown --version, --help, missing file, and directory input diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/h2m_dir
      html-to-markdown --version
      html-to-markdown --help | head -n 2
      html-to-markdown /tmp/missing_h2m.html 2>&1; echo "rc1=$?"
      html-to-markdown /tmp/h2m_dir 2>&1; echo "rc2=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^html-to-markdown \(safe-bash bounded HTML profile\)\n/);
    assert.match(r.stdout, /Usage: html-to-markdown \[--\] \[FILE\|-\] \.\.\.\nRead VFS files or shared stdin; write bounded Markdown to stdout\./);
    assert.match(r.stdout, /html-to-markdown: ENOENT: no such file or directory, readStream '\/tmp\/missing_h2m\.html'\nrc1=1\n/);
    assert.match(r.stdout, /html-to-markdown: EISDIR: illegal operation on a directory, readStream '\/tmp\/h2m_dir'\nrc2=1\n/);
  });

  test("2. html-to-markdown unknown flag and multiple file operands", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf '<p>one</p>' > /tmp/a.html
      printf '<p>two</p>' > /tmp/b.html
      html-to-markdown --unknown-flag <<< '<p>hi</p>' 2>&1; echo "rc1=$?"
      html-to-markdown --heading-style <<< '<p>hi</p>' 2>&1; echo "rc2=$?"
      html-to-markdown /tmp/a.html /tmp/b.html; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /html-to-markdown: unknown option: --unknown-flag\nrc1=2\n/);
    assert.match(r.stdout, /html-to-markdown: unknown option: --heading-style\nrc2=2\n/);
    assert.match(r.stdout, /one\n\ntwo\nrc3=0\n/);
  });

  test("3. unrtf --version, --help, missing file (.rtf fallback), and directory input diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/unrtf_dir
      unrtf --version 2>&1; echo "v_rc=$?"
      unrtf --help 2>&1; echo "h_rc=$?"
      unrtf /tmp/missing_doc 2>&1; echo "rc1=$?"
      unrtf /tmp/unrtf_dir 2>&1; echo "rc2=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /unrtf: E_PROFILE: Option requires an unadmitted personality\/configuration profile\nv_rc=1\n/);
    assert.match(r.stdout, /unrtf: E_PROFILE: Option requires an unadmitted personality\/configuration profile\nh_rc=1\n/);
    assert.match(r.stdout, /unrtf: ENOENT: ENOENT: no such file or directory, readStream '\/tmp\/missing_doc\.rtf'\nrc1=1\n/);
    assert.match(r.stdout, /unrtf: EISDIR: EISDIR: illegal operation on a directory, readStream '\/tmp\/unrtf_dir'\nrc2=1\n/);
  });

  test("4. unrtf unknown flag, extra operand, and malformed RTF syntax diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      unrtf --bogus 2>&1; echo "rc1=$?"
      unrtf a.rtf b.rtf 2>&1; echo "rc2=$?"
      unrtf --text <<< 'not rtf' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /unrtf: E_PROFILE: Option requires an unadmitted personality\/configuration profile\nrc1=1\n/);
    assert.match(r.stdout, /unrtf: E_PARSE: Only one input file is supported\nrc2=1\n/);
    assert.match(r.stdout, /unrtf: E_PARSE: RTF requires a root group\nrc3=1\n/);
  });

  test("5. mmdc --version, --help, forbidden browser/CSS/iconPacks flags, and invalid numeric/format diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mmdc --version
      mmdc --help | head -n 1
      mmdc --iconPacks foo <<< 'graph TD; A-->B;' 2>&1; echo "rc1=$?"
      mmdc -w 0 <<< 'graph TD; A-->B;' 2>&1; echo "rc2=$?"
      mmdc -e gif <<< 'graph TD; A-->B;' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^0\.0\.1\n/);
    assert.match(r.stdout, /Usage: mmdc \[options\]/);
    assert.match(r.stdout, /mmdc: E_ARGUMENT: Option '--iconPacks' \(browser\/CSS injection\) is not supported\nrc1=2\n/);
    assert.match(r.stdout, /mmdc: E_ARGUMENT: Option '-w' requires a positive number, got '0'\nrc2=2\n/);
    assert.match(r.stdout, /mmdc: E_ARGUMENT: Unsupported output format 'gif'\. Supported formats: svg, png, pdf\nrc3=2\n/);
  });

  test("6. mmdc missing input file, directory input, output target directory, and unsupported diagram syntax diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/mmdc_dir
      mmdc -i /tmp/missing.mmd 2>&1; echo "rc1=$?"
      mmdc -i /tmp/mmdc_dir 2>&1; echo "rc2=$?"
      mmdc -e svg -o /tmp/mmdc_dir <<< 'graph TD; A-->B;' 2>&1; echo "rc3=$?"
      mmdc <<< 'not a diagram' 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /mmdc: E_IO: ENOENT: no such file or directory, realpath '\/tmp\/missing\.mmd'\nrc1=1\n/);
    assert.match(r.stdout, /mmdc: E_IO: EISDIR: illegal operation on a directory, readFile '\/tmp\/mmdc_dir'\nrc2=1\n/);
    assert.match(r.stdout, /mmdc: E_IO: Output target must be a regular file\nrc3=1\n/);
    assert.match(r.stdout, /mmdc: E_UNSUPPORTED \(line 1, column 1\): Unsupported or unrecognized Mermaid diagram family 'not'\nrc4=1\n/);
  });

  test("7. ssconvert --version, --libspreadsheet-version, --help, --help-all, --help-libspreadsheet, --help-gtk, and -O help", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      ssconvert --version | head -n 1
      ssconvert --libspreadsheet-version | head -n 1
      ssconvert --help | grep -c 'Show Gnumeric Options'
      ssconvert --help-all | grep -c 'Load additional GTK+ modules'
      ssconvert --help-libspreadsheet | grep -c 'Display Gnumeric'
      ssconvert --help-gtk | grep -c 'Program class as used by the window manager'
      ssconvert -O help | head -n 2
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ssconvert version '1.12.61'",
        "gnumeric version '1.12.61'",
        "1",
        "1",
        "1",
        "1",
        "Export options (-O 'key=value ...'):",
        "  sheet=<name>             Export named worksheet (repeatable)",
        "",
      ].join("\n")
    );
  });

  test("8. ssconvert missing option value, unknown option, unsupported GTK/display flags, and incompatible -S/-M diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      ssconvert -T 2>&1; echo "rc1=$?"
      ssconvert --bogus 2>&1; echo "rc2=$?"
      ssconvert --gtk-module=foo in.csv out.csv 2>&1; echo "rc3=$?"
      ssconvert -S -M merged.xlsx a.csv b.csv 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /Missing argument for -T\nRun 'ssconvert --help' to see a full list of available command line options\.\nrc1=1\n/);
    assert.match(r.stdout, /Unknown option --bogus\nRun 'ssconvert --help' to see a full list of available command line options\.\nrc2=1\n/);
    assert.match(r.stdout, /Unsupported ssconvert feature: --gtk-module \(virtual runtime parity blocker\)\nrc3=1\n/);
    assert.match(r.stdout, /--export-file-per-sheet and --merge-to are incompatible\nrc4=1\n/);
  });

  test("9. ssconvert missing operand, single-operand without -T, and missing/directory input file diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/ss_dir
      ssconvert 2>&1; echo "rc1=$?"
      ssconvert only_in.csv 2>&1; echo "rc2=$?"
      ssconvert /tmp/missing_ss.csv /tmp/out.csv 2>&1; echo "rc3=$?"
      ssconvert /tmp/ss_dir /tmp/out.csv 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /Usage: ssconvert \[OPTION\.\.\.\] INFILE \[OUTFILE\]\nrc1=1\n/);
    assert.match(r.stdout, /An output file name or an explicit export type is required\.\nTry --list-exporters to see a list of possibilities\.\nrc2=1\n/);
    assert.match(r.stdout, /E \/tmp\/missing_ss\.csv: No such file or directory\nrc3=1\n/);
    assert.match(r.stdout, /E \/tmp\/ss_dir: Is a directory\nrc4=1\n/);
  });

  test("10. pandoc --version, --help, --list-input-formats, --list-output-formats, and --list-extensions", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      pandoc --version | head -n 1
      pandoc --help | head -n 2
      pandoc --list-input-formats | tr '\\n' ','
      echo ""
      pandoc --list-output-formats | tr '\\n' ','
      echo ""
      pandoc --list-extensions=gfm | head -n 2
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "pandoc TypeScript converter 0.0.1 (original bounded implementation)",
        "Usage: pandoc -f FORMAT -t FORMAT [OPTIONS] [FILE|- ...]",
        "--from/--read/-f/-r --to/--write/-t/-w --output/-o PATH (use - for stdout) --yes --standalone[=true|false]/-s",
        "commonmark,commonmark_x,csv,docx,epub,gfm,html,html5,json,latex,markdown,markdown_github,markdown_mmd,markdown_phpextra,markdown_strict,md,odt,pdf,pptx,rst,rtf,tsv,xlsx,",
        "commonmark,commonmark_x,docx,epub,epub3,gfm,html,html5,json,latex,markdown,markdown_github,markdown_mmd,markdown_phpextra,markdown_strict,md,odt,pdf,plain,pptx,rst,rtf,",
        "+autolink_bare_uris",
        "+pipe_tables",
        "",
      ].join("\n")
    );
  });

  test("11. pandoc exclusive flag errors and duplicate standalone flag diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      pandoc --version -t html 2>&1; echo "rc1=$?"
      pandoc --help -t html 2>&1; echo "rc2=$?"
      pandoc --list-input-formats -t html 2>&1; echo "rc3=$?"
      pandoc -s --standalone <<< '# hi' 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /E_OPTION: Use --version alone\nrc1=2\n/);
    assert.match(r.stdout, /E_OPTION: Use help flags alone\nrc2=2\n/);
    assert.match(r.stdout, /E_OPTION: Use format listing flags alone, or --list-extensions FORMAT\nrc3=2\n/);
    assert.match(r.stdout, /E_OPTION: Repeated option: --standalone\nrc4=2\n/);
  });

  test("12. pandoc --wrap, --raw-content, --metadata, --metadata-file, format, and input/output alias diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf '# hi\n' > /tmp/p.md
      pandoc --wrap=bogus <<< '# hi' 2>&1; echo "rc1=$?"
      pandoc --raw-content=bogus <<< '# hi' 2>&1; echo "rc2=$?"
      pandoc -M '=bad' <<< '# hi' 2>&1; echo "rc3=$?"
      pandoc --metadata-file=/tmp/meta.yaml <<< '# hi' 2>&1; echo "rc4=$?"
      pandoc -f bogus <<< '# hi' 2>&1; echo "rc5=$?"
      pandoc /tmp/p.md -o /tmp/p.md 2>&1; echo "rc6=$?"
      pandoc /tmp/missing_p.md 2>&1; echo "rc7=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /E_OPTION: Invalid wrap policy\nrc1=2\n/);
    assert.match(r.stdout, /E_OPTION: Invalid raw-content policy\nrc2=2\n/);
    assert.match(r.stdout, /E_OPTION: Metadata requires a key\nrc3=2\n/);
    assert.match(r.stdout, /E_OPTION: Metadata files must use \.json; YAML is unsupported\nrc4=2\n/);
    assert.match(r.stdout, /E_FORMAT: Unsupported read format: bogus\nrc5=2\n/);
    assert.match(r.stdout, /E_IO: Input and output alias\nrc6=9\n/);
    assert.match(r.stdout, /E_IO: Capability failed\nrc7=9\n/);
  });

  test("13. ast-grep and sg --version, --help, missing pattern, invalid --json mode, and unsupported language diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      ast-grep --help | head -n 1
      sg --help | head -n 1
      ast-grep 2>&1; echo "rc1=$?"
      ast-grep -p '$A' --json=bogus <<< 'x = 1' 2>&1; echo "rc2=$?"
      ast-grep -p '$A' -l cobol <<< 'x = 1' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^Usage: ast-grep \[run\] -p PATTERN \[-r REWRITE\] \[-l LANG\] \[PATH \.\.\.\]\nUsage: ast-grep \[run\] -p PATTERN \[-r REWRITE\] \[-l LANG\] \[PATH \.\.\.\]\n/);
    assert.match(r.stdout, /ast-grep: run requires --pattern\nrc1=2\n/);
    assert.match(r.stdout, /ast-grep: invalid JSON format\nrc2=2\n/);
    assert.match(r.stdout, /ast-grep: Unsupported language: cobol\nrc3=2\n/);
  });

  test("14. ast-grep --rewrite in-place update vs stdout, --json=stream, and caller builtin parity", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'const x = foo(1);\n' > /tmp/code.ts
      ast-grep -p 'foo($A)' -r 'bar($A)' -l ts --stdin <<< 'const x = foo(42);'
      ast-grep -p 'foo($A)' -r 'bar($A)' -U /tmp/code.ts >/dev/null
      cat /tmp/code.ts
      ast-grep -p 'bar($A)' --json=stream /tmp/code.ts | jq -r '.metaVariables.single.A.text'
      caller 2>&1; echo "top_caller=$?"
      inner() { caller 0; }
      outer() { inner; }
      outer
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^STDIN:1:const x = foo\(42\);\nconst x = bar\(42\);\nconst x = bar\(1\);\n1\ntop_caller=1\n/);
    assert.match(r.stdout, /outer /);
  });

  test("15. csvcut, csvgrep, csvstat, csvsort, csvstack, csvjoin, and csvjson --version and --help output", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      for cmd in csvcut csvgrep csvstat csvsort csvstack csvjoin csvjson; do
        $cmd --version
        $cmd --help | head -n 1
      done
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "csvcut 2.2.0",
        "usage: csvcut [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvgrep 2.2.0",
        "usage: csvgrep [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvstat 2.2.0",
        "usage: csvstat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvsort 2.2.0",
        "usage: csvsort [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvstack 2.2.0",
        "usage: csvstack [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]",
        "csvjoin 2.2.0",
        "usage: csvjoin [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvjson 2.2.0",
        "usage: csvjson [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "",
      ].join("\n")
    );
  });

  test("16. in2csv, csvformat, csvlook, csvsql, sql2csv, csvclean, and csvpy --version and --help output", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      for cmd in in2csv csvformat csvlook csvsql sql2csv csvclean csvpy; do
        $cmd --version
        $cmd --help | head -n 1
      done
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "in2csv 2.2.0",
        "usage: in2csv [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvformat 2.2.0",
        "usage: csvformat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]",
        "csvlook 2.2.0",
        "usage: csvlook [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "csvsql 2.2.0",
        "usage: csvsql [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "sql2csv 2.2.0",
        "usage: sql2csv [-h] [-v] [-l] [-V] [--db CONNECTION_STRING]",
        "csvclean 2.2.0",
        "usage: csvclean [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]",
        "csvpy 2.2.0",
        "usage: csvpy [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]",
        "",
      ].join("\n")
    );
  });

  test("17. csvgrep missing -c, missing -r/-m/-f, and in2csv piped stdin without -f or unknown extension diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'id,name\n1,Ada\n' > /tmp/cg.csv
      csvgrep /tmp/cg.csv 2>&1 | tail -n 1; echo "rc1=$\{PIPESTATUS[0]}"
      csvgrep -c 1 /tmp/cg.csv 2>&1 | tail -n 1; echo "rc2=$\{PIPESTATUS[0]}"
      in2csv <<< 'a,b' 2>&1 | tail -n 1; echo "rc3=$\{PIPESTATUS[0]}"
      in2csv /tmp/cg.unknown 2>&1 | tail -n 1; echo "rc4=$\{PIPESTATUS[0]}"
      in2csv -n /tmp/cg.csv 2>&1 | tail -n 1; echo "rc5=$\{PIPESTATUS[0]}"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "csvgrep: error: You must specify at least one column to search using the -c option.",
        "rc1=2",
        "csvgrep: error: One of -r, -m or -f must be specified, unless using the -n option.",
        "rc2=2",
        "in2csv: error: You must specify a format when providing input as piped data via STDIN.",
        "rc3=2",
        "in2csv: error: Unable to automatically determine the format of the input file. Try specifying a format with --format.",
        "rc4=2",
        "in2csv: error: You cannot use the -n or --names options with non-Excel files.",
        "rc5=2",
        "",
      ].join("\n")
    );
  });

  test("18. csvstack -g count mismatch, csvjoin -c/outer/--left --right validation, and csvclean check validation", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'id,name\n1,Ada\n' > /tmp/c1.csv
      printf 'id,name\n2,Grace\n' > /tmp/c2.csv
      csvstack -g a,b,c /tmp/c1.csv /tmp/c2.csv 2>&1 | tail -n 1; echo "rc1=$\{PIPESTATUS[0]}"
      csvjoin -c id,id,id /tmp/c1.csv /tmp/c2.csv 2>&1 | tail -n 1; echo "rc2=$\{PIPESTATUS[0]}"
      csvjoin --left /tmp/c1.csv /tmp/c2.csv 2>&1 | tail -n 1; echo "rc3=$\{PIPESTATUS[0]}"
      csvjoin -c id --left --right /tmp/c1.csv /tmp/c2.csv 2>&1 | tail -n 1; echo "rc4=$\{PIPESTATUS[0]}"
      csvclean /tmp/c1.csv 2>&1 | tail -n 1; echo "rc5=$\{PIPESTATUS[0]}"
      csvclean --join-short-rows --fill-short-rows /tmp/c1.csv 2>&1 | tail -n 1; echo "rc6=$\{PIPESTATUS[0]}"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "csvstack: error: The number of grouping values must be equal to the number of CSV files being stacked.",
        "rc1=2",
        "csvjoin: error: The number of join column names must match the number of files, or be a single column name that exists in all files.",
        "rc2=2",
        "csvjoin: error: You must provide join column names when performing an outer join.",
        "rc3=2",
        "csvjoin: error: It is not valid to specify both a left and a right join.",
        "rc4=2",
        "csvclean: error: No checks or fixes were enabled. See available options with: csvclean --help",
        "rc5=2",
        "csvclean: error: The --join-short-rows and --fill-short-rows options are mutually exclusive.",
        "rc6=2",
        "",
      ].join("\n")
    );
  });

  test("19. csvstat multiple operations / conflicting flags and csvjson --lat/--lon and --snifflimit validation", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'id,val,lat,lon\n1,10,37.7,-122.4\n2,20,37.8,-122.5\n' > /tmp/stat.csv
      csvstat --mean --sum /tmp/stat.csv 2>&1 | tail -n 1; echo "rc1=$\{PIPESTATUS[0]}"
      csvstat --mean --csv /tmp/stat.csv 2>&1 | tail -n 1; echo "rc2=$\{PIPESTATUS[0]}"
      csvjson --lat lat /tmp/stat.csv 2>&1 | tail -n 1; echo "rc3=$\{PIPESTATUS[0]}"
      csvjson --lat lat --lon lon --stream -k id /tmp/stat.csv >/dev/null 2>&1; echo "rc4=$?"
      csvjson --stream -k id /tmp/stat.csv 2>&1 | tail -n 1; echo "rc5=$\{PIPESTATUS[0]}"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "csvstat: error: Only one operation argument may be specified (--mean, --median, etc).",
        "rc1=2",
        "csvstat: error: You may not specify --csv and an operation (--mean, --median, etc) at the same time.",
        "rc2=2",
        "csvjson: error: --lon is required whenever --lat is specified.",
        "rc3=2",
        "rc4=0",
        "csvjson: error: --key is only allowed with --stream when --lat and --lon are also specified.",
        "rc5=2",
        "",
      ].join("\n")
    );
  });

  test("20. csvsql --insert without --db/--query, FileNotFoundError/IsADirectoryError, and csvjoin single-file passthrough", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/csv_dir
      printf 'id,name\n1,Ada\n2,Grace\n' > /tmp/single.csv
      csvsql --insert /tmp/single.csv 2>&1 | tail -n 1; echo "rc1=$\{PIPESTATUS[0]}"
      csvcut /tmp/no_such.csv 2>&1; echo "rc2=$?"
      csvcut /tmp/csv_dir 2>&1; echo "rc3=$?"
      csvjoin /tmp/single.csv
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "csvsql: error: The --insert option is only valid when either --db or --query is specified.",
        "rc1=2",
        "FileNotFoundError: [Errno 2] No such file or directory: '/tmp/no_such.csv'",
        "rc2=1",
        "IsADirectoryError: [Errno 21] Is a directory: '/tmp/csv_dir'",
        "rc3=1",
        "id,name",
        "1,Ada",
        "2,Grace",
        "",
      ].join("\n")
    );
  });
});
