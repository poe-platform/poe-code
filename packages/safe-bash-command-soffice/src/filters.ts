import type { SofficeBudget } from './budget.js';
import { SofficeError, sofficeCapabilities, type OfficeFilter, type DocumentService, type ConversionParameters } from './contracts.js';
export function resolveExportFilter(filters: readonly OfficeFilter[], service: DocumentService, parameters: ConversionParameters, budget: SofficeBudget): OfficeFilter {
  budget.checkpoint();
  budget.charge('work', parameters.filter.length + parameters.extension.length);
  const matches: OfficeFilter[] = [];
  for (const filter of filters) {
    budget.charge('work', 1 + filter.name.length + filter.extensions.length);
    for (const extension of filter.extensions) budget.charge('work', extension.length);
    if (filter.export && filter.service === service &&
      (parameters.filter ? filter.name === parameters.filter : filter.preferred && filter.extensions.includes(parameters.extension))) matches.push(filter);
  }
  if (matches.length === 0) throw new SofficeError('unsupported', 'no declared export filter', parameters.filter || parameters.extension);
  if (matches.length !== 1) throw new SofficeError('ambiguous-filter', 'multiple declared export filters');
  return matches[0]!;
}
export function admitConversion(filter: OfficeFilter): void {
  for (const capability of filter.requires) {
    if (!sofficeCapabilities[capability]) throw new SofficeError('unsupported', 'unqualified capability', capability);
  }
  if (!sofficeCapabilities.conversion) throw new SofficeError('unsupported', 'conversion engine closure is not qualified');
}
