import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan csvkit tabular join groupby pivot flatmap bins matrix", () => {
  it("1. xan map with arithmetic, string functions (upper, lower, trim, len), and filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/emp79.csv\nname,dept,base,bonus\n  alice ,eng,100,25\nbob,sales,80,10\n  carol ,eng,120,30\nCSV\nxan map 'trim(name) as clean_name, upper(dept) as dept_up, base + bonus as total' /tmp/emp79.csv | xan filter 'total >= 120' - | xan select clean_name,dept_up,total -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "clean_name,dept_up,total\nalice,ENG,125\ncarol,ENG,150");
    });
  });

  it("2. xan groupby with count, sum, mean, min, max, and median aggregations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/lat79.csv\nregion,ms\nus,10\nus,20\nus,90\neu,15\neu,25\neu,35\nCSV\nxan groupby region 'count() as n, sum(ms) as total, min(ms) as p0, median(ms) as p50, max(ms) as p100' /tmp/lat79.csv | xan sort -s region -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "region,n,total,p0,p50,p100\neu,3,75,15,25,35\nus,3,120,10,20,90");
    });
  });

  it("3. xan cat and xan reverse across partitioned CSV shards", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"id,val\\n1,alpha\\n2,beta\\n\" > /tmp/sh1.csv\nprintf \"id,val\\n3,gamma\\n4,delta\\n\" > /tmp/sh2.csv\nxan cat rows /tmp/sh1.csv /tmp/sh2.csv | xan reverse -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,val\n4,delta\n3,gamma\n2,beta\n1,alpha");
    });
  });

  it("4. xan join inner, left, and outer joins across normalized tables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/u79.csv\nuid,uname\n1,Alice\n2,Bob\n3,Carol\nCSV\ncat << 'CSV' > /tmp/o79.csv\nuid,amount\n1,250\n3,400\nCSV\nxan join uid /tmp/u79.csv uid /tmp/o79.csv | xan select uid,uname,amount -\nxan join --left uid /tmp/u79.csv uid /tmp/o79.csv | xan select uid,uname,amount -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "uid,uname,amount\n1,Alice,250\n3,Carol,400\nuid,uname,amount\n1,Alice,250\n2,Bob,\n3,Carol,400");
    });
  });

  it("5. xan top -n and xan sort -R -N numeric descending ranking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/scores79.csv\nplayer,score\np1,45\np2,99\np3,12\np4,88\np5,73\nCSV\nxan top score -l 3 /tmp/scores79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "player,score\np2,99\np4,88\np5,73");
    });
  });

  it("6. xan dedup by key column and xan enum row numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/dup79.csv\nemail,login_ts\na@poe.com,100\nb@poe.com,200\na@poe.com,300\nc@poe.com,400\nCSV\nxan dedup -s email /tmp/dup79.csv | xan enum -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "index,email,login_ts\n0,a@poe.com,100\n1,b@poe.com,200\n2,c@poe.com,400");
    });
  });

  it("7. xan frequency categorical value distribution table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/freq79.csv\nstatus\n200\n500\n200\n404\n200\n500\nCSV\nxan frequency -s status /tmp/freq79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "field,value,count\nstatus,200,3\nstatus,500,2\nstatus,404,1");
    });
  });

  it("8. xan transpose matrix inversion on tabular metrics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/mat79.csv\nmetric,q1,q2\nrev,100,150\ncost,60,70\nCSV\nxan transpose /tmp/mat79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "metric,rev,cost\nq1,100,60\nq2,150,70");
    });
  });

  it("9. xan slice, head, tail, and behead headerless stream extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/seq79.csv\nidx,val\n1,a\n2,b\n3,c\n4,d\n5,e\nCSV\nxan slice -s 1 -l 3 /tmp/seq79.csv | xan tail -l 2 -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "idx,val\n3,c\n4,d");
    });
  });

  it("10. xan search regex filtering and column-scoped matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/logs79.csv\nsvc,msg\nauth,login ok\npay,ERR_TIMEOUT_504\nsearch,query ok\npay,ERR_DECLINED_402\nCSV\nxan search -s msg 'ERR_' /tmp/logs79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc,msg\npay,ERR_TIMEOUT_504\npay,ERR_DECLINED_402");
    });
  });

  it("11. xan rename, drop, and select schema refactoring pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/raw_schema79.csv\nold_id,temp_col,old_val\n10,junk,alpha\n20,junk,beta\nCSV\nxan drop temp_col /tmp/raw_schema79.csv | xan rename id,val -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,val\n10,alpha\n20,beta");
    });
  });

  it("12. csvcut (-c / -C) + csvgrep (-c -m / -r) + csvsort (-c -r) pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/inv79.csv\nsku,category,stock,warehouse\nS-100,electronics,45,wh-east\nS-200,books,120,wh-west\nS-300,electronics,5,wh-east\nS-400,electronics,80,wh-west\nCSV\ncsvgrep -c category -m electronics /tmp/inv79.csv | csvcut -C warehouse | csvsort -c stock -r");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sku,category,stock\nS-400,electronics,80\nS-100,electronics,45\nS-300,electronics,5");
    });
  });

  it("13. csvstack with --filenames / -g group labels across regional CSVs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"item,qty\\npen,10\\n\" > /tmp/north79.csv\nprintf \"item,qty\\nbook,5\\n\" > /tmp/south79.csv\ncsvstack -g north,south -n region /tmp/north79.csv /tmp/south79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "region,item,qty\nnorth,pen,10\nsouth,book,5");
    });
  });

  it("14. csvjoin (--left / inner) + csvsql relational query over CSV files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"dept_id,dept_name\\n10,Engineering\\n20,Finance\\n\" > /tmp/depts79.csv\nprintf \"emp,dept_id,salary\\nAlice,10,140\\nBob,10,110\\nCarol,20,125\\n\" > /tmp/emps79.csv\ncsvsql --query \"SELECT d.dept_name, COUNT(*) AS headcount, SUM(CAST(e.salary AS INT)) AS payroll FROM depts79 d JOIN emps79 e ON d.dept_id = e.dept_id GROUP BY d.dept_name ORDER BY payroll DESC\" /tmp/depts79.csv /tmp/emps79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "dept_name,headcount,payroll\nEngineering,2,250\nFinance,1,125");
    });
  });

  it("15. csvjson and in2csv JSON <-> CSV roundtrip with key sorting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/j79.csv\nid,name,active\n1,alpha,true\n2,beta,false\nCSV\ncsvjson /tmp/j79.csv | jq -c 'map({id, name, active})' > /tmp/j79.json\ncat /tmp/j79.json\nin2csv /tmp/j79.json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"id\":1.0,\"name\":\"alpha\",\"active\":true},{\"id\":2.0,\"name\":\"beta\",\"active\":false}]\nid,name,active\n1.0,alpha,True\n2.0,beta,False");
    });
  });

  it("16. csvformat custom delimiter (-D '|') and quote formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' | csvformat -D '|'\na,b,c\n1,\"hello,world\",3\n4,5,6\nCSV");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a|b|c\n1|hello,world|3\n4|5|6");
    });
  });

  it("17. csvlook markdown/ASCII table rendering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' | csvlook\nhost,cpu,mem\nn1,4,16\nn2,8,32\nCSV");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "| host | cpu | mem |\n| ---- | --- | --- |\n| n1   |   4 |  16 |\n| n2   |   8 |  32 |");
    });
  });

  it("18. csvstat --count and per-column summary statistics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/st79.csv\nmetric,val\na,10\nb,20\nc,30\nCSV\ncsvstat --count /tmp/st79.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3");
    });
  });

  it("19. xan to json and xan from json structured conversion roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/xjson79.csv\nsvc,port\napi,8080\ndb,5432\nCSV\nxan to json /tmp/xjson79.csv | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"svc\":\"api\",\"port\":8080},{\"svc\":\"db\",\"port\":5432}]");
    });
  });

  it("20. xan + jq + sqlite3 + csvlook end-to-end SLA breach report table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/sla79.csv\nservice,p95_ms,budget_ms\nauth,42,50\ncheckout,185,100\nsearch,28,40\nbilling,130,90\nCSV\nxan map 'p95_ms - budget_ms as over_ms' /tmp/sla79.csv | xan filter 'over_ms > 0' - | xan sort -R -N -s over_ms - | xan select service,p95_ms,budget_ms,over_ms - | csvlook");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "| service  | p95_ms | budget_ms | over_ms |\n| -------- | ------ | --------- | ------- |\n| checkout |    185 |       100 |      85 |\n| billing  |    130 |        90 |      40 |");
    });
  });

});
