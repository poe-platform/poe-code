import commonmark from "./commonmark.js";
import gfm from "./gfm.js";
import html from "./html.js";
import html5 from "./html5.js";
import json from "./json.js";
import csv from "./csv.js";
import tsv from "./tsv.js";
import plain from "./plain.js";
import latex from "./latex.js";
import rst from "./rst.js";
import rtf from "./rtf.js";
import epub from "./epub.js";
import pdf from "./pdf.js";
import docx from "./docx.js";
import pptx from "./pptx.js";
import xlsx from "./xlsx.js";
import type { FormatDescriptor } from "../formats.js";
export const coreFormats: readonly FormatDescriptor[] = [
  commonmark,
  gfm,
  html,
  html5,
  json,
  csv,
  tsv,
  plain,
  latex,
  rst,
  rtf,
  epub,
  pdf,
  docx,
  pptx,
  xlsx
];
