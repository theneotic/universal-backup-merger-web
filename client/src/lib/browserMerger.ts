import JSZip from "jszip";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqliteWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export type DetectedBackup = {
  name: string;
  role: "target" | "source" | "unsupported";
  confidence: "high" | "medium" | "unsupported";
  tables: number;
  application: string;
  detail?: string;
};
export type MergeCounts = Record<"songs" | "artists" | "albums" | "playlists" | "lyrics" | "events", number>;
export type MergeReport = { counts: MergeCounts; skippedTables: string[]; targetFileName: string; sourceFileNames: string[] };
export type BrowserMerge = { report: MergeReport; output: Blob };
export type BloomeeExportReport = { sourceFileName: string; playlists: number; mediaItems: number; skippedTracks: number };
export type BrowserBloomeeExport = { report: BloomeeExportReport; output: Blob };
export type PortablePlaylistFormat = "csv" | "m3u";
export type PortablePlaylistTrack = { title: string; artists: string[]; album?: string; durationSeconds?: number; artwork?: string; sourceUrl?: string };
export type PortablePlaylist = { name: string; tracks: PortablePlaylistTrack[] };
export type PortablePlaylistExportReport = { sourceFileName: string; sourceApplication: string; format: PortablePlaylistFormat; playlists: number; tracks: number; skippedTracks: number };
export type BrowserPortablePlaylistExport = { report: PortablePlaylistExportReport; output: Blob };
export const supportedApplicationNames = ["Metrolist", "ArchiveTune", "OuterTune", "EchoMusic", "SimpMusic", "RiPlay", "Bloomee JSON export"] as const;
export const unsupportedContainerNotes = { Bloomee: "Bloomee .isar snapshots use a native Isar/MDBX format that this static browser tool cannot decode safely. In Bloomee, choose Create Backup (JSON), then upload that JSON export instead." } as const;

type Row = Record<string, unknown>;
export type BloomeePortableBackup = { playlists: Row[]; mediaItems: Row[] };
type Extracted = { name: string; app: string; dbBytes?: Uint8Array; settings?: Uint8Array; settingsName?: string; tables: string[]; score: number; bloomee?: BloomeePortableBackup; unsupported?: string };
type Stage = "detecting" | "merging" | "validating";

const SQLITE_HEADER = "SQLite format 3\u0000";
const DIRECT_TABLES = ["artist", "album", "song", "format", "playlist", "album_artist_map", "song_album_map", "song_artist_map", "set_video_id", "playCount", "lyrics", "event", "search_history", "related_song_map", "playlist_song_map"];
const COUNT_LABEL: Record<string, keyof MergeCounts> = { song: "songs", artist: "artists", album: "albums", playlist: "playlists", lyrics: "lyrics", event: "events" };
let sqlPromise: Promise<SqlJsStatic> | null = null;
let SQL: SqlJsStatic | null = null;

function sql() { sqlPromise ??= initSqlJs({ locateFile: file => file.endsWith(".wasm") ? sqliteWasmUrl : file }); return sqlPromise; }
function quote(name: string) { return `"${name.replaceAll('"', '""')}"`; }
function normalize(name: string) { return name.toLowerCase(); }
function hasTable(db: Database, table: string) { return tableNames(db).some(name => normalize(name) === normalize(table)); }
function actualTable(tables: string[], name: string) { return tables.find(table => normalize(table) === normalize(name)); }
function tableNames(db: Database) { return db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map(row => String(row[0])) ?? []; }
function columns(db: Database, table: string) { return db.exec(`PRAGMA table_info(${quote(table)})`)[0]?.values.map(row => String(row[1])) ?? []; }
function scalar(db: Database, statement: string) { return db.exec(statement)[0]?.values[0]?.[0] as string | number | undefined; }
function number(value: unknown, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function text(value: unknown) { return value == null ? null : String(value); }
function bool(value: unknown) { return value === true || value === 1 || value === "1" ? 1 : 0; }
function timestamp(value: unknown) { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; } return Date.now(); }
function rows(db: Database, table: string): Row[] { const result = db.exec(`SELECT * FROM ${quote(table)}`)[0]; return result ? result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) : []; }
function objects(value: unknown): Row[] { if (!Array.isArray(value)) return []; return value.flatMap(item => { if (item && typeof item === "object" && !Array.isArray(item)) return [item as Row]; if (typeof item !== "string") return []; try { const decoded = JSON.parse(item); return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? [decoded as Row] : []; } catch { return []; } }); }
function isBlank(bytes: Uint8Array) { return bytes.length > 0 && bytes.every(byte => byte === 0xff); }

export function parseBloomeePortableBackup(value: unknown): BloomeePortableBackup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Row;
  if (!Array.isArray(payload.playlists) || !Array.isArray(payload.media_items)) return null;
  return { playlists: objects(payload.playlists), mediaItems: objects(payload.media_items) };
}

function parseBloomeeBytes(bytes: Uint8Array) { try { return parseBloomeePortableBackup(JSON.parse(new TextDecoder().decode(bytes))); } catch { return null; } }
export function inspectBloomeeNativeSnapshot(bytes: Uint8Array) { return { empty: isBlank(bytes), detail: isBlank(bytes) ? "Bloomee Isar snapshot is empty and contains no recoverable records." : unsupportedContainerNotes.Bloomee }; }
function bloomeeIsarDetail(bytes?: Uint8Array) { return bytes ? inspectBloomeeNativeSnapshot(bytes).detail : unsupportedContainerNotes.Bloomee; }

function appName(name: string, tables: string[]) {
  const file = name.toLowerCase();
  if (file.includes("metrolist")) return "Metrolist";
  if (file.includes("archivetune")) return "ArchiveTune";
  if (file.includes("outertune")) return "OuterTune";
  if (file.includes("echo")) return "EchoMusic";
  if (file.includes("simpmusic")) return "SimpMusic";
  if (file.includes("riplay") || (tables.includes("Song") && tables.includes("Artist"))) return "RiPlay";
  return "Compatible SQLite backup";
}

function inspectSqlite(name: string, bytes: Uint8Array, settings?: Uint8Array, settingsName?: string): Extracted {
  if (!SQL) throw new Error("detecting: SQLite processing is not ready.");
  const db = new SQL.Database(bytes);
  try {
    const tables = tableNames(db);
    const songTable = actualTable(tables, "song");
    const songColumns = new Set(songTable ? columns(db, songTable) : []);
    const app = appName(name, tables);
    const markers = ["libraryAddToken", "lyricsOffset", "isUploaded", "isVideo"].filter(column => songColumns.has(column)).length;
    let score = app === "Metrolist" ? 80 : 0;
    if (tables.includes("speed_dial_item")) score += 35;
    if (markers >= 3) score += 45;
    if (settings && (app === "Metrolist" || markers >= 3)) score += 15;
    return { name, app, dbBytes: bytes, settings, settingsName, tables, score };
  } finally { db.close(); }
}

async function extract(file: File, index: number): Promise<Extracted> {
  if (!/\.(backup|zip|db|isar|json|blm)$/i.test(file.name)) throw new Error(`uploading: ${file.name} is not a .backup, .zip, .db, .isar, or Bloomee JSON file.`);
  const raw = new Uint8Array(await file.arrayBuffer());
  const name = file.name || `backup-${index + 1}`;
  if (new TextDecoder().decode(raw.slice(0, 16)) === SQLITE_HEADER) return inspectSqlite(name, raw);
  const bloomee = parseBloomeeBytes(raw);
  if (bloomee) return { name, app: "Bloomee", tables: ["playlists", "media_items"], score: 0, bloomee };
  if (/\.isar$/i.test(name)) return { name, app: "Bloomee", tables: [], score: 0, unsupported: bloomeeIsarDetail(raw) };
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(raw); } catch { throw new Error(`detecting: ${name} is not a readable backup archive or SQLite database.`); }
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  let dbBytes: Uint8Array | undefined;
  let isarBytes: Uint8Array | undefined;
  for (const entry of entries.sort((a, b) => (/song\.db$/i.test(a.name) ? -1 : 0) - (/song\.db$/i.test(b.name) ? -1 : 0))) {
    const bytes = await entry.async("uint8array");
    if (new TextDecoder().decode(bytes.slice(0, 16)) === SQLITE_HEADER) { dbBytes = bytes; break; }
    if (/\.isar$/i.test(entry.name)) isarBytes = bytes;
  }
  if (!dbBytes) {
    for (const entry of entries) {
      if (!/\.(json|blm)$/i.test(entry.name)) continue;
      const portable = parseBloomeeBytes(await entry.async("uint8array"));
      if (portable) return { name, app: "Bloomee", tables: ["playlists", "media_items"], score: 0, bloomee: portable };
    }
    return { name, app: isarBytes ? "Bloomee" : "Unknown backup", tables: [], score: 0, unsupported: isarBytes ? bloomeeIsarDetail(isarBytes) : "No SQLite database or Bloomee JSON export was found in this archive." };
  }
  const settings = entries.find(entry => /^(settings\.preferences_pb|settings\.xml)$/i.test(entry.name.split("/").pop() ?? ""));
  return inspectSqlite(name, dbBytes, settings ? await settings.async("uint8array") : undefined, settings?.name.split("/").pop());
}

async function extractAll(files: File[]) { SQL = await sql(); return Promise.all(files.map(extract)); }
function chooseTarget(backups: Extracted[]) {
  const candidates = backups.filter(backup => !backup.unsupported).sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target || target.score < 80) throw new Error("detecting: a Metrolist backup could not be identified. Add one Metrolist backup as the target.");
  if (candidates[1]?.score === target.score && target.score >= 80) throw new Error("detecting: more than one Metrolist backup was detected. Upload one target backup only.");
  return { target, sources: candidates.filter(backup => backup !== target), unsupported: backups.filter(backup => backup.unsupported) };
}

export async function inspectBackups(files: File[]): Promise<DetectedBackup[]> {
  if (files.length < 2) throw new Error("uploading: Upload one Metrolist backup and at least one source backup.");
  const backups = await extractAll(files);
  const { target } = chooseTarget(backups);
  return backups.map(backup => ({ name: backup.name, role: backup.unsupported ? "unsupported" : backup === target ? "target" : "source", confidence: backup.unsupported ? "unsupported" : backup === target ? "high" : "medium", tables: backup.tables.length, application: backup.app, detail: backup.unsupported }));
}

function insert(target: Database, table: string, data: Row) {
  if (!hasTable(target, table)) return false;
  const allowed = new Set(columns(target, actualTable(tableNames(target), table) ?? table));
  const entries = Object.entries(data).filter(([key]) => allowed.has(key));
  if (!entries.length) return false;
  const statement = target.prepare(`INSERT OR IGNORE INTO ${quote(table)} (${entries.map(([key]) => quote(key)).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`);
  try { statement.run(entries.map(([, value]) => value ?? null) as Array<string | number | Uint8Array | null>); return true; } finally { statement.free(); }
}

function count(target: Database, table: string) { return number(scalar(target, `SELECT count(*) FROM ${quote(table)}`)); }
function counted(target: Database, table: string, key: keyof MergeCounts, report: MergeReport, operation: () => void) { const before = count(target, table); operation(); report.counts[key] += Math.max(0, count(target, table) - before); }
function array(value: unknown): string[] { if (Array.isArray(value)) return value.map(String); if (typeof value !== "string") return value == null ? [] : [String(value)]; try { const decoded = JSON.parse(value); return Array.isArray(decoded) ? decoded.map(String) : [value]; } catch { return [value]; } }
function lyrics(value: unknown) { const raw = text(value); if (!raw) return ""; try { const decoded = JSON.parse(raw); if (Array.isArray(decoded)) return decoded.map(item => typeof item === "object" && item ? String((item as Row).words ?? "") : String(item)).filter(Boolean).join("\n"); } catch { /* retains raw */ } return raw; }

function addSong(target: Database, source: Row, report: MergeReport) {
  const id = text(source.id ?? source.videoId ?? source.mediaID); if (!id) return;
  counted(target, "song", "songs", report, () => insert(target, "song", { id, title: text(source.title) ?? id, duration: number(source.duration ?? source.durationSeconds), thumbnailUrl: text(source.thumbnailUrl ?? source.thumbnails ?? source.artURL), albumId: text(source.albumId), albumName: text(source.albumName ?? source.album), explicit: bool(source.explicit ?? source.isExplicit), year: source.year ?? null, date: source.date ?? null, dateModified: source.dateModified ?? null, liked: bool(source.liked ?? source.likedAt), likedDate: source.likedDate ?? source.likedAt ?? source.favoriteAt ?? null, totalPlayTime: number(source.totalPlayTime ?? source.totalPlayTimeMs), inLibrary: source.inLibrary ?? source.favoriteAt ?? null, dateDownload: source.dateDownload ?? source.downloadedAt ?? null, isLocal: bool(source.isLocal) }));
}
function addArtist(target: Database, source: Row, report: MergeReport) { const id = text(source.id ?? source.channelId); if (!id) return; counted(target, "artist", "artists", report, () => insert(target, "artist", { id, name: text(source.name) ?? id, thumbnailUrl: text(source.thumbnailUrl ?? source.thumbnails ?? source.artURL), channelId: text(source.channelId ?? source.id), lastUpdateTime: timestamp(source.lastUpdateTime ?? source.timestamp ?? source.createdAt), bookmarkedAt: source.bookmarkedAt ?? source.followedAt ?? null, isLocal: 0 })); }
function addAlbum(target: Database, source: Row, report: MergeReport) { const id = text(source.id ?? source.browseId); if (!id) return; counted(target, "album", "albums", report, () => insert(target, "album", { id, playlistId: text(source.playlistId ?? source.audioPlaylistId), title: text(source.title) ?? id, year: source.year ?? null, thumbnailUrl: text(source.thumbnailUrl ?? source.thumbnails ?? source.artURL), songCount: number(source.songCount ?? source.trackCount), duration: number(source.durationSeconds ?? source.duration), explicit: bool(source.explicit), lastUpdateTime: timestamp(source.lastUpdateTime ?? source.createdAt), bookmarkedAt: source.bookmarkedAt ?? source.favoriteAt ?? null, inLibrary: source.inLibrary ?? null, isLocal: 0 })); }
function addPlaylist(target: Database, source: Row, mappedId: string, report: MergeReport) { counted(target, "playlist", "playlists", report, () => insert(target, "playlist", { id: mappedId, name: text(source.name ?? source.title) ?? mappedId, browseId: text(source.browseId ?? source.youtubePlaylistId), createdAt: source.createdAt ?? source.inLibrary ?? Date.now(), lastUpdateTime: source.lastUpdateTime ?? source.inLibrary ?? Date.now(), isEditable: bool(source.isEditable ?? 1), bookmarkedAt: source.bookmarkedAt ?? source.inLibrary ?? null, thumbnailUrl: text(source.thumbnailUrl ?? source.thumbnail), remoteSongCount: number(source.remoteSongCount ?? source.trackCount), isLocal: 1 })); }
function addLyrics(target: Database, idValue: unknown, value: unknown, provider: string, report: MergeReport) { const id = text(idValue); const body = lyrics(value); if (!id || !body) return; counted(target, "lyrics", "lyrics", report, () => insert(target, "lyrics", { id, lyrics: body, provider, translatedLyrics: "", translationLanguage: "", translationMode: "" })); }
function addEvent(target: Database, source: Row, report: MergeReport) { const songId = text(source.songId ?? source.videoId); if (!songId) return; counted(target, "event", "events", report, () => target.run("INSERT INTO event (songId, timestamp, playTime) VALUES (?, ?, ?)", [songId, number(source.timestamp), number(source.playTime ?? source.listenedSecond) * (source.listenedSecond != null ? 1000 : 1)])); }

function directMerge(target: Database, sourceDb: Database, source: Extracted, report: MergeReport) {
  for (const wanted of DIRECT_TABLES) {
    const sourceTable = actualTable(source.tables, wanted); const targetTable = actualTable(tableNames(target), wanted);
    if (!sourceTable || !targetTable) continue;
    const targetByLower = new Map(columns(target, targetTable).map(column => [normalize(column), column]));
    const sourceColumns = columns(sourceDb, sourceTable);
    const generatedIdTables = new Set(["playlist_song_map", "event", "search_history", "related_song_map"]);
    const common = sourceColumns.filter(column => targetByLower.has(normalize(column)) && !(generatedIdTables.has(wanted) && normalize(column) === "id"));
    if (!common.length) continue;
    const key = COUNT_LABEL[wanted]; const before = key ? count(target, wanted) : 0;
    try { rows(sourceDb, sourceTable).forEach(row => insert(target, wanted, Object.fromEntries(common.map(column => [targetByLower.get(normalize(column))!, row[column]])))); } catch { if (!report.skippedTables.includes(`${source.app}: ${wanted}`)) report.skippedTables.push(`${source.app}: ${wanted}`); }
    if (key) report.counts[key] += Math.max(0, count(target, wanted) - before);
  }
}

export function mergeMetrolistIntoArchiveTuneDatabase(targetDb: Database, sourceDb: Database, targetFileName = "ArchiveTune.backup", sourceFileName = "Metrolist.backup"): MergeReport {
  const sourceTables = tableNames(sourceDb);
  const targetTables = tableNames(targetDb);
  if (!actualTable(sourceTables, "song") || !actualTable(sourceTables, "playlist") || !actualTable(sourceTables, "playlist_song_map")) throw new Error("detecting: The Metrolist source is missing readable songs or playlist records.");
  if (!actualTable(targetTables, "song") || !actualTable(targetTables, "playlist") || !actualTable(targetTables, "playlist_song_map")) throw new Error("detecting: The ArchiveTune target is missing its required music-library tables.");
  const report: MergeReport = { counts: { songs: 0, artists: 0, albums: 0, playlists: 0, lyrics: 0, events: 0 }, skippedTables: [], targetFileName, sourceFileNames: [sourceFileName] };
  directMerge(targetDb, sourceDb, { name: sourceFileName, app: "Metrolist", tables: sourceTables, score: 80 }, report);
  if (scalar(targetDb, "PRAGMA integrity_check") !== "ok") throw new Error("validating: ArchiveTune target integrity check failed after merging Metrolist data.");
  return report;
}

function mergeEchoFamily(target: Database, sourceDb: Database, source: Extracted, report: MergeReport) {
  const songTable = actualTable(source.tables, "song"); if (songTable) rows(sourceDb, songTable).forEach(song => { addSong(target, song, report); array(song.artistId).forEach((id, index) => addArtist(target, { id, name: array(song.artistName)[index] ?? array(song.artistName)[0] ?? id }, report)); });
  const artistTable = actualTable(source.tables, "artist"); if (artistTable) rows(sourceDb, artistTable).forEach(row => addArtist(target, row, report));
  const albumTable = actualTable(source.tables, "album"); if (albumTable) rows(sourceDb, albumTable).forEach(row => addAlbum(target, row, report));
  const local = actualTable(source.tables, "local_playlist"); const playlists = new Map<string, string>();
  if (local) rows(sourceDb, local).forEach(row => { const original = String(row.id); const id = `${source.app.toLowerCase()}:${source.name}:${original}`; playlists.set(original, id); addPlaylist(target, row, id, report); });
  const pairs = actualTable(source.tables, "pair_song_local_playlist"); if (pairs) rows(sourceDb, pairs).forEach(row => { const playlistId = playlists.get(String(row.playlistId)); if (playlistId && row.songId) insert(target, "playlist_song_map", { playlistId, songId: row.songId, position: number(row.position), setVideoId: null }); });
  const lyricTable = actualTable(source.tables, "lyrics"); if (lyricTable) rows(sourceDb, lyricTable).forEach(row => addLyrics(target, row.videoId, row.lines, source.app, report));
  const eventTable = actualTable(source.tables, "playback_event"); if (eventTable) rows(sourceDb, eventTable).forEach(row => addEvent(target, row, report));
}

function mergeRiPlay(target: Database, sourceDb: Database, source: Extracted, report: MergeReport) {
  const songs = actualTable(source.tables, "song"); if (songs) rows(sourceDb, songs).forEach(row => addSong(target, row, report));
  const artists = actualTable(source.tables, "artist"); if (artists) rows(sourceDb, artists).forEach(row => addArtist(target, row, report));
  const albums = actualTable(source.tables, "album"); if (albums) rows(sourceDb, albums).forEach(row => addAlbum(target, row, report));
  const playlists = new Map<string, string>(); const playlistTable = actualTable(source.tables, "playlist");
  if (playlistTable) rows(sourceDb, playlistTable).forEach(row => { const id = `riplay:${source.name}:${String(row.id)}`; playlists.set(String(row.id), id); addPlaylist(target, row, id, report); });
  const songArtist = actualTable(source.tables, "songartistmap"); if (songArtist) rows(sourceDb, songArtist).forEach(row => insert(target, "song_artist_map", { songId: row.songId, artistId: row.artistId, position: 0 }));
  const songAlbum = actualTable(source.tables, "songalbummap"); if (songAlbum) rows(sourceDb, songAlbum).forEach(row => insert(target, "song_album_map", { songId: row.songId, albumId: row.albumId, index: row.position ?? 0 }));
  const songPlaylist = actualTable(source.tables, "songplaylistmap"); if (songPlaylist) rows(sourceDb, songPlaylist).forEach(row => { const playlistId = playlists.get(String(row.playlistId)); if (playlistId) insert(target, "playlist_song_map", { playlistId, songId: row.songId, position: number(row.position), setVideoId: row.setVideoId ?? null }); });
  const lyricTable = actualTable(source.tables, "lyrics"); if (lyricTable) rows(sourceDb, lyricTable).forEach(row => addLyrics(target, row.songId, row.synced ?? row.fixed ?? row.lrcSynced, "RiPlay", report));
  const eventTable = actualTable(source.tables, "event"); if (eventTable) rows(sourceDb, eventTable).forEach(row => addEvent(target, row, report));
}

function bloomeeArtists(value: unknown) { return text(value)?.split(",").map(name => name.trim()).filter(Boolean) ?? []; }
function bloomeeMemberships(value: unknown) { return objects(value).map(item => text(item.playlistName)).filter((name): name is string => Boolean(name)); }

export function mapBloomeePortableBackup(payload: BloomeePortableBackup, sourceName: string) {
  const sourcePrefix = `bloomee:${sourceName}:`;
  const playlists = new Map<string, string>();
  const mapped = { playlists: [] as Array<{ id: string; row: Row }>, songs: [] as Row[], artists: [] as Row[], albums: [] as Row[], songArtists: [] as Row[], songAlbums: [] as Row[], playlistSongs: [] as Row[] };
  payload.playlists.forEach(row => {
    const name = text(row.playlistName); if (!name) return;
    const id = `${sourcePrefix}playlist:${encodeURIComponent(name)}`;
    playlists.set(name, id);
    mapped.playlists.push({ id, row: { ...row, id, name, createdAt: timestamp(row.createdAt), lastUpdateTime: timestamp(row.createdAt), trackCount: 0 } });
  });
  payload.mediaItems.forEach(track => {
    const id = text(track.mediaID); if (!id) return;
    const albumName = text(track.album);
    const albumId = albumName ? `${sourcePrefix}album:${encodeURIComponent(albumName)}` : null;
    if (albumName && albumId) mapped.albums.push({ id: albumId, title: albumName, artURL: track.artURL, inLibrary: timestamp(track.createdAt) });
    mapped.songs.push({ ...track, id, mediaID: id, albumId, albumName, artURL: track.artURL, duration: track.duration, isLocal: 0 });
    bloomeeArtists(track.artist).forEach((name, position) => {
      const artistId = `${sourcePrefix}artist:${encodeURIComponent(name)}`;
      mapped.artists.push({ id: artistId, name, artURL: track.artURL });
      mapped.songArtists.push({ songId: id, artistId, position });
    });
    if (albumId) mapped.songAlbums.push({ songId: id, albumId, index: 0 });
    bloomeeMemberships(track.mediaInPlaylists).forEach((playlistName, position) => {
      const playlistId = playlists.get(playlistName); if (playlistId) mapped.playlistSongs.push({ playlistId, songId: id, position, setVideoId: null });
    });
  });
  return mapped;
}

export function mergeBloomeePortableBackup(target: Database, payload: BloomeePortableBackup, sourceName: string, report: MergeReport) {
  const mapped = mapBloomeePortableBackup(payload, sourceName);
  mapped.playlists.forEach(item => addPlaylist(target, item.row, item.id, report));
  mapped.albums.forEach(row => addAlbum(target, row, report));
  mapped.songs.forEach(row => addSong(target, row, report));
  mapped.artists.forEach(row => addArtist(target, row, report));
  mapped.songArtists.forEach(row => insert(target, "song_artist_map", row));
  mapped.songAlbums.forEach(row => insert(target, "song_album_map", row));
  mapped.playlistSongs.forEach(row => insert(target, "playlist_song_map", row));
}

const BLOOMEE_SYSTEM_PLAYLISTS = new Set(["Liked", "_DOWNLOADS", "recently_played", "_LOCAL_MUSIC"]);
function bloomeePlaylistKey(name: string) { return name.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
const BLOOMEE_SYSTEM_PLAYLIST_KEYS = new Set(Array.from(BLOOMEE_SYSTEM_PLAYLISTS, bloomeePlaylistKey));
function archiveTuneBloomeeMediaId(value: unknown) {
  const raw = text(value)?.trim() ?? "";
  if (!raw) return null;
  if (raw.startsWith("content-resolver.")) return raw;
  const normalized = raw.toLowerCase().startsWith("youtube") ? raw.slice(7).trim() : raw;
  return normalized ? `content-resolver.bloomfactory.ytmusic::${normalized}` : null;
}

export function mapArchiveTuneToBloomee(sourceDb: Database, sourceFileName: string) {
  const tables = tableNames(sourceDb);
  const songTable = actualTable(tables, "song");
  const playlistTable = actualTable(tables, "playlist");
  const playlistSongTable = actualTable(tables, "playlist_song_map");
  if (!songTable || !playlistTable || !playlistSongTable) throw new Error("detecting: ArchiveTune backup is missing song, playlist, or playlist_song_map data.");

  const songs = new Map(rows(sourceDb, songTable).map(row => [String(row.id), row]));
  const artistTable = actualTable(tables, "artist");
  const artists = new Map((artistTable ? rows(sourceDb, artistTable) : []).map(row => [String(row.id), row]));
  const artistMemberships = new Map<string, Array<{ id: string; position: number }>>();
  const songArtistTable = actualTable(tables, "song_artist_map");
  if (songArtistTable) rows(sourceDb, songArtistTable).forEach(row => {
    const songId = text(row.songId); const artistId = text(row.artistId);
    if (!songId || !artistId) return;
    artistMemberships.set(songId, [...(artistMemberships.get(songId) ?? []), { id: artistId, position: number(row.position) }]);
  });

  const playlistKeysById = new Map<string, string>();
  const exportedPlaylistNames = new Map<string, string>();
  rows(sourceDb, playlistTable).forEach(row => {
    const id = text(row.id); const name = text(row.name)?.trim();
    const key = name ? bloomeePlaylistKey(name) : "";
    if (!id || !name || BLOOMEE_SYSTEM_PLAYLIST_KEYS.has(key)) return;
    playlistKeysById.set(id, key);
    if (!exportedPlaylistNames.has(key)) exportedPlaylistNames.set(key, `ArchiveTune · ${name.replace(/\s+/g, " ")}`);
  });
  const memberships = new Map<string, string[]>();
  rows(sourceDb, playlistSongTable).sort((left, right) => number(left.position) - number(right.position)).forEach(row => {
    const songId = text(row.songId); const playlistKey = text(row.playlistId) ? playlistKeysById.get(String(row.playlistId)) : null;
    const playlistName = playlistKey ? exportedPlaylistNames.get(playlistKey) : null;
    if (!songId || !playlistName) return;
    const existing = memberships.get(songId) ?? [];
    if (!existing.includes(playlistName)) memberships.set(songId, [...existing, playlistName]);
  });

  let skippedTracks = 0;
  const mediaItems: Row[] = [];
  memberships.forEach((playlistNamesForSong, songId) => {
    const song = songs.get(songId); const mediaID = archiveTuneBloomeeMediaId(songId);
    if (!song || !mediaID || !playlistNamesForSong.length) { skippedTracks++; return; }
    const artistNames = (artistMemberships.get(songId) ?? []).sort((left, right) => left.position - right.position).map(member => text(artists.get(member.id)?.name)?.trim()).filter((name): name is string => Boolean(name));
    mediaItems.push({ mediaID, title: text(song.title) ?? mediaID, artist: artistNames.join(", "), album: text(song.albumName) ?? "", artURL: text(song.thumbnailUrl) ?? "", duration: Math.max(0, number(song.duration)), permaURL: `https://music.youtube.com/watch?v=${encodeURIComponent(songId)}`, source: "youtube", mediaInPlaylists: playlistNamesForSong.map(playlistName => ({ playlistName })) });
  });
  const playlists = Array.from(exportedPlaylistNames.values()).map(playlistName => ({ playlistName, createdAt: new Date().toISOString() }));
  const payload = { _meta: { format: "legacy-v2-full", exportedAt: new Date().toISOString(), generatedBy: "Universal Backup Merger · ArchiveTune exporter", sourceApplication: "ArchiveTune", sourceFileName, playlistsCount: playlists.length, mediaItemsCount: mediaItems.length }, playlists, media_items: mediaItems };
  if (!parseBloomeePortableBackup(payload)) throw new Error("validating: Generated Bloomee export did not match the portable backup format.");
  return { payload, report: { sourceFileName, playlists: playlists.length, mediaItems: mediaItems.length, skippedTracks } satisfies BloomeeExportReport };
}

export async function exportArchiveTuneToBloomee(file: File, onStage: (stage: Stage) => void): Promise<BrowserBloomeeExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "ArchiveTune" || !source.dbBytes) throw new Error("detecting: Upload an ArchiveTune .backup, .zip, or SQLite database to create a Bloomee import file.");
  const sourceDb = new SQL.Database(source.dbBytes);
  try {
    onStage("merging"); const converted = mapArchiveTuneToBloomee(sourceDb, source.name);
    onStage("validating"); return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
  } finally { sourceDb.close(); }
}

function rowValue(row: Row, ...names: string[]) {
  const lookup = new Map(Object.entries(row).map(([key, value]) => [key.toLocaleLowerCase(), value]));
  for (const name of names) {
    const value = lookup.get(name.toLocaleLowerCase());
    if (value != null) return value;
  }
  return null;
}

function firstTable(tables: string[], ...names: string[]) {
  for (const name of names) {
    const found = actualTable(tables, name);
    if (found) return found;
  }
  return undefined;
}

function listOfStrings(value: unknown) {
  return array(value).flatMap(item => item.split(/[,;]/)).map(item => item.trim()).filter(Boolean);
}

function portableDuration(value: unknown) {
  const raw = Math.max(0, number(value));
  return raw > 86_400 ? Math.round(raw / 1000) : Math.round(raw);
}

function portableTrack(row: Row, artists: string[]): PortablePlaylistTrack | null {
  const title = text(rowValue(row, "title", "songName", "name"))?.trim();
  if (!title) return null;
  const fallbackArtists = listOfStrings(rowValue(row, "artistName", "artists", "artist", "author"));
  const sourceUrl = text(rowValue(row, "sourceUrl", "permaURL", "permaUrl", "url", "videoUrl"))?.trim() || undefined;
  const album = text(rowValue(row, "albumName", "album", "albumTitle"))?.trim() || undefined;
  const artwork = text(rowValue(row, "thumbnailUrl", "artURL", "artUrl", "thumbnail", "artwork"))?.trim() || undefined;
  return { title, artists: artists.length ? artists : fallbackArtists, album, durationSeconds: portableDuration(rowValue(row, "durationSeconds", "duration", "durationMs")), artwork, sourceUrl };
}

function portablePlaylistsFromBloomee(payload: BloomeePortableBackup): PortablePlaylist[] {
  const playlists = new Map<string, PortablePlaylist>();
  payload.playlists.forEach(row => {
    const name = text(row.playlistName)?.trim();
    if (name && !playlists.has(name)) playlists.set(name, { name, tracks: [] });
  });
  payload.mediaItems.forEach(row => {
    const track = portableTrack(row, listOfStrings(row.artist));
    if (!track) return;
    bloomeeMemberships(row.mediaInPlaylists).forEach(name => {
      const playlist = playlists.get(name);
      if (playlist) playlist.tracks.push(track);
    });
  });
  return Array.from(playlists.values()).filter(playlist => playlist.tracks.length > 0);
}

export function mapSqliteBackupToPortablePlaylists(sourceDb: Database, source: { app: string; tables: string[] }): { playlists: PortablePlaylist[]; skippedTracks: number } {
  const songTable = firstTable(source.tables, "song");
  const playlistTable = firstTable(source.tables, "playlist", "local_playlist");
  const playlistSongTable = firstTable(source.tables, "playlist_song_map", "pair_song_local_playlist", "songplaylistmap");
  if (!songTable) throw new Error(`detecting: ${source.app} backup does not contain readable song records for a portable playlist export.`);

  const songs = new Map<string, Row>(rows(sourceDb, songTable).flatMap(row => {
    const id = String(rowValue(row, "id", "songId", "videoId", "mediaID") ?? "");
    return id ? [[id, row] as [string, Row]] : [];
  }));
  const artistTable = firstTable(source.tables, "artist");
  const artists = new Map<string, string>((artistTable ? rows(sourceDb, artistTable) : []).flatMap(row => {
    const id = String(rowValue(row, "id", "artistId", "channelId") ?? "");
    const name = text(rowValue(row, "name", "artistName"))?.trim() ?? "";
    return id && name ? [[id, name] as [string, string]] : [];
  }));
  const artistMemberships = new Map<string, Array<{ position: number; name: string }>>();
  const songArtistTable = firstTable(source.tables, "song_artist_map", "songartistmap");
  if (songArtistTable) rows(sourceDb, songArtistTable).forEach(row => {
    const songId = String(rowValue(row, "songId", "song_id", "videoId") ?? "");
    const artistId = String(rowValue(row, "artistId", "artist_id", "channelId") ?? "");
    const name = artists.get(artistId);
    if (songId && name) artistMemberships.set(songId, [...(artistMemberships.get(songId) ?? []), { position: number(rowValue(row, "position", "index")), name }]);
  });

  const playlistNames = new Map<string, string>();
  if (playlistTable) rows(sourceDb, playlistTable).forEach(row => {
    const id = String(rowValue(row, "id", "playlistId") ?? "");
    const name = text(rowValue(row, "name", "title", "playlistName"))?.trim();
    if (id && name && !playlistNames.has(id)) playlistNames.set(id, name);
  });

  const tracksByPlaylist = new Map<string, Array<{ position: number; track: PortablePlaylistTrack }>>();
  let skippedTracks = 0;
  if (playlistSongTable) rows(sourceDb, playlistSongTable).forEach(row => {
    const playlistId = String(rowValue(row, "playlistId", "playlist_id", "localPlaylistId") ?? "");
    const songId = String(rowValue(row, "songId", "song_id", "videoId", "mediaID") ?? "");
    const song = songs.get(songId);
    const playlistName = playlistNames.get(playlistId);
    if (!playlistName || !song) { skippedTracks++; return; }
    const namedArtists = (artistMemberships.get(songId) ?? []).sort((left, right) => left.position - right.position).map(item => item.name);
    const track = portableTrack(song, namedArtists);
    if (!track) { skippedTracks++; return; }
    tracksByPlaylist.set(playlistId, [...(tracksByPlaylist.get(playlistId) ?? []), { position: number(rowValue(row, "position", "index", "order")), track }]);
  });

  const playlists = Array.from(playlistNames.entries()).map(([id, name]) => ({ name, tracks: (tracksByPlaylist.get(id) ?? []).sort((left, right) => left.position - right.position).map(item => item.track) })).filter(playlist => playlist.tracks.length > 0);
  if (!playlists.length && songs.size) {
    const libraryTracks = Array.from(songs.entries()).map(([songId, song]) => portableTrack(song, (artistMemberships.get(songId) ?? []).sort((left, right) => left.position - right.position).map(item => item.name))).filter((track): track is PortablePlaylistTrack => Boolean(track));
    if (libraryTracks.length) playlists.push({ name: `${source.app} library`, tracks: libraryTracks });
  }
  return { playlists, skippedTracks };
}

function escapeCsv(value: string | number | undefined) {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function filePart(value: string, fallback: string) {
  const compact = value.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return compact || fallback;
}

export async function createPortablePlaylistBundle(playlists: PortablePlaylist[], format: PortablePlaylistFormat, sourceFileName: string, sourceApplication: string, skippedTracks = 0): Promise<BrowserPortablePlaylistExport> {
  const usable = playlists.filter(playlist => playlist.name.trim() && playlist.tracks.length > 0);
  if (!usable.length) throw new Error("merging: No playlist tracks could be exported from this backup.");
  const zip = new JSZip();
  const folder = format === "csv" ? "csv" : "m3u";
  const tracks = usable.reduce((total, playlist) => total + playlist.tracks.length, 0);
  zip.file("README.txt", `Universal Backup Merger portable playlist package\n\nSource: ${sourceFileName}\nDetected source: ${sourceApplication}\nFormat: ${format.toUpperCase()}\nPlaylists: ${usable.length}\nTracks: ${tracks}\n\nEach file represents one playlist. This package is not a native application database backup. Import the individual playlist files using the destination application's documented playlist import action.\n`);
  usable.forEach((playlist, index) => {
    const name = `${String(index + 1).padStart(2, "0")}_${filePart(playlist.name, "playlist")}`;
    if (format === "csv") {
      const body = ["title,artist,album,duration_seconds,source_url", ...playlist.tracks.map(track => [track.title, track.artists.join("; "), track.album, track.durationSeconds, track.sourceUrl].map(escapeCsv).join(","))].join("\n");
      zip.file(`${folder}/${name}.csv`, body);
    } else {
      const body = ["#EXTM3U", `#PLAYLIST:${playlist.name}`, ...playlist.tracks.flatMap(track => [`#EXTINF:${Math.max(0, track.durationSeconds ?? 0)},${track.artists.join("; ") || "Unknown artist"} - ${track.title}`, track.sourceUrl || `#NOURL:${track.title}`])].join("\n");
      zip.file(`${folder}/${name}.m3u`, body);
    }
  });
  return { report: { sourceFileName, sourceApplication, format, playlists: usable.length, tracks, skippedTracks }, output: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
}

export async function exportPortablePlaylistBundle(file: File, format: PortablePlaylistFormat, onStage: (stage: Stage) => void): Promise<BrowserPortablePlaylistExport> {
  onStage("detecting");
  SQL = await sql();
  const source = await extract(file, 0);
  if (source.unsupported) throw new Error(`detecting: ${source.unsupported}`);
  onStage("merging");
  let converted: { playlists: PortablePlaylist[]; skippedTracks: number };
  if (source.bloomee) converted = { playlists: portablePlaylistsFromBloomee(source.bloomee), skippedTracks: 0 };
  else if (source.dbBytes) {
    const sourceDb = new SQL.Database(source.dbBytes);
    try { converted = mapSqliteBackupToPortablePlaylists(sourceDb, source); } finally { sourceDb.close(); }
  } else throw new Error("detecting: This backup does not contain a supported portable music library.");
  onStage("validating");
  return createPortablePlaylistBundle(converted.playlists, format, source.name, source.app, converted.skippedTracks);
}

function mergeBloomee(target: Database, source: Extracted, report: MergeReport) {
  const payload = source.bloomee; if (!payload) return;
  mergeBloomeePortableBackup(target, payload, source.name, report);
}

function mergeSource(target: Database, source: Extracted, report: MergeReport) {
  if (source.bloomee) { mergeBloomee(target, source, report); return; }
  if (!SQL || !source.dbBytes) return;
  const sourceDb = new SQL.Database(source.dbBytes);
  try { if (source.app === "EchoMusic" || source.app === "SimpMusic") mergeEchoFamily(target, sourceDb, source, report); else if (source.app === "RiPlay") mergeRiPlay(target, sourceDb, source, report); else directMerge(target, sourceDb, source, report); } finally { sourceDb.close(); }
}

export async function mergeBackups(files: File[], onStage: (stage: Stage) => void): Promise<BrowserMerge> {
  if (files.length < 2) throw new Error("uploading: Upload one Metrolist backup and at least one source backup.");
  onStage("detecting"); const backups = await extractAll(files); const { target, sources, unsupported } = chooseTarget(backups);
  if (!sources.length) throw new Error("detecting: Add at least one compatible source backup.");
  if (!SQL || !target.dbBytes) throw new Error("validating: SQLite processing is not ready.");
  const targetDb = new SQL.Database(target.dbBytes);
  const report: MergeReport = { counts: { songs: 0, artists: 0, albums: 0, playlists: 0, lyrics: 0, events: 0 }, skippedTables: unsupported.map(item => `${item.app}: ${item.unsupported}`), targetFileName: target.name, sourceFileNames: sources.map(source => source.name) };
  try { onStage("merging"); sources.forEach(source => mergeSource(targetDb, source, report)); onStage("validating"); if (scalar(targetDb, "PRAGMA integrity_check") !== "ok") throw new Error("validating: SQLite integrity check failed."); const zip = new JSZip(); zip.file("song.db", targetDb.export()); if (target.settings) zip.file(target.settingsName ?? "settings.preferences_pb", target.settings); return { report, output: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }) }; } finally { targetDb.close(); }
}

export async function mergeMetrolistToArchiveTune(metrolistFile: File, archiveTuneTargetFile: File, onStage: (stage: Stage) => void): Promise<BrowserMerge> {
  onStage("detecting");
  SQL = await sql();
  const [source, target] = await Promise.all([extract(metrolistFile, 0), extract(archiveTuneTargetFile, 1)]);
  if (source.unsupported || target.unsupported) throw new Error(`detecting: ${source.unsupported ?? target.unsupported}`);
  if (source.app !== "Metrolist" || !source.dbBytes) throw new Error("detecting: Select a Metrolist .backup, .zip, or .db file as the source.");
  if (target.app !== "ArchiveTune" || !target.dbBytes) throw new Error("detecting: Select an ArchiveTune .backup, .zip, or .db file as the target.");
  const targetDb = new SQL.Database(target.dbBytes);
  const sourceDb = new SQL.Database(source.dbBytes);
  try {
    onStage("merging");
    const report = mergeMetrolistIntoArchiveTuneDatabase(targetDb, sourceDb, target.name, source.name);
    onStage("validating");
    const zip = new JSZip();
    zip.file("song.db", targetDb.export());
    if (target.settings) zip.file(target.settingsName ?? "settings.xml", target.settings);
    return { report, output: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
  } finally {
    sourceDb.close();
    targetDb.close();
  }
}
