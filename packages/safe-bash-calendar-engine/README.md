# safe-bash-calendar-engine

Shared portable implementation used by Safe Bash command workspaces.

Calendar formatting and parsing use virtual timezones: UTC, fixed offsets, IANA
zones, and explicit POSIX daylight-saving rules such as
`EST5EDT,M3.2.0/2,M11.1.0/2`. POSIX rules support month/week/weekday, Julian-day,
and zero-based day-of-year transitions, including southern-hemisphere seasons.
Unknown timezone names fall back to UTC.
Date parsing supports next/last/this units, fortnights, weekday names, and
yesterday/tomorrow combined with an ISO date or a time, such as
`2024-01-05 tomorrow 10:00`. Explicit dates accept weekday prefixes such as
`Fri, 5 Jan 2024`, `Friday January 5 2024`, and `fri 2024-01-05`.
Absolute date strings also accept fixed timezone abbreviations such as EST, PDT,
CET, and JST, and east-positive corrections such as `UTC+2` or `GMT-5:30`.
Abbreviations retain their fixed offset regardless of the date's season.

Month-name dates without a year, such as `Jan 5`, `5 Jan`, or `Dec 25 10:30`, use the current year in the virtual timezone.

Time-only inputs use the current day in the source timezone; explicit dates and time-only inputs accept AM/PM notation.

`%Z` uses tzdb abbreviations, including historical and daylight-saving names, with the runtime Intl label as a fallback.
