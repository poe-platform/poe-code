# Testing

## Local GitHub Actions With `act`

Install `act`:

```sh
brew install act
```

Make sure Docker is running before executing workflows locally.

Create `.secrets.act` in the repository root with:

```sh
POE_API_KEY=test
GITHUB_TOKEN=test
```

Run a workflow event locally with:

```sh
act <event> -e <payload> --secret-file .secrets.act
```

Verify workflow discovery with:

```sh
act --list
```

Local quick check:

```sh
npm run test:workflows:all
```

Full CI-grade workflow regression run (requires Docker):

```sh
npm run test:workflows:ci
```

If `act` fails while cloning public actions, remove the `GITHUB_TOKEN=test`
line or replace it with a real GitHub token. The placeholder value is enough
for secret interpolation, but some local runs treat it as an auth credential.
