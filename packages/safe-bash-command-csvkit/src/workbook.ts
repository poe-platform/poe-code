/** Cached reader data shared by in2csv and its public workbook SDK. */
export interface CsvkitWorkbookCell {
  readonly t: string;
  readonly v?: unknown;
  readonly z?: string | number;
  readonly w?: string;
}

export interface CsvkitWorksheet {
  readonly '!ref'?: string;
  readonly [address: string]: unknown;
}

export interface CsvkitWorkbook {
  readonly SheetNames: readonly string[];
  readonly Sheets: Readonly<Record<string, CsvkitWorksheet>>;
  readonly Workbook?: {
    readonly WBProps?: { readonly date1904?: boolean };
    readonly WBView?: readonly { readonly activeTab?: string | number }[];
  };
}
