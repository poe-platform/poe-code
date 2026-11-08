import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure xan tabular analytics, join, groupby, agg, freq, stats, top, and format matrix", () => {
  it("1. xan count and xan headers inspect CSV row counts, custom delimiters, and column names", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.csv
id,name,price
1,apple,10
2,banana,20
3,cherry,30
EOF
        xan count items.csv
        xan count -n items.csv
        xan headers -j items.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3\n4\nid\nname\nprice\n");
    });
  });

  it("2. xan select and xan drop project and exclude columns by name, range, and index", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > data.csv
id,user,role,secret
1,ada,admin,s1
2,bob,user,s2
EOF
        xan select role,user data.csv
        xan drop secret data.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "role,user\nadmin,ada\nuser,bob\nid,user,role\n1,ada,admin\n2,bob,user\n"
      );
    });
  });

  it("3. xan rename renames all columns or selected columns (-s)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > raw.csv
a,b,c
1,2,3
EOF
        xan rename x,y,z raw.csv
        xan rename -s b col_b raw.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "x,y,z\n1,2,3\na,col_b,c\n1,2,3\n");
    });
  });

  it("4. xan enum prepends 0-based or custom-offset (-S) index column (-c)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > list.csv
name
alpha
beta
EOF
        xan enum -c row_id -S 10 list.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "row_id,name\n10,alpha\n11,beta\n");
    });
  });

  it("5. xan slice, xan head, xan tail, and xan reverse slice and invert row order", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > seq.csv
n
10
20
30
40
50
EOF
        xan slice -s 1 -l 2 seq.csv
        xan head -l 2 seq.csv
        xan tail -l 2 seq.csv
        xan reverse seq.csv | xan head -l 2
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "n\n20\n30\nn\n10\n20\nn\n40\n50\nn\n50\n40\n");
    });
  });

  it("6. xan filter evaluates numeric/string comparisons, boolean logic, invert (-v), and limit (-l)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > metrics.csv
svc,latency,status
api,45,200
db,120,200
worker,15,500
cache,5,200
EOF
        xan filter 'latency >= 40' metrics.csv | xan filter 'status == 200'
        xan filter -v 'status == 200' metrics.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "svc,latency,status\napi,45,200\ndb,120,200\nsvc,latency,status\nworker,15,500\n"
      );
    });
  });

  it("7. xan search filters rows by substring, exact match (-e), case-insensitive (-i), and invert (-v)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > hosts.csv
host,region
web-prod-01,us-east
db-STAGE-02,eu-west
api-prod-03,ap-south
EOF
        xan search -s host -i 'stage' hosts.csv
        xan search -s region -e 'us-east' hosts.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "host,region\ndb-STAGE-02,eu-west\nhost,region\nweb-prod-01,us-east\n"
      );
    });
  });

  it("8. xan sort sorts numerically (-N), in reverse (-R), and deduplicates (-u)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > scores.csv
team,pts
red,9
blue,100
red,25
green,40
EOF
        xan sort -s pts -N scores.csv
        xan sort -s team -u scores.csv | xan select team
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "team,pts\nred,9\nred,25\ngreen,40\nblue,100\nteam\nblue\ngreen\nred\n"
      );
    });
  });

  it("9. xan dedup removes duplicate keys keeping first, last (-l), or only duplicates (--keep-duplicates)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > events.csv
key,seq
a,1
b,2
a,3
c,4
EOF
        xan dedup -s key events.csv
        xan dedup -s key -l events.csv
        xan dedup -s key --keep-duplicates events.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "key,seq\na,1\nb,2\nc,4\nkey,seq\na,3\nb,2\nc,4\nkey,seq\na,1\n"
      );
    });
  });

  it("10. xan top extracts top-k and bottom-k (-R) rows by numeric column", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > sales.csv
item,rev
a,50
b,300
c,120
d,10
EOF
        xan top rev -l 2 sales.csv
        xan top rev -l 2 -R sales.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "item,rev\nb,300\nc,120\nitem,rev\nd,10\na,50\n"
      );
    });
  });

  it("11. xan map appends computed columns using arithmetic and string functions", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > cart.csv
item,qty,price
book,3,15
pen,10,2
EOF
        xan map 'qty * price' total cart.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "item,qty,price,total\nbook,3,15,45\npen,10,2,20\n");
    });
  });

  it("12. xan split partitions CSV files by row count (-S) or chunk count (-c) into an output directory", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > events.csv
id,name
1,a
2,b
3,c
4,d
EOF
        xan split -c 2 -O parts -f "chunk_{}.csv" events.csv
        cat parts/chunk_0.csv
        cat parts/chunk_1.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "id,name\n1,a\n2,b\nid,name\n3,c\n4,d\n");
    });
  });

  it("13. xan join --semi and xan join --anti filter left rows by key existence in right table", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > all_users.csv
id,name
1,Ada
2,Grace
3,Linus
EOF
        cat <<'EOF' > active_ids.csv
id
1
3
EOF
        xan join --semi id all_users.csv id active_ids.csv
        xan join --anti id all_users.csv id active_ids.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "id,name\n1,Ada\n3,Linus\nid,name\n2,Grace\n"
      );
    });
  });

  it("14. xan groupby aggregates groups with count, sum, mean, min, max, first, and last", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > logs.csv
dept,salary
eng,100
eng,140
sales,80
sales,100
EOF
        xan groupby dept 'count() as cnt, sum(salary) as total, mean(salary) as avg, min(salary) as lo, max(salary) as hi' logs.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "dept,cnt,total,avg,lo,hi\neng,2,240,120,100,140\nsales,2,180,90,80,100\n"
      );
    });
  });

  it("15. xan agg computes whole-table aggregations with custom aliases", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > vals.csv
v
10
20
30
EOF
        xan agg 'count() as n, sum(v) as s, mean(v) as m, first(v) as f, last(v) as l' vals.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "n,s,m,f,l\n3,60,20,10,30\n");
    });
  });

  it("16. xan freq computes frequency distributions with --limit (-l) and --no-extra (-N)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > statuses.csv
code
200
500
200
404
200
500
EOF
        xan freq -s code statuses.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "field,value,count\ncode,200,3\ncode,500,2\ncode,404,1\n");
    });
  });

  it("17. xan stats computes summary statistics and pipes into xan select", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > nums.csv
val
10
20
30
EOF
        xan stats nums.csv | xan select field,count,type,sum,mean,min,max
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "field,count,type,sum,mean,min,max\nval,3,int,60,20,10,30\n");
    });
  });

  it("18. xan join performs inner, left (--left), right (--right), and semi/anti joins", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > u.csv
id,name
1,Ada
2,Grace
3,Linus
EOF
        cat <<'EOF' > r.csv
id,role
1,Admin
3,Maintainer
EOF
        xan join id u.csv id r.csv
        xan join --left id u.csv id r.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "id,name,role\n1,Ada,Admin\n3,Linus,Maintainer\nid,name,role\n1,Ada,Admin\n2,Grace,\n3,Linus,Maintainer\n"
      );
    });
  });

  it("19. xan cat rows, xan cat cols (-p), and xan transpose reshape tables", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'a,b
1,2
' > p1.csv
        printf 'a,b
3,4
' > p2.csv
        xan cat rows p1.csv p2.csv > combined.csv
        cat combined.csv
        xan transpose combined.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a,b\n1,2\n3,4\na,1,3\nb,2,4\n");
    });
  });

  it("20. xan from -f json and xan to json / ndjson round-trip structured records", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf '[{"host":"w1","cpu":40},{"host":"w2","cpu":85}]
'           | xan from -f json           | xan filter 'cpu >= 50'           | xan to json
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '[{"host":"w2","cpu":85}]\n');
    });
  });
});
