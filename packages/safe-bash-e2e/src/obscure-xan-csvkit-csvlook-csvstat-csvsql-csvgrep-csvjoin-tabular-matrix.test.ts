import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan & csvkit (csvcut, csvgrep, csvsort, csvjoin, csvstack, csvjson, in2csv, csvsql, csvlook, csvstat) tabular matrix", () => {
  it("01: chains xan search -e, xan sort -N -R, and xan select", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/emp.csv
id,name,dept,salary
1,alice,eng,120
2,bob,sales,90
3,carol,eng,150
4,dave,eng,110
5,erin,ops,130
CSV
        xan search -s dept -e eng /workspace/emp.csv | xan sort -s salary -N -R | xan select name,salary
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "name,salary\ncarol,150\nalice,120\ndave,110\n");
    });
  });

  it("02: aggregates count(), sum(), min(), max(), and median() per group with xan groupby", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/tx.csv
region,amt
west,10
west,20
west,90
east,5
east,15
CSV
        xan groupby region 'count() as n, sum(amt) as total, min(amt) as lo, max(amt) as hi, median(amt) as med' /workspace/tx.csv | xan sort -s region
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "region,n,total,lo,hi,med\neast,2,20,5,15,10\nwest,3,120,10,90,20\n",
      );
    });
  });

  it("03: performs inner and --left relational joins across CSV files with xan join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/u.csv
uid,uname
1,alice
2,bob
3,carol
CSV
        cat << 'CSV' > /workspace/r.csv
uid,role
1,admin
3,editor
CSV
        xan join uid /workspace/u.csv uid /workspace/r.csv | xan select uid,uname,role
        echo "---LEFT---"
        xan join --left uid /workspace/u.csv uid /workspace/r.csv | xan select uid,uname,role
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "uid,uname,role\n1,alice,admin\n3,carol,editor\n---LEFT---\nuid,uname,role\n1,alice,admin\n2,bob,\n3,carol,editor\n",
      );
    });
  });

  it("04: computes derived columns with xan map and filters rows via xan filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/items.csv
sku,qty,price
A,2,15
B,5,20
C,1,50
CSV
        xan map 'qty * price' total /workspace/items.csv | xan filter 'total >= 40'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sku,qty,price,total\nB,5,20,100\nC,1,50,50\n");
    });
  });

  it("05: prepends row indices with xan enum and renames headers with xan rename", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/raw.csv
code,val
A,10
B,20
CSV
        xan enum /workspace/raw.csv | xan rename idx,item_code,amount
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "idx,item_code,amount\n0,A,10\n1,B,20\n");
    });
  });

  it("06: deduplicates rows by key column using xan dedup -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/dup.csv
k,v
a,1
b,2
a,3
c,4
b,5
CSV
        xan dedup -s k /workspace/dup.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "k,v\na,1\nb,2\nc,4\n");
    });
  });

  it("07: selects top-N rows by numeric column with xan top -l", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/scores.csv
player,pts
p1,40
p2,95
p3,70
p4,85
CSV
        xan top pts -l 2 /workspace/scores.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "player,pts\np2,95\np4,85\n");
    });
  });

  it("08: converts CSV to JSON array via xan to json and transforms with jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/mini.csv
name,score
alice,10
bob,25
CSV
        xan to json /workspace/mini.csv | jq -c 'map({u: .name, s: (.score | tonumber)})'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '[{"u":"alice","s":10},{"u":"bob","s":25}]');
    });
  });

  it("09: projects and excludes columns by name using csvcut -c and csvcut -C", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/wide.csv
a,b,c,d
1,2,3,4
5,6,7,8
CSV
        csvcut -c d,a /workspace/wide.csv
        echo "---EXCLUDE---"
        csvcut -C b,c /workspace/wide.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "d,a\n4,1\n8,5\n---EXCLUDE---\na,d\n1,4\n5,8\n");
    });
  });

  it("10: filters CSV rows with csvgrep regex (-r) and inverted literal (-i -m) matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/hosts.csv
host,env,status
web-01,prod,up
db-01,prod,down
dev-01,staging,up
CSV
        csvgrep -c env -r '^prod$' /workspace/hosts.csv | csvgrep -c status -i -m down
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "host,env,status\nweb-01,prod,up\n");
    });
  });

  it("11: sorts CSV rows numerically in descending order via csvsort -c -r", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/items.csv
sku,price
B,25
A,100
C,5
CSV
        csvsort -c price -r /workspace/items.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sku,price\nA,100\nB,25\nC,5\n");
    });
  });

  it("12: joins CSV files with inner and --left modes via csvjoin -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/left.csv
id,name
1,alpha
2,beta
CSV
        cat << 'CSV' > /workspace/right.csv
id,tier
1,gold
CSV
        csvjoin -c id /workspace/left.csv /workspace/right.csv
        echo "---LEFT---"
        csvjoin --left -c id /workspace/left.csv /workspace/right.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "id,name,tier\n1,alpha,gold\n---LEFT---\nid,name,tier\n1,alpha,gold\n2,beta,\n",
      );
    });
  });

  it("13: stacks multiple CSV files with group labels via csvstack -g -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'id,v\\n1,a\\n' > /workspace/q1.csv
        printf 'id,v\\n2,b\\n' > /workspace/q2.csv
        csvstack -g Q1,Q2 -n quarter /workspace/q1.csv /workspace/q2.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "quarter,id,v\nQ1,1,a\nQ2,2,b\n");
    });
  });

  it("14: indexes CSV rows by key with csvjson -k and converts JSON arrays to CSV with in2csv -f json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/kv.csv
id,role
u1,admin
u2,user
CSV
        csvjson -k id /workspace/kv.csv | jq -c .
        printf '[{"city":"NYC","pop":800},{"city":"LA","pop":400}]\\n' | in2csv -f json
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"u1":{"id":"u1","role":"admin"},"u2":{"id":"u2","role":"user"}}\ncity,pop\nNYC,800\nLA,400\n',
      );
    });
  });

  it("15: executes multi-table SQL joins and aggregations directly over CSV files via csvsql --query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/depts.csv
dept_id,dept_name
10,Engineering
20,Design
CSV
        cat << 'CSV' > /workspace/members.csv
name,dept_id,hours
Alice,10,40
Bob,10,35
Carol,20,30
CSV
        csvsql --query 'SELECT d.dept_name, COUNT(*) AS hc, SUM(CAST(m.hours AS INT)) AS total_h FROM depts d JOIN members m ON d.dept_id = m.dept_id GROUP BY d.dept_name ORDER BY d.dept_name' /workspace/depts.csv /workspace/members.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "dept_name,hc,total_h\nDesign,1,30\nEngineering,2,75\n");
    });
  });

  it("16: renders aligned markdown/ASCII tables from CSV streams with csvlook", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' | csvlook
col1,col2
alpha,10
beta,200
CSV
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "| col1  | col2 |\n| ----- | ---- |\n| alpha |   10 |\n| beta  |  200 |\n",
      );
    });
  });

  it("17: reports row counts with csvstat --count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/nums.csv
metric,val
a,10
b,20
c,30
CSV
        csvstat --count /workspace/nums.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3\n");
    });
  });

  it("18: transposes CSV rows and columns with xan transpose", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' | xan transpose
metric,q1,q2
rev,100,150
cost,60,80
CSV
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "metric,rev,cost\nq1,100,60\nq2,150,80\n");
    });
  });

  it("19: concatenates CSV files vertically with xan cat rows", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'k,v\\na,1\\n' > /workspace/c1.csv
        printf 'k,v\\nb,2\\n' > /workspace/c2.csv
        xan cat rows /workspace/c1.csv /workspace/c2.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "k,v\na,1\nb,2\n");
    });
  });

  it("20: runs an end-to-end polyglot tabular pipeline (in2csv -> xan groupby -> csvsort -> csvjson -> jq)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'JSON' | in2csv -f json | xan groupby team 'sum(pts) as total_pts, count() as players' | csvsort -c total_pts -r | csvjson | jq -c 'map({team: .team, total_pts: (.total_pts | tonumber), players: (.players | tonumber)})'
[
  {"team":"red","player":"a","pts":15},
  {"team":"blue","player":"b","pts":40},
  {"team":"red","player":"c","pts":35}
]
JSON
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"team":"red","total_pts":50.0,"players":2.0},{"team":"blue","total_pts":40.0,"players":1.0}]',
      );
    });
  });
});
