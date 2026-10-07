import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

const SEED_SALES = [
  "cat <<'CSV' > /tmp/sales.csv",
  "id,region,rep,units,price,tags",
  "1,east, alice ,10,5.5,core|pro",
  "2,west,bob,4,12.0,core",
  "3,east,carol,8,7.25,pro|ent",
  "4,west,dave,15,4.0,ent",
  "CSV",
  "cat <<'CSV' > /tmp/quotas.csv",
  "region,quota",
  "east,100",
  "west,80",
  "north,50",
  "CSV",
].join("\n");

describe("obscure xan and csvkit tabular analytics pipeline matrix", () => {
  test("1. xan map with nested upper(trim(...)) string functions and arithmetic expressions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan map 'upper(trim(rep))' rep_clean /tmp/sales.csv | xan map 'units * price' revenue | xan select rep_clean,revenue",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "rep_clean,revenue\nALICE,55\nBOB,48\nCAROL,58\nDAVE,60\n"
      );
    });
  });

  test("2. xan select -e evaluated projection with upper, lower, trim, len, arithmetic, and AS aliases", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan select -e 'upper(trim(rep)) as rep_clean, len(trim(rep)) as name_len, units * price as revenue' /tmp/sales.csv",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "rep_clean,name_len,revenue\nALICE,5,55\nBOB,3,48\nCAROL,5,58\nDAVE,4,60\n"
      );
    });
  });

  test("3. xan filter multi-stage numeric and string equality pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          `xan filter 'units >= 8' /tmp/sales.csv | xan filter 'region == "east"' | xan select id,rep,units`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,rep,units\n1, alice ,10\n3,carol,8\n");
    });
  });

  test("4. xan groupby with count(), sum(), mean(), min(), and max() aggregations", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan groupby region 'count() as n, sum(units) as total_u, mean(price) as avg_p' /tmp/sales.csv | xan sort -s region",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "region,n,total_u,avg_p\neast,2,18,6.375\nwest,2,19,8\n"
      );
    });
  });

  test("5. xan agg whole-table summary aggregations with custom aliases", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan agg 'count() as rows, sum(units) as u_sum, min(units) as u_min, max(units) as u_max' /tmp/sales.csv",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "rows,u_sum,u_min,u_max\n4,37,4,15\n");
    });
  });

  test("6. xan search case-insensitive substring and exact match filtering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan search -s tags -i 'PRO' /tmp/sales.csv | xan select id,tags",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,tags\n1,core|pro\n3,pro|ent\n");
    });
  });

  test("7. xan join relational inner join followed by numeric sort", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan join region /tmp/sales.csv region /tmp/quotas.csv | xan select id,region,quota | xan sort -N -s id",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "id,region,quota\n1,east,100\n2,west,80\n3,east,100\n4,west,80\n"
      );
    });
  });

  test("8. xan join --semi and --anti relational key filtering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          'printf "region\\neast\\n" > /tmp/active_reg.csv',
          "xan join --semi region /tmp/sales.csv region /tmp/active_reg.csv | xan select id",
          "xan join --anti region /tmp/sales.csv region /tmp/active_reg.csv | xan select id",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id\n1\n3\nid\n2\n4\n");
    });
  });

  test("9. xan top largest (-l) and smallest (-l -R) numeric ranking", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan top units -l 2 /tmp/sales.csv | xan select id,units",
          "xan top units -l 2 -R /tmp/sales.csv | xan select id,units",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,units\n4,15\n1,10\nid,units\n2,4\n3,8\n");
    });
  });

  test("10. xan enum custom start offset (-S), xan rename (-s), and xan slice (-s -l)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan enum -c row_idx -S 10 /tmp/sales.csv | xan rename -s row_idx idx | xan select idx,id | xan slice -s 1 -l 2",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "idx,id\n11,2\n12,3\n");
    });
  });

  test("11. xan dedup first-seen vs last-seen (-l) key deduplication", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan dedup -s region /tmp/sales.csv | xan select id,region",
          "xan dedup -s region -l /tmp/sales.csv | xan select id,region",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,region\n1,east\n2,west\nid,region\n3,east\n4,west\n");
    });
  });

  test("12. xan transpose matrix row/column inversion", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "metric,q1,q2\\nrev,100,120\\ncost,40,50\\n" | xan transpose`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "metric,rev,cost\nq1,100,40\nq2,120,50\n");
    });
  });

  test("13. xan stats column summary statistics piped into xan search and xan select", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan stats /tmp/sales.csv | xan search -s field -e 'units' | xan select field,count,type,sum,mean,min,max",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "field,count,type,sum,mean,min,max\nunits,4,int,37,9.25,4,15\n"
      );
    });
  });

  test("14. xan frequency value distribution and xan to json serialization", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "xan frequency -s region /tmp/sales.csv",
          "xan select id,region /tmp/sales.csv | xan slice -l 2 | xan to json | jq -c '.'",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        'field,value,count\nregion,east,2\nregion,west,2\n[{"id":1,"region":"east"},{"id":2,"region":"west"}]\n'
      );
    });
  });

  test("15. csvcut column inclusion (-c) and exclusion (-C) by header name", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "csvcut -c region,units /tmp/sales.csv | head -n 3",
          "csvcut -C tags,price /tmp/sales.csv | tail -n 2",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "region,units\neast,10\nwest,4\n3,east,carol,8\n4,west,dave,15\n"
      );
    });
  });

  test("16. csvgrep pattern matching (-m) and inverted match (-i) on named columns", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "csvgrep -c region -m east /tmp/sales.csv | csvcut -c id,rep",
          "csvgrep -c region -m east -i /tmp/sales.csv | csvcut -c id",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,rep\n1, alice \n3,carol\nid\n2\n4\n");
    });
  });

  test("17. csvsort reverse numeric ordering (-c units -r)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [SEED_SALES, "csvsort -c units -r /tmp/sales.csv | csvcut -c id,units"].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id,units\n4,15\n1,10\n3,8\n2,4\n");
    });
  });

  test("18. csvjoin relational join on shared key column (-c region)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "csvjoin -c region /tmp/sales.csv /tmp/quotas.csv | csvcut -c id,region,quota",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "id,region,quota\n1,east,100\n2,west,80\n3,east,100\n4,west,80\n"
      );
    });
  });

  test("19. csvsql --query SQL aggregation directly over CSV file", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          SEED_SALES,
          "csvsql --query 'SELECT region, SUM(CAST(units AS INTEGER)) AS u FROM sales GROUP BY region ORDER BY region' /tmp/sales.csv",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "region,u\neast,18\nwest,19\n");
    });
  });

  test("20. csvstack multi-file concatenation, csvformat custom delimiter (-D), and in2csv + csvstat --count", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a,b\\n1,2\\n" > /tmp/p1.csv',
          'printf "a,b\\n3,4\\n" > /tmp/p2.csv',
          "csvstack /tmp/p1.csv /tmp/p2.csv | csvformat -D '|'",
          `printf '[{"k":"a","v":10},{"k":"b","v":20}]' | in2csv -f json | csvstat --count`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|b\n1|2\n3|4\n2\n");
    });
  });
});
