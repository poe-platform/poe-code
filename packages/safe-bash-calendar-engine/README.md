# safe-bash-calendar-engine

Shared portable implementation used by Safe Bash command workspaces.

Calendar formatting and parsing use virtual timezones: UTC, fixed offsets, IANA
zones, and explicit POSIX daylight-saving rules such as
`EST5EDT,M3.2.0/2,M11.1.0/2`. POSIX rules support month/week/weekday, Julian-day,
and zero-based day-of-year transitions, including southern-hemisphere seasons.
Date parsing supports next/last/this units, fortnights, weekday names, and
yesterday/tomorrow combined with an ISO date or a time, such as
`2024-01-05 tomorrow 10:00`.
