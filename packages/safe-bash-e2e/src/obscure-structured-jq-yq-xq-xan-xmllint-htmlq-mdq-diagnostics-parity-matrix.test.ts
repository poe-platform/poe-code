import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

const createEnv = () => SafeBashE2EHarness.create();

describe("obscure structured jq yq xq xan xmllint htmlq mdq diagnostics parity matrix", () => {
  test("1. jq --version, --help, unsupported option, and missing operand diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      jq --version
      jq --help | head -n 3
      jq --bogus 2>&1; echo "rc1=$?"
      jq --arg a 2>&1; echo "rc2=$?"
      jq --indent 9 '.' <<< '{}' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^jq-1\.7\.1\n/);
    assert.match(r.stdout, /jq - commandline JSON processor/);
    assert.match(r.stdout, /jq: unsupported option --bogus\nrc1=2\n/);
    assert.match(r.stdout, /jq: --arg requires an operand\nrc2=2\n/);
    assert.match(r.stdout, /jq: --indent takes a number between -1 and 7\nrc3=2\n/);
  });

  test("2. jq --argjson / --jsonargs invalid JSON, -f multiple filters, and compile syntax errors", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf '.a' > /tmp/f1.jq
      printf '.b' > /tmp/f2.jq
      jq -f /tmp/f1.jq -f /tmp/f2.jq <<< '{}' 2>&1; echo "rc1=$?"
      jq --argjson k '{bad' '.' <<< '{}' 2>&1; echo "rc2=$?"
      jq -n '.' --jsonargs '{bad' 2>&1; echo "rc3=$?"
      jq '.foo + (' <<< '{}' 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /jq: provide exactly one filter program\nrc1=2\n/);
    assert.match(r.stdout, /jq: invalid JSON for --argjson k\nrc2=2\n/);
    assert.match(r.stdout, /jq: invalid JSON text passed to --jsonargs\nrc3=2\n/);
    assert.match(r.stdout, /rc4=3\n/);
  });

  test("3. jq -e exit codes (4 on empty output, 1 on false/null, 0 on truthy) and --raw-output0 NUL rejection", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      jq -e 'empty' <<< '{}' >/dev/null 2>&1; echo "empty=$?"
      jq -e 'false' <<< '{}' >/dev/null 2>&1; echo "false=$?"
      jq -e 'null' <<< '{}' >/dev/null 2>&1; echo "null=$?"
      jq -e 'true' <<< '{}' >/dev/null 2>&1; echo "true=$?"
      jq --raw-output0 '"a\\u0000b"' <<< '{}' 2>&1; echo "nul=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "empty=4\nfalse=1\nnull=1\ntrue=0\njq: error (at <stdin>:1): Cannot dump a string containing NUL with --raw-output0 option\nnul=5\n"
    );
  });

  test("4. jq missing and directory input file readStream diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/jqdir
      jq '.' /tmp/no_such_jq.json 2>&1; echo "rc1=$?"
      jq '.' /tmp/jqdir 2>&1; echo "rc2=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "jq: ENOENT: no such file or directory, readStream '/tmp/no_such_jq.json'\nrc1=2\njq: EISDIR: illegal operation on a directory, readStream '/tmp/jqdir'\nrc2=2\n"
    );
  });

  test("5. xq --version, --help, unsupported option, missing file, and invalid XML with -n", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      xq --version
      xq --bogus 2>&1; echo "rc1=$?"
      xq '.' /tmp/missing_xq.xml 2>&1; echo "rc2=$?"
      xq -n '.' <<< '<a></b>' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "jq-1.7.1\njq: unsupported option --bogus\nrc1=2\njq: ENOENT: no such file or directory, readStream '/tmp/missing_xq.xml'\nrc2=2\nnull\njq: Invalid XML: mismatched closing tag\nrc3=1\n"
    );
  });

  test("6. yq --help across root, eval, and eval-all modes plus --version", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      yq --version
      yq --help | grep -E "^Usage:" -A 1
      yq e --help | grep -E "^Usage:" -A 1
      yq ea --help | grep -E "^Usage:" -A 1
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "yq (safe-bash; bounded Mike Farah v4.53.3 profile)\nUsage:\n  yq [flags]\nUsage:\n  yq eval [expression] [yaml_file1]... [flags]\nUsage:\n  yq eval-all [expression] [yaml_file1]... [flags]\n"
    );
  });

  test("7. yq unknown flag, unknown shorthand, missing flag argument, and invalid -I / --unwrapScalar", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      yq --bogus 2>/tmp/y1; echo "rc1=$?"; head -n 1 /tmp/y1
      yq -z 2>/tmp/y2; echo "rc2=$?"; head -n 1 /tmp/y2
      yq -o 2>/tmp/y3; echo "rc3=$?"; head -n 1 /tmp/y3
      yq -I nope '.' <<< 'a: 1' 2>/tmp/y4; echo "rc4=$?"; head -n 1 /tmp/y4
      yq -I 99999999999999999999 '.' <<< 'a: 1' 2>/tmp/y5; echo "rc5=$?"; head -n 1 /tmp/y5
      yq --unwrapScalar=maybe '.' <<< 'a: 1' 2>/tmp/y6; echo "rc6=$?"; head -n 1 /tmp/y6
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'rc1=1\nError: unknown flag: --bogus\nrc2=1\nError: unknown shorthand flag: \'z\' in -z\nrc3=1\nError: flag needs an argument: \'o\' in -o\nrc4=1\nError: invalid argument "nope" for "-I, --indent" flag: strconv.ParseInt: parsing "nope": invalid syntax\nrc5=1\nError: invalid argument "99999999999999999999" for "-I, --indent" flag: strconv.ParseInt: parsing "99999999999999999999": value out of range\nrc6=1\nError: invalid argument "maybe" for "-r, --unwrapScalar" flag: strconv.ParseBool: parsing "maybe": invalid syntax\n'
    );
  });

  test("8. yq format validation, -i / -n / -s conflicts, -e no matches found, and missing/directory files", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/yqdir
      yq -o protobuf '.' <<< 'a: 1' 2>&1; echo "rc1=$?"
      yq -o hcl '.' <<< 'a: 1' 2>&1; echo "rc2=$?"
      yq -i '.' 2>&1; echo "rc3=$?"
      yq -i -s '.a' /tmp/f.yaml 2>&1; echo "rc4=$?"
      yq -n '.' /tmp/f.yaml 2>&1; echo "rc5=$?"
      yq -e '.missing' <<< 'a: 1' 2>&1; echo "rc6=$?"
      yq '.' /tmp/missing_yq.yaml 2>&1; echo "rc7=$?"
      yq '.' /tmp/yqdir 2>&1; echo "rc8=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "Error: unknown format 'protobuf' please use [yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|shell|s|lua|l|ini|i]\nrc1=1\nError: format 'hcl' is not supported by this bounded yq profile\nrc2=1\nError: write in place flag only applicable when giving an expression and at least one file\nrc3=1\nError: write in place cannot be used with split file\nrc4=1\nError: cannot pass files in when using null-input flag\nrc5=1\nnull\nError: no matches found\nrc6=1\nError: open /tmp/missing_yq.yaml: no such file or directory\nrc7=1\nError: read /tmp/yqdir: is a directory\nrc8=1\n"
    );
  });

  test("9. xan root help/version, unknown subcommand, and subcommand unknown flag usage diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      xan 2>&1; echo "rc1=$?"
      xan bogus 2>&1; echo "rc2=$?"
      xan headers -n 2>/tmp/xh; echo "rc3=$?"; head -n 2 /tmp/xh
      xan select 2>/tmp/xs; echo "rc4=$?"; head -n 1 /tmp/xs
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "xan: expected a CSV subcommand (use xan --help)\nrc1=1\nxan bogus: expected a CSV subcommand (use xan --help)\nrc2=1\nrc3=1\nUsage:\n    xan headers [options] [<input>...]\nrc4=1\nUsage:\n"
    );
  });

  test("10. xan count parallel/threads/approx/check-alignment and slice range/byte-offset diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      printf 'a,b\n1,2\n3,4\n' > /tmp/xan.csv
      xan count -p /tmp/xan.csv 2>/tmp/xan_par.err; echo "par_rc=$? err=$(cat /tmp/xan_par.err)"
      xan count -p <<< $'a,b\n1,2\n' 2>&1; echo "rc1=$?"
      xan count -p -c /tmp/xan.csv 2>&1; echo "rc2=$?"
      xan count -t 0 /tmp/xan.csv 2>&1; echo "rc3=$?"
      xan slice -s 1 -r 1:2 /tmp/xan.csv 2>&1; echo "rc4=$?"
      xan slice -B 10 --end-byte 5 /tmp/xan.csv 2>&1; echo "rc5=$?"
      xan slice --indices 0 -s 1 /tmp/xan.csv 2>&1; echo "rc6=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "2\npar_rc=0 err=nothing is actually parallelized!\nxan count: count execution options require a file path\nrc1=1\nxan count: -p/--parallel or -t/--threads cannot be used with -a/--approx nor -c/--check-alignment!\nrc2=1\nxan count: --threads must be positive\nrc3=1\nxan slice: unsupported in bounded CSV profile: -r\nrc4=1\nxan slice: -B/--byte-offset must be less than --end-byte!\nrc5=1\nxan slice: conflicting slice modes\nrc6=1\n"
    );
  });

  test("11. xan join conflict/missing operand and missing/directory file readStream diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/xandir
      xan join --left --right a /tmp/f1.csv a /tmp/f2.csv 2>&1; echo "rc1=$?"
      xan join a /tmp/f1.csv 2>&1; echo "rc2=$?"
      xan count /tmp/no_such_xan.csv 2>&1; echo "rc3=$?"
      xan count /tmp/xandir 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "xan join: conflicting join modes\nrc1=1\nxan join: join requires columns and two inputs\nrc2=1\nxan count: ENOENT: no such file or directory, readStream '/tmp/no_such_xan.csv'\nrc3=1\nxan count: EISDIR: illegal operation on a directory, readStream '/tmp/xandir'\nrc4=1\n"
    );
  });

  test("12. xmllint --version, --help, option validation, and missing/duplicate --xpath diagnostics", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      xmllint --version 2>&1; echo "rc1=$?"
      xmllint --bogus 2>&1; echo "rc2=$?"
      xmllint --output 2>&1; echo "rc3=$?"
      xmllint --encode 2>&1; echo "rc4=$?"
      xmllint --xpath 2>&1; echo "rc5=$?"
      xmllint --xpath '//a' --xpath '//b' - <<< '<a/>' 2>&1; echo "rc6=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "xmllint: expected XML input FILE or -\nrc1=2\nxmllint: expected XML input FILE or -\nrc2=2\nxmllint: expected value after --output\nrc3=2\nxmllint: expected value after --encode\nrc4=2\nxmllint: expected QUERY [FILE|-]\nrc5=2\nxmllint: expected one --xpath QUERY\nrc6=2\n"
    );
  });

  test("13. xmllint empty XPath syntax error (exit 10), empty XPath set (exit 11), and --noout + --xpath", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      xmllint --xpath '' - <<< '<r/>' 2>&1; echo "rc1=$?"
      xmllint --xpath '//missing' - <<< '<r><a/></r>' 2>&1; echo "rc2=$?"
      xmllint --noout --xpath 'string(/r/a)' - <<< '<r><a>ok</a></r>'; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "xmllint: unsupported XPath syntax at offset 0\nrc1=10\nxmllint: XPath set is empty\nrc2=11\nok\nrc3=0\n"
    );
  });

  test("14. xmllint strict XML parser diagnostics and missing/directory file readStream errors", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/xmldir
      xmllint - <<< '' 2>&1; echo "rc1=$?"
      xmllint - <<< '<a></b>' 2>&1; echo "rc2=$?"
      xmllint - <<< '<!DOCTYPE a><a/>' 2>&1; echo "rc3=$?"
      xmllint /tmp/missing_xml.xml 2>&1; echo "rc4=$?"
      xmllint /tmp/xmldir 2>&1; echo "rc5=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "xmllint: Invalid XML: incomplete document\nrc1=1\nxmllint: Invalid XML: mismatched closing tag\nrc2=1\nxmllint: Invalid XML: DTD and entity declarations are forbidden\nrc3=1\nxmllint: ENOENT: no such file or directory, readStream '/tmp/missing_xml.xml'\nrc4=1\nxmllint: EISDIR: illegal operation on a directory, readStream '/tmp/xmldir'\nrc5=1\n"
    );
  });

  test("15. htmlq --version, --help, and E_ARGUMENT on unknown, repeated, or missing-value options", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      htmlq --version
      htmlq --help | head -n 3
      htmlq --bogus <<< '<p>x</p>' 2>&1; echo "rc1=$?"
      htmlq -t -t <<< '<p>x</p>' 2>&1; echo "rc2=$?"
      htmlq -f <<< '<p>x</p>' 2>&1; echo "rc3=$?"
      htmlq --text=1 <<< '<p>x</p>' 2>&1; echo "rc4=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "htmlq 0.5.0 (safe-bash virtual implementation)\nLike jq, but for HTML.\n\nUsage: htmlq [OPTIONS] [SELECTOR]...\nhtmlq: E_ARGUMENT\nrc1=2\nhtmlq: E_ARGUMENT\nrc2=2\nhtmlq: E_ARGUMENT\nrc3=2\nhtmlq: E_ARGUMENT\nrc4=2\n"
    );
  });

  test("16. htmlq E_SELECTOR on invalid CSS selectors and E_IO / E_UNSUPPORTED on missing or directory paths", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/hqdir
      htmlq '[' <<< '<p>x</p>' 2>&1; echo "rc1=$?"
      htmlq ':not(a, b)' <<< '<p>x</p>' 2>&1; echo "rc2=$?"
      htmlq -f /tmp/no_such.html 'p' 2>&1; echo "rc3=$?"
      htmlq -f /tmp/hqdir 'p' 2>&1; echo "rc4=$?"
      htmlq -o /tmp/hqdir 'p' <<< '<p>x</p>' 2>&1; echo "rc5=$?"
      htmlq -r '[' 'p' <<< '<p>keep</p>'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "htmlq: E_SELECTOR\nrc1=1\nhtmlq: E_SELECTOR\nrc2=1\nhtmlq: E_IO\nrc3=1\nhtmlq: E_IO\nrc4=1\nhtmlq: E_UNSUPPORTED\nrc5=1\n<p>keep</p>\n"
    );
  });

  test("17. mdq --version, -h short help vs --help long help", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mdq --version
      mdq -h | grep -E "Print help"
      mdq --help | grep -E "Print help"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "mdq 0.10.0\n          Print help (see more with '--help')\n          Print help (see a summary with '-h')\n"
    );
  });

  test("18. mdq unknown option with Jaro suggestion, repeated option, and --br / --no-br / --[no]-br conflicts", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mdq --outpu json <<< '# hi' 2>&1 | head -n 3; echo "rc1=\${PIPESTATUS[0]}"
      mdq -q -q '#' <<< '# hi' 2>&1 | head -n 1; echo "rc2=\${PIPESTATUS[0]}"
      mdq --br --no-br '#' <<< '# hi' 2>&1 | head -n 1; echo "rc3=\${PIPESTATUS[0]}"
      mdq '--[no]-br' '#' <<< '# hi' 2>&1 | head -n 1; echo "rc4=\${PIPESTATUS[0]}"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "error: unexpected argument '--outpu' found\n\n  tip: a similar argument exists: '--output'\nrc1=2\nerror: the argument '--quiet' cannot be used multiple times\nrc2=2\nerror: the argument '--br' cannot be used with '--no-br'\nrc3=2\nerror: invalid argument '--[no]-br'; use '--br' or '--no-br'.\nrc4=1\n"
    );
  });

  test("19. mdq invalid enum values, invalid --wrap-width, and --output json + --wrap-width conflict", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mdq --output yaml '#' <<< '# hi' 2>&1 | head -n 2; echo "rc1=\${PIPESTATUS[0]}"
      mdq --wrap-width abc '#' <<< '# hi' 2>&1 | head -n 1; echo "rc2=\${PIPESTATUS[0]}"
      mdq --output json --wrap-width 40 '#' <<< '# hi' 2>&1 | head -n 1; echo "rc3=\${PIPESTATUS[0]}"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "error: invalid value 'yaml' for '--output <OUTPUT>'\n  [possible values: markdown, md, json, plain]\nrc1=2\nerror: invalid value 'abc' for '--wrap-width <WRAP_WIDTH>': invalid digit found in string\nrc2=2\nerror: Can't set text width with JSON output format\nrc3=1\n"
    );
  });

  test("20. mdq missing/directory file diagnostics and invalid selector syntax error formatting", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
      mkdir -p /tmp/mdqdir
      mdq '#' /tmp/no_such.md 2>&1; echo "rc1=$?"
      mdq '#' /tmp/mdqdir 2>&1; echo "rc2=$?"
      mdq '???' <<< '# hi' 2>&1; echo "rc3=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      'entity not found while reading file "/tmp/no_such.md"\nrc1=1\nis a directory while reading file "/tmp/mdqdir"\nrc2=1\nSyntax error in select specifier:\n --> 1:1\n  |\n1 | ???\n  | ^---\n  |\n  = expected valid query\nrc3=1\n'
    );
  });
});
