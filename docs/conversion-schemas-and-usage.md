# Conversion Schemas and Usage Guide

## Purpose and safety boundary

Universal Backup Merger is a **browser-first, source-only conversion tool** for supported music-library backups. Selected files are opened locally in the browser with `sql.js` and JSZip; the application does not upload a backup to a conversion server. A route is available only when it either merges into a user-supplied destination backup with a validated compatible SQLite schema, or emits a documented portable import format. It never disguises one application’s raw database as another application’s native backup.

> **Keep every original backup.** A generated file is an additional restore candidate, not a replacement for the original. Restore it in the destination app only after checking its contents and test it before deleting or overwriting a library.

| Class | Output | When it is safe | Examples |
| --- | --- | --- | --- |
| Direct target merge | Destination app’s `.backup` ZIP with its `song.db` updated | The user supplies an existing destination backup and the shared SQLite tables are compatible | ArchiveTune → Metrolist; Metrolist → ArchiveTune |
| Portable playlist package | ZIP containing one CSV or Extended M3U file per playlist | The destination documents a playlist importer for that portable format | Metrolist, Echo Music, ArchiveTune, and RiPlay |
| Validated app-specific portable export | A destination-specific portable payload, not a raw database | The destination’s payload contract is known and tested | ArchiveTune → Bloomee legacy-v2 `.blm` |
| Safety block | No generated native backup | The destination’s native backup format or cross-fork restore behavior is not a safe documented interchange path | Native Bloomee Isar/MDBX; OuterTune cross-fork backup restoration; arbitrary SimpMusic JSON/CSV |

## Accepted input containers and detection

The browser accepts `.backup`, `.zip`, `.db`, `.json`, `.blm`, and `.isar` filenames. A raw SQLite input is recognized only if its first bytes contain the SQLite signature `SQLite format 3\0`. ZIP inputs are scanned for a SQLite payload, with `song.db` preferred when several entries exist. The tool also retains a destination settings entry when it is named `settings.preferences_pb` or `settings.xml`.

| Detected source | Expected readable payload | Main merge treatment | Important limit |
| --- | --- | --- | --- |
| Metrolist | SQLite `song.db` in a `.backup`/ZIP or raw SQLite | Main target, or source for the ArchiveTune-target route | Exactly one Metrolist target is required for the main merge screen |
| ArchiveTune | SQLite `song.db` in a `.backup`/ZIP or raw SQLite | Main source, Bloomee export source, or direct target for Metrolist transfer | Direct ArchiveTune output requires an existing ArchiveTune target backup |
| OuterTune | Compatible SQLite library | Direct shared-table copy into a Metrolist target | The app does not create an OuterTune native backup from other forks |
| Echo Music / SimpMusic | SQLite library including their music tables | Field-mapped into a Metrolist target | Native database generation is not offered |
| RiPlay | Raw SQLite library with its PascalCase/compatibility tables | Field-mapped into a Metrolist target | Native RiPlay backup generation is not offered |
| Bloomee portable export | JSON or `.blm` object with `playlists` and `media_items` arrays | Mapped into a Metrolist target, or made portable for supported destinations | Must be a legacy portable export, not an Isar snapshot |
| Bloomee native snapshot | `.isar` or ZIP containing `.isar` | Explicitly identified but not decoded | Native Isar/MDBX is not browser-safe in this implementation |

An all-`0xFF` Isar payload is reported as **empty**, not as a valid library. A non-empty native Isar snapshot is still not opened or converted unless a browser-safe decoder and a real-device validation path are available.

## Shared direct-merge schema

The validated direct SQLite path starts from an existing target database and inserts compatible data with `INSERT OR IGNORE`. Before inserting, the merger finds matching table and column names case-insensitively and only copies the column intersection. This protects destination-only columns and avoids fabricating unknown required fields.

| Shared table | Meaning | Merge behavior |
| --- | --- | --- |
| `artist` | Artist identities and names | Insert compatible columns; duplicate keys are ignored |
| `album` | Album metadata | Insert compatible columns; duplicate keys are ignored |
| `song` | Core track records | Insert compatible columns; existing target songs remain authoritative |
| `format` | Source media format metadata | Direct-copy only when present in both schemas |
| `playlist` | Playlist identities and metadata | Insert compatible columns; preserve target playlists |
| `album_artist_map` | Album-to-artist links | Direct-copy compatible relationships |
| `song_album_map` | Song-to-album links | Direct-copy compatible relationships |
| `song_artist_map` | Song-to-artist links | Direct-copy compatible relationships |
| `set_video_id` | Video/alternate resolver relationships | Direct-copy compatible values |
| `playCount` | Playback-count records | Direct-copy compatible values |
| `lyrics` | Lyric records | Direct-copy compatible values; reported as `lyrics` |
| `event` | Playback/event records | Copy matching fields, excluding a generated primary key |
| `search_history` | Search history | Copy matching fields, excluding a generated primary key |
| `related_song_map` | Related-track links | Copy matching fields, excluding a generated primary key |
| `playlist_song_map` | Playlist membership and ordering | Copy matching fields, excluding a generated primary key |

Generated `id` fields are deliberately omitted for `playlist_song_map`, `event`, `search_history`, and `related_song_map`. Their destination database assigns its own row IDs, preventing a source primary-key collision from corrupting a valid target relationship table.

The main screen reports additions under the fixed labels **songs**, **artists**, **albums**, **playlists**, **lyrics**, and **events**. Its visible workflow stages remain **uploading**, **detecting**, **merging**, and **validating**.

## Direct bidirectional routes

### ArchiveTune into Metrolist

1. Open the main **Merge** screen.
2. Upload one Metrolist `.backup` as the target and one ArchiveTune `.backup`, `.zip`, or `.db` as the source.
3. Confirm the detection preview names the Metrolist target and ArchiveTune source.
4. Choose **Merge backups**, wait for validation, then select **Download merged backup**.
5. Restore the downloaded file through Metrolist’s own restore interface.

The main merger writes the merged target database to `song.db` and carries forward the target settings entry if present. The browser-level reverse test used supplied private samples and confirmed a non-empty downloaded backup, `PRAGMA integrity_check = ok`, preserved Metrolist settings, a 32,608-song output library, and zero missing ArchiveTune source song IDs.

### Metrolist into ArchiveTune

1. Open **Metrolist → ArchiveTune**.
2. Select a Metrolist `.backup` as the source.
3. Select an existing ArchiveTune `.backup`, `.zip`, or `.db` as the target.
4. Choose **Create ArchiveTune backup**, then download the validated output.
5. Restore it with ArchiveTune’s normal backup-and-restore feature.

This route requires the ArchiveTune target so it can preserve `settings.xml`, target-only tables, and the current destination schema. It does not generate an ArchiveTune backup from scratch. The supplied private browser test confirmed SQLite integrity, target-settings preservation, 32,607 transferred Metrolist song IDs with zero missing IDs, and 5,807 retained playlist-membership tuples.

## Source-specific mappings into a Metrolist target

### Direct compatible SQLite sources

ArchiveTune and compatible OuterTune schema variants use the shared direct-table model described above. Tables are copied only when both source and target contain a compatible table and column set. A failed optional table is added to the `skippedTables` report rather than causing the whole library output to be claimed as complete.

### Echo Music and SimpMusic family mapping

When their recognizable tables are present, the adapter reads `song`, `artist`, `album`, `local_playlist`, `pair_song_local_playlist`, `lyrics`, and `playback_event`. Songs map from fields such as `id`, `title`, duration, artwork, album data, explicit flags, favorites, library membership, and download status. The adapter namespaces each local playlist ID using the source application and filename, then writes membership rows using the corresponding source song IDs and positions. Lyric lines and playback events are normalized into the Metrolist `lyrics` and `event` tables where supported.

### RiPlay mapping

The RiPlay adapter recognizes `song`, `artist`, `album`, `playlist`, `songartistmap`, `songalbummap`, `songplaylistmap`, `lyrics`, and `event`. It namespaces playlist IDs as `riplay:<source filename>:<source playlist id>` so the source’s numeric/local IDs cannot collide with the Metrolist target. Artist, album, and playlist relation rows retain their source song IDs and use safe defaults for optional positions or video IDs.

### Bloomee legacy portable JSON mapping

A supported Bloomee portable payload must have `playlists` and `media_items` arrays. Each media item contributes a source `mediaID`, title, artist list, optional album/artwork/duration, and playlist memberships. The adapter generates a `bloomee:<source filename>:` namespace for synthetic playlist and album IDs, then inserts portable rows into Metrolist songs, artists, albums, `song_artist_map`, `song_album_map`, and `playlist_song_map` tables. A Bloomee native Isar/MDBX snapshot is intentionally outside this contract.

## Portable playlist schema

The **Portable exports** page first reduces each readable source to this canonical in-browser model:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| Playlist `name` | string | Yes | Display name used for the exported filename and destination import |
| Track `title` | string | Yes | Track label used by CSV importers or Extended M3U metadata |
| Track `artists` | string array | No | Ordered artist names; CSV joins them with `; ` |
| Track `album` | string | No | Album label |
| Track `durationSeconds` | number | No | Duration in seconds when the source provides it |
| Track `artwork` | string | No | Preserved in the internal model, not required by CSV/M3U export |
| Track `sourceUrl` | string | No | Resolver/media URL when the source provides it |

A track without a title is skipped because no listed destination can reliably resolve it. Playlist order and track order are preserved where the source relationship table exposes a position.

### CSV package

The CSV route produces a ZIP of UTF-8 files, one file per playlist. Each file begins exactly with:

```csv
title,artist,album,duration_seconds,source_url
```

Artists are separated by `; ` inside the `artist` value, while standard CSV escaping protects commas, quotes, and line breaks. The ZIP also includes a `README.txt` with source filename, detected source application, chosen format, and playlist/file counts.

### Extended M3U package

The M3U route produces a ZIP of one `.m3u` file per playlist. Each track writes an `#EXTINF` line containing its duration and `artist - title`, followed by its resolver URL. If no URL is known, the exporter writes a `#NOURL:` marker rather than inventing a fake media location. Destination applications may need a catalog lookup to resolve that marker.

| Destination | Offered portable package | Use it by |
| --- | --- | --- |
| Metrolist | CSV | Extract the ZIP, then import each CSV through Metrolist’s playlist CSV importer |
| Echo Music | CSV or M3U | Extract the ZIP, then select Echo Music’s matching importer |
| ArchiveTune | CSV or M3U | Extract the ZIP, then use ArchiveTune’s playlist importer |
| RiPlay | CSV | Extract the ZIP, then use RiPlay’s source-matching CSV playlist importer |

The portable package is not a native app backup. It preserves playlist boundaries and searchable metadata, but artwork, listening history, downloads, app settings, and unresolved tracks depend on the destination app.

## ArchiveTune to Bloomee `.blm`

The dedicated ArchiveTune → Bloomee page reads an ArchiveTune source and produces a legacy-v2 JSON payload with the `.blm` filename. It emits a `playlists` collection and a `media_items` collection, maps supported YouTube Music IDs into Bloomee’s resolver scope, namespaces playlist names as `ArchiveTune · <name>`, removes case-insensitive playlist-name collisions, excludes Bloomee system aliases, and deduplicates playlist memberships. These measures address the known case-insensitive unique playlist-name constraint in legacy Bloomee restore logic.

Use the resulting file only through Bloomee’s **Settings → Storage → Backup & Restore → Restore Backup** workflow, with **Media items** enabled. Device restoration remains the final authority because an existing user library can still contain conflicts that no offline export can predict.

## Unsupported or intentionally blocked directions

| Destination or input | Why the route is blocked | Safe alternative |
| --- | --- | --- |
| Native Bloomee `.isar` / MDBX | The static browser runtime cannot safely decode native Isar/MDBX bytes. Empty all-`0xFF` samples contain no records to test. | Use Bloomee’s legacy JSON/Create Backup export where available |
| OuterTune native backup | The project has warned that restores from InnerTune forks are not supported and can fail on schema differences. | Use a portable CSV/M3U package when appropriate, not a fabricated raw database |
| SimpMusic hand-authored import | SimpMusic’s documented import flow validates output from its own converter and rejects arbitrary raw backups/CSV. | Use SimpMusic’s official converter for its destination-specific output |
| Standalone ArchiveTune or Metrolist database creation | A raw generated database could omit required target-only metadata and settings. | Supply an existing destination backup as the target for the direct route |

## Validation model and troubleshooting

Every native target merge follows the same control sequence:

1. **Uploading:** files stay in the browser and are read into memory.
2. **Detecting:** the application identifies file containers, SQLite tables, target candidates, unsupported snapshots, and portable JSON.
3. **Merging:** it copies compatible columns or maps fields into a safe target schema.
4. **Validating:** it runs `PRAGMA integrity_check`; a failed integrity result blocks the download.

| Symptom | Meaning | Action |
| --- | --- | --- |
| “Add one Metrolist backup as the target” | The main screen cannot identify exactly one Metrolist target | Upload one Metrolist backup with a readable `song.db` alongside source files |
| “Select an ArchiveTune … target” | The dedicated direct route needs a real ArchiveTune destination schema | Add an existing ArchiveTune `.backup`, `.zip`, or `.db` file as target |
| Native Bloomee unsupported message | The upload is an Isar/MDBX snapshot, not a portable JSON export | Export JSON/legacy backup from Bloomee, or retain the snapshot until a safe reader is available |
| Portable import has unresolved tracks | The destination cannot resolve a title/artist or the source had no resolver URL | Use destination catalog search, correct track metadata, or retain the playlist as a portable record |
| Destination reports playlist-name conflict | Existing destination data collides with an imported name | Preserve the original target, rename conflict sources, then retry with the app’s own importer |

## Production publishing and repository policy

Run the verification commands before publishing:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
```

The static production output is `dist/public`. A static host must rewrite unknown client-side routes to `/index.html`. The project is checkpointed and source-only; no `.backup`, `.isar`, `.blm`, ZIP, SQLite database, upload, download, or conversion output may be committed. To make the updated project live, use the project UI’s **Publish** button after reviewing the latest checkpoint.

## References

1. [Metrolist CSV playlist import discussion](https://github.com/MetrolistGroup/Metrolist/issues/2759)
2. [Echo Music backup and restore implementation](https://github.com/EchoMusicApp/Echo-Music/blob/main/app/src/main/kotlin/com/music/echo/viewmodels/BackupRestoreViewModel.kt)
3. [ArchiveTune release notes](https://github.com/rukamori/ArchiveTune/releases)
4. [RiPlay release notes](https://github.com/fast4x/RiPlay/releases)
5. [SimpMusic playlist-import documentation](https://www.simpmusic.org/docs/guide/import-playlists)
6. [OuterTune cross-fork backup compatibility discussion](https://github.com/OuterTune/OuterTune/issues/682)
