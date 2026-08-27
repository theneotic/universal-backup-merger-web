# Safe Bidirectional Compatibility Model

VibeBridge treats an app-native backup as an application-owned database, not as a generic interchange format. A conversion route is enabled only when the receiving app documents a portable import mechanism or when this project has validated the receiver’s payload contract. The tool never relabels a source database as a backup for another app.

| Destination | Safe output route | Supported sources | Status |
| --- | --- | --- | --- |
| Metrolist | Native merged `.backup` with a user-supplied Metrolist target | ArchiveTune, OuterTune, EchoMusic, SimpMusic, RiPlay, Bloomee legacy JSON | Existing primary route |
| Metrolist | One-playlist-per-file CSV package containing title, artist, album, duration, and source URL | Every readable supported source | Implement now |
| Echo Music | One-playlist-per-file CSV package and M3U package | Every readable supported source | Implement now |
| Bloomee | Validated legacy-v2 `.blm` JSON | ArchiveTune and Metrolist | Implemented dedicated and Bloomee bridge routes |
| SimpMusic | Official SimpMusic browser converter | ArchiveTune, OuterTune, and Metrolist | Link and instructions only; do not recreate an undocumented payload |
| OuterTune | No generated native backup | None | Explicitly unavailable because cross-fork backup restore is not supported |
| ArchiveTune | One-playlist-per-file CSV or M3U package | Every readable supported source | Implemented portable route |
| ArchiveTune | Native merged `.backup` with a user-supplied ArchiveTune target | Metrolist and portable Bloomee JSON | Implemented direct target routes; preserve the selected target settings and ArchiveTune-only tables |
| RiPlay | One-playlist-per-file CSV package | Every readable supported source | Implemented portable route |

The new portable bundle model contains an ordered set of playlists and tracks. A track has a title, zero or more artist names, an optional album, duration in seconds, artwork, and an optional resolver URL. A source adapter must omit a track only when it cannot provide a title. Playlist identity is normalized independently from the source database ID so that the exported files are portable and do not accidentally claim to be native database backups.

The CSV exporter creates a ZIP containing one UTF-8 CSV per playlist. Every CSV has a stable header: `title,artist,album,duration_seconds,source_url`. The M3U exporter creates a ZIP containing one Extended M3U playlist per playlist. Its `#EXTINF` line uses duration and `artist - title`; the next line is a resolver URL when known, otherwise a conservative `#NOURL:` marker. These outputs preserve playlist boundaries and ordering, while acknowledging that a destination may need to search its own catalog to resolve a track.

## Evidence and restrictions

Metrolist’s CSV import searches by title and artist, so a title-and-artist playlist export is appropriate rather than a generated raw database.[1] Echo Music’s current source exposes explicit CSV and M3U playlist import paths in its Backup and Restore screen.[2] ArchiveTune documents improved reviewed imports for both CSV and M3U playlists, while RiPlay documents a CSV source-matching playlist importer.[3] [4] SimpMusic documents that it only accepts an import file created by its own converter, and rejects arbitrary raw backups and hand-authored CSV files.[5] OuterTune’s project has stated that it does not support backups from InnerTune forks, with a warning that incompatible database columns can cause restoration failures.[6]

The Bloomee routes use the validated `legacy-v2-full` portable structure: `_meta`, `playlists`, and `media_items`. A playlist supplies `playlistName` and `createdAt`; a media item supplies `mediaID`, `title`, `artist`, `album`, `artURL`, `duration`, `permaURL`, and `mediaInPlaylists`. Both ArchiveTune and Metrolist exporters translate playlist-backed music IDs into Bloomee’s YouTube Music resolver namespace, namespace non-system playlist names by source app, remove case-insensitive name duplicates, and deduplicate memberships. Native Bloomee Isar/MDBX snapshots are not a portable interchange format and remain unavailable in the browser-only runtime.

The Metrolist-to-ArchiveTune route is also deliberately narrow. It requires the user to supply an existing ArchiveTune backup as the target, merges only matching columns from the shared library tables with duplicate-safe inserts, preserves ArchiveTune’s `settings.xml`, leaves ArchiveTune-only tables intact, omits generated primary-key values for membership and event rows, and verifies SQLite integrity before download. It does not fabricate an ArchiveTune database from scratch.

The Bloomee-to-ArchiveTune bridge follows the same target-aware rule. It accepts only a portable Bloomee JSON, `.blm`, or ZIP containing that validated JSON, then maps the data into the supplied ArchiveTune target’s music tables. It neither opens nor generates a native `.isar` snapshot.

## References

[1] [Metrolist CSV import discussion](https://github.com/MetrolistGroup/Metrolist/issues/2759)

[2] [Echo Music BackupRestoreViewModel](https://github.com/EchoMusicApp/Echo-Music/blob/main/app/src/main/kotlin/com/music/echo/viewmodels/BackupRestoreViewModel.kt)

[3] [ArchiveTune releases](https://github.com/rukamori/ArchiveTune/releases)

[4] [RiPlay releases](https://github.com/fast4x/RiPlay/releases)

[5] [SimpMusic Import playlists documentation](https://www.simpmusic.org/docs/guide/import-playlists)

[6] [OuterTune backup compatibility discussion](https://github.com/OuterTune/OuterTune/issues/682)
