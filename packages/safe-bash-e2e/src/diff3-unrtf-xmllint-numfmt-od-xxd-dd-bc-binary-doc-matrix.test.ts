import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("diff3, unrtf, xmllint, numfmt, od, xxd, dd, bc, fmt, fold, envsubst, shuf, and sponge matrix", () => {
  it("1. diff3 produces standard 3-way diff hunks (====1, ====2, ====3, ====) across mine, older, and yours", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "line1\nline2\nline3\nline4\n");
      await h.writeText("/workspace/mine.txt", "line1_mine\nline2\nline3\nline4\n");
      await h.writeText("/workspace/yours.txt", "line1\nline2\nline3\nline4_yours\n");

      const res = await h.exec("diff3 /workspace/mine.txt /workspace/base.txt /workspace/yours.txt");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /====1/);
      assert.match(res.stdout, /line1_mine/);
      assert.match(res.stdout, /====3/);
      assert.match(res.stdout, /line4_yours/);
    });
  });

  it("2. diff3 -m cleanly merges non-overlapping edits (exit 0) and emits labeled conflict blocks on overlapping edits (exit 1)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "a\nb\nc\nd\n");
      await h.writeText("/workspace/left.txt", "a_left\nb\nc\nd\n");
      await h.writeText("/workspace/right.txt", "a\nb\nc\nd_right\n");

      const clean = await h.exec("diff3 -m /workspace/left.txt /workspace/base.txt /workspace/right.txt");
      assert.equal(clean.exitCode, 0, clean.stderr);
      assert.equal(clean.stdout, "a_left\nb\nc\nd_right\n");

      await h.writeText("/workspace/right_conflict.txt", "a_right\nb\nc\nd\n");
      const conflict = await h.exec(
        "diff3 -m -L OURS -L BASE -L THEIRS /workspace/left.txt /workspace/base.txt /workspace/right_conflict.txt",
      );
      assert.equal(conflict.exitCode, 1);
      assert.match(conflict.stdout, /<<<<<<< OURS/);
      assert.match(conflict.stdout, /\|\|\|\|\|\|\| BASE/);
      assert.match(conflict.stdout, /=======/);
      assert.match(conflict.stdout, />>>>>>> THEIRS/);
    });
  });

  it("3. diff3 -e, -E, -x, -3, and -i emit ed scripts with optional w/q trailer", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "one\ntwo\nthree\n");
      await h.writeText("/workspace/mine.txt", "one\ntwo_mine\nthree\n");
      await h.writeText("/workspace/yours.txt", "one\ntwo\nthree_yours\n");

      const edRes = await h.exec("diff3 -e -i /workspace/mine.txt /workspace/base.txt /workspace/yours.txt");
      assert.equal(edRes.exitCode, 0, edRes.stderr);
      assert.match(edRes.stdout, /2,3c\ntwo\nthree_yours\n\.\nw\nq\n/);
    });
  });

  it("4. diff3 -T indents hunk lines with an initial tab and --strip-trailing-cr normalizes CRLF inputs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "alpha\r\nbeta\r\n");
      await h.writeText("/workspace/mine.txt", "alpha\r\nbeta\n");
      await h.writeText("/workspace/yours.txt", "alpha\nbeta_changed\r\n");

      const res = await h.exec(
        "diff3 -T --strip-trailing-cr /workspace/mine.txt /workspace/base.txt /workspace/yours.txt",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /\tbeta_changed/);
    });
  });

  it("5. unrtf --text converts RTF documents with paragraphs, tables, Unicode escapes, and hex escapes to plain text", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/doc.rtf",
        String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Courier;}}Hello \b World\b0!\par \trowd\intbl CellA\cell CellB\cell\row}`,
      );

      const res = await h.exec("unrtf --text --quiet /workspace/doc.rtf");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Hello World!/);
      assert.match(res.stdout, /CellA\tCellB/);
    });
  });

  it("6. unrtf --html and --latex render RTF formatting controls (\\b, \\i, \\ul, \\strike) with --quiet", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/styled.rtf",
        String.raw`{\rtf1\ansi{\b BoldText} and {\i ItalicText}\par}`,
      );

      const htmlRes = await h.exec("unrtf --html --quiet /workspace/styled.rtf");
      assert.equal(htmlRes.exitCode, 0, htmlRes.stderr);
      assert.match(htmlRes.stdout, /<(?:b|strong)>BoldText<\/(?:b|strong)>/i);
      assert.match(htmlRes.stdout, /<(?:i|em)>ItalicText<\/(?:i|em)>/i);

      const latexRes = await h.exec("unrtf --profile=gnu-0.21.10 --latex --quiet /workspace/styled.rtf");
      assert.equal(latexRes.exitCode, 0, latexRes.stderr);
      assert.match(latexRes.stdout, /\{\\bf BoldText\}/);
      assert.match(latexRes.stdout, /\{\\it ItalicText\}/);
    });
  });

  it("7. xmllint --format pretty-prints compact XML and --noout validates well-formedness", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/compact.xml",
        "<catalog><book id=\"1\"><title>Rust</title></book></catalog>",
      );

      const fmtRes = await h.exec("xmllint --format /workspace/compact.xml");
      assert.equal(fmtRes.exitCode, 0, fmtRes.stderr);
      assert.match(fmtRes.stdout, /<catalog>\n\s+<book id="1">\n\s+<title>Rust<\/title>/);

      const okRes = await h.exec("xmllint --noout /workspace/compact.xml");
      assert.equal(okRes.exitCode, 0, okRes.stderr);
      assert.equal(okRes.stdout, "");

      await h.writeText("/workspace/broken.xml", "<catalog><book></catalog>");
      const badRes = await h.exec("xmllint --noout /workspace/broken.xml");
      assert.notEqual(badRes.exitCode, 0);
    });
  });

  it("8. xmllint --c14n canonicalizes XML attribute ordering and self-closing tags", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/raw.xml",
        '<root z="last" a="first"><empty b="2" a="1"/></root>',
      );

      const res = await h.exec("xmllint --c14n /workspace/raw.xml");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '<root a="first" z="last"><empty a="1" b="2"></empty></root>');
    });
  });

  it("9. xmllint --xpath evaluates XPath node-sets, attributes, string(), and count() queries", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/servers.xml",
        `<cluster>
  <node id="n1" role="primary"><ip>10.0.0.1</ip></node>
  <node id="n2" role="replica"><ip>10.0.0.2</ip></node>
  <node id="n3" role="replica"><ip>10.0.0.3</ip></node>
</cluster>`,
      );

      const cntRes = await h.exec("xmllint --xpath 'count(//node[@role=\"replica\"])' /workspace/servers.xml");
      assert.equal(cntRes.exitCode, 0, cntRes.stderr);
      assert.equal(cntRes.stdout.trim(), "2");

      const ipRes = await h.exec("xmllint --xpath 'string(//node[@id=\"n1\"]/ip)' /workspace/servers.xml");
      assert.equal(ipRes.exitCode, 0, ipRes.stderr);
      assert.equal(ipRes.stdout.trim(), "10.0.0.1");
    });
  });

  it("10. numfmt converts between SI and IEC/IEC-i units with --header, --delimiter, --field, --suffix, and --format", async () => {
    await withE2EHarness(async (h) => {
      const toIec = await h.exec("numfmt --to=iec-i --suffix=B 1048576 2048");
      assert.equal(toIec.exitCode, 0, toIec.stderr);
      assert.equal(toIec.stdout, "1.0MiB\n2.0KiB\n");

      const fromSi = await h.exec("numfmt --from=si 2.5K 1M");
      assert.equal(fromSi.exitCode, 0, fromSi.stderr);
      assert.equal(fromSi.stdout, "2500\n1000000\n");

      const tableRes = await h.exec(
        "printf 'NAME,BYTES\\napi,1048576\\ndb,5242880\\n' | numfmt --header=1 --delimiter=, --field=2 --to=iec",
      );
      assert.equal(tableRes.exitCode, 0, tableRes.stderr);
      assert.equal(tableRes.stdout, "NAME,BYTES\napi,1.0M\ndb,5.0M\n");
    });
  });

  it("11. numfmt supports --round modes (up, down, from-zero, towards-zero, nearest) and --padding", async () => {
    await withE2EHarness(async (h) => {
      const upRes = await h.exec("numfmt --to=si --round=up 1001");
      assert.equal(upRes.exitCode, 0, upRes.stderr);
      assert.equal(upRes.stdout, "1.1k\n");

      const downRes = await h.exec("numfmt --to=si --round=down 1999");
      assert.equal(downRes.exitCode, 0, downRes.stderr);
      assert.equal(downRes.stdout, "1.9k\n");

      const padRes = await h.exec("numfmt --to=si --padding=6 1000 2000000");
      assert.equal(padRes.exitCode, 0, padRes.stderr);
      assert.equal(padRes.stdout, "  1.0k\n  2.0M\n");
    });
  });

  it("12. od formats byte streams in hex (-t x1), decimal (-t u1), escaped chars (-t c), with skip (-j) and count (-N)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeBytes("/workspace/sample.bin", new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x0a, 0x00]));

      const hexRes = await h.exec("od -A n -t x1 -j 1 -N 3 /workspace/sample.bin");
      assert.equal(hexRes.exitCode, 0, hexRes.stderr);
      assert.equal(hexRes.stdout.trim().replace(/\s+/g, " "), "42 43 44");

      const charRes = await h.exec("od -A x -t c /workspace/sample.bin");
      assert.equal(charRes.exitCode, 0, charRes.stderr);
      assert.match(charRes.stdout, /A\s+B\s+C\s+D\s+\\n\s+\\0/);
    });
  });

  it("13. xxd dumps hex/ASCII, plain hex (-p), C include (-i), binary (-b), and round-trips via xxd -r", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/msg.txt", "SafeBash!");

      const plainHex = await h.exec("xxd -p /workspace/msg.txt");
      assert.equal(plainHex.exitCode, 0, plainHex.stderr);
      assert.equal(plainHex.stdout.trim(), "536166654261736821");

      const roundTrip = await h.exec("xxd -p /workspace/msg.txt | xxd -r -p");
      assert.equal(roundTrip.exitCode, 0, roundTrip.stderr);
      assert.equal(roundTrip.stdout, "SafeBash!");

      const cInclude = await h.exec("xxd -i /workspace/msg.txt");
      assert.equal(cInclude.exitCode, 0, cInclude.stderr);
      assert.match(cInclude.stdout, /unsigned char .*msg_txt\[\]/);
      assert.match(cInclude.stdout, /unsigned int .*msg_txt_len = 9;/);

      const binDump = await h.exec("printf 'A' | xxd -b");
      assert.equal(binDump.exitCode, 0, binDump.stderr);
      assert.match(binDump.stdout, /01000001/);
    });
  });

  it("14. dd copies slices of files using bs=, count=, skip=, seek=, and status=none", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/input.dat", "0123456789ABCDEF");

      const res = await h.exec(
        "dd if=/workspace/input.dat of=/workspace/out.dat bs=4 skip=1 count=2 status=none && cat /workspace/out.dat",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "456789AB");
    });
  });

  it("15. dd applies conv=ucase, conv=lcase, conv=swab, and conv=notrunc transformations", async () => {
    await withE2EHarness(async (h) => {
      const swabRes = await h.exec("printf 'abcdef' | dd conv=swab,ucase status=none");
      assert.equal(swabRes.exitCode, 0, swabRes.stderr);
      assert.equal(swabRes.stdout, "BADCFE");

      await h.writeText("/workspace/patch.dat", "XXXXXXXXXX");
      await h.exec(
        "printf 'YYY' | dd of=/workspace/patch.dat bs=1 seek=3 conv=notrunc status=none",
      );
      assert.equal(await h.readText("/workspace/patch.dat"), "XXXYYYXXXX");
    });
  });

  it("16. bc evaluates arbitrary-precision arithmetic, base conversions (ibase/obase), functions, loops, and -l math functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
bc <<'BC_EOF'
scale=4
22 / 7
ibase=16
FF
ibase=A
obase=2
13
obase=10
define sq(x) {
  return (x * x)
}
sq(12)
s=0
for (i=1; i<=10; i++) s += i
s
BC_EOF
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3.1428\n255\n1101\n144\n55\n");
    });
  });

  it("17. fmt reflows paragraphs to target width and fold wraps lines at spaces (-s) or byte counts (-b)", async () => {
    await withE2EHarness(async (h) => {
      const fmtRes = await h.exec(
        "printf 'alpha beta gamma delta epsilon zeta eta theta\\n' | fmt -w 20",
      );
      assert.equal(fmtRes.exitCode, 0, fmtRes.stderr);
      const fmtLines = fmtRes.stdout.trim().split("\n");
      assert.ok(fmtLines.length >= 2);
      for (const line of fmtLines) {
        assert.ok(line.length <= 20, `Line exceeded width 20: ${line}`);
      }

      const foldRes = await h.exec("printf 'hello world foo bar\\n' | fold -s -w 11");
      assert.equal(foldRes.exitCode, 0, foldRes.stderr);
      assert.equal(foldRes.stdout, "hello \nworld foo \nbar\n");
    });
  });

  it("18. envsubst substitutes environment variables selectively with restriction format strings and lists variables via -v", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `HOST=db.internal PORT=5432 SECRET=keep_literal envsubst '$HOST $PORT' <<< 'postgres://$HOST:$PORT/?secret=\${SECRET}'`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "postgres://db.internal:5432/?secret=${SECRET}\n");

      const varsRes = await h.exec("envsubst -v 'postgres://$HOST:${PORT}/$DB_NAME'");
      assert.equal(varsRes.exitCode, 0, varsRes.stderr);
      assert.equal(varsRes.stdout, "HOST\nPORT\nDB_NAME\n");
    });
  });

  it("19. shuf generates permutations from ranges (-i) and argument lists (-e), and sponge updates files in place safely", async () => {
    await withE2EHarness(async (h) => {
      const rangeRes = await h.exec("shuf -i 1-5 | sort -n");
      assert.equal(rangeRes.exitCode, 0, rangeRes.stderr);
      assert.equal(rangeRes.stdout, "1\n2\n3\n4\n5\n");

      await h.writeText("/workspace/inplace.txt", "c\na\nb\n");
      const spongeRes = await h.exec("sort /workspace/inplace.txt | sponge /workspace/inplace.txt");
      assert.equal(spongeRes.exitCode, 0, spongeRes.stderr);
      assert.equal(await h.readText("/workspace/inplace.txt"), "a\nb\nc\n");
    });
  });

  it("20. chains xxd -> dd -> od -> bc -> numfmt -> sponge in an end-to-end binary telemetry pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
printf '61626364' | xxd -r -p | dd conv=ucase status=none > /workspace/upper.bin
bytes_sum=$(od -A n -t u1 /workspace/upper.bin | tr -s ' ' '\n' | grep -E '^[0-9]+$' | paste -sd+ - | bc)
scaled=$(echo "$bytes_sum * 4096" | bc | numfmt --to=iec-i --suffix=B)
printf 'ascii=%s sum=%s scaled=%s\n' "$(cat /workspace/upper.bin)" "$bytes_sum" "$scaled" > /workspace/report.txt
tr 'a-z' 'A-Z' < /workspace/report.txt | sponge /workspace/report.txt
cat /workspace/report.txt
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ASCII=ABCD SUM=266 SCALED=1.1MIB\n");
    });
  });
});
