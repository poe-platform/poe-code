import type { NumberSchema } from "toolcraft-schema-rust";
export declare function isValidNumberSchemaValue(value: unknown, schema: NumberSchema): value is number;
export declare function getExpectedNumberDescription(schema: NumberSchema): string;
