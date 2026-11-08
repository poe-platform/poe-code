import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure bash shell subshell, pipefail, errexit, traps, arrays, glob, and fd matrix", () => {
  it("01_set_errexit_exemption_in_if_while_and_or_lists", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("(\n  set -e\n  if false; then\n    printf \"unreachable\\n\"\n  fi\n  false || printf \"recovered_or\\n\"\n  ! false && printf \"negated_ok\\n\"\n)\nprintf \"outer_rc=%d\\n\" \"$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "recovered_or\nnegated_ok\nouter_rc=0\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_set_nounset_with_default_and_alternate_expansions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("(\n  set -u\n  defined_var=\"hello\"\n  printf \"def=%s fallback=%s\\n\" \"$defined_var\" \"${unset_var:-safe_default}\"\n)");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "def=hello fallback=safe_default\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_shopt_nullglob_and_dotglob_directory_matching", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/glob_dir\nprintf \"a\" > /workspace/glob_dir/.hidden\nprintf \"b\" > /workspace/glob_dir/visible.txt\nshopt -s nullglob\nno_matches=(/workspace/glob_dir/*.nomatch)\nprintf \"nullglob_count=%d\\n\" \"${#no_matches[@]}\"\nshopt -s dotglob\nall_files=(/workspace/glob_dir/*)\nfor f in \"${all_files[@]}\"; do\n  basename \"$f\"\ndone | sort");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "nullglob_count=0\n.hidden\nvisible.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_nested_function_local_shadowing_and_dynamic_scope", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("v=\"global\"\ninner() {\n  printf \"inner_sees=%s\\n\" \"$v\"\n  v=\"mutated_by_inner\"\n}\nouter() {\n  local v=\"local_outer\"\n  inner\n  printf \"outer_after=%s\\n\" \"$v\"\n}\nouter\nprintf \"global_after=%s\\n\" \"$v\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "inner_sees=local_outer\nouter_after=mutated_by_inner\nglobal_after=global\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_command_group_braces_vs_subshell_parens_with_redirection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("count=10\n{\n  count=$(( count + 5 ))\n  printf \"in_group=%d\\n\" \"$count\"\n} > /workspace/group.out\n(\n  count=$(( count + 100 ))\n  printf \"in_sub=%d\\n\" \"$count\"\n) > /workspace/sub.out\ncat /workspace/group.out /workspace/sub.out\nprintf \"final_count=%d\\n\" \"$count\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "in_group=15\nin_sub=115\nfinal_count=15\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_read_custom_null_and_colon_delimiters", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"first_rec:second_rec:third_rec:\" > /workspace/records.dat\nidx=0\nwhile IFS= read -r -d ':' rec; do\n  idx=$(( idx + 1 ))\n  printf \"r%d=[%s]\\n\" \"$idx\" \"$rec\"\ndone < /workspace/records.dat");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "r1=[first_rec]\nr2=[second_rec]\nr3=[third_rec]\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_positional_parameters_set_shift_at_vs_star_expansion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("set -- \"one two\" \"three\" \"four five\"\nprintf \"argc=%d\\n\" \"$#\"\nfor arg in \"$@\"; do\n  printf \"at=[%s]\\n\" \"$arg\"\ndone\nshift\nIFS='|'\nprintf \"star=%s\\n\" \"$*\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "argc=3\nat=[one two]\nat=[three]\nat=[four five]\nstar=three|four five\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_process_substitution_diff_and_paste_streams", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("paste -d':' <(seq 1 3) <(printf \"alpha\\nbeta\\ngamma\\n\")");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:alpha\n2:beta\n3:gamma\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_double_bracket_lexicographical_numeric_and_file_tests", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/test_fs\nprintf \"nonempty\" > /workspace/test_fs/file.txt\nln -s /workspace/test_fs/file.txt /workspace/test_fs/link.txt\n[[ -d /workspace/test_fs && -s /workspace/test_fs/file.txt && -L /workspace/test_fs/link.txt ]] && printf \"fs_checks=pass\\n\"\n[[ \"apple\" < \"banana\" && 42 -gt 9 && \"foo_bar\" == foo_* ]] && printf \"cmp_checks=pass\\n\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "fs_checks=pass\ncmp_checks=pass\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_declare_integer_attribute_auto_arithmetic_evaluation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("declare -i num=10\nnum=\"num + 5 * 3\"\nprintf \"num=%d\\n\" \"$num\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "num=25\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_associative_array_compound_update_and_key_existence", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("declare -A cfg=([host]=\"db.internal\" [port]=\"5432\")\ncfg+=([port]=\"6432\" [ssl]=\"require\")\nfor k in host port ssl; do\n  printf \"%s=%s\\n\" \"$k\" \"${cfg[$k]}\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "host=db.internal\nport=6432\nssl=require\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_array_append_slice_negative_index_and_unset_element", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("items=(zero one two three four)\nitems+=(five)\nunset 'items[1]'\nprintf \"count=%d last=%s indices=%s\\n\" \"${#items[@]}\" \"${items[-1]}\" \"${!items[*]}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "count=5 last=five indices=0 2 3 4 5\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_Arithmetic_for_loop_with_continue_and_break", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sum=0\nfor (( i=1; i<=10; i++ )); do\n  if (( i % 2 == 0 )); then\n    continue\n  fi\n  if (( i > 7 )); then\n    break\n  fi\n  sum=$(( sum + i ))\ndone\nprintf \"odd_sum=%d\\n\" \"$sum\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "odd_sum=16\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_case_continue_matching_operator_double_semicolon_amp", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("out=\"\"\ncase \"foobar\" in\n  foo*)\n    out=\"${out}prefix_foo:\"\n    ;;&\n  *bar)\n    out=\"${out}suffix_bar:\"\n    ;;&\n  xyz*)\n    out=\"${out}never:\"\n    ;;\nesac\nprintf \"matched=%s\\n\" \"$out\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "matched=prefix_foo:suffix_bar:\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_parameter_expansion_length_and_pattern_removal_edge_cases", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("path=\"/opt/services/payment-v2.4.1/bin/run.sh\"\ndir=\"${path%/*}\"\nfile=\"${path##*/}\"\nprintf \"len=%d\\ndir=%s\\nfile=%s\\n\" \"${#path}\" \"$dir\" \"$file\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "len=39\ndir=/opt/services/payment-v2.4.1/bin\nfile=run.sh\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_pipeline_last_stage_and_command_substitution_trailing_newline_strip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("raw=$(printf \"hello\\n\\n\\n\")\nprintf \"stripped=[%s] len=%d\\n\" \"$raw\" \"${#raw}\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "stripped=[hello] len=5\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_until_loop_and_compound_boolean_short_circuit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("n=1\nsteps=0\nuntil (( n >= 32 )); do\n  n=$(( n * 2 ))\n  steps=$(( steps + 1 ))\ndone\nprintf \"n=%d steps=%d\\n\" \"$n\" \"$steps\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "n=32 steps=5\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_source_dot_script_with_positional_args_and_return_code", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/helper.sh\nhelper_var=\"loaded_from_${1}\"\nif [[ \"$2\" == \"fail\" ]]; then\n  return 7\nfi\nreturn 0\nEOF\nsource /workspace/helper.sh \"modA\" \"ok\"\nrc1=$?\nsource /workspace/helper.sh \"modB\" \"fail\" || rc2=$?\nprintf \"var=%s rc1=%d rc2=%d\\n\" \"$helper_var\" \"$rc1\" \"$rc2\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "var=loaded_from_modB rc1=0 rc2=7\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_trap_err_and_exit_combined_signal_handling", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("trace=\"\"\ntrap 'trace=\"${trace}:ERR\"' ERR\ntrap 'printf \"trace=%s\\n\" \"$trace\"' EXIT\ntrace=\"init\"\nfalse\ntrace=\"${trace}:after_false\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "trace=init:ERR:after_false\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_type_and_command_v_builtin_function_external_resolution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("my_func() { :; }\nprintf \"fn=%s\\nbuiltin=%s\\n\" \"$(type -t my_func)\" \"$(type -t cd)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "fn=function\nbuiltin=builtin\n");
    } finally {
      await h.dispose();
    }
  });

});
