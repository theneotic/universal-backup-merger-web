#Universal Backup Merger

**Universal Backup Merger** is a browser-first tool for inspecting, merging, converting, and organizing compatible music-app backups. It is designed for people moving their music-library metadata between supported apps while retaining control over the files they select.

> **Privacy-first workflow:** the active merger and converter run in the browser. Selected backup files are not sent to a conversion server, and local merge history stays in that browser until you delete it.

| Resource | Link |
|---|---|
| Public repository | [theneotic/universal-backup-merger-web](https://github.com/theneotic/universal-backup-merger-web) |
| ArchiveTune → Bloomee converter | [/archivetune-to-bloomee](https://universal-backup-merger-web.vercel.app/archivetune-to-bloomee) |
| Portable playlist exports | [/portable-playlists](https://universal-backup-merger-web.vercel.app/portable-playlists) |

> **Current hosting status:** the previous Vercel URL returned `DEPLOYMENT_NOT_FOUND` during the latest validation. Treat the links above as route references after your own deployment, not as a working public deployment. The included manual deployment instructions are the current reliable path.

## What it does

The main workflow accepts a **Metrolist backup as the target** and one or more compatible source backups. It detects the supplied structures, maps supported music-library records, produces a validated Metrolist backup, and makes the result available for download. Merge records, labels, notes, and downloaded outputs are retained only in browser-local storage.

The project also includes a dedicated **ArchiveTune → Bloomee** converter. It creates a Bloomee legacy-v2 JSON payload with a `.blm` extension, which Bloomee can restore through its backup workflow. The **Portable playlist exports** route adds a destination-safe reverse conversion option: it turns a readable supported backup into a ZIP containing one CSV or M3U file per playlist. These files preserve the playlist name and track order together with title, artist, album, duration, and source URL when available; they are not renamed app databases.

## Compatibility

| Application | Role | Input accepted by the browser workflow | Notes |
|---|---|---|---|
| Metrolist | Target | `.backup` | Required target for the main merge workflow. |
| ArchiveTune | Source, converter source, and direct target | `.backup`, `.zip`, `.db` | Can merge into Metrolist, export to Bloomee, or serve as the user-supplied target for a Metrolist-to-ArchiveTune merge. |
| OuterTune | Source | Compatible SQLite backup | Mapped into a Metrolist target. |
| EchoMusic | Source | Compatible archive containing `Music Database` | Mapped into a Metrolist target. |
| SimpMusic | Source | Compatible archive containing `Music Database` | Mapped into a Metrolist target. |
| RiPlay | Source | Raw SQLite `.db` | Mapped into a Metrolist target. |
| Bloomee portable export | Source | `.json` or `.blm` legacy JSON payload | Mapped into a Metrolist target. |
| Bloomee native Isar snapshot | Not currently supported | `.isar` | Native Isar/MDBX snapshots cannot be safely decoded by the browser-only runtime. |

### Safe portable destination routes

| Destination | Output | Safe input sources | Import notes |
|---|---|---|---|
| Metrolist | ZIP of playlist CSV files | Any browser-readable supported source | Extract the ZIP and import one CSV at a time through Metrolist’s CSV playlist importer. Metrolist resolves tracks by title and artist. |
| Echo Music | ZIP of playlist CSV files | Any browser-readable supported source | Extract the ZIP and use Echo Music’s CSV playlist importer. |
| Echo Music | ZIP of Extended M3U playlist files | Any browser-readable supported source | Extract the ZIP and use Echo Music’s M3U playlist importer. |
| ArchiveTune | ZIP of CSV or Extended M3U playlist files | Any browser-readable supported source | Extract the ZIP and use ArchiveTune’s reviewed playlist importer. |
| ArchiveTune | Native merged `.backup` | Metrolist plus an existing ArchiveTune target | Use `/metrolist-to-archivetune`. The target’s ArchiveTune settings and destination-only tables stay intact. |
| RiPlay | ZIP of playlist CSV files | Any browser-readable supported source | Extract the ZIP and use RiPlay’s CSV source-matching playlist importer. |
| Bloomee | `.blm` legacy-v2 JSON | ArchiveTune | Use the dedicated ArchiveTune → Bloomee converter and Bloomee’s restore workflow. |
| SimpMusic | Official SimpMusic converter output | ArchiveTune, OuterTune, Metrolist | SimpMusic intentionally rejects hand-authored CSV and raw third-party backups; use its own documented browser converter. |
| OuterTune | No generated native backup | — | Cross-fork backup restore is not safely supported. The app will not create an unsafe raw database for this destination. |

> Keep an untouched copy of every original backup. Generated files should be tested in the destination app before they replace an existing library.

## Use the main merger

1. Open the [hosted application](https://universal-backup-merger-web.vercel.app).
2. Add one **Metrolist** backup to use as the target.
3. Add one or more compatible source files. The app displays detected target, source, and unsupported files before merging.
4. Select **Merge backups**. The visible stages are `uploading`, `detecting`, `merging`, and `validating`.
5. Download the generated Metrolist backup and restore it with Metrolist’s own restore process.

The browser history area lets you search local sessions by filename, label, note, metadata state, or date range. Deleting a session removes its locally stored output from that browser.

### Latest validation status

| Surface | Result | Meaning |
|---|---|---|
| Local browser merger | Passed with the supplied private Metrolist target and ArchiveTune source | The visible upload, detection, merge, validation, result card, and download flow created a non-empty 16,795,534-byte Metrolist backup. |
| Local portable playlist exports | Passed with the supplied private ArchiveTune source | Browser downloads contained 58 playlist files for Metrolist CSV, Echo Music M3U, ArchiveTune CSV/M3U, and RiPlay CSV routes. |
| Local Metrolist → ArchiveTune target merge | Passed with the supplied private Metrolist source and ArchiveTune target | The browser output preserved `settings.xml`, passed SQLite integrity, contained all 32,607 Metrolist songs and all 5,807 Metrolist playlist memberships, and downloaded as a non-empty 20,326,523-byte ArchiveTune backup. |
| Previous public Vercel URL | `DEPLOYMENT_NOT_FOUND` | The hosted URL is not currently a working proof of the app. Deploy the included source archive or reconnect a project before relying on it. |

This separation is deliberate: local browser validation proves the client-side merger code and download flow, while a public deployment must be separately linked, built, and checked after publishing.

## Convert ArchiveTune to Bloomee

1. Open the [ArchiveTune → Bloomee converter](https://universal-backup-merger-web.vercel.app/archivetune-to-bloomee).
2. Select an ArchiveTune `.backup`, `.zip`, or `.db` file.
3. Select **Create Bloomee import file** and download the resulting `.blm` file.
4. In Bloomee, open **Settings → Storage → Backup & Restore → Restore Backup**.
5. Select the `.blm` file, keep **Media items** enabled, then continue and confirm.

The exporter preserves supported playlist tracks, artist names, album metadata, artwork URLs, durations, and YouTube Music resolver IDs. It normalizes case-insensitive playlist names, avoids Bloomee system-playlist aliases, and deduplicates playlist memberships to reduce legacy restore index conflicts.

## Transfer Metrolist into ArchiveTune

1. Open `/metrolist-to-archivetune` after deploying the project.
2. Select the **Metrolist** backup that you want to transfer.
3. Select an existing **ArchiveTune** backup as the target. This supplies the destination schema and retains its ArchiveTune settings.
4. Select **Create ArchiveTune backup**, then download the generated `.backup` file after the `uploading`, `detecting`, `merging`, and `validating` stages complete.
5. Keep both original files, then restore the generated backup with ArchiveTune’s own backup-and-restore workflow.

This direct route copies compatible shared music-library rows into the supplied ArchiveTune target and verifies the output database before download. It is not a standalone ArchiveTune database generator; an ArchiveTune target backup is required.

## Export portable playlists for Metrolist or Echo Music

1. Open `/portable-playlists` after deploying the project.
2. Choose a supported `.backup`, `.zip`, `.db`, Bloomee `.json`, or `.blm` export. Native Bloomee `.isar` snapshots remain unavailable.
3. Select the destination route: **Metrolist · CSV**, **Echo Music · CSV**, **Echo Music · M3U**, **ArchiveTune · CSV**, **ArchiveTune · M3U**, or **RiPlay · CSV**.
4. Select **Create CSV playlist package** or **Create M3U playlist package**, then download the ZIP.
5. Extract the ZIP and import the individual playlist files using the destination app’s documented playlist import option.

Every ZIP includes a `README.txt` that records the source filename, detected source application, selected portable format, and file count. The package deliberately does not include a destination-app backup database. A catalog search or resolver in the destination app may be required before the imported playlist has working tracks.

## Run locally

### Prerequisites

Use a current Node.js LTS release and the pnpm version pinned in `package.json`. The project uses React, Vite, Tailwind CSS, `sql.js`, and `jszip` for the production browser workflow.

```bash
git clone https://github.com/theneotic/universal-backup-merger-web.git
cd universal-backup-merger-web
corepack enable
pnpm install --frozen-lockfile
```

Start the local development server:

```bash
pnpm dev
```

The browser app uses the Vite client in `client/`. The current production path is static and does not require the legacy Express/Python merger services that remain in the repository for historical tests and reference.

## Verify before deployment

Run the checks below before publishing any build:

```bash
pnpm test
pnpm check
pnpm build
```

The static production build is written to:

```text
dist/public
```

## Manual deployment

This project is a static Vite application. Upload or serve the generated `dist/public` folder with any static host that supports single-page application fallback.

| Hosting setting | Value |
|---|---|
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Publish / output directory | `dist/public` |
| Node package manager | pnpm |
| SPA fallback | Rewrite unknown routes to `/index.html` |

### Deploy on Vercel manually

1. Create or open a Vercel project and import this repository.
2. Use the repository’s included `vercel.json`, or enter the settings in the table above.
3. Confirm that the framework is detected as **Vite**.
4. Run the deployment from the Vercel dashboard. For a command-line deployment on your own machine, install the Vercel CLI, authenticate, and run `vercel --prod` from the repository root.
5. After deployment, open the root page and the direct routes `/about`, `/contact`, `/privacy`, `/terms`, `/archivetune-to-bloomee`, and `/portable-playlists` to verify the host’s SPA fallback.

### Deploy to another static host

Run `pnpm build`, then upload the **contents** of `dist/public` to the host’s public directory. Configure a catch-all rewrite so links such as `/about` load `index.html` and are handled by the client router.

## Privacy and repository hygiene

The active browser workflows process selected backup content on-device. The public site may use hosting or analytics services that receive limited technical request data; that is separate from the backup contents selected by the merger.

User backup artifacts must never be committed. The repository ignores `.backup`, `.db`, `.sqlite`, `.sqlite3`, `.isar`, `.blm`, and `.zip` files, plus upload, download, and backup-export directories. If you discover a backup file in a clone, remove it before committing and rotate or delete the affected history if needed.

For public support requests, describe the source app, destination app, versions, and non-sensitive error text. Do **not** attach music backups, converted backups, account credentials, or private library screenshots to public issues.

## Repository layout

```text
client/
  src/
    pages/                 # Merger, converter, About, Contact, Privacy, and Terms pages
    lib/browserMerger.ts   # Browser-side SQLite/ZIP inspection, mapping, and conversion
    lib/localHistory.ts    # Browser-local merge-history persistence
server/
  *.test.ts                # Vitest coverage, including browser compatibility tests
vercel.json                # Static Vite deployment settings
```

## Limitations

- The main merge target is currently Metrolist.
- Reverse conversion is intentionally destination-specific. Portable CSV and M3U routes are available only where the destination exposes the corresponding documented playlist import path; no output is falsely labeled as another app’s native backup.
- The previously referenced Vercel URL is currently unavailable with `DEPLOYMENT_NOT_FOUND`; local validation does not make that public deployment live.
- Compatibility depends on the schema contained in each backup; unsupported or malformed inputs are shown before processing.
- Bloomee portable legacy JSON is supported, but native Bloomee `.isar` snapshots are not directly imported by the static browser app.
- A restore operation is ultimately controlled by the destination app. Always retain original backups and test generated outputs cautiously.

## License

The package metadata declares the project under the [MIT License](https://opensource.org/license/mit). Add a standalone `LICENSE` file before redistributing the project if you require the license text to accompany every copy.

## References

[1]: https://vite.dev/guide/ "Vite Guide"
[2]: https://vercel.com/docs/frameworks/frontend/vite "Deploying Vite with Vercel"
[3]: https://github.com/theneotic/universal-backup-merger-web "Universal Backup Merger repository"
