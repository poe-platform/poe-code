import {unpackCodepage} from "./codepage-table.js";
import { normalizeEncoding, pythonCodecAliases } from "./python-codec-aliases.js";

// dbfread 2.0.7 single-byte drivers, captured from frozen CPython 3.14.2.
// Every byte is qualified in docs/csvkit/dbf-codepage-reference.json.
const table0 = unpackCodepage("gKwggf//gQOFJiCG//+GCpEYIJEBkxwgkwGVIiCWEyCWAZj//5gHoQEOoTnb///bA98/Dt8c/P///AM=");
const table1 = unpackCodepage("ghogg5IBhB4ghiAghgGJMCCLOSCZIiGbOiChhQOhAaOjAKMGqv//q6sAqwOvFSCwsACwA7SEA7W1ALUCuIgDuAK7uwC8jAO9vQC+jgO+E9L//9OjA9Mr", table0);
const table2 = unpackCodepage("iMYCmNwCoaEAoQGkqiCq1wCvrwC0tAC4uAC4Abr3ALy8AL6+AL4BwLAFwAnK///LuwXLCNTwBdQE2f//2Qbg0AXgGvv///sB/Q4g/QE=", table1);
const table3 = unpackCodepage("imABjFIBmmEBnFMBn3gBpKQAqqoAuroAwMAAwA/QHgHR0QDRC90wAd5eAd/fAN8Q8B8B8fEA8Qv9MQH+XwH//wA=", table2);
const table4 = unpackCodepage("gX4GinkGjYYGjpgGj4gGkK8GmKkGmpEGnQwgnQGfugahDAaqvga6Gwa/HwbAwQbBIQbBFdg3BtgD3EAG3APhRAbjRQbjA+xJBuwB8EsG8AP1Twb1AfhRBvpSBv0OIP0B/9IG", table3);
const table5 = unpackCodepage("gAIEgAGDUwSIrCCKCQSMCgSNDASOCwSPDwSQUgSaWQScWgSdXASeWwSfXwShDgSiXgSjCASlkASoAQSqBASvBwSyBgSzVgS0kQS4UQS5FiG6VAS8WAS9BQS+VQS/VwTAEATAPw==", table1);
const table6 = unpackCodepage("gBAEgC+wkSWwArMCJbQkJbVhJbUBt1YluFUluWMlulElu1clvF0lvVwlvlslvxAlwBQlwTQlwiwlwxwlxAAlxTwlxl4lxgHIWiXJVCXKaSXLZiXMYCXNUCXObCXPZyXPAdFkJdEB01kl1Fgl1VIl1QHXayXYaiXZGCXaDCXbiCXchCXdjCXekCXfgCXgQATgD/ABBPFRBPIEBPNUBPQHBPVXBPYOBPdeBPiwAPkZIvq3APsaIvwWIf2kAP6gJf+gAA==");
const table7 = unpackCodepage("gJEDgBCRowORBpixA5gQqcMDqsIDq8QDqwTgyQPhrAPhAuTKA+WvA+bMA+YB6MsD6c4D6oYD64gD6wLujAPvjgPvAfGxAPJlIvNkIvSqA/QB9vcA90gi/H8g/bIA", table6);
const table8 = unpackCodepage("gBAEgB+gICChsACikASkpwClIiCmtgCnBgSorgCqIiGrAgSsUgStYCKuAwSvUwSwHiKyZCKyAbRWBLaRBLcIBLgEBLlUBLoHBLtXBLwJBL1ZBL4KBL9aBMBYBMEFBMKsAMMaIsSSAcVIIsYGIserAMi7AMkmIMqgAMsLBMxbBM0MBM5cBM9VBNATINAB0hwg0gHUGCDUAdb3ANceINgOBNleBNoPBNtfBNwWId0BBN5RBN9PBOAwBOAe/6wg");
const table9 = unpackCodepage("g///iP//jFoBjWQBjn0Bj3kBmP//nFsBnWUBnn4Bn3oBoccCotgCo0EBpQQBql4Br3sBstsCs0IBuQUBul8BvD0Bvd0Cvj4Bv3wBwFQBwwIBxTkBxgYByAwByhgBzBoBzw4B0BAB0UMB0kcB1VAB2FgB2W4B23AB3d0A3mIB4FUB4wMB5ToB5gcB6A0B6hkB7BsB7w8B8BEB8UQB8kgB9VEB+FkB+W8B+3EB/f0A/mMB/9kC", table3);
const table10 = unpackCodepage("gMcAgfwAgukAg+IAhOQAheAAhuUAh+cAiOoAiAGK6ACL7wCM7gCN7ACOxACOAZDJAJHmAJLGAJP0AJT2AJXyAJb7AJf5AJj/AJnWAJrcAJuiAJsBnaUAnqcgn5IBoOEAoe0AovMAo/oApPEApdEApqoAp7oAqL8AqRAjqqwAq70ArLwAraEArqsAr7sA4LED4d8A4pMD48AD5KMD5cMD5rUA58QD6KYD6ZgD6qkD67QD7B4i7cYD7rUD7yki8GEi9CAj9AE=", table7);
const table11 = unpackCodepage("m/gAndgAr6QA", table10);
const table12 = unpackCodepage("i9AAjPAAjd4Alf4Al90AmP0ApMEApc0AptMAp9oAr7sA", table11);
const table13 = unpackCodepage("hOMAhsEAicoAi80AjNQAjsMAj8IAkcAAksgAlPUAltoAmMwAmdUAndkAn9MAqdIA", table10);
const table14 = unpackCodepage("hMIAhrYAjRcgjsAAj6cAkcgAksoAlMsAlc8AmKQAmdQAndkAntsAoKYAobQApKgApbgAprMAp68AqM4Arb4A", table10);
const table15 = unpackCodepage("ntcAqa4Ar7sAtcEAtQG3wAC4qQC9ogC+pQDG4wDHwwDPpADQ8ADR0ADSygDSAdTIANUxAdbNANYC3aYA3swA4NMA4tQA49IA5PUA5dUA5/4A6N4A6doA6QHr2QDs/QDt3QDurwDvtADwrQDyFyDzvgD0tgD1pwD3uAD5qAD7uQD8swA=", table11);
const table16 = unpackCodepage("jTEBmDABnl4BngGmHgGmAdC6ANGqANX//+f//+jXAOzsAO3/APL//w==", table15);
const table17 = unpackCodepage("hW8BhgcBiEIBilABigGNeQGPBgGROQGRAZU9AZUBl1oBlwGbZAGbAZ1BAZ8NAaQEAaQBpn0BpgGoGAGoAat6AawMAa1fAbcaAbheAb17Ab0BxgIBxgHQEQHREAHSDgHUDwHVRwHYGwHdYgHebgHjQwHjAeVIAeZgAeYB6FQB6lUB63AB7mMB8d0C8tsC88cC9NgC+tkC+3EB/FgB/AE=", table15);
const table18 = unpackCodepage("gMQAgQABgQGDyQCEBAGF1gCG3ACH4QCIBQGJDAGK5ACLDQGMBgGMAY7pAI95AY8BkQ4Bku0Akw8BlBIBlAGWFgGX8wCYFwGZ9ACa9gCb9QCc+gCdGgGdAZ/8AKIYAaffAKsZAayoAK4jAa8uAa8BsSoBtCsBtTYBtgIitxEiuEIBuTsBuQO9OQG9Ab9FAb8BwUMBxEQBxUcBy0gBzFABzdUAzlEBz0wB18ol2E0B2VQB2QHbWAHcOSDcAd5ZAd9WAd8B4WAB4hog4x4g5GEB5VoB5QHnwQDoZAHoAerNAOt9AesB7WoB7tMA7gHwawHxbgHy2gDzbwHzBPjdAPn9APo3Aft7AfxBAf18Af4iAf/HAg==", table8);
const table19 = unpackCodepage("gcUAgscAhNEAiOAAieIAi+MAjOUAjecAj+gAkOoAkAGT7ACU7gCUAZbxAJjyAJ35AJ77AKKiAKu0AK7GAK/YALAeIrGxALSlALW1ALgPIrnAA7orIruqALy6AL2pA77mAL/4AMC/AMGhAMSSAcVIIsvAAMzDAM5SAc4B2P8A2XgB2kQg26wg3gH73gHgISDhtwDkMCDlwgDmygDoywDpyADrzgDrAe3MAPD/+PHSAPPbAPTZAPUxAfbGAvfcAvivAPnYAvkC/LgA/d0C/tsC", table18);
const table20 = unpackCodepage("gbkAgrIAhLMAh4UDi4QDjKgAkqMAkyIhliIgl70AmDAgm6YAnKwgoZMDoQGjmAOkmwOlngOmoAOqowOrqgOspwCusACvtwCwkQO1kgO2lQO2ArmZA7kBu5wDvKYDvasDvqgDvgHArAPBnQPDnwPEoQPGpAPLpQPMpwPNhgPOiAPRFSDXiQPXAdmMA9qOA9utA9sC3swD348D4M0D4bED4QHjyAPktAPkAebGA+ezA+i3A+m5A+q+A+u6A+sD778D7wHxzgPywQPzwwPzAfW4A/bJA/fCA/jHA/nFA/q2A/vKA/sB/ZAD/rAD/60A", table19);

export const dbfCodepages: Readonly<Record<string, readonly number[]>> = Object.freeze({
  "cp1250": table9,
  "cp1251": table5,
  "cp1253": table1,
  "cp1254": table3,
  "cp1255": table2,
  "cp1256": table4,
  "cp437": table10,
  "cp737": table7,
  "cp850": table15,
  "cp852": table17,
  "cp857": table16,
  "cp860": table13,
  "cp861": table12,
  "cp863": table14,
  "cp865": table11,
  "cp866": table6,
  "cp874": table0,
  "mac_cyrillic": table8,
  "mac_greek": table20,
  "mac_latin2": table18,
  "mac_roman": table19
});

const cp1252High = [
  0x20ac, -1, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, -1, 0x017d, -1,
  -1, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, -1, 0x017e, 0x0178
];


export class PythonTextDecodeError extends Error {}

/** Existing strict single-byte decode loop; the caller bounds the input chunk. */
export function decodePythonSingleByte(bytes: Uint8Array, codepoints: readonly number[], encoding: string): string {
  let text = "";
  for (const byte of bytes) {
    const code = codepoints[byte]!;
    if (code < 0) throw new PythonTextDecodeError(`Invalid ${encoding} input`);
    text += String.fromCodePoint(code);
  }
  return text;
}

export const pythonSingleByteCodepages: Readonly<Record<string, readonly number[]>> = Object.freeze({
  ...Object.fromEntries(Object.entries(dbfCodepages).map(([name, codepoints]) => [pythonCodecAliases[normalizeEncoding(name)]!, codepoints])),
  ascii: Object.freeze(Array.from({ length: 256 }, (_, byte) => byte < 128 ? byte : -1)),
  "iso8859-1": Object.freeze(Array.from({ length: 256 }, (_, byte) => byte)),
  cp1252: Object.freeze(Array.from({ length: 256 }, (_, byte) => byte >= 128 && byte < 160 ? cp1252High[byte - 128]! : byte))
});
