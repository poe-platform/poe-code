/*!
 * UNICODE LICENSE V3
 *
 * COPYRIGHT AND PERMISSION NOTICE
 *
 * Copyright © 1991-2026 Unicode, Inc.
 *
 * NOTICE TO USER: Carefully read the following legal agreement. BY
 * DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
 * SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
 * TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
 * DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of data files and any associated documentation (the "Data Files") or
 * software and any associated documentation (the "Software") to deal in the
 * Data Files or Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, and/or sell
 * copies of the Data Files or Software, and to permit persons to whom the
 * Data Files or Software are furnished to do so, provided that either (a)
 * this copyright and permission notice appear with all copies of the Data
 * Files or Software, or (b) this copyright and permission notice appear in
 * associated Documentation.
 *
 * THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
 * THIRD PARTY RIGHTS.
 *
 * IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
 * BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
 * OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
 * WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 * ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
 * FILES OR SOFTWARE.
 *
 * Except as contained in this notice, the name of a copyright holder shall
 * not be used in advertising or otherwise to promote the sale, use or other
 * dealings in these Data Files or Software without prior written
 * authorization of the copyright holder.
 */

/** Compact Unicode 15 overrides for the frozen Unicode 16 Python tables.
 * Extracted from CPython 3.12.13 and 3.14.7 over all 1,114,112 code points.
 * The Python 3.12 public-property extraction also matches its C API exactly.
 * Delta JSON SHA-256: cfaa04eb0329bf3d770e72b396a267e47d1a5e434b1da6d534584c7fe12e6d27.
 */
export type PythonUnicodeVersion = "15.0.0" | "15.1.0" | "16.0.0";
export interface PythonUnicodeProfile {
  readonly titleIdentity: readonly (readonly [number, number])[];
  readonly lowerIdentity: readonly (readonly [number, number])[];
  readonly uncased: readonly (readonly [number, number])[];
  readonly ignorable: readonly (readonly [number, number])[];
  readonly notIgnorable: readonly (readonly [number, number])[];
  readonly nonPrintable: readonly (readonly [number, number])[];
}
const unicode15: PythonUnicodeProfile = {
  titleIdentity: [[411, 411], [612, 612], [7306, 7306], [42957, 42957], [42971, 42971], [68976, 68997]],
  lowerIdentity: [[7305, 7305], [42955, 42956], [42970, 42970], [42972, 42972], [68944, 68965]],
  uncased: [[7305, 7306], [42955, 42957], [42970, 42972], [68944, 68965], [68976, 68997]],
  ignorable: [[71454, 71454]],
  notIgnorable: [[2199, 2199], [68942, 68942], [68969, 68973], [68975, 68975], [69372, 69372], [70587, 70592], [70606, 70606], [70608, 70608], [70610, 70610], [70625, 70626], [73562, 73562], [90398, 90409], [90413, 90415], [93504, 93506], [93547, 93548], [124398, 124399]],
  nonPrintable: [[2199, 2199], [6990, 6991], [7039, 7039], [7305, 7306], [9255, 9257], [12284, 12287], [12772, 12773], [12783, 12783], [42955, 42957], [42970, 42972], [67008, 67059], [68928, 68965], [68969, 68997], [69006, 69007], [69314, 69316], [69372, 69372], [70528, 70537], [70539, 70539], [70542, 70542], [70544, 70581], [70583, 70592], [70594, 70594], [70597, 70597], [70599, 70602], [70604, 70613], [70615, 70616], [70625, 70626], [71376, 71395], [72640, 72673], [72688, 72697], [73562, 73562], [78944, 82938], [90368, 90425], [93504, 93561], [101631, 101631], [117760, 118009], [118016, 118451], [124368, 124410], [124415, 124415], [129202, 129211], [129216, 129217], [129673, 129673], [129679, 129679], [129726, 129726], [129734, 129734], [129756, 129756], [129759, 129759], [129769, 129769], [129995, 130031], [191472, 192093]],
};
export const pythonUnicodeProfiles: Readonly<Record<PythonUnicodeVersion, PythonUnicodeProfile>> = {
  "15.0.0": unicode15,
  "15.1.0": {
    ...unicode15,
    // CPython 3.13 adds 627 printable characters; all other properties match 3.12.
    // Exhaustive extraction and provenance: docs/ssconvert/python-unicode151-profile.json.
    nonPrintable: unicode15.nonPrintable.filter(([start, end]) => !(
      (start === 0x2ffc && end === 0x2fff) ||
      (start === 0x31ef && end === 0x31ef) ||
      (start === 0x2ebf0 && end === 0x2ee5d)
    ))
  },
  "16.0.0": { titleIdentity: [], lowerIdentity: [], uncased: [], ignorable: [], notIgnorable: [], nonPrintable: [] }
};

export function inUnicodeRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  let lo = 0, hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1, range = ranges[mid]!;
    if (code < range[0]) hi = mid;
    else if (code > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}
