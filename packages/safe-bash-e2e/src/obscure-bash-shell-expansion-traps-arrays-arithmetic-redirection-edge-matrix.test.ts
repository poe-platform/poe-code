import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure bash shell expansion, traps, arrays, arithmetic, and redirection edge matrix", () => {
  it("01_parameter_expansion_prefix_suffix_case_mod_substr", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("v=\"  /var/log/nginx/access.2026-10-06.log.gz  \"\ntrimmed=\"${v#\"${v%%[![:space:]]*}\"}\"\ntrimmed=\"${trimmed%\"${trimmed##*[![:space:]]}\"}\"\nbase=\"${trimmed##*/}\"\nstem=\"${base%%.*}\"\next=\"${base#*.}\"\nword=\"hello_world\"\nprintf \"trim=%s\\nbase=%s\\nstem=%s\\next=%s\\nup=%s\\nfirst=%s\\nslice=%s\\ntail=%s\\n\" \\\n  \"$trimmed\" \"$base\" \"$stem\" \"$ext\" \"${word^^}\" \"${word^}\" \"${base:0:6}\" \"${base: -6:3}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "trim=/var/log/nginx/access.2026-10-06.log.gz\nbase=access.2026-10-06.log.gz\nstem=access\next=2026-10-06.log.gz\nup=HELLO_WORLD\nfirst=Hello_world\nslice=access\ntail=log\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_associative_and_indexed_array_slicing_keys_delete", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("declare -A scores=([alice]=95 [bob]=82 [carol]=91 [dave]=88)\nunset 'scores[bob]'\nscores[eve]=99\nfor k in \"${!scores[@]}\"; do\n  printf \"%s=%s\\n\" \"$k\" \"${scores[$k]}\"\ndone | sort\narr=(alpha beta gamma delta epsilon zeta)\nprintf \"slice=%s\\ncount=%d\\nlen2=%d\\n\" \"${arr[*]:2:3}\" \"${#arr[@]}\" \"${#arr[4]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alice=95\ncarol=91\ndave=88\neve=99\nslice=gamma delta epsilon\ncount=6\nlen2=7\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_arithmetic_radix_bitwise_ternary_comma_compound", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("a=$(( 16#ff & 8#377 ))\nb=$(( 2#101010 ^ 2#111100 ))\nc=$(( (a > 200 ? 10 : 20) + (b << 2) ))\nx=5\ny=$(( x += 3, x *= 2, x - 1 ))\nprintf \"a=%d b=%d c=%d x=%d y=%d\\n\" \"$a\" \"$b\" \"$c\" \"$x\" \"$y\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a=255 b=22 c=98 x=16 y=15\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_nameref_indirect_expansion_and_function_mutation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("modify_via_ref() {\n  local -n ref=\"$1\"\n  ref=\"${ref}_modified:${2}\"\n}\ntarget_var=\"initial\"\nptr=\"target_var\"\nmodify_via_ref \"$ptr\" \"step1\"\nprintf \"indirect=%s direct=%s\\n\" \"${!ptr}\" \"$target_var\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "indirect=initial_modified:step1 direct=initial_modified:step1\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_case_fallthrough_and_extglob_patterns", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("classify() {\n  for item in \"$@\"; do\n    tag=\"\"\n    case \"$item\" in\n      [0-9][0-9][0-9])\n        tag=\"three_digit:\"\n        ;&\n      [0-9]*)\n        tag=\"${tag}numeric\"\n        ;;\n      err_*|warn_*)\n        tag=\"alert\"\n        ;;\n      *)\n        tag=\"other\"\n        ;;\n    esac\n    printf \"%s->%s\\n\" \"$item\" \"$tag\"\n  done\n}\nclassify 123 45 err_disk warn_cpu ok_status");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "123->three_digit:numeric\n45->numeric\nerr_disk->alert\nwarn_cpu->alert\nok_status->other\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_trap_exit_and_return_cleanup_order", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("log=\"\"\nrun_work() {\n  trap 'log=\"${log}:return_trap\"' RETURN\n  log=\"${log}:inside_fn\"\n}\ntrap 'printf \"final_log=%s\\n\" \"$log\"' EXIT\nlog=\"start\"\nrun_work\nlog=\"${log}:after_fn\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "final_log=start:inside_fn:return_trap:after_fn\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_read_ifs_custom_delimiter_and_array_split", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("data=\"usr:bin:env:python3|/opt/app/run.sh|8080\"\nIFS='|' read -r col1 col2 col3 <<< \"$data\"\nIFS=':' read -r -a parts <<< \"$col1\"\nprintf \"col2=%s col3=%s parts_count=%d p0=%s p3=%s\\n\" \"$col2\" \"$col3\" \"${#parts[@]}\" \"${parts[0]}\" \"${parts[3]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "col2=/opt/app/run.sh col3=8080 parts_count=4 p0=usr p3=python3\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_mapfile_readarray_with_skip_count_and_strip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("input=$(printf \"line0\\nline1\\nline2\\nline3\\nline4\\n\")\nmapfile -t -s 1 -n 3 lines <<< \"$input\"\nprintf \"count=%d:[%s][%s][%s]\\n\" \"${#lines[@]}\" \"${lines[0]}\" \"${lines[1]}\" \"${lines[2]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "count=3:[line1][line2][line3]\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_getopts_short_options_with_arguments_and_shift", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("parse_cli() {\n  local OPTIND=1 opt mode=\"default\" count=1 verbose=0\n  while getopts \":m:c:v\" opt; do\n    case \"$opt\" in\n      m) mode=\"$OPTARG\" ;;\n      c) count=\"$OPTARG\" ;;\n      v) verbose=$(( verbose + 1 )) ;;\n      :) printf \"missing_arg=%s\\n\" \"$OPTARG\"; return 1 ;;\n      \\?) printf \"unknown_opt=%s\\n\" \"$OPTARG\"; return 1 ;;\n    esac\n  done\n  shift $(( OPTIND - 1 ))\n  printf \"mode=%s count=%s verbose=%d rest=%s\\n\" \"$mode\" \"$count\" \"$verbose\" \"$*\"\n}\nparse_cli -v -m turbo -v -c 4 -- file1.txt file2.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "mode=turbo count=4 verbose=2 rest=file1.txt file2.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_heredoc_quoted_vs_unquoted_and_dash_tab_strip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("VAR=\"expanded_val\"\ncat <<-EOF\n\tindented_expanded=$VAR\n\tmath=$(( 6 * 7 ))\nEOF\ncat <<-'EOF'\n\tindented_literal=$VAR\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "indented_expanded=expanded_val\nmath=42\nindented_literal=$VAR\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_brace_expansion_numeric_alpha_padded_nested", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"%s\\n\" pre-{01..03}-{a..b}-post");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "pre-01-a-post\npre-01-b-post\npre-02-a-post\npre-02-b-post\npre-03-a-post\npre-03-b-post\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_subshell_isolation_and_pipeline_pipefail_status", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("set -o pipefail\nx=100\n(\n  x=200\n  printf \"sub_x=%d\\n\" \"$x\"\n)\nprintf \"main_x=%d\\n\" \"$x\"\nfalse | true\nrc1=$?\ntrue | true\nrc2=$?\nprintf \"rc1=%d rc2=%d\\n\" \"$rc1\" \"$rc2\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sub_x=200\nmain_x=100\nrc1=1 rc2=0\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_printf_format_reuse_padding_hex_octal_float_var", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf -v captured \"%04x:%04o:%+06d:%.2f\" 255 63 42 3.14159\nprintf \"captured=%s\\n\" \"$captured\"\nprintf \"(%s)\\n\" one two three");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "captured=00ff:0077:+00042:3.14\n(one)\n(two)\n(three)\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_fd_duplication_stderr_to_stdout_and_null_redirect", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("emit_both() {\n  printf \"out_msg\\n\"\n  printf \"err_msg\\n\" >&2\n}\ncombined=$(emit_both 2>&1 >/dev/null)\nboth=$(emit_both 2>&1)\nprintf \"stderr_only=%s\\nboth=%s\\n\" \"$combined\" \"$(printf \"%s\" \"$both\" | paste -sd, -)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "stderr_only=err_msg\nboth=out_msg,err_msg\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_regex_matching_bash_rematch_capture_groups", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("line=\"commit 4f8a92b (tag: v2.14.3, origin/main)\"\nif [[ \"$line\" =~ ^commit[[:space:]]+([0-9a-f]+)[[:space:]]+\\(tag:[[:space:]]*v([0-9]+\\.[0-9]+\\.[0-9]+) ]]; then\n  printf \"hash=%s ver=%s\\n\" \"${BASH_REMATCH[1]}\" \"${BASH_REMATCH[2]}\"\nelse\n  printf \"no_match\\n\"\nfi");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hash=4f8a92b ver=2.14.3\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_recursive_shell_function_with_local_scoping_ackermann_fib", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("fib() {\n  local n=\"$1\"\n  if (( n <= 1 )); then\n    printf \"%d\" \"$n\"\n    return\n  fi\n  local a b\n  a=$(fib $(( n - 1 )))\n  b=$(fib $(( n - 2 )))\n  printf \"%d\" $(( a + b ))\n}\nfor i in 0 1 2 5 8; do\n  printf \"fib(%d)=%s\\n\" \"$i\" \"$(fib \"$i\")\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "fib(0)=0\nfib(1)=1\nfib(2)=1\nfib(5)=5\nfib(8)=21\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_parameter_default_assign_error_alternate_operators", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("unset u\ne=\"\"\ns=\"present\"\nprintf \"colon_dash=%s|%s|%s\\n\" \"${u:-def}\" \"${e:-def}\" \"${s:-def}\"\nprintf \"dash=%s|%s|%s\\n\" \"${u-def}\" \"${e-def}\" \"${s-def}\"\nprintf \"colon_plus=%s|%s|%s\\n\" \"${u:+alt}\" \"${e:+alt}\" \"${s:+alt}\"\n: \"${u:=assigned_now}\"\nprintf \"after_assign=%s\\n\" \"$u\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "colon_dash=def|def|present\ndash=def||present\ncolon_plus=||alt\nafter_assign=assigned_now\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_pattern_substitution_global_prefix_suffix_in_arrays", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("items=(\"src/foo.ts\" \"src/bar.ts\" \"test/foo.ts\")\nprintf \"all=%s\\n\" \"${items[*]/%.ts/.js}\"\npath=\"a//b///c//d\"\nprintf \"single=%s global=%s\\n\" \"${path/\\/\\//\\/}\" \"${path//\\/\\//\\/}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "all=src/foo.js src/bar.js test/foo.js\nsingle=a/b///c//d global=a/b//c/d\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_while_read_loop_preserving_leading_trailing_spaces", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("while IFS= read -r line || [[ -n \"$line\" ]]; do\n  printf \"[%s](%d)\\n\" \"$line\" \"${#line}\"\ndone << 'EOF'\n  leading\ntrailing   \n  both  \nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[  leading](9)\n[trailing   ](11)\n[  both  ](8)\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_eval_dynamic_variable_table_and_command_chain", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("for idx in 1 2 3; do\n  eval \"metric_${idx}=\\$(( idx * 15 ))\"\ndone\nsum=0\nfor idx in 1 2 3; do\n  eval \"val=\\$metric_${idx}\"\n  sum=$(( sum + val ))\n  printf \"m%d=%d\\n\" \"$idx\" \"$val\"\ndone\nprintf \"sum=%d\\n\" \"$sum\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "m1=15\nm2=30\nm3=45\nsum=90\n");
    } finally {
      await h.dispose();
    }
  });

});
