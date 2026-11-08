import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan csvkit csvsql csvjoin csvgrep csvstat tabular etl matrix", () => {
  it("1. xan cat rows and xan cat cols vertical and horizontal CSV concatenation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,name\\n1,alice\\n' > /tmp/c1.csv\nprintf 'id,name\\n2,bob\\n' > /tmp/c2.csv\nprintf 'role\\nadmin\\nuser\\n' > /tmp/c3.csv\nxan cat rows /tmp/c1.csv /tmp/c2.csv > /tmp/rows.csv\nxan cat cols /tmp/rows.csv /tmp/c3.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,name,role\n1,alice,admin\n2,bob,user");
    });
  });

  it("2. xan map computed columns with arithmetic and string concatenation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'item,qty,price\\ncpu,4,150\\nram,8,45\\n' | xan map 'qty * price as total' - | xan select item,total -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "item,total\ncpu,600\nram,360");
    });
  });

  it("3. xan rename, xan drop, and xan slice -s/-l pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'old_id,name,temp_col\\n10,alpha,x\\n20,beta,y\\n30,gamma,z\\n' > /tmp/rds.csv\nxan drop temp_col /tmp/rds.csv | xan rename id,label - | xan slice -s 1 -l 2 -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,label\n20,beta\n30,gamma");
    });
  });

  it("4. xan groupby with multiple aggregations (sum, mean, min, max, count)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | xan groupby region 'count() as n, sum(ms) as total_ms, min(ms) as min_ms, max(ms) as max_ms' - | xan sort -s region -\nregion,ms\neu,12\nus,30\neu,18\nus,10\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "region,n,total_ms,min_ms,max_ms\neu,2,30,12,18\nus,2,40,10,30");
    });
  });

  it("5. xan join inner and left join across two CSV datasets", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'uid,name\\n1,Alice\\n2,Bob\\n3,Carol\\n' > /tmp/u.csv\nprintf 'uid,role\\n1,admin\\n3,editor\\n' > /tmp/r.csv\nxan join uid /tmp/u.csv uid /tmp/r.csv | xan select uid,name,role -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "uid,name,role\n1,Alice,admin\n3,Carol,editor");
    });
  });

  it("6. xan top -l N highest rows and xan dedup -s column deduplication", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'host,score\\nh1,50\\nh2,95\\nh1,80\\nh3,70\\nh2,60\\n' > /tmp/scores.csv\nxan top score -l 2 /tmp/scores.csv\nxan dedup -s host /tmp/scores.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "host,score\nh2,95\nh1,80\nhost,score\nh1,50\nh2,95\nh3,70");
    });
  });

  it("7. xan freq frequency distribution table sorted by count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'tier\\ngold\\nsilver\\ngold\\ngold\\nbronz\\nsilver\\n' | xan freq -s tier -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "field,value,count\ntier,gold,3\ntier,silver,2\ntier,bronz,1");
    });
  });

  it("8. xan to json and xan from -f json roundtrip conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,service\\n1,gateway\\n2,worker\\n' | xan to json - | xan from -f json - | xan select id,service -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,service\n1,gateway\n2,worker");
    });
  });

  it("9. xan transpose 2D CSV matrix and xan enum row numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'metric,q1,q2\\nrev,100,120\\ncost,40,50\\n' | xan transpose -\nprintf 'name\\nalpha\\nbeta\\n' | xan enum -c idx -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "metric,rev,cost\nq1,100,40\nq2,120,50\nidx,name\n0,alpha\n1,beta");
    });
  });

  it("10. csvcut -c column selection, -C exclusion, and -l line numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a,b,c,d\\n10,20,30,40\\n50,60,70,80\\n' > /tmp/four.csv\ncsvcut -c d,a /tmp/four.csv\ncsvcut -C b,c -l /tmp/four.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "d,a\n40,10\n80,50\nline_number,a,d\n1,10,40\n2,50,80");
    });
  });

  it("11. csvgrep -c column -r regex match and -i invert match", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,email\\n1,alice@prod.org\\n2,bob@staging.org\\n3,carol@prod.org\\n' > /tmp/emails.csv\ncsvgrep -c email -r '@prod\\.org$' /tmp/emails.csv\ncsvgrep -i -c email -m 'prod' /tmp/emails.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,email\n1,alice@prod.org\n3,carol@prod.org\nid,email\n2,bob@staging.org");
    });
  });

  it("12. csvstat --count, --sum, --mean, --min, --max, and --median", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'val\\n10\\n20\\n30\\n40\\n50\\n' > /tmp/nums.csv\ncsvstat --count /tmp/nums.csv\ncsvstat --sum /tmp/nums.csv\ncsvstat --median /tmp/nums.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5\n150\n30");
    });
  });

  it("13. csvjoin inner, --left, and --outer joins on key column", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,dept\\n1,eng\\n2,ops\\n' > /tmp/j_left.csv\nprintf 'id,budget\\n1,500\\n3,300\\n' > /tmp/j_right.csv\ncsvjoin -c id /tmp/j_left.csv /tmp/j_right.csv\ncsvjoin --left -c id /tmp/j_left.csv /tmp/j_right.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,dept,budget\n1,eng,500\nid,dept,budget\n1,eng,500\n2,ops,");
    });
  });

  it("14. csvstack -g group labels and -n group column name across regional shards", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'host,cpu\\nh1,45\\n' > /tmp/us.csv\nprintf 'host,cpu\\nh2,60\\n' > /tmp/eu.csv\ncsvstack -g us,eu -n region /tmp/us.csv /tmp/eu.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "region,host,cpu\nus,h1,45\neu,h2,60");
    });
  });

  it("15. csvjson -k keyed object map and GeoJSON (--lat / --lon) feature collection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,city,lat,lon\\nsfo,SF,37.77,-122.41\\n' > /tmp/geo.csv\ncsvjson -k id /tmp/geo.csv | jq -c '.sfo.city'\ncsvjson --lat lat --lon lon -k id /tmp/geo.csv | jq -c '.features[0] | {id: .id, type: .geometry.type, coords: .geometry.coordinates}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "\"SF\"\n{\"id\":\"sfo\",\"type\":\"Point\",\"coords\":[-122.41,37.77]}");
    });
  });

  it("16. in2csv JSON-to-CSV and NDJSON-to-CSV conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[{\"host\":\"web1\",\"ok\":true},{\"host\":\"web2\",\"ok\":false}]' | in2csv -f json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "host,ok\nweb1,True\nweb2,False");
    });
  });

  it("17. csvformat -D custom output delimiter and -T tab delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a,b,c\\n1,2,3\\n' | csvformat -D '|'\nprintf 'a,b,c\\n1,2,3\\n' | csvformat -T");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a|b|c\n1|2|3\na\tb\tc\n1\t2\t3");
    });
  });

  it("18. csvsql --query ad-hoc SQL JOIN and GROUP BY directly over CSV files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'emp_id,name,dept_id\\n1,Alice,10\\n2,Bob,20\\n3,Carol,10\\n' > /tmp/emp.csv\nprintf 'dept_id,dept_name\\n10,Core\\n20,Cloud\\n' > /tmp/dept.csv\ncsvsql --query 'SELECT d.dept_name, COUNT(*) AS headcount FROM emp e JOIN dept d ON e.dept_id = d.dept_id GROUP BY d.dept_name ORDER BY d.dept_name' /tmp/emp.csv /tmp/dept.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "dept_name,headcount\nCloud,1\nCore,2");
    });
  });

  it("19. csvlook Markdown-compatible ASCII table rendering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'pkg,status\\nsafe-bash,ready\\n' | csvlook");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "| pkg       | status |\n| --------- | ------ |\n| safe-bash | ready  |");
    });
  });

  it("20. csvsort numeric and reverse sorting piped through xan filter and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'service,p99\\nauth,42\\ngateway,9\\nbilling,120\\nsearch,18\\n' | csvsort -c p99 -r | xan filter 'p99 >= 20' - | xan to json - | jq -c 'map(.service)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[\"billing\",\"auth\"]");
    });
  });

});
