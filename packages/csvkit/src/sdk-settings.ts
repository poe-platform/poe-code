// Generated from the frozen csvkit 2.2.0 flag inventory by scripts/generate-inventories.mjs.
export interface CSVCleanSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly skipinitialspace?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly length_mismatch?: boolean;
  readonly empty_columns?: boolean;
  readonly enable_all_checks?: boolean;
  readonly omit_error_rows?: boolean;
  readonly label?: string | null;
  readonly header_normalize_space?: boolean;
  readonly join_short_rows?: boolean;
  readonly separator?: string;
  readonly fill_short_rows?: boolean;
  readonly fillvalue?: string | null;
}

export interface CSVCutSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly skipinitialspace?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly names_only?: boolean;
  readonly columns?: string | null;
  readonly not_columns?: string | null;
  readonly delete_empty?: boolean;
}

export interface CSVFormatSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly skip_header?: boolean;
  readonly out_delimiter?: string | null;
  readonly out_tabs?: boolean;
  readonly out_asv?: boolean;
  readonly out_quotechar?: string | null;
  readonly out_quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly out_doublequote?: boolean;
  readonly out_escapechar?: string | null;
  readonly out_lineterminator?: string | null;
}

export interface CSVGrepSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly skipinitialspace?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly names_only?: boolean;
  readonly columns?: string | null;
  readonly pattern?: string | null;
  readonly regex?: string | null;
  readonly matchfile?: string | null;
  readonly inverse?: boolean;
  readonly any_match?: boolean;
}

export interface CSVJoinSettings {
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly input_paths?: readonly string[];
  readonly columns?: string | null;
  readonly outer_join?: boolean;
  readonly left_join?: boolean;
  readonly right_join?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface CSVJSONSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly indent?: number | bigint | null;
  readonly key?: string | null;
  readonly lat?: string | null;
  readonly lon?: string | null;
  readonly type?: string | null;
  readonly geometry?: string | null;
  readonly crs?: string | null;
  readonly no_bbox?: boolean;
  readonly streamOutput?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface CSVLookSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly max_rows?: number | bigint | null;
  readonly max_columns?: number | bigint | null;
  readonly max_column_width?: number | bigint | null;
  readonly max_precision?: number | bigint | null;
  readonly no_number_ellipsis?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface CSVPySettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly as_dict?: boolean;
  readonly as_agate?: boolean;
  readonly no_number_ellipsis?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface CSVSortSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly names_only?: boolean;
  readonly columns?: string | null;
  readonly reverse?: boolean;
  readonly ignore_case?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface CSVSQLSettings {
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly input_paths?: readonly string[];
  readonly dialect?: "mssql" | "mysql" | "oracle" | "postgresql" | "sqlite" | null;
  readonly connection_string?: string | null;
  readonly engine_option?: readonly (readonly [string, unknown])[];
  readonly queries?: readonly string[] | null;
  readonly insert?: boolean;
  readonly prefix?: readonly string[];
  readonly before_insert?: string | null;
  readonly after_insert?: string | null;
  readonly sql_delimiter?: string;
  readonly table_names?: string | null;
  readonly no_constraints?: boolean;
  readonly unique_constraint?: string | null;
  readonly no_create?: boolean;
  readonly create_if_not_exists?: boolean;
  readonly overwrite?: boolean;
  readonly db_schema?: string | null;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
  readonly chunk_size?: number | bigint | null;
  readonly min_col_len?: number | bigint;
  readonly col_len_multiplier?: number | bigint;
}

export interface CSVStackSettings {
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly skipinitialspace?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly input_paths?: readonly string[];
  readonly groups?: string | null;
  readonly group_name?: string | null;
  readonly group_by_filenames?: boolean;
}

export interface CSVStatSettings {
  readonly input_path?: string | null;
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly csv_output?: boolean;
  readonly json_output?: boolean;
  readonly indent?: number | bigint | null;
  readonly names_only?: boolean;
  readonly columns?: string | null;
  readonly type_only?: boolean;
  readonly nulls_only?: boolean;
  readonly nonnulls_only?: boolean;
  readonly unique_only?: boolean;
  readonly min_only?: boolean;
  readonly max_only?: boolean;
  readonly sum_only?: boolean;
  readonly mean_only?: boolean;
  readonly median_only?: boolean;
  readonly stdev_only?: boolean;
  readonly len_only?: boolean;
  readonly maxprecision_only?: boolean;
  readonly freq_only?: boolean;
  readonly freq_count?: number | bigint | null;
  readonly count_only?: boolean;
  readonly decimal_format?: string;
  readonly no_grouping_separator?: boolean;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface In2CSVSettings {
  readonly delimiter?: string | null;
  readonly tabs?: boolean;
  readonly quotechar?: string | null;
  readonly quoting?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  readonly doublequote?: boolean;
  readonly escapechar?: string | null;
  readonly field_size_limit?: number | bigint | null;
  readonly encoding?: string;
  readonly locale?: string;
  readonly skipinitialspace?: boolean;
  readonly blanks?: boolean;
  readonly null_values?: readonly string[];
  readonly date_format?: string | null;
  readonly datetime_format?: string | null;
  readonly no_leading_zeroes?: boolean;
  readonly no_header_row?: boolean;
  readonly skip_lines?: number | bigint;
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly add_bom?: boolean;
  readonly zero_based?: boolean;
  readonly input_path?: string | null;
  readonly filetype?: "csv" | "dbf" | "fixed" | "geojson" | "json" | "ndjson" | "xls" | "xlsx" | null;
  readonly schema?: string | null;
  readonly key?: string | null;
  readonly names_only?: boolean;
  readonly sheet?: string | null;
  readonly write_sheets?: string | null;
  readonly use_sheet_names?: boolean;
  readonly reset_dimensions?: boolean | null;
  readonly encoding_xls?: string | null;
  readonly sniff_limit?: number | bigint;
  readonly no_inference?: boolean;
}

export interface SQL2CSVSettings {
  readonly verbose?: boolean;
  readonly line_numbers?: boolean;
  readonly connection_string?: string;
  readonly engine_option?: readonly (readonly [string, unknown])[];
  readonly execution_option?: readonly (readonly [string, unknown])[];
  readonly input_path?: string | null;
  readonly query?: string | null;
  readonly encoding?: string;
  readonly no_header_row?: boolean;
}

export interface CsvkitSettings {
  readonly csvclean: CSVCleanSettings;
  readonly csvcut: CSVCutSettings;
  readonly csvformat: CSVFormatSettings;
  readonly csvgrep: CSVGrepSettings;
  readonly csvjoin: CSVJoinSettings;
  readonly csvjson: CSVJSONSettings;
  readonly csvlook: CSVLookSettings;
  readonly csvpy: CSVPySettings;
  readonly csvsort: CSVSortSettings;
  readonly csvsql: CSVSQLSettings;
  readonly csvstack: CSVStackSettings;
  readonly csvstat: CSVStatSettings;
  readonly in2csv: In2CSVSettings;
  readonly sql2csv: SQL2CSVSettings;
}
export type CsvkitCommand = keyof CsvkitSettings;
export type CsvkitRequest = { [Name in CsvkitCommand]: { readonly command: Name; readonly settings?: CsvkitSettings[Name] } }[CsvkitCommand];
