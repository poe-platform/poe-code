export function parseFilterBoolean(value: string, error: string): boolean {
  const word = value.toLowerCase();
  if (["true", "y", "yes", "enable", "enabled", "on"].includes(word)) return true;
  if (["false", "n", "no", "disable", "disabled", "off", ""].includes(word)) return false;
  const digits = value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
  const number = Number(value);
  if (!digits.length || ![...digits].every(char => char >= "0" && char <= "9") ||
      (number !== 0 && number !== 1)) {
    throw new Error(error);
  }
  return number === 1;
}
