# Digital Locker

A responsive visual prototype for a student document locker. Built with React, Vite, and plain CSS: rounded panels, a dark background, blue buttons, and readable light text.

## What is included

- Dashboard with sample document counts, storage usage, and recent activity.
- Document list with search, categories, scan-status filters, and sorting.
- Document-details dialog and example clean, flagged, and quarantined states.
- Simulated upload flow: quarantine → scanning → chosen result.
- Demo sharing controls with expiration, view limits, and revocation.
- Activity timeline, sample profile settings, notification preference, and reset.
- Responsive navigation, keyboard focus indicators, native accessible dialogs, and feedback messages.

**This is a frontend demo, not a secure document service.** All documents are fictional. No files are uploaded, scanned, encrypted, stored, or shared. Links are sample records without working URLs. Preferences and changes live in memory and reset on refresh. The initial timestamps are illustrative, not live events.

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

## Publish to your existing GitHub repository

1. Copy this starter's files into the root of `rasrafee/digital_locker`. Include the hidden `.github` folder and `.gitignore`.
2. Commit and push the changes to `main`.
3. On GitHub open **Settings → Pages** and set **Source → GitHub Actions**.
4. Open the **Actions** tab and wait for **Deploy Digital Locker** to finish. If Pages was enabled after the initial push, run the workflow manually.
5. Open `https://rasrafee.github.io/digital_locker/` after a successful deployment.

`vite.config.js` already sets `base: '/digital_locker/'`. Update it if you rename the repository. Navigation is handled inside the app, so refreshing does not require server-side route rewrites.

Official deployment reference: https://vite.dev/guide/static-deploy.html#github-pages

## Next steps

Replace demo state with authenticated API calls only when the backend is ready. Planned services include authentication, quarantine storage, malware scanning, private encrypted storage, server-enforced sharing limits, and access logs. Security decisions and secrets must remain on the server. Never commit personal documents or cloud credentials.
