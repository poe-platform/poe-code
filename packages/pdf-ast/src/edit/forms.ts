import {
  cosArray,
  cosBool,
  cosDict,
  cosName,
  cosString,
  decodePdfString,
  dictGet,
  dictSet,
  type PdfCosDict,
  type PdfCosNode,
} from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";

export interface PdfFormFieldInfo {
  readonly name: string;
  readonly type: "text" | "checkbox" | "choice" | "unknown";
  readonly value: string | boolean;
}

function collectFieldDicts(
  doc: ParsedCosDocument,
  node: PdfCosNode | undefined,
  prefix = "",
  out: Array<{ fullName: string; dict: PdfCosDict }> = []
): Array<{ fullName: string; dict: PdfCosDict }> {
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

  const kidsArr = doc.resolveArray(dictGet(dict, "Kids"));
  if (kidsArr && kidsArr.items.length > 0) {
    const hasFT = Boolean(dictGet(dict, "FT"));
    const kidsHaveNames = kidsArr.items.some(kid => {
      const kidDict = doc.resolveDict(kid);
      return Boolean(kidDict && dictGet(kidDict, "T"));
    });
    if (!kidsHaveNames && hasFT && fullName) {
      out.push({ fullName, dict });
      return out;
    }
    for (const kid of kidsArr.items) {
      collectFieldDicts(doc, kid, fullName, out);
    }
  } else if (fullName) {
    out.push({ fullName, dict });
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

export function getDocumentFormFields(doc: ParsedCosDocument): PdfFormFieldInfo[] {
  const catalog = doc.resolveDict(doc.rootRef);
  if (!catalog) return [];
  const acroForm = doc.resolveDict(dictGet(catalog, "AcroForm"));
  if (!acroForm) return [];
  const fieldsArr = doc.resolveArray(dictGet(acroForm, "Fields"));
  if (!fieldsArr) return [];

  const all: Array<{ fullName: string; dict: PdfCosDict }> = [];
  for (const item of fieldsArr.items) {
    collectFieldDicts(doc, item, "", all);
  }

  return all.map(({ fullName, dict }) => {
    const ftNode = doc.resolve(dictGet(dict, "FT"));
    const ft = ftNode?.kind === "name" ? ftNode.decoded : "";
    const vNode = doc.resolve(dictGet(dict, "V"));
    if (ft === "Btn") {
      const checked = vNode?.kind === "name" ? vNode.decoded !== "Off" : vNode?.kind === "boolean" ? vNode.value : false;
      return { name: fullName, type: "checkbox", value: checked };
    }
    const strVal =
      vNode?.kind === "string"
        ? decodePdfString(vNode)
        : vNode?.kind === "name"
          ? vNode.decoded
          : "";
    return {
      name: fullName,
      type: ft === "Tx" ? "text" : ft === "Ch" ? "choice" : "unknown",
      value: strVal,
    };
  });
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

  const all: Array<{ fullName: string; dict: PdfCosDict }> = [];
  for (const item of fieldsArr.items) {
    collectFieldDicts(doc, item, "", all);
  }

  const existing = all.find(f => f.fullName === fieldName);
  if (existing) {
    if (typeof value === "boolean") {
      const onValue = resolveCheckboxOnValue(doc, existing.dict);
      const targetState = cosName(value ? onValue : "Off");
      dictSet(existing.dict, "FT", cosName("Btn"));
      dictSet(existing.dict, "V", targetState);
      dictSet(existing.dict, "AS", targetState);
      const kidsArr = doc.resolveArray(dictGet(existing.dict, "Kids"));
      if (kidsArr) {
        for (const kid of kidsArr.items) {
          const kidDict = doc.resolveDict(kid);
          if (kidDict) {
            dictSet(kidDict, "AS", targetState);
          }
        }
      }
    } else {
      dictSet(existing.dict, "FT", cosName("Tx"));
      dictSet(existing.dict, "V", cosString(value));
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
