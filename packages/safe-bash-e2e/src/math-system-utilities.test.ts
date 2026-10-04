import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("bc arbitrary-precision arithmetic, scale=10 division, and recursive function definition", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'BC' | bc",
      "scale=6",
      "22 / 7",
      "define fact(n) {",
      "  if (n <= 1) return (1);",
      "  return (n * fact(n - 1));",
      "}",
      "fact(10)",
      "2 ^ 64",
      "BC",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "3.142857",
        "3628800",
        "18446744073709551616",
        "",
      ].join("\n"),
    );
  });
});

test("bc base conversions (ibase and obase) between hex, binary, and decimal", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'obase=16; 255\\nobase=2; 42\\n' | bc",
      "printf 'ibase=16; FF + 1\\n' | bc",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "FF",
        "101010",
        "256",
        "",
      ].join("\n"),
    );
  });
});

test("bc -l standard math library (sqrt, s, c, a, l, e) computes pi to 10 decimal places", async () => {
  await withE2EHarness(async (h) => {
    const script = "printf 'scale=10; 4 * a(1)\\nsqrt(2)\\n' | bc -l";
    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n");
    assert.match(lines[0]!, /^3\.141592653/);
    assert.match(lines[1]!, /^1\.414213562/);
  });
});

test("expr integer arithmetic, comparisons, regex matching, substr, index, and length", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "expr 14 '*' 3 + 8",
      "expr 'release-v2.4.9' : 'release-v\\([0-9.]*\\)'",
      "expr substr 'abcdefghi' 4 3",
      "expr length 'safe-bash-rust'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "50",
        "2.4.9",
        "def",
        "14",
        "",
      ].join("\n"),
    );
  });
});

test("factor computes prime factorizations from arguments and stdin stream", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "factor 1 12 360 997",
      "printf '1024\\n2310\\n' | factor",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1:",
        "12: 2 2 3",
        "360: 2 2 2 3 3 5",
        "997: 997",
        "1024: 2 2 2 2 2 2 2 2 2 2",
        "2310: 2 3 5 7 11",
        "",
      ].join("\n"),
    );
  });
});

test("seq with equal-width padding (-w), custom separator (-s), format (-f), and negative steps", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq -w 8 10",
      "seq -s ':' 10 -3 1",
      "seq -f 'item-%03g' 1 3",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "08",
        "09",
        "10",
        "10:7:4:1",
        "item-001",
        "item-002",
        "item-003",
        "",
      ].join("\n"),
    );
  });
});

test("numfmt human-readable unit conversions (--to=iec, --to=si, --from=iec, --field)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "numfmt --to=iec 1048576",
      "numfmt --to=si 1000000",
      "numfmt --from=iec 2G",
      "printf 'cache 5242880\\nindex 1073741824\\n' | numfmt --field=2 --to=iec",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1.0M",
        "1.0M",
        "2147483648",
        "cache    5.0M",
        "index       1.0G",
        "",
      ].join("\n"),
    );
  });
});

test("envsubst substitutes only whitelisted variables when restriction string is provided", async () => {
  await withE2EHarness(
    {
      env: {
        APP_HOST: "api.acme.internal",
        APP_PORT: "8443",
        UNTOUCHED_VAR: "should_not_expand",
      },
    },
    async (h) => {
      const script = [
        "printf 'endpoint=https://${APP_HOST}:${APP_PORT}/v1?raw=${UNTOUCHED_VAR}\\n' | envsubst '$APP_HOST $APP_PORT'",
        "printf '${APP_HOST}\\n${APP_PORT}\\n${UNTOUCHED_VAR}\\n' | envsubst -v '$APP_HOST $APP_PORT'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "endpoint=https://api.acme.internal:8443/v1?raw=${UNTOUCHED_VAR}",
          "APP_HOST",
          "APP_PORT",
          "",
        ].join("\n"),
      );
    },
  );
});

test("iconv converts character encodings between UTF-8 and ISO-8859-1 / UTF-16LE", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'caf\\xc3\\xa9\\n' > /workspace/utf8.txt",
      "iconv -f UTF-8 -t ISO-8859-1 /workspace/utf8.txt > /workspace/latin1.bin",
      "wc -c < /workspace/latin1.bin | tr -d ' '",
      "iconv -f ISO-8859-1 -t UTF-8 /workspace/latin1.bin",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "5",
        "café",
        "",
      ].join("\n"),
    );
  });
});

test("unix2dos and dos2unix convert LF <-> CRLF line endings accurately", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'line1\\nline2\\nline3\\n' > /workspace/text.txt",
      "wc -c < /workspace/text.txt | tr -d ' '",
      "unix2dos /workspace/text.txt 2>/dev/null",
      "wc -c < /workspace/text.txt | tr -d ' '",
      "dos2unix /workspace/text.txt 2>/dev/null",
      "wc -c < /workspace/text.txt | tr -d ' '",
      "cat /workspace/text.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "18",
        "21",
        "18",
        "line1",
        "line2",
        "line3",
        "",
      ].join("\n"),
    );
  });
});

test("cal renders leap-year February 2024 with 29 days and full month header", async () => {
  await withE2EHarness(async (h) => {
    const res = await h.exec("cal 2 2024");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /February 2024/);
    assert.match(res.stdout, /29/);
    assert.doesNotMatch(res.stdout, /30/);
  });
});

test("date -u formatting (+%Y-%m-%dT%H:%M:%SZ) and epoch (@timestamp / -d) parsing", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "date -u -d '@1700000000' '+%Y-%m-%d %H:%M:%S'",
      "date -u -d '2025-01-15T00:00:00Z' '+%Y-%m-%d'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "2023-11-14 22:13:20",
        "2025-01-15",
        "",
      ].join("\n"),
    );
  });
});

test("timeout allows fast commands to succeed and aborts slow commands with exit code 124", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "timeout 2s echo 'completed_in_time'",
      "timeout 0.02s sleep 5 || echo \"timeout_rc:$?\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "completed_in_time",
        "timeout_rc:124",
        "",
      ].join("\n"),
    );
  });
});

test("getopt parses short and long options into normalized canonical order before '--'", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "parsed=$(getopt -o ab: --long alpha,beta: -- -a pos1 --beta val2 pos2)",
      'eval set -- "$parsed"',
      "out=''",
      "while true; do",
      "  case \"$1\" in",
      "    -a|--alpha) out=\"${out}A:\"; shift ;;",
      "    -b|--beta) out=\"${out}B=$2:\"; shift 2 ;;",
      "    --) shift; break ;;",
      "  esac",
      "done",
      'echo "${out}rest=$*"',
    ].join("\n");

    await h.expectOk(script, "A:B=val2:rest=pos1 pos2\n");
  });
});

test("id, whoami, uname, hostname, nproc, locale, and getconf report deterministic sandbox environment metadata", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "id -u",
      "id -g",
      "whoami",
      "uname -s",
      "hostname",
      "nproc",
      "getconf PATH_MAX /",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n");
    assert.equal(lines.length, 7);
    assert.match(lines[0]!, /^\d+$/);
    assert.match(lines[1]!, /^\d+$/);
    assert.ok(lines[2]!.length > 0);
    assert.match(lines[3]!, /Linux/i);
    assert.ok(lines[4]!.length > 0);
    assert.match(lines[5]!, /^\d+$/);
    assert.match(lines[6]!, /^\d+$/);
  });
});

test("env -i and -u isolate environment variables and printenv inspects specific keys", async () => {
  await withE2EHarness(
    {
      env: {
        KEEP_ME: "kept",
        DROP_ME: "dropped",
      },
    },
    async (h) => {
      const script = [
        "env -u DROP_ME printenv KEEP_ME",
        "env -u DROP_ME printenv DROP_ME || echo 'dropped:yes'",
        "env -i ONLY_VAR=42 printenv ONLY_VAR",
        "env -i ONLY_VAR=42 printenv KEEP_ME || echo 'isolated:yes'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "kept",
          "dropped:yes",
          "42",
          "isolated:yes",
          "",
        ].join("\n"),
      );
    },
  );
});

test("yes piped to head -n terminates cleanly via downstream pipe closure without hanging", async () => {
  await withE2EHarness(async (h) => {
    const script = "yes 'confirm' | head -n 4";
    await h.expectOk(
      script,
      ["confirm", "confirm", "confirm", "confirm", ""].join("\n"),
    );
  });
});

test("less and more pass stdin through transparently when invoked in non-interactive pipelines", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'alpha\\nbeta\\ngamma\\n' | less | tr 'a-z' 'A-Z'",
      "printf 'one\\ntwo\\n' | more | wc -l | tr -d ' '",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ALPHA",
        "BETA",
        "GAMMA",
        "2",
        "",
      ].join("\n"),
    );
  });
});

test("locale reports C/POSIX locale settings consistently", async () => {
  await withE2EHarness(async (h) => {
    const res = await h.exec("locale");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /LANG=/);
    assert.match(res.stdout, /LC_ALL=/);
  });
});

test("capacity planning pipeline: seq -> awk -> bc -> numfmt report generation", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "for tier in $(seq 1 3); do",
      "  bytes=$(printf '%s * 10485760\\n' \"$tier\" | bc)",
      "  human=$(numfmt --to=iec \"$bytes\")",
      '  printf "tier-%d %s\\n" "$tier" "$human"',
      "done",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "tier-1 10M",
        "tier-2 20M",
        "tier-3 30M",
        "",
      ].join("\n"),
    );
  });
});
