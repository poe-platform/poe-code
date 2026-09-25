import {
  cosArray,
  cosBool,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  decodePdfString,
  dictGet,
  dictSet,
  type PdfCosDict,
  type PdfCosNode,
} from "../ast.js";
import { tokenizeCos, type CosToken } from "../cos/lexer.js";
import type { ParsedCosDocument } from "../cos/parser.js";

export interface PdfFormFieldInfo {
  readonly name: string;
  readonly type: "text" | "checkbox" | "choice" | "unknown";
  readonly value: string | boolean;
  readonly options?: readonly string[] | undefined;
  readonly selectedValues?: readonly string[] | undefined;
  readonly flags?: number | undefined;
  readonly stateValue?: string | undefined;
  readonly altName?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly justification?: "Left" | "Centered" | "Right" | undefined;
  readonly maxLength?: number | undefined;
}

interface CollectedFieldEntry {
  readonly fullName: string;
  readonly dict: PdfCosDict;
  readonly inheritedFt: string;
  readonly inheritedFf: number;
  readonly inheritedQ: number;
  readonly inheritedMaxLen?: number | undefined;
}


function resolveInheritedFieldEntry(
  doc: ParsedCosDocument,
  dict: PdfCosDict,
  key: string
): PdfCosNode | undefined {
  let cur: PdfCosDict | undefined = dict;
  const visited = new Set<PdfCosDict>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const val = dictGet(cur, key);
    if (val !== undefined) return val;
    cur = doc.resolveDict(dictGet(cur, "Parent"));
  }
  return undefined;
}

function collectFieldDicts(
  doc: ParsedCosDocument,
  node: PdfCosNode | undefined,
  prefix = "",
  out: CollectedFieldEntry[] = [],
  parentFt = "",
  parentFf = 0,
  parentQ = 0,
  parentMaxLen?: number
): CollectedFieldEntry[] {
  const dict = doc.resolveDict(node);
  if (!dict) return out;
  const tNode = doc.resolve(dictGet(dict, "T"));
  const partialName =
    tNode?.kind === "string"
      ? decodePdfString(tNode)
      : tNode?.kind === "name"
        ? tNode.decoded
        : "";
  const fullName = prefix && partialName ? `${prefix}.${partialName}` : partialName || prefix;

  const ownFtNode = doc.resolve(dictGet(dict, "FT"));
  const currentFt = ownFtNode?.kind === "name" ? ownFtNode.decoded : parentFt;
  const ownFfNode = doc.resolve(dictGet(dict, "Ff"));
  const currentFf = ownFfNode?.kind === "number" ? ownFfNode.value : parentFf;
  const ownQNode = doc.resolve(dictGet(dict, "Q"));
  const currentQ = ownQNode?.kind === "number" ? ownQNode.value : parentQ;
  const ownMaxLenNode = doc.resolve(dictGet(dict, "MaxLen"));
  const currentMaxLen = ownMaxLenNode?.kind === "number" ? ownMaxLenNode.value : parentMaxLen;

  const kidsArr = doc.resolveArray(dictGet(dict, "Kids"));
  if (kidsArr && kidsArr.items.length > 0) {
    const hasFT = Boolean(currentFt);
    const kidsHaveNames = kidsArr.items.some(kid => {
      const kidDict = doc.resolveDict(kid);
      return Boolean(kidDict && dictGet(kidDict, "T"));
    });
    if (!kidsHaveNames && hasFT && fullName) {
      out.push({
        fullName,
        dict,
        inheritedFt: currentFt,
        inheritedFf: currentFf,
        inheritedQ: currentQ,
        inheritedMaxLen: currentMaxLen,
      });
      return out;
    }
    for (const kid of kidsArr.items) {
      collectFieldDicts(doc, kid, fullName, out, currentFt, currentFf, currentQ, currentMaxLen);
    }
  } else if (fullName) {
    out.push({
      fullName,
      dict,
      inheritedFt: currentFt,
      inheritedFf: currentFf,
      inheritedQ: currentQ,
      inheritedMaxLen: currentMaxLen,
    });
  }
  return out;
}

function resolveCheckboxOnValue(doc: ParsedCosDocument, fieldDict: PdfCosDict): string {
  const inspectApDict = (d: PdfCosDict): string | undefined => {
    const ap = doc.resolveDict(dictGet(d, "AP"));
    const nDict = ap ? doc.resolveDict(dictGet(ap, "N")) : undefined;
    if (!nDict) return undefined;
    for (const entry of nDict.entries) {
      if (entry.key.decoded !== "Off") {
        return entry.key.decoded;
      }
    }
    return undefined;
  };
  const direct = inspectApDict(fieldDict);
  if (direct) return direct;
  const kidsArr = doc.resolveArray(dictGet(fieldDict, "Kids"));
  if (kidsArr) {
    for (const kid of kidsArr.items) {
      const kidDict = doc.resolveDict(kid);
      if (kidDict) {
        const found = inspectApDict(kidDict);
        if (found) return found;
      }
    }
  }
  return "Yes";
}

function collectFieldOptions(doc: ParsedCosDocument, fieldDict: PdfCosDict, ft: string): string[] {
  const options: string[] = [];
  const addUnique = (val: string) => {
    if (val && !options.includes(val)) options.push(val);
  };

  if (ft === "Btn") {
    addUnique("Off");
    const inspectAp = (d: PdfCosDict) => {
      const ap = doc.resolveDict(dictGet(d, "AP"));
      const nDict = ap ? doc.resolveDict(dictGet(ap, "N")) : undefined;
      if (!nDict) return;
      for (const entry of nDict.entries) {
        addUnique(entry.key.decoded);
      }
    };
    inspectAp(fieldDict);
    const kidsArr = doc.resolveArray(dictGet(fieldDict, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        const kd = doc.resolveDict(kid);
        if (kd) inspectAp(kd);
      }
    }
    if (options.length === 1) {
      addUnique("Yes");
    }
  }

  const optArr = doc.resolveArray(resolveInheritedFieldEntry(doc, fieldDict, "Opt"));
  if (optArr) {
    for (const item of optArr.items) {
      const r = doc.resolve(item);
      if (r?.kind === "string") {
        addUnique(decodePdfString(r));
      } else if (r?.kind === "name") {
        addUnique(r.decoded);
      } else if (r?.kind === "array" && r.items.length > 0) {
        const last = doc.resolve(r.items[r.items.length - 1]);
        if (last?.kind === "string") addUnique(decodePdfString(last));
        else if (last?.kind === "name") addUnique(last.decoded);
      }
    }
  }

  return options;
}

export function getDocumentFormFields(doc: ParsedCosDocument): PdfFormFieldInfo[] {
  const catalog = doc.resolveDict(doc.rootRef);
  if (!catalog) return [];
  const acroForm = doc.resolveDict(dictGet(catalog, "AcroForm"));
  if (!acroForm) return [];
  const fieldsArr = doc.resolveArray(dictGet(acroForm, "Fields"));
  if (!fieldsArr) return [];

  const all: CollectedFieldEntry[] = [];
  for (const item of fieldsArr.items) {
    collectFieldDicts(doc, item, "", all);
  }

  return all.map(({ fullName, dict, inheritedFt, inheritedFf, inheritedQ, inheritedMaxLen }) => {
    const ft = inheritedFt;
    const flags = inheritedFf;
    const options = collectFieldOptions(doc, dict, ft);
    const vNode = doc.resolve(resolveInheritedFieldEntry(doc, dict, "V"));
    const dvNode = doc.resolve(resolveInheritedFieldEntry(doc, dict, "DV"));
    const defaultValue =
      dvNode?.kind === "string"
        ? decodePdfString(dvNode)
        : dvNode?.kind === "name"
          ? dvNode.decoded
          : undefined;
    const tuNode = doc.resolve(resolveInheritedFieldEntry(doc, dict, "TU"));
    const altName =
      tuNode?.kind === "string"
        ? decodePdfString(tuNode)
        : tuNode?.kind === "name"
          ? tuNode.decoded
          : undefined;
    const justification: "Left" | "Centered" | "Right" =
      inheritedQ === 1 ? "Centered" : inheritedQ === 2 ? "Right" : "Left";

    if (ft === "Btn") {
      const checked = vNode?.kind === "name" ? vNode.decoded !== "Off" : vNode?.kind === "boolean" ? vNode.value : false;
      const onState = options.find(o => o !== "Off") ?? "Yes";
      const stateValue =
        vNode?.kind === "name"
          ? vNode.decoded
          : checked
            ? onState
            : "Off";
      const info: PdfFormFieldInfo = { name: fullName, type: "checkbox", value: checked };
      Object.defineProperties(info, {
        options: { value: options, enumerable: false, configurable: true },
        flags: { value: flags, enumerable: false, configurable: true },
        stateValue: { value: stateValue, enumerable: false, configurable: true },
        altName: { value: altName, enumerable: false, configurable: true },
        defaultValue: { value: defaultValue, enumerable: false, configurable: true },
        justification: { value: justification, enumerable: false, configurable: true },
        maxLength: { value: inheritedMaxLen, enumerable: false, configurable: true },
      });
      return info;
    }
    let selectedValues: string[] | undefined;
    if (vNode?.kind === "array") {
      selectedValues = [];
      for (const it of vNode.items) {
        const r = doc.resolve(it);
        if (r?.kind === "string") selectedValues.push(decodePdfString(r));
        else if (r?.kind === "name") selectedValues.push(r.decoded);
      }
    }
    const strVal =
      vNode?.kind === "string"
        ? decodePdfString(vNode)
        : vNode?.kind === "name"
          ? vNode.decoded
          : selectedValues
            ? selectedValues.join(", ")
            : "";
    const info: PdfFormFieldInfo = {
      name: fullName,
      type: ft === "Tx" ? "text" : ft === "Ch" ? "choice" : "unknown",
      value: strVal,
    };
    Object.defineProperties(info, {
      options: { value: options, enumerable: false, configurable: true },
      selectedValues: { value: selectedValues, enumerable: false, configurable: true },
      flags: { value: flags, enumerable: false, configurable: true },
      altName: { value: altName, enumerable: false, configurable: true },
      defaultValue: { value: defaultValue, enumerable: false, configurable: true },
      justification: { value: justification, enumerable: false, configurable: true },
      maxLength: { value: inheritedMaxLen, enumerable: false, configurable: true },
    });
    return info;
  });
}

const ACROFORM_FONT_ALIAS_MAP: Record<string, string> = {
  Helv: "Helvetica",
  HeBo: "Helvetica-Bold",
  HeOb: "Helvetica-Oblique",
  HeBI: "Helvetica-BoldOblique",
  Cour: "Courier",
  CoBo: "Courier-Bold",
  CoOb: "Courier-Oblique",
  CoBI: "Courier-BoldOblique",
  TiRo: "Times-Roman",
  TiBo: "Times-Bold",
  TiIt: "Times-Italic",
  TiBI: "Times-BoldItalic",
  Symb: "Symbol",
  ZaDb: "ZapfDingbats",
};

function parseDefaultAppearanceString(
  daStr: string,
  boxHeight: number
): { baseFont: string; fontSize: number; colorOp?: string | undefined } {
  let baseFont = "Helvetica";
  let fontSize = 11;
  let colorOp: string | undefined;
  const tokens = tokenizeCos(new TextEncoder().encode(daStr));
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "keyword") {
      if (tok.value === "Tf" && i >= 2) {
        const nameTok = tokens[i - 2]!;
        const sizeTok = tokens[i - 1]!;
        if (nameTok.kind === "name") {
          baseFont = ACROFORM_FONT_ALIAS_MAP[nameTok.decoded] ?? nameTok.decoded;
        }
        if (sizeTok.kind === "number") {
          fontSize =
            sizeTok.value > 0
              ? sizeTok.value
              : Math.max(6, Math.min(18, Math.floor(boxHeight * 0.65)));
        }
      } else if ((tok.value === "g" || tok.value === "G") && i >= 1) {
        const c0 = tokens[i - 1]!;
        if (c0.kind === "number") {
          colorOp = `${c0.value} ${tok.value}`;
        }
      } else if ((tok.value === "rg" || tok.value === "RG") && i >= 3) {
        const c0 = tokens[i - 3]!;
        const c1 = tokens[i - 2]!;
        const c2 = tokens[i - 1]!;
        if (c0.kind === "number" && c1.kind === "number" && c2.kind === "number") {
          colorOp = `${c0.value} ${c1.value} ${c2.value} ${tok.value}`;
        }
      } else if ((tok.value === "k" || tok.value === "K") && i >= 4) {
        const c0 = tokens[i - 4]!;
        const c1 = tokens[i - 3]!;
        const c2 = tokens[i - 2]!;
        const c3 = tokens[i - 1]!;
        if (
          c0.kind === "number" &&
          c1.kind === "number" &&
          c2.kind === "number" &&
          c3.kind === "number"
        ) {
          colorOp = `${c0.value} ${c1.value} ${c2.value} ${c3.value} ${tok.value}`;
        }
      }
    }
  }
  return { baseFont, fontSize, colorOp };
}

function synthesizeTextAppearanceStream(
  doc: ParsedCosDocument,
  targetDict: PdfCosDict,
  textValue: string,
  qAlign = 0,
  maxLen?: number,
  isComb = false,
  isPassword = false
): void {
  const effectiveText = isPassword ? "*".repeat(textValue.length) : textValue;
  const rectArr = doc.resolveArray(dictGet(targetDict, "Rect"));
  let width = 120;
  let height = 20;
  if (rectArr && rectArr.items.length >= 4) {
    const r0 = doc.resolve(rectArr.items[0]);
    const r1 = doc.resolve(rectArr.items[1]);
    const r2 = doc.resolve(rectArr.items[2]);
    const r3 = doc.resolve(rectArr.items[3]);
    if (r0?.kind === "number" && r1?.kind === "number" && r2?.kind === "number" && r3?.kind === "number") {
      width = Math.max(10, Math.abs(r2.value - r0.value));
      height = Math.max(10, Math.abs(r3.value - r1.value));
    }
  }
  const parentDict = doc.resolveDict(dictGet(targetDict, "Parent"));
  const catalog = doc.resolveDict(doc.rootRef);
  const acroFormDict = catalog ? doc.resolveDict(dictGet(catalog, "AcroForm")) : undefined;
  const daNode = doc.resolve(
    dictGet(targetDict, "DA") ??
      (parentDict ? dictGet(parentDict, "DA") : undefined) ??
      (acroFormDict ? dictGet(acroFormDict, "DA") : undefined)
  );
  const da =
    daNode?.kind === "string"
      ? parseDefaultAppearanceString(decodePdfString(daNode), height)
      : { baseFont: "Helvetica", fontSize: 11, colorOp: undefined };
  const helvRef = doc.allocateObject(
    cosDict({
      Type: cosName("Font"),
      Subtype: cosName("Type1"),
      BaseFont: cosName(da.baseFont),
    })
  );
  const lines = effectiveText.replaceAll("\r\n", "\n").split("\n");
  const startY = lines.length > 1 ? Math.max(4, height - 13) : 4;
  let tjOps: string;
  if (isComb && maxLen && maxLen > 0 && lines.length === 1) {
    const cellW = width / maxLen;
    const chars = Array.from(lines[0] ?? "").slice(0, maxLen);
    const combOps: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const xPos = Number((i * cellW + Math.max(1, (cellW - 6) / 2)).toFixed(2));
      combOps.push(`1 0 0 1 ${xPos} ${Math.round(startY)} Tm (${escapePdfLiteralString(ch)}) Tj`);
    }
    tjOps = combOps.join(" ");
  } else {
    let prevX = 0;
    tjOps = lines
      .map((line, idx) => {
        const approxW = line.length * 6;
        const targetX =
          qAlign === 1
            ? Math.max(2, Math.round((width - approxW) / 2))
            : qAlign === 2
              ? Math.max(2, Math.round(width - approxW - 2))
              : 2;
        const dx = idx === 0 ? targetX : targetX - prevX;
        const dy = idx === 0 ? Math.round(startY) : -13;
        prevX = targetX;
        return `${dx} ${dy} Td (${escapePdfLiteralString(line)}) Tj`;
      })
      .join(" ");
  }
  const colorPrefix = da.colorOp ? `${da.colorOp} ` : "";
  const contentStr = `/Tx BMC q BT ${colorPrefix}/F1 ${da.fontSize} Tf ${tjOps} ET Q EMC\n`;
  const formStream = cosStream(new TextEncoder().encode(contentStr), {
    dict: cosDict({
      Type: cosName("XObject"),
      Subtype: cosName("Form"),
      FormType: cosNumber(1),
      BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(width), cosNumber(height)]),
      Resources: cosDict({
        Font: cosDict({ F1: helvRef }),
      }),
    }),
    compress: false,
  });
  const apStreamRef = doc.allocateObject(formStream);
  dictSet(targetDict, "AP", cosDict({ N: apStreamRef }));
}

export function setDocumentFormField(
  doc: ParsedCosDocument,
  fieldName: string,
  value: string | boolean
): void {
  const catalog = doc.resolveDict(doc.rootRef);
  if (!catalog) return;
  let acroForm = doc.resolveDict(dictGet(catalog, "AcroForm"));
  if (!acroForm) {
    acroForm = cosDict({ Fields: cosArray([]), NeedAppearances: cosBool(true) });
    const acroRef = doc.allocateObject(acroForm);
    dictSet(catalog, "AcroForm", acroRef);
  }
  dictSet(acroForm, "NeedAppearances", cosBool(true));

  let fieldsArr = doc.resolveArray(dictGet(acroForm, "Fields"));
  if (!fieldsArr) {
    fieldsArr = cosArray([]);
    dictSet(acroForm, "Fields", fieldsArr);
  }

  const all: CollectedFieldEntry[] = [];
  for (const item of fieldsArr.items) {
    collectFieldDicts(doc, item, "", all);
  }

  const matching = all.filter(f => f.fullName === fieldName);
  if (matching.length > 0) {
    for (const existing of matching) {
    const ftNode = doc.resolve(dictGet(existing.dict, "FT"));
    const existingFt = existing.inheritedFt || (ftNode?.kind === "name" ? ftNode.decoded : "");
    if (typeof value === "boolean" || existingFt === "Btn") {
      const onValue = resolveCheckboxOnValue(doc, existing.dict);
      const isChecked =
        typeof value === "boolean"
          ? value
          : value !== "Off" && value !== "false" && value !== "0" && value !== "";
      const chosenOn =
        typeof value === "string" && value !== "true" && value !== "false" && value !== "Off"
          ? value
          : onValue;
      const targetState = cosName(isChecked ? chosenOn : "Off");
      dictSet(existing.dict, "FT", cosName("Btn"));
      dictSet(existing.dict, "V", targetState);
      dictSet(existing.dict, "AS", targetState);
      const kidsArr = doc.resolveArray(dictGet(existing.dict, "Kids"));
      if (kidsArr) {
        for (const kid of kidsArr.items) {
          const kidDict = doc.resolveDict(kid);
          if (kidDict) {
            const ap = doc.resolveDict(dictGet(kidDict, "AP"));
            const nDict = ap ? doc.resolveDict(dictGet(ap, "N")) : undefined;
            if (nDict && nDict.entries.length > 0) {
              const supportsChosen = isChecked && dictGet(nDict, chosenOn) !== undefined;
              dictSet(kidDict, "AS", cosName(supportsChosen ? chosenOn : "Off"));
            } else {
              dictSet(kidDict, "AS", targetState);
            }
          }
        }
      }
    } else {
      if (!existingFt) dictSet(existing.dict, "FT", cosName("Tx"));
      const strVal = String(value);
      let displayVal = strVal;
      const isMultiSelectChoice = existingFt === "Ch" && (existing.inheritedFf & (1 << 21)) !== 0 && strVal.includes(",");
      if (isMultiSelectChoice) {
        const selParts = strVal.split(",").map(s => s.trim()).filter(Boolean);
        dictSet(existing.dict, "V", cosArray(selParts.map(p => cosString(p))));
        const optArr = doc.resolveArray(dictGet(existing.dict, "Opt"));
        if (optArr) {
          const matchedIndices: number[] = [];
          for (let idx = 0; idx < optArr.items.length; idx++) {
            const item = doc.resolve(optArr.items[idx]);
            if (item?.kind === "string" && selParts.includes(decodePdfString(item))) {
              matchedIndices.push(idx);
            } else if (item?.kind === "array" && item.items.length >= 2) {
              const expNode = doc.resolve(item.items[0]);
              const dispNode = doc.resolve(item.items[1]);
              const expStr = expNode?.kind === "string" ? decodePdfString(expNode) : "";
              const dispStr = dispNode?.kind === "string" ? decodePdfString(dispNode) : "";
              if (selParts.includes(expStr) || selParts.includes(dispStr)) {
                matchedIndices.push(idx);
              }
            }
          }
          if (matchedIndices.length > 0) {
            dictSet(existing.dict, "I", cosArray(matchedIndices.map(i => cosNumber(i))));
          }
        }
      } else {
        dictSet(existing.dict, "V", cosString(strVal));
        if (existingFt === "Ch") {
          const optArr = doc.resolveArray(dictGet(existing.dict, "Opt"));
          if (optArr) {
            let matchedIdx = -1;
            for (let idx = 0; idx < optArr.items.length; idx++) {
              const item = doc.resolve(optArr.items[idx]);
              if (item?.kind === "string" && decodePdfString(item) === strVal) {
                matchedIdx = idx;
                break;
              }
              if (item?.kind === "array" && item.items.length >= 2) {
                const expNode = doc.resolve(item.items[0]);
                const dispNode = doc.resolve(item.items[1]);
                const expStr = expNode?.kind === "string" ? decodePdfString(expNode) : "";
                const dispStr = dispNode?.kind === "string" ? decodePdfString(dispNode) : "";
                if (expStr === strVal || dispStr === strVal) {
                  matchedIdx = idx;
                  if (dispStr) displayVal = dispStr;
                  break;
                }
              }
            }
            if (matchedIdx >= 0) {
              dictSet(existing.dict, "I", cosArray([cosNumber(matchedIdx)]));
            }
          }
        }
      }
      const isComb = (existing.inheritedFf & (1 << 24)) !== 0;
      const isPassword = (existing.inheritedFf & (1 << 13)) !== 0;
      synthesizeTextAppearanceStream(
        doc,
        existing.dict,
        displayVal,
        existing.inheritedQ,
        existing.inheritedMaxLen,
        isComb,
        isPassword
      );
      const kidsArr = doc.resolveArray(dictGet(existing.dict, "Kids"));
      if (kidsArr) {
        for (const kid of kidsArr.items) {
          const kidDict = doc.resolveDict(kid);
          if (kidDict && !dictGet(kidDict, "T")) {
            synthesizeTextAppearanceStream(
              doc,
              kidDict,
              displayVal,
              existing.inheritedQ,
              existing.inheritedMaxLen,
              isComb,
              isPassword
            );
          }
        }
      }
    }
    }
    return;
  }

  const newFieldDict =
    typeof value === "boolean"
      ? cosDict({
          FT: cosName("Btn"),
          T: cosString(fieldName),
          V: cosName(value ? "Yes" : "Off"),
          AS: cosName(value ? "Yes" : "Off"),
        })
      : cosDict({
          FT: cosName("Tx"),
          T: cosString(fieldName),
          V: cosString(value),
        });
  const fieldRef = doc.allocateObject(newFieldDict);
  fieldsArr.items.push(fieldRef);
}

export function generateDocumentFormAppearances(doc: ParsedCosDocument): void {
  const catalog = doc.resolveDict(doc.rootRef);
  if (!catalog) return;
  const acroForm = doc.resolveDict(dictGet(catalog, "AcroForm"));
  if (!acroForm) return;
  const needAppearancesNode = doc.resolve(dictGet(acroForm, "NeedAppearances"));
  const forceAll = needAppearancesNode?.kind === "boolean" && needAppearancesNode.value;
  const fieldsArr = doc.resolveArray(dictGet(acroForm, "Fields"));
  if (fieldsArr) {
    const all: CollectedFieldEntry[] = [];
    for (const item of fieldsArr.items) {
      collectFieldDicts(doc, item, "", all);
    }
    for (const entry of all) {
      const ftNode = doc.resolve(dictGet(entry.dict, "FT"));
      const ft = entry.inheritedFt || (ftNode?.kind === "name" ? ftNode.decoded : "");
      const vNode = doc.resolve(dictGet(entry.dict, "V"));
      if (!vNode) continue;
      const existingAp = doc.resolveDict(dictGet(entry.dict, "AP"));
      const hasApN = existingAp ? dictGet(existingAp, "N") !== undefined : false;
      if (!forceAll && hasApN) continue;

      if (ft === "Btn") {
        const stateStr =
          vNode.kind === "name"
            ? vNode.decoded
            : vNode.kind === "string"
              ? decodePdfString(vNode)
              : "Off";
        dictSet(entry.dict, "AS", cosName(stateStr));
        if (!hasApN) {
          const onVal = resolveCheckboxOnValue(doc, entry.dict);
          const onStream = doc.allocateObject(
            cosStream(new TextEncoder().encode("q 0 0 0 rg 2 2 8 8 re f Q\n"), {
              dict: cosDict({
                Type: cosName("XObject"),
                Subtype: cosName("Form"),
                BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(12), cosNumber(12)]),
              }),
              compress: false,
            })
          );
          const offStream = doc.allocateObject(
            cosStream(new TextEncoder().encode("q Q\n"), {
              dict: cosDict({
                Type: cosName("XObject"),
                Subtype: cosName("Form"),
                BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(12), cosNumber(12)]),
              }),
              compress: false,
            })
          );
          dictSet(
            entry.dict,
            "AP",
            cosDict({
              N: cosDict({
                [onVal]: onStream,
                Off: offStream,
              }),
            })
          );
        }
      } else {
        let strVal =
          vNode.kind === "string"
            ? decodePdfString(vNode)
            : vNode.kind === "name"
              ? vNode.decoded
              : "";
        if (ft === "Ch") {
          const optArr = doc.resolveArray(dictGet(entry.dict, "Opt"));
          if (optArr) {
            for (const optItem of optArr.items) {
              const resolvedOpt = doc.resolve(optItem);
              if (resolvedOpt?.kind === "array" && resolvedOpt.items.length >= 2) {
                const expNode = doc.resolve(resolvedOpt.items[0]);
                const dispNode = doc.resolve(resolvedOpt.items[1]);
                const expStr = expNode?.kind === "string" ? decodePdfString(expNode) : "";
                const dispStr = dispNode?.kind === "string" ? decodePdfString(dispNode) : "";
                if (expStr === strVal && dispStr) {
                  strVal = dispStr;
                  break;
                }
              }
            }
          }
        }
        const isComb = (entry.inheritedFf & (1 << 24)) !== 0;
        const isPassword = (entry.inheritedFf & (1 << 13)) !== 0;
        synthesizeTextAppearanceStream(
          doc,
          entry.dict,
          strVal,
          entry.inheritedQ,
          entry.inheritedMaxLen,
          isComb,
          isPassword
        );
        const kidsArr = doc.resolveArray(dictGet(entry.dict, "Kids"));
        if (kidsArr) {
          for (const kid of kidsArr.items) {
            const kidDict = doc.resolveDict(kid);
            if (kidDict && !dictGet(kidDict, "T")) {
              synthesizeTextAppearanceStream(
                doc,
                kidDict,
                strVal,
                entry.inheritedQ,
                entry.inheritedMaxLen,
                isComb,
                isPassword
              );
            }
          }
        }
      }
    }
  }
  dictSet(acroForm, "NeedAppearances", cosBool(false));
}

function decodeXmlEntities(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "&") {
      const semi = text.indexOf(";", i + 1);
      if (semi !== -1) {
        const entity = text.slice(i + 1, semi);
        if (entity === "amp") {
          out += "&";
          i = semi + 1;
          continue;
        }
        if (entity === "lt") {
          out += "<";
          i = semi + 1;
          continue;
        }
        if (entity === "gt") {
          out += ">";
          i = semi + 1;
          continue;
        }
        if (entity === "quot") {
          out += "\"";
          i = semi + 1;
          continue;
        }
        if (entity === "apos") {
          out += "'";
          i = semi + 1;
          continue;
        }
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const code = Number.parseInt(entity.slice(2), 16);
          if (Number.isFinite(code)) {
            out += String.fromCodePoint(code);
            i = semi + 1;
            continue;
          }
        } else if (entity.startsWith("#")) {
          const code = Number.parseInt(entity.slice(1), 10);
          if (Number.isFinite(code)) {
            out += String.fromCodePoint(code);
            i = semi + 1;
            continue;
          }
        }
      }
    }
    out += text[i]!;
    i++;
  }
  return out;
}

function extractAttributeValue(tagBody: string, attrName: string): string | undefined {
  const search = `${attrName}=`;
  const idx = tagBody.indexOf(search);
  if (idx === -1) return undefined;
  const after = idx + search.length;
  const quote = tagBody[after];
  if (quote !== "\"" && quote !== "'") return undefined;
  const end = tagBody.indexOf(quote, after + 1);
  if (end === -1) return undefined;
  return decodeXmlEntities(tagBody.slice(after + 1, end));
}

function parseXfdfString(text: string, out: Map<string, string | boolean>): void {
  const fieldStack: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf("<", pos);
    if (lt === -1) break;
    const gt = text.indexOf(">", lt + 1);
    if (gt === -1) break;
    const rawTag = text.slice(lt + 1, gt).trim();
    pos = gt + 1;

    if (rawTag.startsWith("?") || rawTag.startsWith("!")) continue;
    if (rawTag.startsWith("/")) {
      const closeName = rawTag.slice(1).trim().toLowerCase();
      if (closeName === "field" && fieldStack.length > 0) {
        fieldStack.pop();
      }
      continue;
    }
    const selfClosing = rawTag.endsWith("/");
    const tagContent = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceIdx = tagContent.indexOf(" ");
    const tagName = (spaceIdx === -1 ? tagContent : tagContent.slice(0, spaceIdx)).toLowerCase();

    if (tagName === "field") {
      const nameAttr = extractAttributeValue(tagContent, "name") ?? "";
      if (!selfClosing) {
        fieldStack.push(nameAttr);
      }
    } else if (tagName === "value" && !selfClosing && fieldStack.length > 0) {
      const closeVal = text.indexOf("</value>", pos);
      if (closeVal !== -1) {
        const rawVal = decodeXmlEntities(text.slice(pos, closeVal));
        const fullFieldName = fieldStack.filter(Boolean).join(".");
        if (fullFieldName) {
          if (rawVal === "Off") out.set(fullFieldName, false);
          else if (rawVal === "Yes" || rawVal === "On") out.set(fullFieldName, true);
          else {
            const prev = out.get(fullFieldName);
            if (typeof prev === "string" && prev.length > 0) {
              out.set(fullFieldName, `${prev},${rawVal}`);
            } else {
              out.set(fullFieldName, rawVal);
            }
          }
        }
        pos = closeVal + "</value>".length;
      }
    }
  }
}

function decodeTokenString(tok: CosToken): string {
  if (tok.kind === "string" || tok.kind === "hex-string") {
    return decodePdfString({
      kind: "string",
      bytes: tok.bytes,
      encoding: tok.kind === "hex-string" ? "hex" : "literal",
    });
  }
  if (tok.kind === "name") return tok.decoded;
  return "";
}

function parseFdfCosNodes(bytes: Uint8Array, out: Map<string, string | boolean>): void {
  const tokens = tokenizeCos(bytes);

  // Index indirect objects `N G obj << ... >> endobj` so `/Fields` and `/Kids` indirect refs (`N G R`) resolve hierarchically
  const objDictStarts = new Map<number, number>();
  const childRefObjs = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t0 = tokens[i];
    const t1 = tokens[i + 1];
    const t2 = tokens[i + 2];
    const t3 = tokens[i + 3];
    if (
      t0?.kind === "number" &&
      t1?.kind === "number" &&
      t2?.kind === "keyword" &&
      t2.value === "obj" &&
      t3?.kind === "dict-start"
    ) {
      objDictStarts.set(t0.value, i + 4);
    }
    if (t0?.kind === "name" && t0.decoded === "Kids" && t1?.kind === "array-start") {
      let k = i + 2;
      let depth = 1;
      while (k < tokens.length && depth > 0) {
        const tk = tokens[k]!;
        if (tk.kind === "array-start") depth++;
        else if (tk.kind === "array-end") depth--;
        else if (
          depth === 1 &&
          tk.kind === "number" &&
          tokens[k + 1]?.kind === "number" &&
          tokens[k + 2]?.kind === "keyword" &&
          (tokens[k + 2] as { value?: string }).value === "R"
        ) {
          childRefObjs.add(tk.value);
          k += 2;
        }
        k++;
      }
    }
  }

  const visitedObjs = new Set<number>();
  let idx = 0;

  const parseDictAt = (prefix: string) => {
    let partialName = "";
    let hasValue = false;
    let val: string | boolean = "";
    const deferredChildren: Array<{ startIdx: number; endIdx: number; refObjs: number[] }> = [];

    while (idx < tokens.length) {
      const tok = tokens[idx++]!;
      if (tok.kind === "dict-end") break;
      if (tok.kind === "dict-start") {
        const curPrefix = prefix && partialName ? `${prefix}.${partialName}` : partialName || prefix;
        parseDictAt(curPrefix);
        continue;
      }
      if (tok.kind === "name") {
        const key = tok.decoded;
        if (key === "T") {
          const valTok = tokens[idx];
          if (valTok && (valTok.kind === "string" || valTok.kind === "hex-string" || valTok.kind === "name")) {
            partialName = decodeTokenString(valTok);
            idx++;
          }
        } else if (key === "V") {
          const valTok = tokens[idx];
          if (valTok) {
            if (valTok.kind === "string" || valTok.kind === "hex-string") {
              val = decodeTokenString(valTok);
              hasValue = true;
              idx++;
            } else if (valTok.kind === "name") {
              if (valTok.decoded === "Off") val = false;
              else if (valTok.decoded === "Yes" || valTok.decoded === "On") val = true;
              else val = valTok.decoded;
              hasValue = true;
              idx++;
            } else if (valTok.kind === "boolean") {
              val = valTok.value;
              hasValue = true;
              idx++;
            } else if (valTok.kind === "number") {
              val = String(valTok.value);
              hasValue = true;
              idx++;
            } else if (valTok.kind === "array-start") {
              idx++;
              const arrVals: string[] = [];
              let depth = 1;
              while (idx < tokens.length && depth > 0) {
                const tk = tokens[idx++]!;
                if (tk.kind === "array-start") depth++;
                else if (tk.kind === "array-end") depth--;
                else if (depth === 1 && (tk.kind === "string" || tk.kind === "hex-string" || tk.kind === "name")) {
                  arrVals.push(decodeTokenString(tk));
                }
              }
              val = arrVals.join(",");
              hasValue = true;
            }
          }
        } else if (key === "Kids" || key === "Fields") {
          if (tokens[idx]?.kind === "array-start") {
            idx++;
            const arrStart = idx;
            const refObjs: number[] = [];
            let depth = 1;
            while (idx < tokens.length && depth > 0) {
              const t = tokens[idx++]!;
              if (t.kind === "array-start") depth++;
              else if (t.kind === "array-end") depth--;
              else if (
                depth === 1 &&
                t.kind === "number" &&
                tokens[idx]?.kind === "number" &&
                tokens[idx + 1]?.kind === "keyword" &&
                (tokens[idx + 1] as { value?: string }).value === "R"
              ) {
                refObjs.push(t.value);
                idx += 2;
              }
            }
            deferredChildren.push({ startIdx: arrStart, endIdx: idx - 1, refObjs });
          }
        }
      }
    }

    const fullName = prefix && partialName ? `${prefix}.${partialName}` : partialName || prefix;
    if (fullName && hasValue) {
      out.set(fullName, val);
    }

    const savedIdx = idx;
    for (const child of deferredChildren) {
      idx = child.startIdx;
      while (idx < child.endIdx) {
        const t = tokens[idx++]!;
        if (t.kind === "dict-start") {
          parseDictAt(fullName);
        }
      }
      for (const refObjNum of child.refObjs) {
        const dictStart = objDictStarts.get(refObjNum);
        if (dictStart !== undefined && !visitedObjs.has(refObjNum)) {
          visitedObjs.add(refObjNum);
          idx = dictStart;
          parseDictAt(fullName);
        }
      }
    }
    idx = savedIdx;
  };

  while (idx < tokens.length) {
    const t0 = tokens[idx];
    const t1 = tokens[idx + 1];
    const t2 = tokens[idx + 2];
    if (
      t0?.kind === "number" &&
      t1?.kind === "number" &&
      t2?.kind === "keyword" &&
      t2.value === "obj"
    ) {
      const objNum = t0.value;
      if (childRefObjs.has(objNum) || visitedObjs.has(objNum)) {
        idx += 3;
        while (idx < tokens.length) {
          const tk = tokens[idx++]!;
          if (tk.kind === "keyword" && tk.value === "endobj") break;
        }
        continue;
      }
    }
    const tok = tokens[idx++]!;
    if (tok.kind === "dict-start") {
      parseDictAt("");
    }
  }
}

export function parseFormDataBytes(bytes: Uint8Array): Map<string, string | boolean> {
  const out = new Map<string, string | boolean>();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const trimmed = text.trimStart();

  if (trimmed.startsWith("%FDF-") || (trimmed.includes("/FDF") && trimmed.includes("/Fields"))) {
    parseFdfCosNodes(bytes, out);
    return out;
  }

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<xfdf") || trimmed.includes("<fields")) {
    parseXfdfString(text, out);
    return out;
  }

  if (text.includes("FieldName:")) {
    const lines = text.split("\n");
    let curName = "";
    let curType = "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === "---") {
        curName = "";
        curType = "";
        continue;
      }
      if (line.startsWith("FieldType:")) {
        curType = line.slice("FieldType:".length).trim();
      } else if (line.startsWith("FieldName:")) {
        curName = decodeXmlEntities(line.slice("FieldName:".length).trim());
      } else if (line.startsWith("FieldValue:") && curName) {
        const val = decodeXmlEntities(line.slice("FieldValue:".length).trim());
        if (val === "Yes" || val === "On") {
          out.set(curName, true);
        } else if (val === "Off" || val === "false" || (curType === "Button" && val === "")) {
          out.set(curName, false);
        } else {
          const prev = out.get(curName);
          if (typeof prev === "string" && prev.length > 0) {
            out.set(curName, `${prev},${val}`);
          } else {
            out.set(curName, val);
          }
        }
      }
    }
    return out;
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    const colonIdx = line.indexOf(":");
    const sepIdx = eqIdx !== -1 ? eqIdx : colonIdx;
    if (sepIdx > 0) {
      const key = line.slice(0, sepIdx).trim();
      const val = line.slice(sepIdx + 1).trim();
      if (val === "true" || val === "Yes" || val === "On") out.set(key, true);
      else if (val === "false" || val === "Off") out.set(key, false);
      else out.set(key, val);
    }
  }
  return out;
}

function escapePdfLiteralString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

function collectPageDictsForFlatten(
  doc: ParsedCosDocument,
  node: PdfCosNode | undefined,
  out: PdfCosDict[] = [],
  visited = new Set<number>()
): PdfCosDict[] {
  if (!node) return out;
  if (node.kind === "ref") {
    if (visited.has(node.objectNumber)) return out;
    visited.add(node.objectNumber);
  }
  const dict = doc.resolveDict(node);
  if (!dict) return out;
  const kids = doc.resolveArray(dictGet(dict, "Kids"));
  if (kids) {
    for (const k of kids.items) collectPageDictsForFlatten(doc, k, out, visited);
  } else {
    out.push(dict);
  }
  return out;
}

export function flattenDocumentFormFields(doc: ParsedCosDocument): void {
  const catalog = doc.resolveDict(doc.rootRef);
  if (!catalog) return;
  const acroForm = doc.resolveDict(dictGet(catalog, "AcroForm"));
  const fieldsArr = acroForm ? doc.resolveArray(dictGet(acroForm, "Fields")) : undefined;

  const allFields: CollectedFieldEntry[] = [];
  if (fieldsArr) {
    for (const item of fieldsArr.items) {
      collectFieldDicts(doc, item, "", allFields);
    }
  }

  const pages = collectPageDictsForFlatten(doc, dictGet(catalog, "Pages"));
  if (pages.length === 0) return;

  const appendDrawingToPage = (pageDict: PdfCosDict, text: string, x: number, y: number) => {
    if (!text) return;
    let resDict = doc.resolveDict(dictGet(pageDict, "Resources"));
    if (!resDict) {
      resDict = cosDict({});
      dictSet(pageDict, "Resources", resDict);
    }
    let fontDict = doc.resolveDict(dictGet(resDict, "Font"));
    if (!fontDict) {
      fontDict = cosDict({});
      dictSet(resDict, "Font", fontDict);
    }
    const fontKey = dictGet(fontDict, "F1") ? "F_AcroFlat" : "F1";
    if (!dictGet(fontDict, fontKey)) {
      const helvRef = doc.allocateObject(
        cosDict({
          Type: cosName("Font"),
          Subtype: cosName("Type1"),
          BaseFont: cosName("Helvetica"),
        })
      );
      dictSet(fontDict, fontKey, helvRef);
    }

    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const tjOps = lines
      .map((line, idx) =>
        idx === 0
          ? `${Math.round(x)} ${Math.round(y)} Td (${escapePdfLiteralString(line)}) Tj`
          : `0 -13 Td (${escapePdfLiteralString(line)}) Tj`
      )
      .join(" ");
    const opStr = `\nq BT /${fontKey} 11 Tf ${tjOps} ET Q\n`;
    const opBytes = new TextEncoder().encode(opStr);
    const newStreamRef = doc.allocateObject(cosStream(opBytes, { compress: false }));

    const existingContents = dictGet(pageDict, "Contents");
    if (!existingContents) {
      dictSet(pageDict, "Contents", newStreamRef);
    } else {
      const resolved = doc.resolve(existingContents);
      if (resolved?.kind === "array") {
        resolved.items.push(newStreamRef);
      } else {
        dictSet(pageDict, "Contents", cosArray([existingContents, newStreamRef]));
      }
    }
  };

  const bakedDicts = new Set<PdfCosDict>();
  for (const pageDict of pages) {
    const annotsArr = doc.resolveArray(dictGet(pageDict, "Annots"));
    if (!annotsArr) continue;
    const remainingAnnots: PdfCosNode[] = [];
    for (const annotNode of annotsArr.items) {
      const annotDict = doc.resolveDict(annotNode);
      if (!annotDict) {
        remainingAnnots.push(annotNode);
        continue;
      }
      const subtypeNode = doc.resolve(dictGet(annotDict, "Subtype"));
      const subtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "";
      const hasFtOrT = Boolean(dictGet(annotDict, "FT") || dictGet(annotDict, "T"));
      if (subtype === "Widget" || hasFtOrT) {
        bakedDicts.add(annotDict);
        const parentDict = doc.resolveDict(dictGet(annotDict, "Parent"));
        if (parentDict) bakedDicts.add(parentDict);
        const rectArr = doc.resolveArray(dictGet(annotDict, "Rect"));
        const x1 = rectArr && rectArr.items[0] && doc.resolve(rectArr.items[0])?.kind === "number" ? (doc.resolve(rectArr.items[0]) as { value: number }).value : 50;
        const y1 = rectArr && rectArr.items[1] && doc.resolve(rectArr.items[1])?.kind === "number" ? (doc.resolve(rectArr.items[1]) as { value: number }).value : 700;
        const ownAsNode = doc.resolve(dictGet(annotDict, "AS"));
        const vNode =
          ownAsNode ??
          doc.resolve(
            dictGet(annotDict, "V") ??
              (parentDict ? dictGet(parentDict, "V") ?? dictGet(parentDict, "AS") : undefined)
          );
        const apDict = doc.resolveDict(dictGet(annotDict, "AP"));
        let apN = apDict ? doc.resolve(dictGet(apDict, "N")) : undefined;
        if (apN?.kind === "dict" && vNode?.kind === "name" && vNode.decoded !== "Off") {
          apN = doc.resolve(dictGet(apN, vNode.decoded));
        }
        let apBaked = false;
        if (apN?.kind === "stream") {
          let apBytes = doc.decodeStream(apN);
          apBaked = true;
          const apRes = doc.resolveDict(dictGet(apN.dict, "Resources"));
          const resRenames = new Map<string, string>();
          if (apRes) {
            let dstRes = doc.resolveDict(dictGet(pageDict, "Resources"));
            if (!dstRes) {
              dstRes = cosDict({});
              dictSet(pageDict, "Resources", dstRes);
            }
            for (const subKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading"]) {
              const srcSub = doc.resolveDict(dictGet(apRes, subKey));
              if (!srcSub) continue;
              let dstSub = doc.resolveDict(dictGet(dstRes, subKey));
              if (!dstSub) {
                dstSub = cosDict({});
                dictSet(dstRes, subKey, dstSub);
              }
              for (const entry of srcSub.entries) {
                const origName = entry.key.decoded;
                const existingEntry = dictGet(dstSub, origName);
                if (!existingEntry) {
                  dictSet(dstSub, origName, entry.value);
                } else if (
                  existingEntry.kind === "ref" &&
                  entry.value.kind === "ref" &&
                  existingEntry.objectNumber === entry.value.objectNumber
                ) {
                  // Same object reference already registered
                } else {
                  let suffix = 1;
                  while (dictGet(dstSub, `${origName}_ap${suffix}`)) suffix++;
                  const newName = `${origName}_ap${suffix}`;
                  dictSet(dstSub, newName, entry.value);
                  resRenames.set(origName, newName);
                }
              }
            }
          }
          if (resRenames.size > 0) {
            let text = new TextDecoder("latin1").decode(apBytes);
            for (const [oldKey, newKey] of resRenames.entries()) {
              text = text.replaceAll(`/${oldKey} `, `/${newKey} `).replaceAll(`/${oldKey}\n`, `/${newKey}\n`);
            }
            apBytes = new TextEncoder().encode(text);
          }
          const r2Node = rectArr && rectArr.items[2] ? doc.resolve(rectArr.items[2]) : undefined;
          const r3Node = rectArr && rectArr.items[3] ? doc.resolve(rectArr.items[3]) : undefined;
          const rectW = r2Node?.kind === "number" ? Math.max(1, Math.abs(r2Node.value - x1)) : 20;
          const rectH = r3Node?.kind === "number" ? Math.max(1, Math.abs(r3Node.value - y1)) : 20;
          const bboxArr = doc.resolveArray(dictGet(apN.dict, "BBox"));
          let bx0 = 0, by0 = 0, bx1 = rectW, by1 = rectH;
          if (bboxArr && bboxArr.items.length >= 4) {
            const b0 = doc.resolve(bboxArr.items[0]);
            const b1 = doc.resolve(bboxArr.items[1]);
            const b2 = doc.resolve(bboxArr.items[2]);
            const b3 = doc.resolve(bboxArr.items[3]);
            if (b0?.kind === "number" && b1?.kind === "number" && b2?.kind === "number" && b3?.kind === "number") {
              bx0 = Math.min(b0.value, b2.value);
              by0 = Math.min(b1.value, b3.value);
              bx1 = Math.max(b0.value, b2.value);
              by1 = Math.max(b1.value, b3.value);
            }
          }
          const matArr = doc.resolveArray(dictGet(apN.dict, "Matrix"));
          let ma = 1, mb = 0, mc = 0, md = 1, me = 0, mf = 0;
          let hasFormMatrix = false;
          if (matArr && matArr.items.length >= 6) {
            const mNums = matArr.items.slice(0, 6).map(it => {
              const r = doc.resolve(it);
              return r?.kind === "number" ? r.value : 0;
            });
            ma = mNums[0]!; mb = mNums[1]!; mc = mNums[2]!; md = mNums[3]!; me = mNums[4]!; mf = mNums[5]!;
            hasFormMatrix = true;
          }
          const corners = [
            [bx0 * ma + by0 * mc + me, bx0 * mb + by0 * md + mf],
            [bx1 * ma + by0 * mc + me, bx1 * mb + by0 * md + mf],
            [bx0 * ma + by1 * mc + me, bx0 * mb + by1 * md + mf],
            [bx1 * ma + by1 * mc + me, bx1 * mb + by1 * md + mf],
          ];
          const tbx0 = Math.min(...corners.map(c => c[0]!));
          const tby0 = Math.min(...corners.map(c => c[1]!));
          const tbx1 = Math.max(...corners.map(c => c[0]!));
          const tby1 = Math.max(...corners.map(c => c[1]!));
          const bw = Math.max(1, tbx1 - tbx0);
          const bh = Math.max(1, tby1 - tby0);
          const sx = Number((rectW / bw).toFixed(6));
          const sy = Number((rectH / bh).toFixed(6));
          const tx = Number((x1 - tbx0 * sx).toFixed(6));
          const ty = Number((y1 - tby0 * sy).toFixed(6));
          const matSuffix = hasFormMatrix ? ` ${ma} ${mb} ${mc} ${md} ${me} ${mf} cm` : "";
          const apPrefix = new TextEncoder().encode(`\nq ${sx} 0 0 ${sy} ${tx} ${ty} cm${matSuffix}\n`);
          const apSuffix = new TextEncoder().encode(`\nQ\n`);
          const wrappedApBytes = new Uint8Array(apPrefix.length + apBytes.length + apSuffix.length);
          wrappedApBytes.set(apPrefix, 0);
          wrappedApBytes.set(apBytes, apPrefix.length);
          wrappedApBytes.set(apSuffix, apPrefix.length + apBytes.length);
          const apStreamRef = doc.allocateObject(cosStream(wrappedApBytes, { compress: false }));
          const existingContents = dictGet(pageDict, "Contents");
          if (!existingContents) {
            dictSet(pageDict, "Contents", apStreamRef);
          } else {
            const resolved = doc.resolve(existingContents);
            if (resolved?.kind === "array") {
              resolved.items.push(apStreamRef);
            } else {
              dictSet(pageDict, "Contents", cosArray([existingContents, apStreamRef]));
            }
          }
        }

        let valStr = "";
        if (vNode?.kind === "string") valStr = decodePdfString(vNode);
        else if (vNode?.kind === "name" && vNode.decoded !== "Off") valStr = vNode.decoded;
        else if (vNode?.kind === "boolean" && vNode.value) valStr = "Yes";
        else if (vNode?.kind === "array") {
          const parts: string[] = [];
          for (const it of vNode.items) {
            const r = doc.resolve(it);
            if (r?.kind === "string") parts.push(decodePdfString(r));
            else if (r?.kind === "name") parts.push(r.decoded);
          }
          valStr = parts.join(", ");
        }
        if (valStr && !apBaked) {
          appendDrawingToPage(pageDict, valStr, x1 + 2, y1 + 4);
        }
      } else {
        remainingAnnots.push(annotNode);
      }
    }
    dictSet(pageDict, "Annots", cosArray(remainingAnnots));
  }

  // Also bake any AcroForm fields that were not attached to a page Annots array
  for (const { dict } of allFields) {
    if (bakedDicts.has(dict)) continue;
    const rectArr = doc.resolveArray(dictGet(dict, "Rect"));
    const x1 = rectArr && rectArr.items[0] && doc.resolve(rectArr.items[0])?.kind === "number" ? (doc.resolve(rectArr.items[0]) as { value: number }).value : 50;
    const y1 = rectArr && rectArr.items[1] && doc.resolve(rectArr.items[1])?.kind === "number" ? (doc.resolve(rectArr.items[1]) as { value: number }).value : 700;
    const vNode = doc.resolve(dictGet(dict, "V") ?? dictGet(dict, "AS"));
    let valStr = "";
    if (vNode?.kind === "string") valStr = decodePdfString(vNode);
    else if (vNode?.kind === "name" && vNode.decoded !== "Off") valStr = vNode.decoded;
    else if (vNode?.kind === "boolean" && vNode.value) valStr = "Yes";
    if (valStr && pages[0]) {
      appendDrawingToPage(pages[0], valStr, x1 + 2, y1 + 4);
    }
  }

  if (acroForm) {
    dictSet(acroForm, "Fields", cosArray([]));
    dictSet(acroForm, "NeedAppearances", cosBool(false));
  }
}
