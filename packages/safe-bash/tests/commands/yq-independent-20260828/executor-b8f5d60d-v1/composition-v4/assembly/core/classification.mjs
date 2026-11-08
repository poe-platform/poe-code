import { requireFact } from './primitives.mjs';

export function classifyProcess(receipt, integrity) {
  const aggregateFailure = receipt.code !== 0 || receipt.signal !== null || receipt.timedOut === true || receipt.overflow === true || receipt.spawnError !== null;
  return { aggregateFailure, mayContinue: integrity === true && receipt.reaped === true, unsafe: integrity !== true || receipt.reaped !== true };
}
export function exactReceiptIds(receipts, expected) {
  requireFact(Array.isArray(receipts) && receipts.length === expected.length && new Set(receipts.map(row => row.jobId)).size === expected.length && receipts.every((row, index) => row.jobId === expected[index]), 'RECEIPT_IDS');
}
export function assertDiagnostic(code, catalogue) {
  requireFact(catalogue.some(entry => entry.code === code), 'UNDECLARED_DIAGNOSTIC');
}
export function exactCompilerDiagnostic(text, expected) {
  const lines = text.trim().split(/\r?\n/u);
  requireFact(lines.length === 1 && new RegExp(`^.+\\(${expected.line},[0-9]+\\): error TS${expected.code}: `, 'u').test(lines[0]), 'COMPILER_DIAGNOSTIC_MISMATCH');
}
