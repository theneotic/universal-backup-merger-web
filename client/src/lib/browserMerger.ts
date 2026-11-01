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
export type BitChordPrefValue = {
  type: string;
  value?: string | null;
  values?: string[];
};
export type BitChordDayStats = {
  ms: number;
  plays: number;
};
export type BitChordTrack = {
  id: string;
  title?: string;
  artist?: string;
  album?: string | null;
  albumId?: string | null;
  artistId?: string | null;
  art?: string | null;
  ms?: number;
  plays?: number;
  last?: number;
  days?: Record<string, BitChordDayStats>;
};
export type BitChordNameEntry = {
  name: string;
  sub?: string | null;
  art?: string | null;
  id?: string | null;
  ms?: number;
  plays?: number;
  key?: string | null;
  days?: Record<string, BitChordDayStats>;
};
export type BitChordBucket = {
  version?: number;
  month: string;
  tracks: BitChordTrack[];
  artists?: BitChordNameEntry[];
  albums?: BitChordNameEntry[];
  hours?: number[];
  days?: Record<string, number>;
  trackDays?: Record<string, BitChordDayStats>;
  artistDays?: Record<string, BitChordDayStats>;
  albumDays?: Record<string, BitChordDayStats>;
};
export type BitChordBackup = {
  app: string;
  version: number;
  versionName?: string;
  exportedAt?: string;
  settings?: Record<string, BitChordPrefValue>;
  listening: BitChordBucket[];
};
export type BitChordExportReport = {
  sourceFileName: string;
  sourceApplication: string;
  months: number;
  tracks: number;
  artists: number;
  albums: number;
};
export type BrowserBitChordExport = { report: BitChordExportReport; output: Blob };
export const supportedApplicationNames = ["Metrolist", "ArchiveTune", "OuterTune", "EchoMusic", "SimpMusic", "RiPlay", "Bloomee JSON export", "BitChord JSON backup"] as const;
export const unsupportedContainerNotes = { Bloomee: "Bloomee .isar snapshots use a native Isar/MDBX format that this static browser tool cannot decode safely. In Bloomee, choose Create Backup (JSON), then upload that JSON export instead." } as const;

type Row = Record<string, unknown>;
export type BloomeePortableBackup = { playlists: Row[]; mediaItems: Row[] };
type Extracted = { name: string; app: string; dbBytes?: Uint8Array; settings?: Uint8Array; settingsName?: string; tables: string[]; score: number; bloomee?: BloomeePortableBackup; bitchord?: BitChordBackup; unsupported?: string };
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

export function parseBitChordBackup(value: unknown): BitChordBackup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Row;
  const isApp = typeof payload.app === "string" && payload.app.toLowerCase() === "bitchord";
  const hasListening = Array.isArray(payload.listening);
  if (!isApp && !hasListening) return null;
  if (!hasListening) return null;

  const listening: BitChordBucket[] = (payload.listening as unknown[]).flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const b = item as Row;
    const month = text(b.month);
    if (!month) return [];
    const tracks: BitChordTrack[] = Array.isArray(b.tracks)
      ? (b.tracks as unknown[]).flatMap(rawTrack => {
          if (!rawTrack || typeof rawTrack !== "object" || Array.isArray(rawTrack)) return [];
          const tr = rawTrack as Row;
          const id = text(tr.id);
          if (!id) return [];
          return [{
            id,
            title: text(tr.title) ?? id,
            artist: text(tr.artist) ?? "",
            album: text(tr.album),
            albumId: text(tr.albumId),
            artistId: text(tr.artistId),
            art: text(tr.art),
            ms: number(tr.ms),
            plays: number(tr.plays),
            last: number(tr.last),
            days: tr.days && typeof tr.days === "object" ? (tr.days as Record<string, BitChordDayStats>) : undefined,
          }];
        })
      : [];
    const artists: BitChordNameEntry[] = Array.isArray(b.artists)
      ? (b.artists as unknown[]).flatMap(rawArtist => {
          if (!rawArtist || typeof rawArtist !== "object" || Array.isArray(rawArtist)) return [];
          const ar = rawArtist as Row;
          const name = text(ar.name);
          if (!name) return [];
          return [{
            name,
            sub: text(ar.sub),
            art: text(ar.art),
            id: text(ar.id),
            ms: number(ar.ms),
            plays: number(ar.plays),
            key: text(ar.key),
            days: ar.days && typeof ar.days === "object" ? (ar.days as Record<string, BitChordDayStats>) : undefined,
          }];
        })
      : [];
    const albums: BitChordNameEntry[] = Array.isArray(b.albums)
      ? (b.albums as unknown[]).flatMap(rawAlbum => {
          if (!rawAlbum || typeof rawAlbum !== "object" || Array.isArray(rawAlbum)) return [];
          const al = rawAlbum as Row;
          const name = text(al.name);
          if (!name) return [];
          return [{
            name,
            sub: text(al.sub),
            art: text(al.art),
            id: text(al.id),
            ms: number(al.ms),
            plays: number(al.plays),
            key: text(al.key),
            days: al.days && typeof al.days === "object" ? (al.days as Record<string, BitChordDayStats>) : undefined,
          }];
        })
      : [];

    return [{
      version: number(b.version, 1),
      month,
      tracks,
      artists,
      albums,
      hours: Array.isArray(b.hours) ? b.hours.map(h => number(h)) : undefined,
      days: b.days && typeof b.days === "object" ? (b.days as Record<string, number>) : undefined,
      trackDays: b.trackDays && typeof b.trackDays === "object" ? (b.trackDays as Record<string, BitChordDayStats>) : undefined,
      artistDays: b.artistDays && typeof b.artistDays === "object" ? (b.artistDays as Record<string, BitChordDayStats>) : undefined,
      albumDays: b.albumDays && typeof b.albumDays === "object" ? (b.albumDays as Record<string, BitChordDayStats>) : undefined,
    }];
  });

  const settings = payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)
    ? (payload.settings as Record<string, BitChordPrefValue>)
    : {};

  return {
    app: "bitchord",
    version: number(payload.version, 1),
    versionName: text(payload.versionName) ?? "1.9",
    exportedAt: text(payload.exportedAt) ?? new Date().toISOString(),
    settings,
    listening,
  };
}

export function parseBitChordBytes(bytes: Uint8Array): BitChordBackup | null {
  try {
    return parseBitChordBackup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
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
  if (!/\.(backup|zip|db|isar|json|blm)$/i.test(file.name)) throw new Error(`uploading: ${file.name} is not a .backup, .zip, .db, .isar, Bloomee, or BitChord JSON file.`);
  const raw = new Uint8Array(await file.arrayBuffer());
  const name = file.name || `backup-${index + 1}`;
  if (new TextDecoder().decode(raw.slice(0, 16)) === SQLITE_HEADER) return inspectSqlite(name, raw);
  const bloomee = parseBloomeeBytes(raw);
  if (bloomee) return { name, app: "Bloomee", tables: ["playlists", "media_items"], score: 0, bloomee };
  const bitchord = parseBitChordBytes(raw);
  if (bitchord) return { name, app: "BitChord", tables: ["listening", "tracks", "artists", "albums", "settings"], score: 0, bitchord };
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
      const fileBytes = await entry.async("uint8array");
      const portable = parseBloomeeBytes(fileBytes);
      if (portable) return { name, app: "Bloomee", tables: ["playlists", "media_items"], score: 0, bloomee: portable };
      const bitchordEntry = parseBitChordBytes(fileBytes);
      if (bitchordEntry) return { name, app: "BitChord", tables: ["listening", "tracks", "artists", "albums", "settings"], score: 0, bitchord: bitchordEntry };
    }
    return { name, app: isarBytes ? "Bloomee" : "Unknown backup", tables: [], score: 0, unsupported: isarBytes ? bloomeeIsarDetail(isarBytes) : "No SQLite database, Bloomee JSON export, or BitChord JSON backup was found in this archive." };
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

export function mergeBloomeeIntoArchiveTuneDatabase(targetDb: Database, payload: BloomeePortableBackup, targetFileName = "ArchiveTune.backup", sourceFileName = "Bloomee.json"): MergeReport {
  const targetTables = tableNames(targetDb);
  if (!actualTable(targetTables, "song") || !actualTable(targetTables, "playlist") || !actualTable(targetTables, "playlist_song_map")) throw new Error("detecting: The ArchiveTune target is missing its required music-library tables.");
  const report: MergeReport = { counts: { songs: 0, artists: 0, albums: 0, playlists: 0, lyrics: 0, events: 0 }, skippedTables: [], targetFileName, sourceFileNames: [sourceFileName] };
  mergeBloomeePortableBackup(targetDb, payload, sourceFileName, report);
  if (scalar(targetDb, "PRAGMA integrity_check") !== "ok") throw new Error("validating: ArchiveTune target integrity check failed after merging Bloomee data.");
  return report;
}

export function mergeBitChordIntoArchiveTuneDatabase(targetDb: Database, payload: BitChordBackup, targetFileName = "ArchiveTune.backup", sourceFileName = "BitChord.json"): MergeReport {
  const targetTables = tableNames(targetDb);
  if (!actualTable(targetTables, "song") || !actualTable(targetTables, "playlist") || !actualTable(targetTables, "playlist_song_map")) throw new Error("detecting: The ArchiveTune target is missing its required music-library tables.");
  const report: MergeReport = { counts: { songs: 0, artists: 0, albums: 0, playlists: 0, lyrics: 0, events: 0 }, skippedTables: [], targetFileName, sourceFileNames: [sourceFileName] };
  mergeBitChordBackup(targetDb, payload, sourceFileName, report);
  if (scalar(targetDb, "PRAGMA integrity_check") !== "ok") throw new Error("validating: ArchiveTune target integrity check failed after merging BitChord data.");
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
function bloomeeLibraryId(value: unknown) {
  const raw = text(value)?.trim() ?? "";
  const resolverPrefix = "content-resolver.bloomfactory.ytmusic::";
  return raw.startsWith(resolverPrefix) ? raw.slice(resolverPrefix.length) : raw;
}

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
    const id = bloomeeLibraryId(track.mediaID); if (!id) return;
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

export function mapBitChordBackup(payload: BitChordBackup, sourceName: string) {
  const sourcePrefix = `bitchord:${sourceName}:`;
  const playlists = new Map<string, string>();
  const mapped = {
    playlists: [] as Array<{ id: string; row: Row }>,
    songs: [] as Row[],
    artists: [] as Row[],
    albums: [] as Row[],
    songArtists: [] as Row[],
    songAlbums: [] as Row[],
    playlistSongs: [] as Row[],
    events: [] as Row[],
    searchHistory: [] as Row[],
  };

  const seenSongs = new Set<string>();
  const seenArtists = new Set<string>();
  const seenAlbums = new Set<string>();

  payload.listening.forEach((bucket, bucketIdx) => {
    const month = bucket.month || `bucket-${bucketIdx + 1}`;
    const playlistName = `BitChord · ${month}`;
    const playlistId = `${sourcePrefix}playlist:${encodeURIComponent(month)}`;
    playlists.set(month, playlistId);
    mapped.playlists.push({
      id: playlistId,
      row: {
        id: playlistId,
        name: playlistName,
        createdAt: Date.now(),
        lastUpdateTime: Date.now(),
        trackCount: bucket.tracks.length,
      },
    });

    bucket.artists?.forEach(ar => {
      const name = ar.name?.trim();
      if (!name) return;
      const artistId = ar.id || `${sourcePrefix}artist:${encodeURIComponent(name.toLowerCase())}`;
      if (!seenArtists.has(artistId)) {
        seenArtists.add(artistId);
        mapped.artists.push({
          id: artistId,
          name,
          thumbnailUrl: ar.art || null,
          channelId: ar.id || null,
          lastUpdateTime: Date.now(),
          isLocal: 0,
        });
      }
    });

    bucket.albums?.forEach(al => {
      const name = al.name?.trim();
      if (!name) return;
      const albumId = al.id || `${sourcePrefix}album:${encodeURIComponent(name.toLowerCase())}`;
      if (!seenAlbums.has(albumId)) {
        seenAlbums.add(albumId);
        mapped.albums.push({
          id: albumId,
          title: name,
          thumbnailUrl: al.art || null,
          songCount: 0,
          duration: 0,
          lastUpdateTime: Date.now(),
          isLocal: 0,
        });
      }
    });

    bucket.tracks.forEach((track, pos) => {
      const id = text(track.id)?.trim();
      if (!id) return;

      const albumName = text(track.album);
      const albumId = track.albumId || (albumName ? `${sourcePrefix}album:${encodeURIComponent(albumName.toLowerCase())}` : null);
      if (albumName && albumId && !seenAlbums.has(albumId)) {
        seenAlbums.add(albumId);
        mapped.albums.push({
          id: albumId,
          title: albumName,
          thumbnailUrl: track.art || null,
          songCount: 1,
          duration: Math.max(0, portableDuration(track.ms)),
          lastUpdateTime: Date.now(),
          isLocal: 0,
        });
      }

      if (!seenSongs.has(id)) {
        seenSongs.add(id);
        const durSec = portableDuration(track.ms);
        mapped.songs.push({
          id,
          title: text(track.title) || id,
          duration: durSec,
          thumbnailUrl: text(track.art) || null,
          albumId,
          albumName: albumName || null,
          explicit: 0,
          totalPlayTime: number(track.ms),
          inLibrary: number(track.last) || Date.now(),
          dateModified: number(track.last) || Date.now(),
          isLocal: 0,
        });
      }

      const trackArtists = listOfStrings(track.artist);
      trackArtists.forEach((artName, artPos) => {
        const artId = `${sourcePrefix}artist:${encodeURIComponent(artName.toLowerCase())}`;
        if (!seenArtists.has(artId)) {
          seenArtists.add(artId);
          mapped.artists.push({
            id: artId,
            name: artName,
            thumbnailUrl: track.art || null,
            lastUpdateTime: Date.now(),
            isLocal: 0,
          });
        }
        mapped.songArtists.push({ songId: id, artistId: artId, position: artPos });
      });

      if (albumId) {
        mapped.songAlbums.push({ songId: id, albumId, index: 0 });
      }

      mapped.playlistSongs.push({
        playlistId,
        songId: id,
        position: pos,
        setVideoId: null,
      });

      if (track.days && typeof track.days === "object") {
        Object.entries(track.days).forEach(([dayKey, dayStat]) => {
          const parsed = Date.parse(`${dayKey}T12:00:00Z`);
          const ts = Number.isFinite(parsed) ? parsed : (number(track.last) || Date.now());
          mapped.events.push({
            songId: id,
            timestamp: ts,
            playTime: number(dayStat.ms),
          });
        });
      } else if (track.ms && track.last) {
        mapped.events.push({
          songId: id,
          timestamp: number(track.last),
          playTime: number(track.ms),
        });
      }
    });
  });

  if (payload.settings?.search_history?.value) {
    try {
      const historyItems = JSON.parse(payload.settings.search_history.value);
      if (Array.isArray(historyItems)) {
        historyItems.forEach(item => {
          if (!item || typeof item !== "object") return;
          const searchTitle = text(item.title) || text(item.query);
          const searchId = text(item.id) || searchTitle;
          if (searchTitle) {
            mapped.searchHistory.push({
              id: searchId,
              query: searchTitle,
              timestamp: number(item.timestamp) || Date.now(),
            });
          }
          if (item.entityType === "TRACK" && item.id && !seenSongs.has(String(item.id))) {
            const trId = String(item.id);
            seenSongs.add(trId);
            mapped.songs.push({
              id: trId,
              title: searchTitle || trId,
              duration: 0,
              thumbnailUrl: text(item.artworkUrl) || null,
              albumId: null,
              albumName: null,
              explicit: 0,
              totalPlayTime: 0,
              inLibrary: number(item.timestamp) || Date.now(),
              dateModified: number(item.timestamp) || Date.now(),
              isLocal: 0,
            });
          }
        });
      }
    } catch {
      // ignore
    }
  }

  return mapped;
}

export function mergeBitChordBackup(target: Database, payload: BitChordBackup, sourceName: string, report: MergeReport) {
  const mapped = mapBitChordBackup(payload, sourceName);
  mapped.playlists.forEach(item => addPlaylist(target, item.row, item.id, report));
  mapped.albums.forEach(row => addAlbum(target, row, report));
  mapped.songs.forEach(row => addSong(target, row, report));
  mapped.artists.forEach(row => addArtist(target, row, report));
  mapped.songArtists.forEach(row => insert(target, "song_artist_map", row));
  mapped.songAlbums.forEach(row => insert(target, "song_album_map", row));
  mapped.playlistSongs.forEach(row => insert(target, "playlist_song_map", row));
  mapped.events.forEach(row => addEvent(target, row, report));
  if (hasTable(target, "search_history")) {
    mapped.searchHistory.forEach(row => insert(target, "search_history", row));
  }
}

const BLOOMEE_SYSTEM_PLAYLISTS = new Set(["Liked", "_DOWNLOADS", "recently_played", "_LOCAL_MUSIC"]);
function bloomeePlaylistKey(name: string) { return name.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
const BLOOMEE_SYSTEM_PLAYLIST_KEYS = new Set(Array.from(BLOOMEE_SYSTEM_PLAYLISTS, bloomeePlaylistKey));
function bloomeeMediaId(value: unknown) {
  const raw = text(value)?.trim() ?? "";
  if (!raw) return null;
  if (raw.startsWith("content-resolver.")) return raw;
  const normalized = raw.toLowerCase().startsWith("youtube") ? raw.slice(7).trim() : raw;
  return normalized ? `content-resolver.bloomfactory.ytmusic::${normalized}` : null;
}

export function mapSqliteBackupToBloomee(sourceDb: Database, sourceFileName: string, sourceApplication: "ArchiveTune" | "Metrolist") {
  const tables = tableNames(sourceDb);
  const songTable = actualTable(tables, "song");
  const playlistTable = actualTable(tables, "playlist");
  const playlistSongTable = actualTable(tables, "playlist_song_map");
  if (!songTable || !playlistTable || !playlistSongTable) throw new Error(`detecting: ${sourceApplication} backup is missing song, playlist, or playlist_song_map data.`);

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
    if (!exportedPlaylistNames.has(key)) exportedPlaylistNames.set(key, `${sourceApplication} · ${name.replace(/\s+/g, " ")}`);
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
    const song = songs.get(songId); const mediaID = bloomeeMediaId(songId);
    if (!song || !mediaID || !playlistNamesForSong.length) { skippedTracks++; return; }
    const artistNames = (artistMemberships.get(songId) ?? []).sort((left, right) => left.position - right.position).map(member => text(artists.get(member.id)?.name)?.trim()).filter((name): name is string => Boolean(name));
    mediaItems.push({ mediaID, title: text(song.title) ?? mediaID, artist: artistNames.join(", "), album: text(song.albumName) ?? "", artURL: text(song.thumbnailUrl) ?? "", duration: Math.max(0, number(song.duration)), permaURL: text(song.sourceUrl ?? song.videoUrl) ?? `https://music.youtube.com/watch?v=${encodeURIComponent(songId)}`, mediaInPlaylists: playlistNamesForSong.map(playlistName => ({ playlistName })) });
  });
  const playlists = Array.from(exportedPlaylistNames.values()).map(playlistName => ({ playlistName, createdAt: new Date().toISOString() }));
  const payload = { _meta: { format: "legacy-v2-full", exportedAt: new Date().toISOString(), generatedBy: `VibeBridge · ${sourceApplication} exporter`, sourceApplication, sourceFileName, playlistsCount: playlists.length, mediaItemsCount: mediaItems.length }, playlists, media_items: mediaItems };
  if (!parseBloomeePortableBackup(payload)) throw new Error("validating: Generated Bloomee export did not match the portable backup format.");
  return { payload, report: { sourceFileName, playlists: playlists.length, mediaItems: mediaItems.length, skippedTracks } satisfies BloomeeExportReport };
}

export function mapArchiveTuneToBloomee(sourceDb: Database, sourceFileName: string) { return mapSqliteBackupToBloomee(sourceDb, sourceFileName, "ArchiveTune"); }
export function mapMetrolistToBloomee(sourceDb: Database, sourceFileName: string) { return mapSqliteBackupToBloomee(sourceDb, sourceFileName, "Metrolist"); }

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

export function portablePlaylistsFromBitChord(payload: BitChordBackup): PortablePlaylist[] {
  const playlists: PortablePlaylist[] = [];
  payload.listening.forEach(bucket => {
    const tracks: PortablePlaylistTrack[] = [];
    bucket.tracks.forEach(tr => {
      const title = text(tr.title)?.trim() || text(tr.id);
      if (!title) return;
      const artists = listOfStrings(tr.artist);
      tracks.push({
        title,
        artists: artists.length ? artists : ["Unknown artist"],
        album: text(tr.album) || undefined,
        durationSeconds: portableDuration(tr.ms),
        artwork: text(tr.art) || undefined,
        sourceUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(tr.id)}`,
      });
    });
    if (tracks.length > 0) {
      playlists.push({
        name: `BitChord · ${bucket.month}`,
        tracks,
      });
    }
  });
  return playlists;
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
  zip.file("README.txt", `VibeBridge portable playlist package\n\nSource: ${sourceFileName}\nDetected source: ${sourceApplication}\nFormat: ${format.toUpperCase()}\nPlaylists: ${usable.length}\nTracks: ${tracks}\n\nEach file represents one playlist. This package is not a native application database backup. Import the individual playlist files using the destination application's documented playlist import action.\n`);
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
  else if (source.bitchord) converted = { playlists: portablePlaylistsFromBitChord(source.bitchord), skippedTracks: 0 };
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
  if (source.bitchord) { mergeBitChordBackup(target, source.bitchord, source.name, report); return; }
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

export async function mergeBloomeeToArchiveTune(bloomeeFile: File, archiveTuneTargetFile: File, onStage: (stage: Stage) => void): Promise<BrowserMerge> {
  onStage("detecting");
  SQL = await sql();
  const [source, target] = await Promise.all([extract(bloomeeFile, 0), extract(archiveTuneTargetFile, 1)]);
  if (source.unsupported || target.unsupported) throw new Error(`detecting: ${source.unsupported ?? target.unsupported}`);
  if (source.app !== "Bloomee" || !source.bloomee) throw new Error("detecting: Select a Bloomee portable .json, .blm, or ZIP export as the source. Native .isar snapshots are not supported.");
  if (target.app !== "ArchiveTune" || !target.dbBytes) throw new Error("detecting: Select an ArchiveTune .backup, .zip, or .db file as the target.");
  const targetDb = new SQL.Database(target.dbBytes);
  try {
    onStage("merging");
    const report = mergeBloomeeIntoArchiveTuneDatabase(targetDb, source.bloomee, target.name, source.name);
    onStage("validating");
    const zip = new JSZip();
    zip.file("song.db", targetDb.export());
    if (target.settings) zip.file(target.settingsName ?? "settings.xml", target.settings);
    return { report, output: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
  } finally { targetDb.close(); }
}

export async function exportMetrolistToBloomee(file: File, onStage: (stage: Stage) => void): Promise<BrowserBloomeeExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "Metrolist" || !source.dbBytes) throw new Error("detecting: Upload a Metrolist .backup, .zip, or SQLite database to create a Bloomee import file.");
  const sourceDb = new SQL.Database(source.dbBytes);
  try {
    onStage("merging"); const converted = mapMetrolistToBloomee(sourceDb, source.name);
    onStage("validating"); return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
  } finally { sourceDb.close(); }
}

export async function mergeBitChordToArchiveTune(bitchordFile: File, archiveTuneTargetFile: File, onStage: (stage: Stage) => void): Promise<BrowserMerge> {
  onStage("detecting");
  SQL = await sql();
  const [source, target] = await Promise.all([extract(bitchordFile, 0), extract(archiveTuneTargetFile, 1)]);
  if (source.unsupported || target.unsupported) throw new Error(`detecting: ${source.unsupported ?? target.unsupported}`);
  if (source.app !== "BitChord" || !source.bitchord) throw new Error("detecting: Select a BitChord JSON backup file as the source.");
  if (target.app !== "ArchiveTune" || !target.dbBytes) throw new Error("detecting: Select an ArchiveTune .backup, .zip, or .db file as the target.");
  const targetDb = new SQL.Database(target.dbBytes);
  try {
    onStage("merging");
    const report = mergeBitChordIntoArchiveTuneDatabase(targetDb, source.bitchord, target.name, source.name);
    onStage("validating");
    const zip = new JSZip();
    zip.file("song.db", targetDb.export());
    if (target.settings) zip.file(target.settingsName ?? "settings.xml", target.settings);
    return { report, output: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
  } finally { targetDb.close(); }
}

export function mapBitChordToBloomee(payload: BitChordBackup, sourceFileName: string): { payload: BloomeePortableBackup; report: BloomeeExportReport } {
  const playlists: Row[] = [];
  const mediaItems: Row[] = [];
  let skippedTracks = 0;
  const seenMedia = new Set<string>();

  payload.listening.forEach((bucket, bucketIdx) => {
    const month = bucket.month || `bucket-${bucketIdx + 1}`;
    const playlistName = `BitChord · ${month}`;
    playlists.push({ playlistName, createdAt: new Date().toISOString() });

    bucket.tracks.forEach(track => {
      const mediaID = bloomeeMediaId(track.id);
      if (!mediaID) { skippedTracks++; return; }
      if (seenMedia.has(mediaID)) {
        const existing = mediaItems.find(m => m.mediaID === mediaID);
        if (existing && Array.isArray(existing.mediaInPlaylists)) {
          (existing.mediaInPlaylists as Array<{ playlistName: string }>).push({ playlistName });
        }
        return;
      }
      seenMedia.add(mediaID);
      mediaItems.push({
        mediaID,
        title: track.title || track.id,
        artist: track.artist || "Unknown artist",
        album: track.album || "",
        artURL: track.art || "",
        duration: Math.max(0, portableDuration(track.ms)),
        permaURL: `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`,
        mediaInPlaylists: [{ playlistName }]
      });
    });
  });

  const outputPayload = {
    _meta: {
      format: "legacy-v2-full",
      exportedAt: new Date().toISOString(),
      generatedBy: "VibeBridge · BitChord exporter",
      sourceApplication: "BitChord",
      sourceFileName,
      playlistsCount: playlists.length,
      mediaItemsCount: mediaItems.length,
    },
    playlists,
    media_items: mediaItems,
  };

  return { payload: outputPayload as BloomeePortableBackup, report: { sourceFileName, playlists: playlists.length, mediaItems: mediaItems.length, skippedTracks } };
}

export async function exportBitChordToBloomee(file: File, onStage: (stage: Stage) => void): Promise<BrowserBloomeeExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "BitChord" || !source.bitchord) throw new Error("detecting: Upload a BitChord JSON backup to create a Bloomee import file.");
  onStage("merging");
  const converted = mapBitChordToBloomee(source.bitchord, source.name);
  onStage("validating");
  return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
}

export function mapBloomeeToBitChord(payload: BloomeePortableBackup, sourceFileName = "Bloomee.json"): { payload: BitChordBackup; report: BitChordExportReport } {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dayStr = `${monthStr}-${String(now.getDate()).padStart(2, "0")}`;
  const dayNum = now.getDate();

  const tracks: BitChordTrack[] = [];
  const artistsMap = new Map<string, BitChordNameEntry>();
  const albumsMap = new Map<string, BitChordNameEntry>();
  let totalMs = 0;

  payload.mediaItems.forEach(item => {
    const rawId = bloomeeLibraryId(item.mediaID);
    if (!rawId) return;
    const durationSeconds = Math.max(0, number(item.duration));
    const trackMs = durationSeconds > 0 ? durationSeconds * 1000 : 180000;
    totalMs += trackMs;

    const artistNames = bloomeeArtists(item.artist);
    const artist = artistNames.join(", ");
    const album = text(item.album) || null;

    tracks.push({
      id: rawId,
      title: text(item.title) || rawId,
      artist,
      album,
      albumId: null,
      artistId: null,
      art: text(item.artURL) || null,
      ms: trackMs,
      plays: 1,
      last: now.getTime(),
      days: { [dayStr]: { ms: trackMs, plays: 1 } },
    });

    artistNames.forEach(name => {
      const key = name.toLowerCase();
      const existing = artistsMap.get(key);
      if (existing) {
        existing.ms += trackMs;
        existing.plays += 1;
      } else {
        artistsMap.set(key, {
          name,
          sub: null,
          art: text(item.artURL) || null,
          id: null,
          ms: trackMs,
          plays: 1,
          key,
          days: { [dayStr]: { ms: trackMs, plays: 1 } },
        });
      }
    });

    if (album) {
      const key = album.toLowerCase();
      const existing = albumsMap.get(key);
      if (existing) {
        existing.ms += trackMs;
        existing.plays += 1;
      } else {
        albumsMap.set(key, {
          name: album,
          sub: null,
          art: text(item.artURL) || null,
          id: null,
          ms: trackMs,
          plays: 1,
          key,
          days: { [dayStr]: { ms: trackMs, plays: 1 } },
        });
      }
    }
  });

  const hours = Array(24).fill(0);
  hours[now.getHours()] = totalMs;

  const bucket: BitChordBucket = {
    version: 1,
    month: monthStr,
    tracks,
    artists: Array.from(artistsMap.values()),
    albums: Array.from(albumsMap.values()),
    hours,
    days: { [String(dayNum)]: totalMs },
    trackDays: { [dayStr]: { ms: totalMs, plays: tracks.length } },
    artistDays: { [dayStr]: { ms: totalMs, plays: tracks.length } },
    albumDays: {},
  };

  const bitchordPayload: BitChordBackup = {
    app: "bitchord",
    version: 1,
    versionName: "1.9",
    exportedAt: now.toISOString(),
    settings: {
      high_performance_mode: { type: "bool", value: "true", values: [] },
      sync_downloaded_playlists: { type: "bool", value: "true", values: [] },
      audio_quality_download: { type: "string", value: "LOSSLESS", values: [] },
    },
    listening: [bucket],
  };

  return {
    payload: bitchordPayload,
    report: {
      sourceFileName,
      sourceApplication: "Bloomee",
      months: 1,
      tracks: tracks.length,
      artists: artistsMap.size,
      albums: albumsMap.size,
    },
  };
}

export async function exportBloomeeToBitChord(file: File, onStage: (stage: Stage) => void): Promise<BrowserBitChordExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "Bloomee" || !source.bloomee) throw new Error("detecting: Upload a Bloomee portable JSON export to create a BitChord backup file.");
  onStage("merging");
  const converted = mapBloomeeToBitChord(source.bloomee, source.name);
  onStage("validating");
  return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
}

export function mapSqliteBackupToBitChord(sourceDb: Database, sourceFileName: string, sourceApplication: "Metrolist" | "ArchiveTune"): { payload: BitChordBackup; report: BitChordExportReport } {
  const tables = tableNames(sourceDb);
  const songTable = actualTable(tables, "song");
  if (!songTable) throw new Error(`detecting: ${sourceApplication} backup is missing song records.`);

  const songs = rows(sourceDb, songTable);
  const artistTable = actualTable(tables, "artist");
  const artists = new Map((artistTable ? rows(sourceDb, artistTable) : []).map(r => [String(r.id), r]));
  const songArtistTable = actualTable(tables, "song_artist_map");
  const artistMemberships = new Map<string, string[]>();
  if (songArtistTable) {
    rows(sourceDb, songArtistTable).sort((a, b) => number(a.position) - number(b.position)).forEach(row => {
      const songId = text(row.songId);
      const artistId = text(row.artistId);
      if (!songId || !artistId) return;
      const name = text(artists.get(artistId)?.name);
      if (name) {
        artistMemberships.set(songId, [...(artistMemberships.get(songId) ?? []), name]);
      }
    });
  }

  const eventTable = actualTable(tables, "event");
  const events = eventTable ? rows(sourceDb, eventTable) : [];

  const bucketsByMonth = new Map<string, {
    tracksMap: Map<string, BitChordTrack>;
    artistsMap: Map<string, BitChordNameEntry>;
    albumsMap: Map<string, BitChordNameEntry>;
    hours: number[];
    days: Record<string, number>;
    trackDays: Record<string, BitChordDayStats>;
  }>();

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  function getBucket(m: string) {
    let b = bucketsByMonth.get(m);
    if (!b) {
      b = {
        tracksMap: new Map(),
        artistsMap: new Map(),
        albumsMap: new Map(),
        hours: Array(24).fill(0),
        days: {},
        trackDays: {},
      };
      bucketsByMonth.set(m, b);
    }
    return b;
  }

  const songsById = new Map(songs.map(s => [String(s.id), s]));

  if (events.length > 0) {
    events.forEach(ev => {
      const songId = text(ev.songId);
      if (!songId) return;
      const song = songsById.get(songId);
      const ts = number(ev.timestamp);
      const date = ts > 0 ? new Date(ts) : now;
      const m = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const dayKey = `${m}-${String(date.getDate()).padStart(2, "0")}`;
      const dayOfMonth = String(date.getDate());
      const playMs = number(ev.playTime) || (number(song?.duration) ? number(song.duration) * 1000 : 180000);

      const b = getBucket(m);
      b.hours[date.getHours()] = (b.hours[date.getHours()] ?? 0) + playMs;
      b.days[dayOfMonth] = (b.days[dayOfMonth] ?? 0) + playMs;
      if (!b.trackDays[dayKey]) b.trackDays[dayKey] = { ms: 0, plays: 0 };
      b.trackDays[dayKey].ms += playMs;
      b.trackDays[dayKey].plays += 1;

      let tr = b.tracksMap.get(songId);
      if (!tr) {
        const artistNames = artistMemberships.get(songId) ?? (text(song?.artistName) ? [text(song.artistName)!] : []);
        const album = text(song?.albumName) || null;
        tr = {
          id: songId,
          title: text(song?.title) || songId,
          artist: artistNames.join(", "),
          album,
          albumId: text(song?.albumId) || null,
          artistId: null,
          art: text(song?.thumbnailUrl) || null,
          ms: 0,
          plays: 0,
          last: ts,
          days: {},
        };
        b.tracksMap.set(songId, tr);
      }
      tr.ms += playMs;
      tr.plays += 1;
      tr.last = Math.max(tr.last ?? 0, ts);
      if (!tr.days) tr.days = {};
      if (!tr.days[dayKey]) tr.days[dayKey] = { ms: 0, plays: 0 };
      tr.days[dayKey].ms += playMs;
      tr.days[dayKey].plays += 1;

      const names = tr.artist.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      names.forEach(name => {
        const key = name.toLowerCase();
        let ar = b.artistsMap.get(key);
        if (!ar) {
          ar = { name, sub: null, art: tr?.art ?? null, id: null, ms: 0, plays: 0, key, days: {} };
          b.artistsMap.set(key, ar);
        }
        ar.ms += playMs;
        ar.plays += 1;
        if (!ar.days) ar.days = {};
        if (!ar.days[dayKey]) ar.days[dayKey] = { ms: 0, plays: 0 };
        ar.days[dayKey].ms += playMs;
        ar.days[dayKey].plays += 1;
      });

      if (tr.album) {
        const key = tr.album.toLowerCase();
        let al = b.albumsMap.get(key);
        if (!al) {
          al = { name: tr.album, sub: null, art: tr?.art ?? null, id: null, ms: 0, plays: 0, key, days: {} };
          b.albumsMap.set(key, al);
        }
        al.ms += playMs;
        al.plays += 1;
      }
    });
  }

  const defaultB = getBucket(defaultMonth);
  songs.forEach(song => {
    const songId = text(song.id);
    if (!songId) return;
    const inAny = Array.from(bucketsByMonth.values()).some(b => b.tracksMap.has(songId));
    if (inAny) return;

    const durSec = number(song.duration);
    const trackMs = durSec > 0 ? durSec * 1000 : 180000;
    const artistNames = artistMemberships.get(songId) ?? (text(song.artistName) ? [text(song.artistName)!] : []);
    const album = text(song.albumName) || null;
    const todayKey = `${defaultMonth}-${String(now.getDate()).padStart(2, "0")}`;

    const tr: BitChordTrack = {
      id: songId,
      title: text(song.title) || songId,
      artist: artistNames.join(", "),
      album,
      albumId: text(song.albumId) || null,
      artistId: null,
      art: text(song.thumbnailUrl) || null,
      ms: trackMs,
      plays: 1,
      last: number(song.dateModified ?? song.inLibrary) || now.getTime(),
      days: { [todayKey]: { ms: trackMs, plays: 1 } },
    };
    defaultB.tracksMap.set(songId, tr);

    artistNames.forEach(name => {
      const key = name.toLowerCase();
      let ar = defaultB.artistsMap.get(key);
      if (!ar) {
        ar = { name, sub: null, art: tr.art, id: null, ms: 0, plays: 0, key, days: {} };
        defaultB.artistsMap.set(key, ar);
      }
      ar.ms += trackMs;
      ar.plays += 1;
    });

    if (album) {
      const key = album.toLowerCase();
      let al = defaultB.albumsMap.get(key);
      if (!al) {
        al = { name: album, sub: null, art: tr.art, id: null, ms: 0, plays: 0, key, days: {} };
        defaultB.albumsMap.set(key, al);
      }
      al.ms += trackMs;
      al.plays += 1;
    }
  });

  const searchHistoryTable = actualTable(tables, "search_history");
  let searchHistoryPref: BitChordPrefValue | undefined;
  if (searchHistoryTable) {
    const searchRows = rows(sourceDb, searchHistoryTable);
    if (searchRows.length > 0) {
      const searchItems = searchRows.map(r => ({
        id: text(r.id) || text(r.query) || "query",
        title: text(r.query) || text(r.title) || "",
        subtitle: "",
        artworkUrl: "",
        entityType: "TRACK",
        timestamp: number(r.timestamp) || now.getTime(),
      }));
      searchHistoryPref = {
        type: "string",
        value: JSON.stringify(searchItems),
        values: [],
      };
    }
  }

  const listeningBuckets: BitChordBucket[] = Array.from(bucketsByMonth.entries()).map(([month, b]) => ({
    version: 1,
    month,
    tracks: Array.from(b.tracksMap.values()),
    artists: Array.from(b.artistsMap.values()),
    albums: Array.from(b.albumsMap.values()),
    hours: b.hours,
    days: b.days,
    trackDays: b.trackDays,
    artistDays: {},
    albumDays: {},
  }));

  const settings: Record<string, BitChordPrefValue> = {
    high_performance_mode: { type: "bool", value: "true", values: [] },
    sync_downloaded_playlists: { type: "bool", value: "true", values: [] },
    audio_quality_download: { type: "string", value: "LOSSLESS", values: [] },
  };
  if (searchHistoryPref) settings.search_history = searchHistoryPref;

  const bitchordPayload: BitChordBackup = {
    app: "bitchord",
    version: 1,
    versionName: "1.9",
    exportedAt: now.toISOString(),
    settings,
    listening: listeningBuckets,
  };

  const totalTracks = listeningBuckets.reduce((acc, b) => acc + b.tracks.length, 0);
  const totalArtists = listeningBuckets.reduce((acc, b) => acc + (b.artists?.length ?? 0), 0);
  const totalAlbums = listeningBuckets.reduce((acc, b) => acc + (b.albums?.length ?? 0), 0);

  return {
    payload: bitchordPayload,
    report: {
      sourceFileName,
      sourceApplication,
      months: listeningBuckets.length,
      tracks: totalTracks,
      artists: totalArtists,
      albums: totalAlbums,
    },
  };
}

export async function exportMetrolistToBitChord(file: File, onStage: (stage: Stage) => void): Promise<BrowserBitChordExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "Metrolist" || !source.dbBytes) throw new Error("detecting: Upload a Metrolist .backup, .zip, or SQLite database to create a BitChord backup file.");
  const sourceDb = new SQL.Database(source.dbBytes);
  try {
    onStage("merging"); const converted = mapSqliteBackupToBitChord(sourceDb, source.name, "Metrolist");
    onStage("validating"); return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
  } finally { sourceDb.close(); }
}

export async function exportArchiveTuneToBitChord(file: File, onStage: (stage: Stage) => void): Promise<BrowserBitChordExport> {
  onStage("detecting"); SQL = await sql();
  const source = await extract(file, 0);
  if (source.app !== "ArchiveTune" || !source.dbBytes) throw new Error("detecting: Upload an ArchiveTune .backup, .zip, or SQLite database to create a BitChord backup file.");
  const sourceDb = new SQL.Database(source.dbBytes);
  try {
    onStage("merging"); const converted = mapSqliteBackupToBitChord(sourceDb, source.name, "ArchiveTune");
    onStage("validating"); return { report: converted.report, output: new Blob([JSON.stringify(converted.payload, null, 2)], { type: "application/json" }) };
  } finally { sourceDb.close(); }
}

export function mergeBitChordBackups(backups: BitChordBackup[], sourceNames: string[]): { payload: BitChordBackup; report: BitChordExportReport } {
  const mergedBuckets = new Map<string, {
    tracksMap: Map<string, BitChordTrack>;
    artistsMap: Map<string, BitChordNameEntry>;
    albumsMap: Map<string, BitChordNameEntry>;
    hours: number[];
    days: Record<string, number>;
    trackDays: Record<string, BitChordDayStats>;
    artistDays: Record<string, BitChordDayStats>;
    albumDays: Record<string, BitChordDayStats>;
  }>();

  const mergedSettings: Record<string, BitChordPrefValue> = {
    high_performance_mode: { type: "bool", value: "true", values: [] },
    sync_downloaded_playlists: { type: "bool", value: "true", values: [] },
    audio_quality_download: { type: "string", value: "LOSSLESS", values: [] },
  };

  const combinedSearchHistory: Row[] = [];
  const seenSearchIds = new Set<string>();

  backups.forEach(backup => {
    // Merge settings
    if (backup.settings) {
      Object.entries(backup.settings).forEach(([k, v]) => {
        if (k === "search_history") {
          try {
            const parsed = JSON.parse(v.value || "[]");
            if (Array.isArray(parsed)) {
              parsed.forEach(item => {
                const id = String(item.id || item.title || "");
                if (id && !seenSearchIds.has(id)) {
                  seenSearchIds.add(id);
                  combinedSearchHistory.push(item);
                }
              });
            }
          } catch {
            // ignore
          }
        } else if (!mergedSettings[k]) {
          mergedSettings[k] = v;
        }
      });
    }

    // Merge buckets
    backup.listening.forEach(bucket => {
      const month = bucket.month;
      let target = mergedBuckets.get(month);
      if (!target) {
        target = {
          tracksMap: new Map(),
          artistsMap: new Map(),
          albumsMap: new Map(),
          hours: Array(24).fill(0),
          days: {},
          trackDays: {},
          artistDays: {},
          albumDays: {},
        };
        mergedBuckets.set(month, target);
      }

      // Merge hours
      if (bucket.hours) {
        bucket.hours.forEach((h, idx) => {
          if (idx < 24) target!.hours[idx] = (target!.hours[idx] ?? 0) + number(h);
        });
      }

      // Merge days
      if (bucket.days) {
        Object.entries(bucket.days).forEach(([d, ms]) => {
          target!.days[d] = (target!.days[d] ?? 0) + number(ms);
        });
      }

      // Merge tracks
      bucket.tracks.forEach(tr => {
        const existing = target!.tracksMap.get(tr.id);
        if (existing) {
          existing.ms = (existing.ms ?? 0) + (tr.ms ?? 0);
          existing.plays = (existing.plays ?? 0) + (tr.plays ?? 0);
          existing.last = Math.max(existing.last ?? 0, tr.last ?? 0);
          if (!existing.art && tr.art) existing.art = tr.art;
          if (!existing.album && tr.album) existing.album = tr.album;
          if (tr.days) {
            existing.days ??= {};
            Object.entries(tr.days).forEach(([dk, ds]) => {
              existing.days![dk] = {
                ms: (existing.days![dk]?.ms ?? 0) + (ds.ms ?? 0),
                plays: (existing.days![dk]?.plays ?? 0) + (ds.plays ?? 0),
              };
            });
          }
        } else {
          target!.tracksMap.set(tr.id, { ...tr, days: tr.days ? { ...tr.days } : undefined });
        }
      });

      // Merge artists
      bucket.artists?.forEach(ar => {
        const key = ar.key || ar.name.toLowerCase();
        const existing = target!.artistsMap.get(key);
        if (existing) {
          existing.ms = (existing.ms ?? 0) + (ar.ms ?? 0);
          existing.plays = (existing.plays ?? 0) + (ar.plays ?? 0);
          if (!existing.art && ar.art) existing.art = ar.art;
          if (ar.days) {
            existing.days ??= {};
            Object.entries(ar.days).forEach(([dk, ds]) => {
              existing.days![dk] = {
                ms: (existing.days![dk]?.ms ?? 0) + (ds.ms ?? 0),
                plays: (existing.days![dk]?.plays ?? 0) + (ds.plays ?? 0),
              };
            });
          }
        } else {
          target!.artistsMap.set(key, { ...ar, days: ar.days ? { ...ar.days } : undefined });
        }
      });

      // Merge albums
      bucket.albums?.forEach(al => {
        const key = al.key || al.name.toLowerCase();
        const existing = target!.albumsMap.get(key);
        if (existing) {
          existing.ms = (existing.ms ?? 0) + (al.ms ?? 0);
          existing.plays = (existing.plays ?? 0) + (al.plays ?? 0);
          if (!existing.art && al.art) existing.art = al.art;
        } else {
          target!.albumsMap.set(key, { ...al });
        }
      });
    });
  });

  if (combinedSearchHistory.length > 0) {
    mergedSettings.search_history = {
      type: "string",
      value: JSON.stringify(combinedSearchHistory),
      values: [],
    };
  }

  const resultBuckets: BitChordBucket[] = Array.from(mergedBuckets.entries()).map(([month, b]) => ({
    version: 1,
    month,
    tracks: Array.from(b.tracksMap.values()),
    artists: Array.from(b.artistsMap.values()),
    albums: Array.from(b.albumsMap.values()),
    hours: b.hours,
    days: b.days,
    trackDays: b.trackDays,
    artistDays: b.artistDays,
    albumDays: b.albumDays,
  }));

  const payload: BitChordBackup = {
    app: "bitchord",
    version: 1,
    versionName: "1.9",
    exportedAt: new Date().toISOString(),
    settings: mergedSettings,
    listening: resultBuckets,
  };

  const totalTracks = resultBuckets.reduce((acc, b) => acc + b.tracks.length, 0);
  const totalArtists = resultBuckets.reduce((acc, b) => acc + (b.artists?.length ?? 0), 0);
  const totalAlbums = resultBuckets.reduce((acc, b) => acc + (b.albums?.length ?? 0), 0);

  return {
    payload,
    report: {
      sourceFileName: sourceNames.join(", "),
      sourceApplication: "BitChord",
      months: resultBuckets.length,
      tracks: totalTracks,
      artists: totalArtists,
      albums: totalAlbums,
    },
  };
}

export async function mergeBitChordFiles(files: File[], onStage: (stage: Stage) => void): Promise<BrowserBitChordExport> {
  if (files.length < 2) throw new Error("uploading: Select at least two BitChord backup files to merge.");
  onStage("detecting");
  const extractedList = await Promise.all(files.map(extract));
  const bitchordBackups: BitChordBackup[] = [];
  extractedList.forEach(ext => {
    if (ext.app !== "BitChord" || !ext.bitchord) throw new Error(`detecting: ${ext.name} is not a valid BitChord backup JSON file.`);
    bitchordBackups.push(ext.bitchord);
  });
  onStage("merging");
  const merged = mergeBitChordBackups(bitchordBackups, files.map(f => f.name));
  onStage("validating");
  return {
    report: merged.report,
    output: new Blob([JSON.stringify(merged.payload, null, 2)], { type: "application/json" }),
  };
}
