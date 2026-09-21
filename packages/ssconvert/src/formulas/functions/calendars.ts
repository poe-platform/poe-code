import { error, numericResult } from "../values.js";
import { numberArg, str } from "./common.js";
import { dateSerial, gregorian, localNow, serialDate } from "./dates.js";
import type { FunctionImplementation } from "./types.js";

function easter(year: number): Date {
  const c = Math.trunc(year / 100), n = year % 19, k = Math.trunc((c - 17) / 25);
  let i = (c - Math.trunc(c / 4) - Math.trunc((c - k) / 3) + 19 * n + 15) % 30;
  i -= Math.trunc(i / 28) * (1 - Math.trunc(i / 28) * Math.trunc(29 / (i + 1)) * Math.trunc((21 - n) / 11));
  const j = (year + Math.trunc(year / 4) + i + 2 - c + Math.trunc(c / 4)) % 7, l = i - j, month = 3 + Math.trunc((l + 40) / 44);
  return gregorian(year, month, l + 28 - 31 * Math.trunc(month / 4));
}
function hebrewStart(year: number): number {
  let l = year * 7 + 1; const m = year * 12 + Math.trunc(l / 19); l %= 19;
  let molad = m * (25920 + 12 * 1080 + 793) + 7 * 1080 + 779;
  let start = m * 28 + Math.trunc(molad / 25920) - 2;
  molad %= 181440; let weekday = Math.trunc(molad / 25920); molad %= 25920;
  if (l < 12 && weekday === 3 && molad >= 15 * 1080 + 204 || l < 7 && weekday === 2 && molad >= 21 * 1080 + 589) { start++; weekday++; }
  if ([1, 4, 6].includes(weekday)) start++;
  return start;
}
function hebrewDate(julian: number, gregorianYear: number): { day: number; month: number; year: number } {
  let year = gregorianYear + 16, start = hebrewStart(year), next = hebrewStart(year + 1), day = julian - 1715119;
  while (day >= next) { start = next; year++; next = hebrewStart(year + 1); }
  day -= start; let size = next - start, month: number;
  if (day >= size - 236) {
    day -= size - 236; month = Math.trunc(day * 2 / 59); day -= Math.trunc((month * 59 + 1) / 2); month += 4;
    if (size > 365 && month <= 5) month += 8;
  } else { size = 114 + size % 10; month = Math.trunc(day * 4 / size); day -= Math.trunc((month * size + 3) / 4); }
  return { day: day + 1, month, year: year + 3744 };
}
function hebrewNumber(n: number): string {
  if (n < 1 || n > 10000) return "";
  const units = " אבגדהוזחט", tens = "טיכלמנסעפצ", hundreds = " קרשת"; let text = "";
  if (n >= 1000) { text += units[Math.trunc(n / 1000)] ?? ""; n %= 1000; }
  while (n >= 400) { text += "ת"; n -= 400; }
  if (n >= 100) { text += hundreds[Math.trunc(n / 100)]; n %= 100; }
  if (n >= 10) { if (n === 15 || n === 16) n -= 9; text += tens[Math.trunc(n / 10)]; n %= 10; }
  if (n > 0) text += units[n];
  return text.length < 2 ? text + "׳" : text.slice(0, -1) + "״" + text.slice(-1);
}
const months = ["Tishri", "Heshwan", "Kislev", "Tebet", "Shebat", "Adar", "Nisan", "Iyar", "Sivan", "Tammuz", "Ab", "Elul", "Adar I", "Adar II"];
const hebrewMonths = ["ת\u05bc\u05b4ש\u05c1\u05b0ר\u05b5י", "ח\u05b6ש\u05c1\u05b0ו\u05c7ן", "כ\u05bc\u05b4ס\u05b0ל\u05b5ו", "טֵבֵת", "ש\u05c1\u05b0ב\u05c7ט", "אַדׇר", "נִיסׇן", "אִיׇיר", "סִיוׇן", "ת\u05bc\u05c7מו\u05bcז", "אָב", "אֱלוּל", "אַדׇר א׳", "אַדׇר ב׳"];
export const calendarFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(Object.entries({ EASTERSUNDAY: 0, ASCENSIONTHURSDAY: 39, ASHWEDNESDAY: -46, GOODFRIDAY: -2, PENTECOSTSUNDAY: 49 }).map(([name, diff]) => [name, ((a, h) => {
    let year: number;
    if (a[0] === undefined) {
      const today = localNow(h); year = today.getUTCFullYear();
      if (dateSerial(easter(year), h) + diff < Math.floor(dateSerial(today, h))) year++;
    } else { year = Math.trunc(numberArg(a, 0, h)); if (year >= 0 && year <= 29) year += 2000; else if (year <= 99 && year >= 30) year += 1900; }
    if (year < 1582 || year > 9956) return error("#NUM!");
    let serial = dateSerial(easter(year), h) + diff;
    if (diff < 0 && serial > 0 && serial <= 60 && h.book.dateSystem !== "1904") serial--;
    return numericResult(serial);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["HDATE", "HDATE_HEB", "HDATE_DAY", "HDATE_MONTH", "HDATE_YEAR", "HDATE_JULIAN", "DATE2HDATE", "DATE2HDATE_HEB", "DATE2JULIAN"].map(name => [name, ((a, h) => {
    let date: Date;
    if (name.startsWith("DATE2")) {
      const value = a[0] === undefined ? localNow(h) : serialDate(numberArg(a, 0, h), h);
      if (!value) return error("#NUM!"); date = gregorian(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    } else {
      const defaults = a.some(v => v === undefined) || a.length < 3 ? localNow(h) : undefined;
      const year = Math.trunc(numberArg(a, 0, h, defaults?.getUTCFullYear())), month = Math.trunc(numberArg(a, 1, h, defaults ? defaults.getUTCMonth() + 1 : 0)), day = Math.trunc(numberArg(a, 2, h, defaults?.getUTCDate()));
      if (name === "HDATE_JULIAN") {
        const shift = Math.trunc((month - 14) / 12);
        return numericResult(Math.trunc(1461 * (year + 4800 + shift) / 4) + Math.trunc(367 * (month - 2 - 12 * shift) / 12) - Math.trunc(3 * Math.trunc((year + 4900 + shift) / 100) / 4) + day - 32075);
      }
      if (year <= 0 || month < 1 || month > 12 || day < 1 || day > (year >= 3000 && month === 6 ? 59 : 31)) return error("#VALUE!");
      date = gregorian(year, month, day);
    }
    const julian = date.getTime() / 86400000 + 2440588;
    if (name === "DATE2JULIAN" || name === "HDATE_JULIAN") return numericResult(julian);
    const hd = hebrewDate(julian, date.getUTCFullYear());
    if (name === "HDATE_DAY") return numericResult(hd.day);
    if (name === "HDATE_MONTH") return numericResult(hd.month);
    if (name === "HDATE_YEAR") return numericResult(hd.year);
    return str(name.endsWith("_HEB") ? `${hebrewNumber(hd.day)} בְּ${hebrewMonths[hd.month]} ${hebrewNumber(hd.year)}` : `${hd.day} ${months[hd.month]} ${hd.year}`);
  }) satisfies FunctionImplementation]))
};
