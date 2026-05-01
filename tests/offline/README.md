# Offline Playwright tests

These specs are skeletons. To run:

```sh
npm install --save-dev @playwright/test
npx playwright install
npx playwright test
```

Set the test base URL via env:

```sh
BASE_URL=http://localhost:3000 npx playwright test
```

Each spec is intentionally minimal — fill in the trip share ID and any auth fixtures that match your dev environment.
