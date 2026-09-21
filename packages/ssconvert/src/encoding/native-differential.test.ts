// Captured from the separate pinned 1.12.61 oracle, using original fixtures.
// Output expectations are hexadecimal bytes, never decoded-string comparisons.
import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand } from "../index.js";

interface Case {
  readonly formula?: string;
  readonly timezone?: string;
  readonly locale?: string;
  readonly charset?: string;
  readonly mode?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly exportLocale?: string | null;
  readonly importEncoding?: string;
  readonly inputHex: string;
  readonly outputHex: string | null;
  readonly status: number;
  readonly stderr: string;
}
const cases: readonly Case[] = [
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "225c7530306539205c7530306466205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "CP437",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "228220e1205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "CP437",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "228220e120455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "LATIN10",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20a4205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "LATIN10",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20a4203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ISO-8859-9",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ISO-8859-9",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "CP1252",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df2080205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "CP1252",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df2080203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-16",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-16",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-16BE",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "002200e9002000df002020ac00206f220020d83dde000022002c0031002e0032000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-16BE",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "002200e9002000df002020ac00206f220020d83dde000022002c0031002e0032000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UCS-2",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20005c0055003000300030003100660036003000300022002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UCS-2",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003f0022002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-32",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe000022000000e900000020000000df00000020000000ac20000020000000226f00002000000000f60100220000002c000000310000002e000000320000000a000000",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF-32",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe000022000000e900000020000000df00000020000000ac20000020000000226f00002000000000f60100220000002c000000310000002e000000320000000a000000",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UCS-4",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "00000022000000e900000020000000df00000020000020ac0000002000006f22000000200001f600000000220000002c000000310000002e000000320000000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UCS-4",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "00000022000000e900000020000000df00000020000020ac0000002000006f22000000200001f600000000220000002c000000310000002e000000320000000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF16LE",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "UTF16LE",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ANSI_X3.4-1968",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "225c7530306539205c7530306466205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ANSI_X3.4-1968",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "225c7530306539205c7530306466205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "CP437",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "228220e1205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "CP437",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "228220e120455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "LATIN10",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20a4205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "LATIN10",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20a4203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ISO-8859-9",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ISO-8859-9",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df20455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "CP1252",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df2080205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "CP1252",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "22e920df2080203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-16",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-16",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-16BE",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "002200e9002000df002020ac00206f220020d83dde000022002c0031002e0032000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-16BE",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "002200e9002000df002020ac00206f220020d83dde000022002c0031002e0032000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UCS-2",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20005c0055003000300030003100660036003000300022002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UCS-2",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003a002d00440022002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-32",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe000022000000e900000020000000df00000020000000ac20000020000000226f00002000000000f60100220000002c000000310000002e000000320000000a000000",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF-32",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "fffe000022000000e900000020000000df00000020000000ac20000020000000226f00002000000000f60100220000002c000000310000002e000000320000000a000000",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UCS-4",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "00000022000000e900000020000000df00000020000020ac0000002000006f22000000200001f600000000220000002c000000310000002e000000320000000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UCS-4",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "00000022000000e900000020000000df00000020000020ac0000002000006f22000000200001f600000000220000002c000000310000002e000000320000000a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF16LE",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "UTF16LE",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "2200e9002000df002000ac202000226f20003dd800de22002c0031002e0032000a00",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ANSI_X3.4-1968",
    "mode": "escape",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "225c7530306539205c7530306466205c7532306163205c7536663232205c553030303166363030222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ANSI_X3.4-1968",
    "mode": "transliterate",
    "env": {},
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {
      "LC_ALL": "",
      "LC_CTYPE": "C.UTF-8",
      "LANG": "C"
    },
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {
      "LC_ALL": "",
      "LC_CTYPE": "C",
      "LANG": "C.UTF-8"
    },
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {
      "LC_ALL": "C.UTF-8",
      "LC_CTYPE": "C",
      "LANG": "C"
    },
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {
      "TZ": "America/New_York"
    },
    "exportLocale": null,
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "C",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "C.UTF-8",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "de_DE.UTF-8",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "missing_LOCALE",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "223f20737320455552203f203f222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "C",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "C.UTF-8",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "de_DE.UTF-8",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "missing_LOCALE",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ASCII",
    "mode": "transliterate",
    "env": {},
    "exportLocale": "",
    "inputHex": "22c3a920c39f20e282ac20e6bca220f09f9880222c312e320a",
    "outputHex": "226520737320455552203f203a2d44222c312e320a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "LATIN10",
    "inputHex": "aa0a",
    "outputHex": "c8980a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "CP437",
    "inputHex": "820a",
    "outputHex": null,
    "status": 1,
    "stderr": "E Unsupported file format for file \"bytes1.csv\"\n"
  },
  {
    "importEncoding": "UTF-8",
    "inputHex": "78c3",
    "outputHex": "780a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "UTF-8",
    "inputHex": "78c3280a",
    "outputHex": "78c383280a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "UTF-16LE",
    "inputHex": "780041",
    "outputHex": "780a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "UTF-32",
    "inputHex": "fffe00007800000041",
    "outputHex": "780a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "WINDOWS-1255",
    "inputHex": "d40a",
    "outputHex": "d7b00a",
    "status": 0,
    "stderr": ""
  },
  {
    "importEncoding": "WINDOWS-1252",
    "inputHex": "810a",
    "outputHex": null,
    "status": 1,
    "stderr": "E Unsupported file format for file \"bytes7.csv\"\n"
  }
,
  {
    "locale": "C",
    "charset": "ascii",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "ascii",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a48203f203f203f2061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-1",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-1",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f20de203f203f204f4520df203f202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-2",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a120a3205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-2",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f20a120a3204f4520df203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-3",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c7532303134205c753030613920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-3",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f203f203f204f4520df203f202d2d2028432920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-4",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a1205c7530313431205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-4",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f20a1203f204f4520df203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-5",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420b6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-5",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20455552204420b6203f203f203f2061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-6",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c753035653920c7205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-6",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a48203f20c7203f2061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-7",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c753030653920a420c4205c7530343136205c7530356539205c7530363237205c753065303120e1205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-7",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20a420c4205a48203f203f203f20e1203f203f203f203f204f45207373203f202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-8",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c753034313620f9205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-8",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a4820f9203f203f2061203f203f203f203f204f45207373203f202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-9",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-9",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f203f203f204f4520df203f202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-10",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de20a1205c7530313431205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-10",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f20de20a1203f204f4520df203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-11",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c753036323720a1205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-11",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a48203f203f20a12061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-13",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520c020d9205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-13",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f20c020d9204f4520df203f202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-14",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-14",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9204555522044205a48203f203f203f2061203f203f203f203f204f4520df203f202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-15",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c753031343120bc20df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-15",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a42044205a48203f203f203f2061203f20de203f203f20bc20df203f202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-16",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c753033623120aa205c753030646520a120a320bc20df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "iso-8859-16",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a42044205a48203f203f203f206120aa203f20a120a320bc20df203f202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp437",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp437",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f20e0203f203f203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp850",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820e8205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp850",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f2061203f20e8203f203f204f4520e1203f202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp852",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a4209d205c753031353220e1205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp852",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f2061203f203f20a4209d204f4520e1203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp855",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420ea205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp855",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20455552204420ea203f203f203f2061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp857",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp857",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f2061203f203f203f203f204f4520e1203f202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp858",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220d5205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820e8205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp858",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220d52044205a48203f203f203f2061203f20e8203f203f204f4520e1203f202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp860",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp860",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f20e0203f203f203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp861",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138208d205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp861",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f20e0203f208d203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp862",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c75303431362099205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp862",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a482099203f203f20e0203f203f203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp863",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp863",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f20e0203f203f203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp864",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c75303061392094222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp864",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a48203f203f203f2061203f203f203f203f204f45207373203f202d2d202843292094222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp865",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp865",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282204555522044205a48203f203f203f20e0203f203f203f203f204f4520e1203f202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp866",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c75303339342086205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp866",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f2045555220442086203f203f203f2061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp869",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c753230616320a7205c7530343136205c7530356539205c7530363237205c753065303120d6205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134209720ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "cp869",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f2045555220a7205a48203f203f203f20d6203f203f203f203f204f45207373203f202d2d209720ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1250",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a520a3205c753031353220df205c553030303166363030209720a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1250",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f203f203f2061203f203f20a520a3204f4520df203f209720a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1251",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c75303065392088205c753033393420c6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1251",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f2088204420c6203f203f203f2061203f203f203f203f204f45207373203f209720a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1252",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1252",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f203f203f2061203f20de203f203f208c20df203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1253",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539208020c4205c7530343136205c7530356539205c7530363237205c753065303120e1205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1253",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f208020c4205a48203f203f203f20e1203f203f203f203f204f45207373203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1254",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1254",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f203f203f2061203f203f203f203f208c20df203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1255",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c75303065392080205c7530333934205c753034313620f9205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1255",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20802044205a4820f9203f203f2061203f203f203f203f204f45207373203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1256",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c753035653920c7205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1256",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f20c7203f2061203f203f203f203f208c207373203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1257",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520c020d9205c753031353220df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1257",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f203f203f2061203f203f20c020d9204f4520df203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1258",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "windows-1258",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920802044205a48203f203f203f2061203f203f203f203f208c20df203f209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "koi8-r",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420f6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420bf205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "koi8-r",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20455552204420f6203f203f203f2061203f203f203f203f204f45207373203f202d2d20bf2020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "koi8-u",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420f6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420bf205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "koi8-u",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f20455552204420f6203f203f203f2061203f203f203f203f204f45207373203f202d2d20bf2020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "macintosh",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228e20db20c6205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c753031343120ce20a7205c55303030316636303020d120a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "macintosh",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228e20db20c6205a48203f203f203f2061203f203f203f203f20ce20a7203f20d120a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "mac-cyrillic",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c75303339342086205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c55303030316636303020d120a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "mac-cyrillic",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f2045555220442086203f203f203f2061203f203f203f203f204f45207373203f20d120a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "tis-620",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c753036323720a1205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C",
    "charset": "tis-620",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "223f204555522044205a48203f203f20a12061203f203f203f203f204f45207373203f202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ascii",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "ascii",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f203f203f203f203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-1",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-1",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f205320de2041204c204f4520df203a2d44202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-2",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a120a3205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-2",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f205320544820a120a3204f4520df203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-3",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c7532303134205c753030613920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-3",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f20532054482041204c204f4520df203a2d44202d2d2028432920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-4",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a1205c7530313431205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-4",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f205320544820a1204c204f4520df203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-5",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420b6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-5",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f20b6203f203f203f203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-6",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c753035653920c7205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-6",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f203f20c7203f203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-7",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c753030653920a420c4205c7530343136205c7530356539205c7530363237205c753065303120e1205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-7",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520a420c4203f203f203f203f20e120532054482041204c204f45207373203a2d44202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-8",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c753034313620f9205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-8",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f20f9203f203f203f20532054482041204c204f45207373203a2d44202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-9",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-9",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f20532054482041204c204f4520df203a2d44202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-10",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de20a1205c7530313431205c753031353220df205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-10",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f205320de20a1204c204f4520df203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-11",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c753036323720a1205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-11",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f203f203f20a1203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-13",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520c020d9205c753031353220df205c553030303166363030205c753230313420a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-13",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f205320544820c020d9204f4520df203a2d44202d2d20a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-14",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e9205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-14",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920455552203f203f203f203f203f203f20532054482041204c204f4520df203a2d44202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-15",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c753031343120bc20df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-15",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4203f203f203f203f203f203f205320de2041204c20bc20df203a2d44202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-16",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c753033623120aa205c753030646520a120a320bc20df205c553030303166363030205c753230313420a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "iso-8859-16",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e920a4203f203f203f203f203f203f20aa20544820a120a320bc20df203a2d44202d2d20a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp437",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp437",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f20e020532054482041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp850",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820e8205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp850",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f203f205320e82041204c204f4520e1203a2d44202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp852",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a4209d205c753031353220e1205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp852",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f203f205320544820a4209d204f4520e1203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp855",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420ea205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp855",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f20ea203f203f203f203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp857",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp857",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f203f20532054482041204c204f4520e1203a2d44202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp858",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220d5205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820e8205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c753230313420b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp858",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220d5203f203f203f203f203f203f205320e82041204c204f4520e1203a2d44202d2d20b820ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp860",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp860",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f20e020532054482041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp861",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138208d205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp861",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f20e02053208d2041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp862",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c75303431362099205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp862",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f2099203f203f20e020532054482041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp863",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp863",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f20e020532054482041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp864",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c75303061392094222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp864",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f203f203f203f203f20532054482041204c204f45207373203a2d44202d2d202843292094222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp865",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2282205c7532306163205c7530333934205c7530343136205c7530356539205c7530363237205c753065303120e0205c7530323138205c7530306465205c7530313034205c7530313431205c753031353220e1205c553030303166363030205c7532303134205c753030613920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp865",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228220455552203f203f203f203f203f20e020532054482041204c204f4520e1203a2d44202d2d2028432920ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp866",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c75303339342086205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp866",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f2086203f203f203f203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp869",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c753230616320a7205c7530343136205c7530356539205c7530363237205c753065303120d6205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134209720ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "cp869",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22652045555220a7203f203f203f203f20d620532054482041204c204f45207373203a2d44202d2d209720ab222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1250",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520a520a3205c753031353220df205c553030303166363030209720a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1250",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f203f203f203f205320544820a520a3204f4520df203a2d44209720a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1251",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c75303065392088205c753033393420c6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1251",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22652088203f20c6203f203f203f203f20532054482041204c204f45207373203a2d44209720a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1252",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c753032313820de205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1252",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f203f203f203f205320de2041204c208c20df203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1253",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539208020c4205c7530343136205c7530356539205c7530363237205c753065303120e1205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1253",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "2265208020c4203f203f203f203f20e120532054482041204c204f45207373203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1254",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1254",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f203f203f203f20532054482041204c208c20df203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1255",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c75303065392080205c7530333934205c753034313620f9205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1255",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22652080203f203f20f9203f203f203f20532054482041204c204f45207373203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1256",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c753035653920c7205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c205c7530306466205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1256",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f20c7203f203f20532054482041204c208c207373203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1257",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c753030646520c020d9205c753031353220df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1257",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f203f203f203f205320544820c020d9204f4520df203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1258",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080205c7530333934205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431208c20df205c553030303166363030209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "windows-1258",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "22e92080203f203f203f203f203f203f20532054482041204c208c20df203a2d44209720a920bd222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "koi8-r",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420f6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420bf205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "koi8-r",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f20f6203f203f203f203f20532054482041204c204f45207373203a2d44202d2d20bf2020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "koi8-u",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c753033393420f6205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c753230313420bf205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "koi8-u",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f20f6203f203f203f203f20532054482041204c204f45207373203a2d44202d2d20bf2020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "macintosh",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228e20db20c6205c7530343136205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c753031343120ce20a7205c55303030316636303020d120a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "macintosh",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "228e20db20c6203f203f203f203f203f20532054482041204c20ce20a7203a2d4420d120a9202031da3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "mac-cyrillic",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c75303339342086205c7530356539205c7530363237205c7530653031205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c55303030316636303020d120a9205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "mac-cyrillic",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f2086203f203f203f203f20532054482041204c204f45207373203a2d4420d120a92020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "tis-620",
    "mode": "escape",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "225c7530306539205c7532306163205c7530333934205c7530343136205c7530356539205c753036323720a1205c7530336231205c7530323138205c7530306465205c7530313034205c7530313431205c7530313532205c7530306466205c553030303166363030205c7532303134205c7530306139205c7530306264222c312e32350a",
    "status": 0,
    "stderr": ""
  },
  {
    "locale": "C.UTF-8",
    "charset": "tis-620",
    "mode": "transliterate",
    "inputHex": "22c3a920e282ac20ce9420d09620d7a920d8a720e0b88120ceb120c89820c39e20c48420c58120c59220c39f20f09f988020e2809420c2a920c2bd222c312e32350a",
    "outputHex": "226520455552203f203f203f203f20a1203f20532054482041204c204f45207373203a2d44202d2d202843292020312f3220222c312e32350a",
    "status": 0,
    "stderr": ""
  }
,
  {
    "timezone": "UTC",
    "formula": "=UNIX2DATE(0)",
    "status": 0,
    "stderr": "",
    "outputHex": "32353536390a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "UTC"
    }
  },
  {
    "timezone": "UTC",
    "formula": "=DATE2UNIX(25569)",
    "status": 0,
    "stderr": "",
    "outputHex": "300a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "UTC"
    }
  },
  {
    "timezone": "UTC",
    "formula": "=DATE(2024,3,10)",
    "status": 0,
    "stderr": "",
    "outputHex": "34353336310a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "UTC"
    }
  },
  {
    "timezone": "UTC",
    "formula": "=TEXT(DATE(2024,3,10),\"yyyy-mm-dd dddd\")",
    "status": 0,
    "stderr": "",
    "outputHex": "22323032342d30332d31302053756e646179220a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "UTC"
    }
  },
  {
    "timezone": "America/New_York",
    "formula": "=UNIX2DATE(0)",
    "status": 0,
    "stderr": "",
    "outputHex": "32353536382e3739313636363636363636380a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "America/New_York"
    }
  },
  {
    "timezone": "America/New_York",
    "formula": "=DATE2UNIX(25569)",
    "status": 0,
    "stderr": "",
    "outputHex": "31383030300a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "America/New_York"
    }
  },
  {
    "timezone": "America/New_York",
    "formula": "=DATE(2024,3,10)",
    "status": 0,
    "stderr": "",
    "outputHex": "34353336310a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "America/New_York"
    }
  },
  {
    "timezone": "America/New_York",
    "formula": "=TEXT(DATE(2024,3,10),\"yyyy-mm-dd dddd\")",
    "status": 0,
    "stderr": "",
    "outputHex": "22323032342d30332d31302053756e646179220a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "America/New_York"
    }
  },
  {
    "timezone": "Europe/Berlin",
    "formula": "=UNIX2DATE(0)",
    "status": 0,
    "stderr": "",
    "outputHex": "32353536392e3034313636363636363636380a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "Europe/Berlin"
    }
  },
  {
    "timezone": "Europe/Berlin",
    "formula": "=DATE2UNIX(25569)",
    "status": 0,
    "stderr": "",
    "outputHex": "2d333630300a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "Europe/Berlin"
    }
  },
  {
    "timezone": "Europe/Berlin",
    "formula": "=DATE(2024,3,10)",
    "status": 0,
    "stderr": "",
    "outputHex": "34353336310a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "Europe/Berlin"
    }
  },
  {
    "timezone": "Europe/Berlin",
    "formula": "=TEXT(DATE(2024,3,10),\"yyyy-mm-dd dddd\")",
    "status": 0,
    "stderr": "",
    "outputHex": "22323032342d30332d31302053756e646179220a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "Europe/Berlin"
    }
  },
  {
    "timezone": "EST5EDT",
    "formula": "=UNIX2DATE(0)",
    "status": 0,
    "stderr": "",
    "outputHex": "32353536382e3739313636363636363636380a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "EST5EDT"
    }
  },
  {
    "timezone": "EST5EDT",
    "formula": "=DATE2UNIX(25569)",
    "status": 0,
    "stderr": "",
    "outputHex": "31383030300a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "EST5EDT"
    }
  },
  {
    "timezone": "EST5EDT",
    "formula": "=DATE(2024,3,10)",
    "status": 0,
    "stderr": "",
    "outputHex": "34353336310a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "EST5EDT"
    }
  },
  {
    "timezone": "EST5EDT",
    "formula": "=TEXT(DATE(2024,3,10),\"yyyy-mm-dd dddd\")",
    "status": 0,
    "stderr": "",
    "outputHex": "22323032342d30332d31302053756e646179220a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": "EST5EDT"
    }
  },
  {
    "timezone": "",
    "formula": "=UNIX2DATE(0)",
    "status": 0,
    "stderr": "",
    "outputHex": "32353536390a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": ""
    }
  },
  {
    "timezone": "",
    "formula": "=DATE2UNIX(25569)",
    "status": 0,
    "stderr": "",
    "outputHex": "300a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": ""
    }
  },
  {
    "timezone": "",
    "formula": "=DATE(2024,3,10)",
    "status": 0,
    "stderr": "",
    "outputHex": "34353336310a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": ""
    }
  },
  {
    "timezone": "",
    "formula": "=TEXT(DATE(2024,3,10),\"yyyy-mm-dd dddd\")",
    "status": 0,
    "stderr": "",
    "outputHex": "22323032342d30332d31302053756e646179220a",
    "inputHex": "666978747572650a",
    "env": {
      "TZ": ""
    }
  }
];

function bytes(hex: string): Uint8Array {
  return new Uint8Array(Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)));
}

it.each(cases.map((c, index) => [index, c] as const))("matches native encoding/locale bytes, diagnostics and status, case %s", async (_index, c) => {
  const fs = Volume.fromJSON({ "/input.csv": Buffer.from(bytes(c.inputHex)) });
  const errors: Uint8Array[] = [];
  const engine = createEngine({ codecs: [],
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    environment: { env: { LC_ALL: c.locale ?? "C", LANG: "C", TZ: "UTC", ...c.env }, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { return [new Uint8Array(fs.readFileSync(uri) as Uint8Array)]; },
      async write(uri, data) { fs.writeFileSync(uri, data); }
    } });
  const args = ["-T", "Gnumeric_stf:stf_assistant"];
  if (c.formula !== undefined) args.push("--set", "A1=" + c.formula, "-O", "format=raw");
  if (c.importEncoding !== undefined) args.push("-E", c.importEncoding);
  if (c.charset !== undefined) {
    let options = "charset=" + c.charset + " transliterate-mode=" + c.mode;
    if (c.exportLocale !== undefined && c.exportLocale !== null) options += " locale='" + c.exportLocale + "'";
    args.push("-O", options);
  }
  args.push("/input.csv", "/output.csv");
  try {
    const result = await runCommand(args, engine, { signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write(data) { errors.push(new Uint8Array(data)); } } });
    expect(result.exitCode).toBe(c.status);
    // Oracle paths vary; require the exact relative file diagnostic for failed probes.
    const expectedError = c.stderr.startsWith("E Unsupported file format") ? 'E Unsupported file format for file "input.csv"\n' : c.stderr;
    expect(errors.map(data => new TextDecoder().decode(data)).join("")).toBe(expectedError);
    if (c.outputHex === null) expect(fs.existsSync("/output.csv")).toBe(false);
    else expect(new Uint8Array(fs.readFileSync("/output.csv") as Uint8Array)).toEqual(bytes(c.outputHex));
    expect(new Uint8Array(fs.readFileSync("/input.csv") as Uint8Array)).toEqual(bytes(c.inputHex));
  } finally { await engine.dispose(); }
});
