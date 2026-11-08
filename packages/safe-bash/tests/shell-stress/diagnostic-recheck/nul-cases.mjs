export const names = ['shell', 'diagnostic-nul-script'];
export const cases = [
  { name: 'original-dollar-blanklines', script: "value=$(:\n\n\nprintf '%s' \"$(printf 'a\\0b')\"\n)" },
  { name: 'original-backtick-control', script: "value=`\nprintf '%s' \"$(printf 'a\\0b')\"\n`" },
  { name: 'dollar-no-blank', script: "value=$(:\nprintf '%s' \"$(printf 'a\\0b')\"\n)" },
  { name: 'dollar-one-blank', script: "value=$(:\n\nprintf '%s' \"$(printf 'a\\0b')\"\n)" },
  { name: 'dollar-three-blanks', script: "value=$(:\n\n\n\nprintf '%s' \"$(printf 'a\\0b')\"\n)" },
  { name: 'dollar-prefix-lines', script: "\n:\nvalue=$(:\n\n\nprintf '%s' \"$(printf 'a\\0b')\"\n)" },
  { name: 'nested-multiple-nuls-one-warning', script: "value=$(:\n\n\nprintf '%s' \"$(printf 'a\\0b\\0c')\"\n); printf '<%s>' \"$value\"" },
  { name: 'two-substitutions-two-warnings', script: "first=$(printf 'a\\0b');\nsecond=$(printf 'c\\0d'); printf '<%s><%s>' \"$first\" \"$second\"" },
];
