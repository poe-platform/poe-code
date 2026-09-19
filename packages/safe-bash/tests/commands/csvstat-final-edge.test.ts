import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

// Independent native measurements: locked CPython3.14.2/csvkit2.2.0/Agate1.14.2,
// frozen C/UTC/UTF-8 80x24 profile. No native oracle is invoked by these tests.
const reference = {
  "cases": [
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"True\": 2, \"False\": 2, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"True\": 2, \"False\": 2, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"True\": 2, \"False\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Boolean\", \"nulls\": true, \"nonnulls\": 4, \"unique\": 3, \"freq\": [{\"value\": true, \"count\": 2}, {\"value\": false, \"count\": 2}, {\"value\": null, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Boolean,True,4,3,,,,,,,,,\"True, False, None\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Boolean\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       4\n\tUnique values:         3\n\tMost common values:    True (2x)\n\t                       False (2x)\n\t                       None (1x)\n\nRow count: 5\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\ntrue\nfalse\nNA\ntrue\nfalse\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"zeta\": 2, \"None\": 2, \"alpha\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"zeta\": 2, \"None\": 2, \"alpha\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"zeta\": 2, \"None\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Text\", \"nulls\": true, \"nonnulls\": 4, \"unique\": 3, \"len\": 5.0, \"freq\": [{\"value\": \"zeta\", \"count\": 2}, {\"value\": null, \"count\": 2}, {\"value\": \"alpha\", \"count\": 2}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Text,True,4,3,,,,,,,5,,\"zeta, None, alpha\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Text\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       4\n\tUnique values:         3\n\tLongest value:         5 characters\n\tMost common values:    zeta (2x)\n\t                       None (2x)\n\t                       alpha (2x)\n\nRow count: 6\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "5\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nzeta\nNA\nalpha\nzeta\nNA\nalpha\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"2.00\": 2, \"-0.00\": 2, \"None\": 1, \"3\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"2.00\": 2, \"-0.00\": 2, \"None\": 1, \"3\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"2.00\": 2, \"-0.00\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Number\", \"nulls\": true, \"nonnulls\": 5, \"unique\": 4, \"min\": -0.0, \"max\": 3.0, \"sum\": 7.0, \"mean\": 1.4, \"median\": 2.0, \"stdev\": 1.3416407864998738, \"maxprecision\": 0, \"freq\": [{\"value\": 2.0, \"count\": 2}, {\"value\": -0.0, \"count\": 2}, {\"value\": null, \"count\": 1}, {\"value\": 3.0, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Number,True,5,4,-0,3,7,1.4,2,1.342,,0,\"2.00, -0.00, None, 3\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Number\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       5\n\tUnique values:         4\n\tSmallest value:        -0\n\tLargest value:         3\n\tSum:                   7\n\tMean:                  1.4\n\tMedian:                2\n\tStDev:                 1.342\n\tMost decimal places:   0\n\tMost common values:    2 (2x)\n\t                       -0 (2x)\n\t                       None (1x)\n\t                       3 (1x)\n\nRow count: 6\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "-0\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "7\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "2\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2.00\n2\n-0.00\n0\nNA\n3\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "0\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"2020-01-01\": 1, \"2020-01-02\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"2020-01-01\": 1, \"2020-01-02\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"2020-01-01\": 1, \"2020-01-02\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Date\", \"nulls\": true, \"nonnulls\": 2, \"unique\": 3, \"min\": \"2020-01-01\", \"max\": \"2020-01-02\", \"freq\": [{\"value\": \"2020-01-01\", \"count\": 1}, {\"value\": \"2020-01-02\", \"count\": 1}, {\"value\": null, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Date,True,2,3,2020-01-01,2020-01-02,,,,,,,\"2020-01-01, 2020-01-02, None\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Date\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       2\n\tUnique values:         3\n\tSmallest value:        2020-01-01\n\tLargest value:         2020-01-02\n\tMost common values:    2020-01-01 (1x)\n\t                       2020-01-02 (1x)\n\t                       None (1x)\n\nRow count: 3\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "2020-01-01\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n2020-01-01\n2020-01-02\nNA\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"0:01:00\": 1, \"0:02:30\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"0:01:00\": 1, \"0:02:30\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"0:01:00\": 1, \"0:02:30\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"TimeDelta\", \"nulls\": true, \"nonnulls\": 2, \"unique\": 3, \"min\": 60.0, \"max\": 150.0, \"sum\": 210.0, \"mean\": 105.0, \"freq\": [{\"value\": 60.0, \"count\": 1}, {\"value\": 150.0, \"count\": 1}, {\"value\": null, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,TimeDelta,True,2,3,0:01:00,0:02:30,0:03:30,0:01:45,,,,,\"0:01:00, 0:02:30, None\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          TimeDelta\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       2\n\tUnique values:         3\n\tSmallest value:        0:01:00\n\tLargest value:         0:02:30\n\tSum:                   0:03:30\n\tMean:                  0:01:45\n\tMost common values:    0:01:00 (1x)\n\t                       0:02:30 (1x)\n\t                       None (1x)\n\nRow count: 3\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "0:01:00\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "0:03:30\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n1:00\n2:30\nNA\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"😀😀\": 1, \"é\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"😀😀\": 1, \"é\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"😀😀\": 1, \"é\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Text\", \"nulls\": true, \"nonnulls\": 2, \"unique\": 3, \"len\": 2.0, \"freq\": [{\"value\": \"😀😀\", \"count\": 1}, {\"value\": \"é\", \"count\": 1}, {\"value\": null, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Text,True,2,3,,,,,,,2,,\"😀😀, é, None\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Text\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       2\n\tUnique values:         3\n\tLongest value:         2 characters\n\tMost common values:    😀😀 (1x)\n\t                       é (1x)\n\t                       None (1x)\n\nRow count: 3\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "2\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\n😀😀\né\nNA\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"Infinity\": 1, \"-Infinity\": 1, \"NaN\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"Infinity\": 1, \"-Infinity\": 1, \"NaN\": 1, \"None\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"Infinity\": 1, \"-Infinity\": 1 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Number\", \"nulls\": true, \"nonnulls\": 3, \"unique\": 4, \"maxprecision\": 0, \"freq\": [{\"value\": Infinity, \"count\": 1}, {\"value\": -Infinity, \"count\": 1}, {\"value\": NaN, \"count\": 1}, {\"value\": null, \"count\": 1}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Number,True,3,4,,,,,,,,0,\"Infinity, -Infinity, NaN, None\"\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Number\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       3\n\tUnique values:         4\n\tMost decimal places:   0\n\tMost common values:    Infinity (1x)\n\t                       -Infinity (1x)\n\t                       NaN (1x)\n\t                       None (1x)\n\nRow count: 4\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nInfinity\n-Infinity\nNaN\nNA\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "0\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--freq"
      ],
      "stdout": "{ \"None\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "0"
      ],
      "stdout": "{ \"None\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "-2"
      ],
      "stdout": "{  }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--freq",
        "--freq-count",
        "2"
      ],
      "stdout": "{ \"None\": 2 }\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--json"
      ],
      "stdout": "[{\"column_id\": 1, \"column_name\": \"x\", \"type\": \"Boolean\", \"nulls\": true, \"nonnulls\": 0, \"unique\": 1, \"freq\": [{\"value\": null, \"count\": 2}]}]",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--csv"
      ],
      "stdout": "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,x,Boolean,True,0,1,,,,,,,,,None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0"
      ],
      "stdout": "  1. \"x\"\n\n\tType of data:          Boolean\n\tContains null values:  True (excluded from calculations)\n\tNon-null values:       0\n\tUnique values:         1\n\tMost common values:    None (2x)\n\nRow count: 2\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--min"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--sum"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--median"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--len"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    },
    {
      "stdin": "x\nNA\nnull\n",
      "argv": [
        "-y0",
        "--max-precision"
      ],
      "stdout": "None\n",
      "stderr": "",
      "status": 0
    }
  ],
  "formats": {
    "[\"%.3f\",\"5\",true]": "5.000",
    "[\"%.3f\",\"-0.00\",true]": "-0.000",
    "[\"%.3f\",\"3\",true]": "3.000",
    "[\"%.3f\",\"7.00\",true]": "7.000",
    "[\"%.3f\",\"1.40\",true]": "1.400",
    "[\"%.3f\",\"2.00\",true]": "2.000",
    "[\"%.3f\",\"1.341640786499873817845504201\",true]": "1.342",
    "[\"%.3f\",\"2\",true]": "2.000"
  }
} as const;

for (const [index, item] of reference.cases.entries()) {
  test(`csvstat final edge differential ${index}: ${item.argv.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(csvkitCommands({
      codecs: [utf8Codec],
      locale: { profile: "C", timezone: "UTC", formatNumber(value, profile, format, grouping) {
        assert.equal(profile, "C");
        const key = JSON.stringify([format, value, grouping]);
        const result = (reference.formats as Record<string, string>)[key];
        assert.notEqual(result, undefined, `unmeasured locale input ${key}`);
        return result!;
      } },
      clock: { now: () => 0 },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
    }));
    try {
      const command = ["csvstat", ...item.argv].map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
      const result = await shell.exec(command, { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: item.stdout, stderr: item.stderr, status: item.status });
      assert.deepEqual(await fs.readdir("/"), [], "statistics must not create VFS effects");
    } finally { await shell.dispose(); }
  });
}

