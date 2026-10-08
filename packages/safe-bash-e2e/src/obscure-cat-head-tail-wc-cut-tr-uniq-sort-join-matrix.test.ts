import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure cat, head, tail, wc, cut, tr, uniq, sort & join deep parity matrix", () => {
  it("01: cat renders nonprinting control/meta bytes (-v/-e/-t/-A), CRLF ends (-E), and cross-file numbering (-b/-s)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a_out=$(printf "\\x01\\x07\\t\\x7f\\x80\\x81\\xc1\\xff\\n" | cat -A)
        e_only=$(printf "dos\\r\\nbare\\rcr\\n" | cat -E | tr "\\r" "~" | paste -sd "|" -)
        et_out=$(printf "\\x02\\t\\r\\n" | cat -et)
        printf "head_" > /workspace/f1.txt
        printf "tail\\n\\n\\nnext\\n" > /workspace/f2.txt
        bs_out=$(cat -b -s /workspace/f1.txt /workspace/f2.txt | tr "\\t" ":" | paste -sd "|" -)
        echo "A=$a_out|E=$e_only|et=$et_out|bs=$bs_out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "A=^A^G^I^?M-^@M-^AM-AM-^?$|E=dos^M$|bare~cr$|et=^B^I^M$|bs=     1:head_tail||     2:next",
      );
    });
  });

  it("02: cat supports long options (--number, --squeeze-blank, --show-ends, --show-tabs) and directory/option error codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        long_out=$(printf "a\\tb\\n\\n\\nc\\n" | cat --number --squeeze-blank --show-ends --show-tabs | tr "\\t" ":" | paste -sd "|" -)
        mkdir -p /workspace/adir
        cat /workspace/adir >/dev/null 2>/workspace/dir.err
        dir_rc=$?
        cat -Z >/dev/null 2>/workspace/opt.err
        opt_rc=$?
        echo "long=$long_out|dir_rc=$dir_rc|opt_rc=$opt_rc"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "long=     1:a^Ib$|     2:$|     3:c$|dir_rc=1|opt_rc=2",
      );
    });
  });

  it("03: head handles negative line/byte counts, NUL-terminated records (-z), multipliers, and verbose/quiet headers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        neg_l=$(printf "l1\\nl2\\nl3\\nl4\\n" | head -n -2 | paste -sd "," -)
        neg_c=$(printf "abcdefghij" | head -c -4)
        nul_h=$(printf "r1\\0r2\\0r3\\0r4\\0" | head -z -n 2 | tr "\\0" ";")
        printf "111\\n222\\n333\\n" > /workspace/h1.txt
        printf "aaa\\nbbb\\nccc\\n" > /workspace/h2.txt
        hdr_qv=$(head -q -v -n 1 /workspace/h1.txt /workspace/h2.txt | paste -sd "|" -)
        hdr_vq=$(head -v -q -n 1 /workspace/h1.txt /workspace/h2.txt | paste -sd "|" -)
        shorthand=$(printf "x\\ny\\nz\\n" | head -2v | paste -sd "|" -)
        echo "neg_l=$neg_l|neg_c=$neg_c|nul=$nul_h|qv=$hdr_qv|vq=$hdr_vq|short=$shorthand"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "neg_l=l1,l2|neg_c=abcdef|nul=r1;r2;|qv===> /workspace/h1.txt <==|111||==> /workspace/h2.txt <==|aaa|vq=111|aaa|short===> standard input <==|x|y",
      );
    });
  });

  it("04: tail slices per-file +K offsets, NUL records (-z), and multi-file headers with -v/-q precedence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a1\\na2\\na3\\n" > /workspace/t1.txt
        printf "b1\\nb2\\nb3\\n" > /workspace/t2.txt
        multi=$(tail -n +2 /workspace/t1.txt /workspace/t2.txt | paste -sd "|" -)
        quiet=$(tail -q -n +3 /workspace/t1.txt /workspace/t2.txt | paste -sd "," -)
        bytes_plus=$(printf "0123456789" | tail -c +5)
        nul_t=$(printf "p1\\0p2\\0p3\\0p4\\0" | tail -z -n 2 | tr "\\0" ";")
        plus_legacy=$(printf "k1\\nk2\\nk3\\n" | tail +2 | paste -sd "," -)
        echo "multi=$multi|quiet=$quiet|bplus=$bytes_plus|nul=$nul_t|legacy=$plus_legacy"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "multi===> /workspace/t1.txt <==|a2|a3||==> /workspace/t2.txt <==|b2|b3|quiet=a3,b3|bplus=456789|nul=p3;p4;|legacy=k2,k3",
      );
    });
  });

  it("05: wc supports --files0-from, --total=auto|always|only|never, and GNU column width padding", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "one two\\nthree\\n" > /workspace/w1.txt
        printf "four five six\\n" > /workspace/w2.txt
        printf "/workspace/w1.txt\\0/workspace/w2.txt\\0" > /workspace/files0.bin
        f0=$(wc -l -w -c --files0-from=/workspace/files0.bin | paste -sd "|" -)
        t_only=$(wc -l -w -c --total=only /workspace/w1.txt /workspace/w2.txt)
        t_always=$(wc -l --total=always /workspace/w1.txt | paste -sd "|" -)
        t_never=$(wc -l --total=never /workspace/w1.txt /workspace/w2.txt | paste -sd "|" -)
        stdin_pad=$(printf "hello world\\n" | wc)
        echo "f0=$f0|only=$t_only|always=$t_always|never=$t_never|stdin=$stdin_pad"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "f0= 2  3 14 /workspace/w1.txt| 1  3 14 /workspace/w2.txt| 3  6 28 total|only=3 6 28|always=2 /workspace/w1.txt|2 total|never= 2 /workspace/w1.txt| 1 /workspace/w2.txt|stdin=      1       2      12",
      );
    });
  });

  it("06: wc computes display width (-L) and char count (-m) across tabs, CR resets, UTF-8 wide chars, and LC_ALL=C", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        tab_l=$(printf "a\\tb\\n\\t\\tx\\n" | wc -L)
        cr_l=$(printf "abcdef\\rxy\\n" | wc -L)
        utf8_ml=$(printf "é漢字\\n" | LC_ALL=C.UTF-8 wc -m -L)
        c_ml=$(LC_ALL=C wc -m -L <<'IN'
é漢字
IN
)
        echo "tab=$tab_l|cr=$cr_l|utf8=$utf8_ml|c=$c_ml"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "tab=17|cr=6|utf8=      4       5|c=      9       0");
    });
  });

  it("07: tr expands [:xdigit:]/[:punct:]/[:blank:], equivalence [=c=], repeats [c*n]/[c*], and 3-digit octal overflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        rep=$(printf "0123456789" | tr "0-9" "[#*3][.*]")
        oct_rep=$(printf "abcdefgh" | tr "a-h" "[_*004][+*]")
        eq=$(printf "b=a=c" | tr "[=a=][==]" "X-")
        cls=$(printf "deadBEEF!?" | tr -d "[:punct:]" | tr "[:xdigit:]" "x")
        oct_ovf=$(printf "A0" | tr "A0" "\\400")
        echo "rep=$rep|oct_rep=$oct_rep|eq=$eq|cls=$cls|ovf=<$oct_ovf>"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "rep=###.......|oct_rep=____++++|eq=b-X-c|cls=xxxxxxxx|ovf=< 0>",
      );
    });
  });

  it("08: tr handles combined -d -s, -t SET1 truncation, and class alignment/range validation exit codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ds=$(printf "a11  b22   c33" | tr -d -s "[:digit:]" " ")
        trunc=$(printf "abcdef" | tr -t "abcdef" "XY")
        tr "z-a" "a-z" </dev/null 2>/dev/null; rc_rev=$?
        tr "a[:upper:]" "[:lower:]" </dev/null 2>/dev/null; rc_mis=$?
        tr "a-z" "[:digit:]" </dev/null 2>/dev/null; rc_cls2=$?
        tr "[:lower:]0-9" "[:upper:]" </dev/null 2>/dev/null; rc_end=$?
        ok_t=$(printf "abc9" | tr -t "[:lower:]0-9" "[:upper:]")
        echo "ds=$ds|trunc=$trunc|rev=$rc_rev|mis=$rc_mis|cls2=$rc_cls2|end=$rc_end|ok_t=$ok_t"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "ds=a b c|trunc=XYcdef|rev=2|mis=1|cls2=1|end=1|ok_t=ABC9",
      );
    });
  });

  it("09: cut normalizes unordered/overlapping ranges and inserts --output-delimiter between separate byte/char ranges", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        reord=$(printf "f1:f2:f3:f4\\n" | cut -d: -f 3,1,2-3)
        sep_c=$(printf "abcdef\\n" | cut -c 1-2,3-4,6 --output-delimiter="|")
        ovl_c=$(printf "abcdef\\n" | cut -c 1-3,2-4,6 --output-delimiter="|")
        comp_b=$(printf "abcdefg\\n" | cut --complement -b 2-3,6- --output-delimiter="-")
        space_f=$(printf "a,b,c,d\\n" | cut -d, -f "4 1" --output-delimiter=":")
        echo "reord=$reord|sep=$sep_c|ovl=$ovl_c|comp=$comp_b|space=$space_f"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "reord=f1:f2:f3|sep=ab|cd|f|ovl=abcd|f|comp=a-de|space=a:d",
      );
    });
  });

  it("10: cut supports empty NUL delimiter (-d ''), NUL records (-z), LC_ALL=C -c byte selection, and validation codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        nul_d=$(printf "aa\\0bb\\0cc\\n" | cut -d "" -f 1,3 | tr "\\0" ":")
        nul_z=$(printf "k1:v1\\0k2:v2\\0" | cut -z -d: -f2 | tr "\\0" ",")
        utf_c=$(printf "éx\\n" | LC_ALL=C.UTF-8 cut -c 1)
        c_c=$(printf "éx\\n" | LC_ALL=C cut -c 1-2)
        cut -f 4-2 </dev/null 2>/dev/null; rc_dec=$?
        cut -f 0 </dev/null 2>/dev/null; rc_zero=$?
        cut -c 1 -d: </dev/null 2>/dev/null; rc_dc=$?
        cut -d "::" -f 1 </dev/null 2>/dev/null; rc_mult=$?
        echo "nul_d=$nul_d|nul_z=$nul_z|utf=$utf_c|c=$c_c|dec=$rc_dec|zero=$rc_zero|dc=$rc_dc|mult=$rc_mult"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "nul_d=aa:cc|nul_z=v1,v2,|utf=é|c=é|dec=1|zero=2|dc=2|mult=2",
      );
    });
  });

  it("11: uniq writes to output file operand, handles -z NUL records, -f/-s/-w with UTF-8, and rejects identical in/out files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\na\\nb\\n" > /workspace/uin.txt
        uniq -c /workspace/uin.txt /workspace/uout.txt
        file_out=$(awk '{print $1 ":" $2}' /workspace/uout.txt | paste -sd "," -)
        nul_u=$(printf "x\\0x\\0y\\0z\\0z\\0" | uniq -z -u | tr "\\0" ",")
        utf_s=$(printf "éA\\nßA\\nüB\\n" | LC_ALL=C.UTF-8 uniq -s 1 | paste -sd "," -)
        uniq /workspace/uin.txt /workspace/uin.txt 2>/dev/null; rc_same=$?
        uniq a b c 2>/dev/null; rc_extra=$?
        echo "out=$file_out|nul=$nul_u|utf=$utf_s|same=$rc_same|extra=$rc_extra"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "out=2:a,1:b|nul=y,|utf=éA,üB|same=2|extra=2",
      );
    });
  });

  it("12: uniq formats duplicate/group runs via -D, --all-repeated=none|prepend|separate, and --group=separate|prepend|append|both", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ar_prep=$(printf "a\\na\\nb\\nc\\nc\\n" | uniq --all-repeated=prepend | paste -sd "|" -)
        ar_sep=$(printf "a\\na\\nb\\nc\\nc\\n" | uniq --all-repeated=separate | paste -sd "|" -)
        grp_both=$(printf "a\\na\\nb\\n" | uniq --group=both | paste -sd "|" -)
        grp_app=$(printf "a\\nb\\nb\\n" | uniq --group=append | paste -sd "|" -)
        uniq --group -c </dev/null 2>/dev/null; rc_gc=$?
        uniq -D -c </dev/null 2>/dev/null; rc_dc=$?
        echo "prep=$ar_prep|sep=$ar_sep|both=$grp_both|app=$grp_app|gc=$rc_gc|dc=$rc_dc"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "prep=|a|a||c|c|sep=a|a||c|c|both=|a|a||b||app=a||b|b||gc=2|dc=2",
      );
    });
  });

  it("13: sort -g orders non-numbers, NaN, -Inf, scientific notation, and hexadecimal floating-point literals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "2.5e1\\nNaN\\n0x1.8p3\\n-Inf\\nalpha\\n-0x10p-2\\n+Inf\\n0\\n" | sort -g | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "alpha,NaN,-Inf,-0x10p-2,0,0x1.8p3,2.5e1,+Inf",
      );
    });
  });

  it("14: sort -h orders negative suffixes and unit ranks (1000K < 1M) and sort -V orders ~ pre-releases and dot entries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        h_out=$(printf "1M\\n1000K\\n-4K\\n-2G\\n0\\n-512M\\n2G\\n" | sort -h | paste -sd "," -)
        v_out=$(printf "1.0a\\n1.0\\n1.0~rc1\\n..\\n.\\n1.0~beta\\n.hidden\\n" | sort -V | paste -sd "," -)
        echo "h=$h_out|v=$v_out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "h=-2G,-512M,-4K,0,1000K,1M,2G|v=.,..,.hidden,1.0~beta,1.0~rc1,1.0,1.0a",
      );
    });
  });

  it("15: sort handles -k blank modifiers (b), cross-field character slices (-k1.2,2.2), dictionary (-d), and nonprinting (-i)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        kb=$(printf "1   b\\n2 a\\n" | sort -k2b,2 | tr -s " " "_" | paste -sd "," -)
        k_nob=$(printf "1   b\\n2 a\\n" | sort -k2,2 | tr -s " " "_" | paste -sd "," -)
        k_span=$(printf "a9:z1\\nb1:a9\\na1:z9\\n" | sort -t: -k1.2,2.1 | paste -sd "," -)
        d_out=$(printf "a-c\\nab\\na_d\\n" | sort -d | paste -sd "," -)
        i_out=$(printf "a\\x01c\\nab\\n" | sort -i | tr -d "\\001" | paste -sd "," -)
        echo "kb=$kb|nob=$k_nob|span=$k_span|d=$d_out|i=$i_out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "kb=2_a,1_b|nob=1_b,2_a|span=b1:a9,a1:z9,a9:z1|d=ab,a-c,a_d|i=ab,ac",
      );
    });
  });

  it("16: sort supports merge (-m), NUL field separator (-t ''), --check=quiet / -c -u, and option conflict exit codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "10\\n30\\n" > /workspace/s1.txt
        printf "20\\n40\\n" > /workspace/s2.txt
        sort -m -n /workspace/s1.txt /workspace/s2.txt -o /workspace/smerged.txt
        m_out=$(paste -sd "," /workspace/smerged.txt)
        nul_t=$(printf "x\\00020\\ny\\0005\\n" | sort -t "" -k2,2n | tr "\\0" ":" | paste -sd "," -)
        printf "a\\na\\n" | sort -c -u 2>/dev/null; rc_cu=$?
        printf "b\\na\\n" | sort --check=quiet; rc_cq=$?
        sort -c -C </dev/null 2>/dev/null; rc_cc=$?
        sort -n -h </dev/null 2>/dev/null; rc_nh=$?
        sort -c /workspace/s1.txt /workspace/s2.txt 2>/dev/null; rc_cm=$?
        echo "m=$m_out|nul_t=$nul_t|cu=$rc_cu|cq=$rc_cq|cc=$rc_cc|nh=$rc_nh|cm=$rc_cm"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "m=10,20,30,40|nul_t=y:5,x:20|cu=1|cq=1|cc=2|nh=2|cm=2",
      );
    });
  });

  it("17: join handles multiple -o flags, -o auto on uneven rows, whole-line -t '', and NUL records (-z)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "k1,a1,b1\\nk2,a2\\n" > /workspace/j1.txt
        printf "k1,x1\\nk3,x3,y3\\n" > /workspace/j2.txt
        mult_o=$(join -t, -a 1 -a 2 -e "NONE" -o 0 -o 1.2,2.2 /workspace/j1.txt /workspace/j2.txt | paste -sd ";" -)
        auto_o=$(join -t, -a 1 -a 2 -e "NA" -o auto /workspace/j1.txt /workspace/j2.txt | paste -sd ";" -)
        printf "full line 1\\nfull line 2\\n" > /workspace/jw1.txt
        printf "full line 2\\nfull line 3\\n" > /workspace/jw2.txt
        whole=$(join -t "" /workspace/jw1.txt /workspace/jw2.txt)
        printf "id1 val1\\0id2 val2\\0" > /workspace/jz1.bin
        printf "id2 ext2\\0id3 ext3\\0" > /workspace/jz2.bin
        nul_j=$(join -z /workspace/jz1.bin /workspace/jz2.bin | tr "\\0" ";")
        echo "mult=$mult_o|auto=$auto_o|whole=$whole|nul=$nul_j"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "mult=k1,a1,x1;k2,a2,NONE;k3,NONE,x3|auto=k1,a1,b1,x1;k2,a2,NA,NA;k3,NA,NA,x3|whole=full line 2|nul=id2 val2 ext2;",
      );
    });
  });

  it("18: join enforces --header, --check-order, --nocheck-order, and default disorder diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "key,left_val\\nb,2\\na,1\\n" > /workspace/uo1.txt
        printf "key,right_val\\nb,20\\na,10\\n" > /workspace/uo2.txt
        hdr_nocheck=$(join -t, --header --nocheck-order /workspace/uo1.txt /workspace/uo2.txt | paste -sd ";" -)
        printf "b 1\\na 2\\n" > /workspace/bad1.txt
        printf "b 10\\nc 20\\n" > /workspace/bad2.txt
        join --check-order /workspace/bad1.txt /workspace/bad2.txt >/workspace/co.out 2>/workspace/co.err
        rc_co=$?
        co_out=$(cat /workspace/co.out)
        join /workspace/bad1.txt /workspace/bad2.txt >/workspace/def.out 2>/workspace/def.err
        rc_def=$?
        def_out=$(cat /workspace/def.out)
        echo "hdr=$hdr_nocheck|rc_co=$rc_co|co_out=<$co_out>|rc_def=$rc_def|def_out=<$def_out>"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "hdr=key,left_val,right_val;b,2,20;a,1,10|rc_co=1|co_out=<>|rc_def=1|def_out=<b 1 10>",
      );
    });
  });

  it("19: join resolves deferred -j1/-j2 operands and validates conflicting options and dual-stdin errors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "leftA k1\\nleftB k2\\n" > /workspace/jf1.txt
        printf "k1 rightA\\nk2 rightB\\n" > /workspace/jf2.txt
        j_sep=$(join -j1 2 -j2 1 /workspace/jf1.txt /workspace/jf2.txt | paste -sd ";" -)
        printf "x k1\\ny k2\\n" > /workspace/jf3.txt
        j_both=$(join -j2 /workspace/jf1.txt /workspace/jf3.txt | paste -sd ";" -)
        join - - </dev/null 2>/dev/null; rc_stdin=$?
        join -1 1 -1 2 /workspace/jf1.txt /workspace/jf2.txt 2>/dev/null; rc_f=$?
        join -e A -e B /workspace/jf1.txt /workspace/jf2.txt 2>/dev/null; rc_e=$?
        echo "sep=$j_sep|both=$j_both|stdin=$rc_stdin|f=$rc_f|e=$rc_e"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "sep=k1 leftA rightA;k2 leftB rightB|both=k1 leftA x;k2 leftB y|stdin=1|f=1|e=1",
      );
    });
  });

  it("20: executes end-to-end ETL pipeline across cat, tr, cut, sort, uniq, join, head, tail, and wc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "svc_b:100:ok\\r\\nsvc_a:250:err\\r\\nsvc_b:100:ok\\r\\nsvc_c:50:ok\\r\\nsvc_a:250:err\\r\\n" > /workspace/raw.log
        printf "service,owner\\nsvc_a,alice\\nsvc_b,bob\\nsvc_c,carol\\n" > /workspace/owners.csv
        cat -E /workspace/raw.log | tr -d "\\r$" | sed 's/\\^M$//' | tr ":" "," | cut -d, -f1,2 | sort -t, -k1,1 -k2,2n | uniq -c | awk '{print $2 "," $1}' > /workspace/agg.csv
        printf "service,latency,count\\n" > /workspace/agg_hdr.csv
        cat /workspace/agg.csv >> /workspace/agg_hdr.csv
        joined=$(join -t, --header /workspace/agg_hdr.csv /workspace/owners.csv | tail -n +2 | sort -t, -k2,2nr | head -n -1 | paste -sd ";" -)
        total_lines=$(wc -l --total=only /workspace/agg.csv /workspace/owners.csv)
        echo "joined=$joined|lines=$total_lines"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "joined=svc_a,250,2,alice;svc_b,100,2,bob|lines=7",
      );
    });
  });
});
