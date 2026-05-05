# Our Trips

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Versioning

Versions are managed by release-please from Conventional Commit messages on `main`. The canonical app version lives in `package.json`.

Use these commit prefixes:

- `fix:` for patch releases, such as `0.1.0` to `0.1.1`
- `feat:` for minor releases, such as `0.1.0` to `0.2.0`
- `feat!:` or `BREAKING CHANGE:` for major releases, such as `1.0.0` to `2.0.0`
- `chore:`, `docs:`, `style:`, `refactor:`, `test:`, and `ci:` for changes that usually do not create a release

Pull requests check the PR title and commit messages for this format. When qualifying commits land on `main`, GitHub Actions opens a release PR that updates `package.json`, `package-lock.json`, `CHANGELOG.md`, and the release manifest. Merging that release PR creates the GitHub Release and tag automatically.

Example commits:

```bash
git commit -m "feat: add shared trip previews"
git commit -m "fix: keep itinerary cards within the viewport"
git commit -m "chore: update dependencies"
```

## Build

```bash
npm run build
```
