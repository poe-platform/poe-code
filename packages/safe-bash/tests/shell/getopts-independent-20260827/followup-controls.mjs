export const cursorControls = [
  { id: 'F01', firstArgs: ['-pqr'], secondArgs: ['-pqr'], expected: [['0', 'p', '1', '', ''], ['0', 'q', '2', '', '']] },
  { id: 'F02', firstArgs: ['-pqr', 'operand'], secondArgs: ['-pqr', 'operand'], expected: [['0', 'p', '1', '', ''], ['0', 'q', '2', '', '']] },
  { id: 'F03', firstArgs: ['-pqr', 'operand'], secondArgs: ['-pqr'], expected: [['0', 'p', '1', '', ''], ['0', 'q', '2', '', '']] },
];

export const nativeCursorScript = `OPTIND=1
OPTERR=1
unset OPTARG
observe() {
  getopts pqr option_name "$@"
  result_status=$?
  printf '%s\\000%s\\000%s\\000%s\\000%s\\000' "$result_status" "$option_name" "$OPTIND" "\${OPTARG+x}" "\${OPTARG-}"
}
case "$1" in
  F01) observe '-pqr'; OPTIND=2; observe '-pqr' ;;
  F02) observe '-pqr' 'operand'; OPTIND=2; observe '-pqr' 'operand' ;;
  F03) observe '-pqr' 'operand'; OPTIND=2; observe '-pqr' ;;
  *) exit 64 ;;
esac
`;
