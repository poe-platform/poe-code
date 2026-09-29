/** CSVKit's established raw-cell format profile; never shared mutable reader state. */
export const workbookNumberFormats: Readonly<Record<number, string>> = Object.freeze({
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'm/d/yy', 15: 'd-mmm-yy', 16: 'd-mmm',
  17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0',
  49: '@', 56: '"上午/下午 "hh"時"mm"分"ss"秒 "'
});

/** Legacy XLS classification considers all sections, unlike openpyxl's first-section rule. */
export function legacyWorkbookDateFormat(format: string, step: () => void): boolean {
  let index = 0;
  while (index < format.length) {
    step(); const char = format[index++]!;
    if (char === 'G') { if (format.slice(index - 1, index + 6).toLowerCase() === 'general') index += 6; }
    else if (char === '"') {
      while (index < format.length) { step(); if (format[index++] === '"') break; }
    } else if (char === '\\' || char === '_') index++;
    else if ('BbMDYHSEmdyhseg'.includes(char)) return true;
    else if (char === 'a' || char === 'A' || char === '上') {
      const text = format.slice(index - 1, index + 4).toUpperCase();
      if (text.startsWith('A/P') || text === 'AM/PM' || text === '上午/下午') return true;
    } else if (char === '[') {
      let elapsed = true;
      while (index < format.length) {
        step(); const token = format[index++]!;
        if (token === ']') { if (elapsed) return true; break; }
        if (token === '[') elapsed = true;
        else if (!'HhMmSsชนท'.includes(token)) elapsed = false;
      }
    } else if (char === '.' || char === '0' || char === '#') {
      while (index < format.length && ('0#?.,E+-%'.includes(format[index]!) ||
        format[index] === '\\' && format[index + 1] === '-' && (format[index + 2] === '0' || format[index + 2] === '#'))) { step(); index++; }
    } else if (char === '?') {
      while (format[index] === '?') { step(); index++; }
    } else if (char === '*') { if (format[index] === ' ' || format[index] === '*') index++; }
    else if (char >= '1' && char <= '9') {
      while (index < format.length && format[index]! >= '0' && format[index]! <= '9') { step(); index++; }
    }
  }
  return false;
}
