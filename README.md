# Digital Locker

A responsive visual prototype for a student document locker. Built with React, Vite, and plain CSS.

## What is included

- Dashboard with sample document counts, storage usage, and recent activity.
- Document list with search, categories, scan-status filters, and sorting.
- Document-details dialog and example clean, flagged, and quarantined states.
- Simulated upload flow: quarantine → scanning → chosen result.
- Demo sharing controls with expiration, view limits, and revocation.
- Activity timeline, sample profile settings, notification preference, and reset.
- Responsive navigation, keyboard focus indicators, native accessible dialogs, and feedback messages.

**This is a temporary frontend demo, services will be integrated later.

## Run locally

Install Node.js 22.12+ (Node 24 recommended). From the repository root:

```sh
npm install
npm run dev
```

Open the local address printed in the terminal. With the current configuration it ends in `/digital_locker/`.

For a production check:

```sh
npm run build
npm run preview
```

You can also use pnpm 11.25.0: `pnpm install`, `pnpm dev`, and `pnpm build`. The committed pnpm lockfile is used by GitHub Actions. If you change dependencies with npm, update the pnpm lockfile with `pnpm import` before pushing so deployment uses the same versions.

## Repository structure

```text
.github/workflows/deploy.yml   Build and deploy to GitHub Pages
components/                    Icons, status badges, and shared dialog
pages/Documents.jsx            Reusable document table
public/                        Static assets
src/App.jsx                    Application shell, views, and demo state
src/data.js                    Fictional seed data
src/styles.css                 Theme, layout, and responsive styles
src/main.jsx                   React entry point
index.html                     HTML entry point
vite.config.js                 GitHub Pages base path
```

The screenshot showed a folder named `.githubworkflows`. GitHub needs two nested folders: `.github/workflows`. This starter supplies the correct path. Empty `temp.txt` files are placeholders and may be removed.

## Planned

Replacing demo state with authenticated API calls only when the backend is ready. Planned services include authentication, quarantine storage, malware scanning, private encrypted storage, server-enforced sharing limits, and access logs. Security decisions and secrets must remain on the server. Never commit personal documents or cloud credentials.
