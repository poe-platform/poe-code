import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure awk, sed, rg, grep, find, fd, xargs, diff, patch, and coreutils refactor matrix", () => {
  it("01_awk_user_defined_recursive_gcd_and_lcm_matrix", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk '\n  function gcd(a, b) {\n    return b == 0 ? a : gcd(b, a % b)\n  }\n  function lcm(a, b) {\n    return (a * b) / gcd(a, b)\n  }\n  {\n    g = gcd($1, $2)\n    l = lcm($1, $2)\n    printf \"%d,%d->gcd=%d,lcm=%d\\n\", $1, $2, g, l\n  }\n' << 'EOF'\n12 18\n35 49\n24 60\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "12,18->gcd=6,lcm=36\n35,49->gcd=7,lcm=245\n24,60->gcd=12,lcm=120\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_awk_multidimensional_subsep_pivot_aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk -F',' '\n  NR > 1 {\n    grid[$1, $2] += $3\n    regions[$1] = 1\n    quarters[$2] = 1\n  }\n  END {\n    for (r in regions) {\n      for (q in quarters) {\n        printf \"%s|%s=%d\\n\", r, q, grid[r, q]\n      }\n    }\n  }\n' << 'EOF' | sort\nregion,quarter,rev\nNA,Q1,100\nNA,Q2,150\nEU,Q1,80\nNA,Q1,50\nEU,Q2,120\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "EU|Q1=80\nEU|Q2=120\nNA|Q1=150\nNA|Q2=150\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_sed_hold_space_reverse_lines_tac_emulation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sed -n '1!G;h;$p' << 'EOF'\nfirst_line\nsecond_line\nthird_line\nfourth_line\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "fourth_line\nthird_line\nsecond_line\nfirst_line\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_sed_branch_loop_joining_backslash_continuation_lines", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sed ':a; /\\\\$/ { N; s/\\\\\\n[[:space:]]*/ /; ba }' << 'EOF'\nCFLAGS = -Wall \\\n  -O2 \\\n  -Werror\nLDFLAGS = -lm\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "CFLAGS = -Wall  -O2  -Werror\nLDFLAGS = -lm\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_rg_glob_exclusion_context_and_replacement_preview", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/proj/src /workspace/proj/vendor\ncat << 'EOF' > /workspace/proj/src/api.ts\n// TODO: migrate v1 endpoint\nexport const v1 = \"/api/v1/users\";\nexport const v2 = \"/api/v2/users\";\nEOF\ncat << 'EOF' > /workspace/proj/vendor/lib.ts\nexport const v1 = \"/api/v1/ignored\";\nEOF\nrg -n -g '!vendor/**' '/api/v1/([a-z]+)' -r '/api/v3/$1' /workspace/proj");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/workspace/proj/src/api.ts:2:export const v1 = \"/api/v3/users\";\n/workspace/proj/vendor/lib.ts:1:export const v1 = \"/api/v3/ignored\";\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_find_fd_prune_and_xargs_batch_chmod_stat", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/tree/bin /workspace/tree/cache\nprintf \"#!/bin/sh\\necho ok\\n\" > /workspace/tree/bin/run.sh\nprintf \"#!/bin/sh\\necho deploy\\n\" > /workspace/tree/bin/deploy.sh\nprintf \"cached\\n\" > /workspace/tree/cache/skip.sh\nfind /workspace/tree -name cache -prune -o -type f -name '*.sh' -print | sort | xargs chmod 755\nfor f in /workspace/tree/bin/deploy.sh /workspace/tree/bin/run.sh; do\n  printf \"%s=%s\\n\" \"$(basename \"$f\")\" \"$(stat -c '%a' \"$f\")\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "deploy.sh=755\nrun.sh=755\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_apply_patch_multi_file_update_add_delete", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/app\ncat << 'EOF' > /workspace/app/config.ts\nexport const port = 3000;\nexport const host = \"127.0.0.1\";\nEOF\ncat << 'EOF' > /workspace/app/legacy.ts\nexport const old = true;\nEOF\napply_patch << 'EOF'\n*** Begin Patch\n*** Update File: /workspace/app/config.ts\n@@\n-export const port = 3000;\n+export const port = 8080;\n export const host = \"127.0.0.1\";\n*** Add File: /workspace/app/health.ts\n+export const healthy = true;\n*** Delete File: /workspace/app/legacy.ts\n*** End Patch\nEOF\nls /workspace/app | sort\ncat /workspace/app/config.ts /workspace/app/health.ts");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Success. Updated the following files:\nM /workspace/app/config.ts\nA /workspace/app/health.ts\nD /workspace/app/legacy.ts\nconfig.ts\nhealth.ts\nexport const port = 8080;\nexport const host = \"127.0.0.1\";\nexport const healthy = true;\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_sort_multi_key_version_month_and_numeric_tiebreak", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sort -t'|' -k1,1 -k2,2nr << 'EOF'\ncore|250|v1\napi|100|v2\ncore|90|v3\napi|400|v1\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "api|400|v1\napi|100|v2\ncore|250|v1\ncore|90|v3\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_join_and_comm_set_reconciliation_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/left.txt\na:10\nb:20\nc:30\nd:40\nEOF\ncat << 'EOF' > /workspace/right.txt\nb:200\nc:300\ne:500\nEOF\njoin -t':' -a 1 -e 'MISSING' -o 0,1.2,2.2 /workspace/left.txt /workspace/right.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a:10:MISSING\nb:20:200\nc:30:300\nd:40:MISSING\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_cut_paste_tr_nl_column_table_formatter", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/raw_table.txt\nalice:eng:p1\nbob:sec:p2\ncarol:data:p1\nEOF\ncut -d':' -f1,2 /workspace/raw_table.txt | tr ':' '\\t' | nl -w2 -s': '");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, " 1: alice\teng\n 2: bob\tsec\n 3: carol\tdata\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_bc_fixed_point_scale_and_expr_arithmetic", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("bc_res=$(printf \"scale=6; (355 / 113) * 1000\\n\" | bc)\nexpr_res=$(expr \\( 12 \\* 15 \\) + 20)\nprintf \"bc=%s expr=%s\\n\" \"$bc_res\" \"$expr_res\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "bc=3141.592000 expr=200\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_factor_prime_factorization_and_seq_formatted_sum", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("for n in 360 1024 2310; do\n  factor \"$n\"\ndone\nseq -f \"%03g\" 1 5 | paste -sd',' -");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "360: 2 2 2 3 3 5\n1024: 2 2 2 2 2 2 2 2 2 2\n2310: 2 3 5 7 11\n001,002,003,004,005\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_date_epoch_conversion_and_arithmetic", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("d1=$(date -u -d \"@1700000000\" \"+%Y-%m-%d %H:%M:%S\")\ne1=$(date -u -d \"2023-11-14T22:13:20Z\" \"+%s\")\nprintf \"d1=%s e1=%s\\n\" \"$d1\" \"$e1\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "d1=2023-11-14 22:13:20 e1=1700000000\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_realpath_readlink_dirname_basename_symlink_chain", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/releases/v2/bin\nprintf \"binary\\n\" > /workspace/releases/v2/bin/server\nln -s /workspace/releases/v2 /workspace/current\nln -s /workspace/current/bin/server /workspace/srv\nprintf \"readlink=%s\\nrealpath=%s\\ndir=%s\\nbase=%s\\n\" \\\n  \"$(readlink /workspace/srv)\" \\\n  \"$(realpath /workspace/srv)\" \\\n  \"$(dirname /workspace/releases/v2/bin/server)\" \\\n  \"$(basename /workspace/releases/v2/bin/server)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "readlink=/workspace/current/bin/server\nrealpath=/workspace/releases/v2/bin/server\ndir=/workspace/releases/v2/bin\nbase=server\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_grep_extended_regex_word_boundary_invert_and_count", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/code.log\nerr_code=100 status=ok\nerr_code=200 status=error\nerr_code=300 status=error_recoverable\nerr_code=400 status=error\nEOF\ngrep -E -w \"status=error\" /workspace/code.log\ngrep -v -c \"status=ok\" /workspace/code.log");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "err_code=200 status=error\nerr_code=400 status=error\n3\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_awk_begin_end_field_widths_and_ofs_ors_formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("awk 'BEGIN { FS=\":\"; OFS=\" -> \"; ORS=\";\\n\" } { print $1, $3, $2 }' << 'EOF'\nsvc_a:8080:tcp\nsvc_b:53:udp\nsvc_c:443:tls\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "svc_a -> tcp -> 8080;\nsvc_b -> udp -> 53;\nsvc_c -> tls -> 443;\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_sed_address_ranges_and_transliteration_y_command", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sed -e '2,3s/status=pending/status=done/' -e 'y/abcdef/ABCDEF/' << 'EOF'\njob1 status=pending\njob2 status=pending\njob3 status=pending\njob4 status=pending\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "joB1 stAtus=pEnDing\njoB2 stAtus=DonE\njoB3 stAtus=DonE\njoB4 stAtus=pEnDing\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_uniq_count_repeated_and_unique_only_filtering", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/tokens.txt\nalpha\nbeta\nbeta\ngamma\ndelta\ndelta\ndelta\nEOF\nuniq -c /workspace/tokens.txt | awk '{print $1 \":\" $2}'\nuniq -u /workspace/tokens.txt | paste -sd',' -");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:alpha\n2:beta\n1:gamma\n3:delta\nalpha,gamma\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_wc_lines_words_bytes_and_head_tail_negative_offsets", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/five.txt\nline_1_alpha\nline_2_beta\nline_3_gamma\nline_4_delta\nline_5_epsilon\nEOF\nhead -n -2 /workspace/five.txt | tail -n +2\nwc -l < /workspace/five.txt | tr -d ' '");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "line_2_beta\nline_3_gamma\n5\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_xargs_replace_str_and_parallel_template_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"auth\\nbilling\\nsearch\\n\" | xargs -I {} sh -c 'printf \"svc=%s len=%d\\n\" \"{}\" \"$(printf \"%s\" \"{}\" | wc -c | tr -d \" \")\"'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "svc=auth len=4\nsvc=billing len=7\nsvc=search len=6\n");
    } finally {
      await h.dispose();
    }
  });

});
