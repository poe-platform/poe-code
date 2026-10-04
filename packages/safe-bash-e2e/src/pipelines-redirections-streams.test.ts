import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("8-stage pipeline combining shell functions, grep, sed, awk, sort, uniq, and head", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "emit_records() {",
      "  cat <<'EOF'",
      "2026-10-01 INFO  auth user=alice latency=12",
      "2026-10-01 ERROR api  user=bob   latency=450",
      "2026-10-01 ERROR auth user=alice latency=320",
      "2026-10-01 WARN  db   user=carol latency=90",
      "2026-10-01 ERROR api  user=alice latency=510",
      "2026-10-01 ERROR api  user=bob   latency=600",
      "2026-10-01 INFO  api  user=dave  latency=15",
      "2026-10-01 ERROR auth user=alice latency=280",
      "EOF",
      "}",
      "",
      "emit_records \\",
      "  | grep 'ERROR' \\",
      "  | sed -E 's/ +/ /g' \\",
      "  | awk '{ print $3, $4 }' \\",
      "  | sed 's/user=//' \\",
      "  | sort \\",
      "  | uniq -c \\",
      "  | sort -k1,1nr -k2,2 \\",
      "  | awk '{ printf \"%s:%s=%d\\n\", $2, $3, $1 }'",
    ].join("\n");

    await h.expectOk(
      script,
      ["api:bob=2", "auth:alice=2", "api:alice=1", ""].join("\n"),
    );
  });
});

test("file descriptor swapping (3>&1 1>&2 2>&3) and selective stderr capture", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "both() {",
      '  echo "normal_stdout"',
      '  echo "error_stderr" >&2',
      "}",
      "",
      "captured_err=$(both 3>&1 1>&2 2>&3 3>&- >/dev/null)",
      'echo "swapped_err:$captured_err"',
      "",
      "upper_out=$( { both; } 2>/workspace/err_only.txt | tr 'a-z_' 'A-Z-' )",
      'echo "upper_out:$upper_out"',
      'echo "file_err:$(cat /workspace/err_only.txt)"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "swapped_err:error_stderr",
        "upper_out:NORMAL-STDOUT",
        "file_err:error_stderr",
        "",
      ].join("\n"),
    );
  });
});

test("noclobber (set -C) prevents accidental overwrite while >| forces clobbering", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'echo "initial" > /workspace/protected.txt',
      "set -C",
      '( echo "accidental" > /workspace/protected.txt ) 2>|/workspace/clobber_err.txt || clobber_rc=$?',
      'echo "clobber_blocked:$(( clobber_rc != 0 )):$(cat /workspace/protected.txt)"',
      'echo "appended" >> /workspace/protected.txt',
      'echo "after_append:$(tr "\\n" "," < /workspace/protected.txt)"',
      'echo "forced" >| /workspace/protected.txt',
      'echo "after_force:$(cat /workspace/protected.txt)"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "clobber_blocked:1:initial",
        "after_append:initial,appended,",
        "after_force:forced",
        "",
      ].join("\n"),
    );
  });
});

test("sponge atomic in-place file transformation without truncating input", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/list.txt": ["delta", "alpha", "charlie", "alpha", "bravo", "delta", ""].join("\n"),
      },
    },
    async (h) => {
      await h.expectOk(
        "sort /workspace/list.txt | uniq | awk '{ print NR \":\" $0 }' | sponge /workspace/list.txt && cat /workspace/list.txt",
        ["1:alpha", "2:bravo", "3:charlie", "4:delta", ""].join("\n"),
      );
    },
  );
});

test("infinite stream backpressure and early consumer termination (yes, seq, while true)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'c1=$(yes "payload_token" | head -n 150 | wc -l | tr -d " ")',
      'c2=$(seq 1 50000 | sed -n "100,104p" | paste -sd "," -)',
      'c3=$(i=0; while true; do (( i++ )); echo "item_$i"; done | head -n 5 | tail -n 1)',
      'echo "c1=$c1|c2=$c2|c3=$c3"',
    ].join("\n");

    await h.expectOk(
      script,
      "c1=150|c2=100,101,102,103,104|c3=item_5\n",
    );
  });
});

test("tee multi-sink fanout and branch aggregation", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "count=$(seq 1 20 | tee /workspace/all.txt | awk '$1 % 2 == 0' | tee /workspace/evens.txt | awk '$1 % 4 == 0' | wc -l | tr -d ' ')",
      'all_lines=$(wc -l < /workspace/all.txt | tr -d " ")',
      'even_lines=$(wc -l < /workspace/evens.txt | tr -d " ")',
      'echo "div4=$count|evens=$even_lines|all=$all_lines"',
    ].join("\n");

    await h.expectOk(script, "div4=5|evens=10|all=20\n");
  });
});

test("process substitution <(...) with comm, diff, and while-read state persistence", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/left.txt": "banana\napple\ncherry\ndate\n",
        "/workspace/right.txt": "cherry\nfig\napple\nelderberry\n",
      },
    },
    async (h) => {
      const script = [
        "common=$(comm -12 <(sort /workspace/left.txt) <(sort /workspace/right.txt) | paste -sd ',' -)",
        "only_left=$(comm -23 <(sort /workspace/left.txt) <(sort /workspace/right.txt) | paste -sd ',' -)",
        'echo "common:$common|only_left:$only_left"',
        "",
        "total=0",
        "while read -r n; do",
        "  (( total += n ))",
        "done < <(seq 1 10)",
        'echo "sum:$total"',
      ].join("\n");

      await h.expectOk(
        script,
        ["common:apple,cherry|only_left:banana,date", "sum:55", ""].join("\n"),
      );
    },
  );
});

test("all 256 byte values (0x00..0xff) round-trip through pipes, codecs, and VFS", async () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;

  await withE2EHarness(
    {
      files: {
        "/workspace/raw.bin": allBytes,
      },
    },
    async (h) => {
      const script = [
        "cat /workspace/raw.bin | base64 | base64 -d > /workspace/rt_b64.bin",
        "cat /workspace/raw.bin | base32 | base32 -d > /workspace/rt_b32.bin",
        "cat /workspace/raw.bin | xxd | xxd -r > /workspace/rt_xxd.bin",
        "cat /workspace/raw.bin | gzip -c | gunzip -c > /workspace/rt_gz.bin",
        "cat /workspace/raw.bin | bzip2 -c | bunzip2 -c > /workspace/rt_bz2.bin",
        "cat /workspace/raw.bin | xz -c | unxz -c > /workspace/rt_xz.bin",
        "cat /workspace/raw.bin | zstd -c | unzstd -c > /workspace/rt_zst.bin",
        "cmp -s /workspace/raw.bin /workspace/rt_b64.bin && echo 'b64:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_b32.bin && echo 'b32:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_xxd.bin && echo 'xxd:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_gz.bin && echo 'gz:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_bz2.bin && echo 'bz2:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_xz.bin && echo 'xz:ok'",
        "cmp -s /workspace/raw.bin /workspace/rt_zst.bin && echo 'zst:ok'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "b64:ok",
          "b32:ok",
          "xxd:ok",
          "gz:ok",
          "bz2:ok",
          "xz:ok",
          "zst:ok",
          "",
        ].join("\n"),
      );

      const rtBytes = await h.readBytes("/workspace/rt_zst.bin");
      assert.deepEqual(rtBytes, allBytes);
    },
  );
});

test("/dev/null and /dev/zero device stream behavior with dd and head -c", async () => {
  await withE2EHarness({ mountDev: true }, async (h) => {
    const script = [
      "dd if=/dev/zero of=/workspace/zeros.bin bs=16 count=4 status=none",
      "size=$(wc -c < /workspace/zeros.bin | tr -d ' ')",
      "non_zero=$(tr -d '\\0' < /workspace/zeros.bin | wc -c | tr -d ' ')",
      "null_size=$(cat /dev/null | wc -c | tr -d ' ')",
      'echo "size=$size|non_zero=$non_zero|null_size=$null_size"',
    ].join("\n");

    await h.expectOk(script, "size=64|non_zero=0|null_size=0\n");
  });
});

test("command substitution trailing-newline stripping vs internal-newline and space preservation", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'val=$(printf "line1\\n\\nline2   \\n\\n\\n")',
      'printf "<%s>\\n" "$val"',
    ].join("\n");

    await h.expectOk(script, "<line1\n\nline2   >\n");
  });
});

test("compound block custom file descriptors (3>, 4>&3, 4<, read -u)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "{",
      '  echo "alpha" >&3',
      '  echo "beta" >&4',
      "} 3>/workspace/fd3.log 4>&3",
      "{",
      "  read -r -u 4 first",
      "  read -r -u 4 second",
      "} 4</workspace/fd3.log",
      'echo "first=$first|second=$second"',
    ].join("\n");

    await h.expectOk(script, "first=alpha|second=beta\n");
  });
});

test("combined stdout and stderr redirection operators (&> and &>>)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "emit_mixed() {",
      '  echo "out_1"',
      '  echo "err_1" >&2',
      "}",
      "emit_mixed &> /workspace/combined.log",
      'echo "tail_out" &>> /workspace/combined.log',
      "sort /workspace/combined.log",
    ].join("\n");

    await h.expectOk(script, ["err_1", "out_1", "tail_out", ""].join("\n"));
  });
});

test("compound group and subshell redirections feeding and consuming pipelines", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/numbers.txt": "10\n20\n30\n40\n",
      },
    },
    async (h) => {
      const script = [
        "{",
        '  echo "header=items"',
        "  awk '{ print \"val=\" $1 * 2 }' /workspace/numbers.txt",
        '  echo "footer=done"',
        "} > /workspace/framed.txt",
        "",
        "grep '^val=' < /workspace/framed.txt | cut -d= -f2 | paste -sd '+' - | bc",
      ].join("\n");

      await h.expectOk(script, "200\n");
    },
  );
});

test("while-read loop redirecting both input and output with internal stderr filtering", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/raw_kv.txt": [
          "host = api.internal",
          "# comment line",
          "port = 8080",
          "invalid_line_without_equals",
          "tls = true",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "while IFS= read -r line; do",
        '  [[ -z "$line" || "$line" == \\#* ]] && continue',
        '  if [[ "$line" != *=* ]]; then',
        '    echo "bad:$line" >&2',
        "    continue",
        "  fi",
        '  key="${line%%=*}"',
        '  val="${line#*=}"',
        '  key="${key%"${key##*[![:space:]]}"}"',
        '  val="${val#"${val%%[![:space:]]*}"}"',
        '  echo "${key}:${val}"',
        "done < /workspace/raw_kv.txt > /workspace/clean_kv.txt 2> /workspace/bad_kv.txt",
        'echo "clean=$(paste -sd "," /workspace/clean_kv.txt)"',
        'echo "bad=$(cat /workspace/bad_kv.txt)"',
      ].join("\n");

      await h.expectOk(
        script,
        [
          "clean=host:api.internal,port:8080,tls:true",
          "bad=bad:invalid_line_without_equals",
          "",
        ].join("\n"),
      );
    },
  );
});

test("xargs -0 pipeline with find -print0 handling filenames with spaces and symbols", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/drop/file one.txt": "alpha\n",
        "/workspace/drop/file [two].txt": "beta\ngamma\n",
        "/workspace/drop/sub dir/file three!.txt": "delta\nepsilon\nzeta\n",
      },
    },
    async (h) => {
      const script = [
        "find /workspace/drop -type f -name '*.txt' -print0 \\",
        "  | sort -z \\",
        "  | xargs -0 wc -l \\",
        "  | tail -n 1 \\",
        "  | awk '{ print $1 }'",
      ].join("\n");

      await h.expectOk(script, "6\n");
    },
  );
});

test("multi-heredoc command combining two distinct input descriptors (0 and 3)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "{",
      "  while read -r -u 0 left && read -r -u 3 right; do",
      '    echo "$left:$right"',
      "  done",
      "} <<'LEFT' 3<<'RIGHT'",
      "k1",
      "k2",
      "k3",
      "LEFT",
      "v1",
      "v2",
      "v3",
      "RIGHT",
    ].join("\n");

    await h.expectOk(script, ["k1:v1", "k2:v2", "k3:v3", ""].join("\n"));
  });
});

test("read builtin with custom delimiter (-d), character count (-n), and array (-a)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'IFS=":" read -r -a parts <<< "svc:auth:9000:prod"',
      'echo "count=${#parts[@]}|p1=${parts[1]}|p3=${parts[3]}"',
      "",
      'read -r -d ";" segment <<< "hello world;ignored"',
      'echo "segment=$segment"',
      "",
      'read -r -n 4 prefix <<< "abcdefg"',
      'echo "prefix=$prefix"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "count=4|p1=auth|p3=prod",
        "segment=hello world",
        "prefix=abcd",
        "",
      ].join("\n"),
    );
  });
});

test("mapfile / readarray reading pipelines and stripping or preserving delimiters", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mapfile -t lines < <(printf 'row_a\\nrow_b\\nrow_c\\n')",
      'echo "n=${#lines[@]}|0=${lines[0]}|2=${lines[2]}"',
      "",
      "readarray -t -s 1 -n 2 slice < <(printf 'first\\nsecond\\nthird\\nfourth\\n')",
      'echo "slice=${slice[*]}"',
    ].join("\n");

    await h.expectOk(
      script,
      ["n=3|0=row_a|2=row_c", "slice=second third", ""].join("\n"),
    );
  });
});

test("head and tail byte and line slicing with negative offsets", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq 1 10 > /workspace/ten.txt",
      "mid=$(tail -n +3 /workspace/ten.txt | head -n -2 | paste -sd ',' -)",
      'echo "mid=$mid"',
      "bytes=$(printf '0123456789abcdef' | tail -c 6 | head -c 4)",
      'echo "bytes=$bytes"',
    ].join("\n");

    await h.expectOk(script, ["mid=3,4,5,6,7,8", "bytes=abcdef".slice(0, 10), ""].join("\n"));
  });
});

test("pipeline negated exit status (! cmd1 | cmd2) with and without pipefail", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "set +o pipefail",
      "! false | true",
      'echo "neg_no_pipefail=$?"',
      "set -o pipefail",
      "! false | true",
      'echo "neg_with_pipefail=$?"',
    ].join("\n");

    await h.expectOk(
      script,
      ["neg_no_pipefail=1", "neg_with_pipefail=0", ""].join("\n"),
    );
  });
});
