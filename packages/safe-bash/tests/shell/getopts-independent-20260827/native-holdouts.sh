OPTIND=1
OPTERR=1
unset OPTARG

observe() {
  getopts "$@"
  result_status=$?
  printf '%s\000%s\000%s\000%s\000%s\000' "$result_status" "$option_name" "$OPTIND" "${OPTARG+x}" "${OPTARG-}"
}

case "$1" in
  N01)
    for observation in 1 2 3 4 5 6; do
      observe 'pq:r' option_name '-prqVALUE' '-q' 'next' 'operand' '-p'
    done
    ;;
  N02)
    for observation in 1 2 3 4; do
      observe 'pq:' option_name '-q' '--' '-q' '' '-q' '-p'
    done
    ;;
  N03)
    for observation in 1 2 3 4; do observe 'p' option_name '-pzp'; done
    ;;
  N04)
    for optstring in 'q:' ':q:'; do
      for report_errors in 0 1; do
        for token in '-z' '-q'; do
          OPTIND=1
          OPTERR=$report_errors
          observe "$optstring" option_name "$token"
          observe "$optstring" option_name "$token"
        done
      done
    done
    ;;
  N05)
    for observation in 1 2 3 4 5; do observe 'pr' option_name '--' '-p' '--' '-r'; done
    ;;
  N06)
    for token in '-' '+' '' 'operand'; do
      OPTIND=1
      observe 'p' option_name "$token" '-p'
      observe 'p' option_name "$token" '-p'
    done
    ;;
  N07)
    observe 'pqr' option_name '-pqr'
    OPTIND=1
    observe 'pqr' option_name '-pqr'
    observe 'pqr' option_name '-pqr'
    OPTIND=0
    observe 'pqr' option_name '-pqr'
    OPTIND=-9
    observe 'pqr' option_name '-pqr'
    ;;
  N08)
    observe 'pqrxz' option_name '-pqr' '-x' '-z'
    OPTIND=2
    for observation in 1 2 3 4; do observe 'pqrxz' option_name '-pqr' '-x' '-z'; done
    ;;
  N09)
    observe 'pqrxyz' option_name '-pqr'
    observe 'pqrxyz' option_name '-xyz'
    observe 'pqrxyz' option_name '-pqz'
    observe 'pqrxyz' option_name '-pqz'
    ;;
  N10)
    observe 'pqrx' option_name '-pqr'
    observe 'pqrx' option_name '-x'
    observe 'pqrx' option_name '-x'
    ;;
  N11)
    for observation in 1 2 3; do observe 'pp:q:' option_name '-pqZ'; done
    OPTIND=1
    for observation in 1 2; do observe 'p:pq' option_name '-pqq'; done
    OPTIND=1
    for observation in 1 2; do observe 'q::p' option_name '-q' '-p'; done
    ;;
  N12)
    for observation in 1 2 3 4; do observe 'q:p' option_name $'-q🧪é\n' '-q' '漢字' '-p'; done
    ;;
  *) exit 64 ;;
esac
