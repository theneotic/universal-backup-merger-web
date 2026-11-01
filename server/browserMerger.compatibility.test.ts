import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import {
  inspectBloomeeNativeSnapshot,
  mapArchiveTuneToBloomee,
  mapBitChordBackup,
  mapBitChordToBloomee,
  mapBloomeePortableBackup,
  mapBloomeeToBitChord,
  mapMetrolistToBloomee,
  mapSqliteBackupToBitChord,
  mergeBitChordBackup,
  mergeBitChordBackups,
  mergeBitChordIntoArchiveTuneDatabase,
  mergeBloomeeIntoArchiveTuneDatabase,
  mergeBloomeePortableBackup,
  parseBitChordBackup,
  parseBloomeePortableBackup,
  portablePlaylistsFromBitChord,
  supportedApplicationNames,
  unsupportedContainerNotes,
  type MergeReport,
} from "../client/src/lib/browserMerger";

function createMetrolistTargetSchema(db: Awaited<ReturnType<typeof initSqlJs>>["Database"]) {
  db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT NOT NULL, thumbnailUrl TEXT, channelId TEXT, lastUpdateTime INTEGER NOT NULL, bookmarkedAt INTEGER, isLocal INTEGER NOT NULL)");
  db.run("CREATE TABLE album (id TEXT PRIMARY KEY, playlistId TEXT, title TEXT NOT NULL, year TEXT, thumbnailUrl TEXT, songCount INTEGER NOT NULL, duration INTEGER NOT NULL, explicit INTEGER NOT NULL, lastUpdateTime INTEGER NOT NULL, bookmarkedAt INTEGER, inLibrary INTEGER, isLocal INTEGER NOT NULL)");
  db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT, duration INTEGER, thumbnailUrl TEXT, albumId TEXT, albumName TEXT, explicit INTEGER, year TEXT, date TEXT, dateModified INTEGER, liked INTEGER, likedDate INTEGER, totalPlayTime INTEGER, inLibrary INTEGER, dateDownload INTEGER, isLocal INTEGER)");
  db.run("CREATE TABLE playlist (id TEXT PRIMARY KEY, name TEXT, browseId TEXT, createdAt INTEGER, lastUpdateTime INTEGER, isEditable INTEGER, bookmarkedAt INTEGER, thumbnailUrl TEXT, remoteSongCount INTEGER, isLocal INTEGER)");
  db.run("CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)");
  db.run("CREATE TABLE song_album_map (songId TEXT, albumId TEXT, 'index' INTEGER)");
  db.run("CREATE TABLE playlist_song_map (playlistId TEXT, songId TEXT, position INTEGER, setVideoId TEXT)");
  db.run("CREATE TABLE lyrics (id TEXT, lyrics TEXT, provider TEXT, translatedLyrics TEXT, translationLanguage TEXT, translationMode TEXT)");
  db.run("CREATE TABLE event (songId TEXT, timestamp INTEGER, playTime INTEGER)");
}

function report(): MergeReport { return { counts: { songs: 0, artists: 0, albums: 0, playlists: 0, lyrics: 0, events: 0 }, skippedTables: [], targetFileName: "Metrolist.backup", sourceFileNames: ["bloomee-portable.json"] }; }

describe("cross-application backup compatibility", () => {
  it("declares every browser-mapped SQLite music application", () => {
    expect(supportedApplicationNames).toEqual(["Metrolist", "ArchiveTune", "OuterTune", "EchoMusic", "SimpMusic", "RiPlay", "Bloomee JSON export", "BitChord JSON backup"]);
  });

  it("recognizes Bloomee's portable playlist and media export structure", () => {
    const parsed = parseBloomeePortableBackup({
      playlists: [{ playlistName: "Library import", createdAt: "2026-08-22T00:00:00.000Z" }],
      media_items: [{ mediaID: "song-1", title: "Example track", artist: "Example artist", mediaInPlaylists: [{ playlistName: "Library import" }] }],
    });
    expect(parsed?.playlists).toHaveLength(1);
    expect(parsed?.mediaItems[0]?.mediaID).toBe("song-1");
  });

  it("maps portable Bloomee tracks, playlists, and relationship rows for the Metrolist target", () => {
    const parsed = parseBloomeePortableBackup({
      playlists: [{ playlistName: "Road trip", createdAt: "2026-08-22T00:00:00.000Z" }, { playlistName: "Night drive", createdAt: "2026-08-21T00:00:00.000Z" }],
      media_items: [{ mediaID: "track-42", title: "Skyline", artist: "Artist One, Artist Two", album: "Long Way Home", artURL: "https://images.example/skyline.jpg", duration: 243, mediaInPlaylists: [{ playlistName: "Road trip" }, { playlistName: "Night drive" }] }],
    });
    expect(parsed).not.toBeNull();
    const mapped = mapBloomeePortableBackup(parsed!, "bloomee-portable.json");
    expect(mapped.playlists).toHaveLength(2);
    expect(mapped.songs).toMatchObject([{ id: "track-42", title: "Skyline", albumName: "Long Way Home", duration: 243 }]);
    expect(mapped.artists.map(row => row.name)).toEqual(["Artist One", "Artist Two"]);
    expect(mapped.albums).toMatchObject([{ title: "Long Way Home" }]);
    expect(mapped.songArtists).toHaveLength(2);
    expect(mapped.songAlbums).toHaveLength(1);
    expect(mapped.playlistSongs.map(row => row.songId)).toEqual(["track-42", "track-42"]);
  });

  it("normalizes Bloomee YouTube Music resolver IDs before inserting source-library records", () => {
    const parsed = parseBloomeePortableBackup({
      playlists: [{ playlistName: "Resolver test", createdAt: "2026-08-27T00:00:00.000Z" }],
      media_items: [{ mediaID: "content-resolver.bloomfactory.ytmusic::abc123", title: "Resolver track", artist: "Resolver artist", mediaInPlaylists: [{ playlistName: "Resolver test" }] }],
    });
    const mapped = mapBloomeePortableBackup(parsed!, "bloomee-portable.json");
    expect(mapped.songs[0]?.id).toBe("abc123");
    expect(mapped.songArtists[0]?.songId).toBe("abc123");
    expect(mapped.playlistSongs[0]?.songId).toBe("abc123");
  });

  it("merges Bloomee portable records into the expected Metrolist target tables", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      createMetrolistTargetSchema(db);
      const payload = parseBloomeePortableBackup({
        playlists: [{ playlistName: "Road trip", createdAt: "2026-08-22T00:00:00.000Z" }, { playlistName: "Night drive", createdAt: "2026-08-21T00:00:00.000Z" }],
        media_items: [{ mediaID: "track-42", title: "Skyline", artist: "Artist One, Artist Two", album: "Long Way Home", artURL: "https://images.example/skyline.jpg", duration: 243, mediaInPlaylists: [{ playlistName: "Road trip" }, { playlistName: "Night drive" }] }],
      });
      expect(payload).not.toBeNull();
      const mergeReport = report();
      mergeBloomeePortableBackup(db, payload!, "bloomee-portable.json", mergeReport);
      expect(mergeReport.counts).toMatchObject({ songs: 1, artists: 2, albums: 1, playlists: 2, lyrics: 0, events: 0 });
      expect(db.exec("SELECT id, title, albumName, duration FROM song")[0]?.values).toEqual([["track-42", "Skyline", "Long Way Home", 243]]);
      expect(db.exec("SELECT count(*) FROM song_artist_map")[0]?.values).toEqual([[2]]);
      expect(db.exec("SELECT count(*) FROM song_album_map")[0]?.values).toEqual([[1]]);
      expect(db.exec("SELECT count(*) FROM playlist_song_map")[0]?.values).toEqual([[2]]);
    } finally { db.close(); }
  });

  it("maps ArchiveTune playlist tracks into Bloomee's legacy JSON contract with YouTube Music resolver IDs", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT, duration INTEGER, thumbnailUrl TEXT, albumName TEXT)");
      db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE playlist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)");
      db.run("CREATE TABLE playlist_song_map (playlistId TEXT, songId TEXT, position INTEGER)");
      db.run("INSERT INTO song VALUES ('abc123', 'Archive track', 235, 'https://image.example/cover.jpg', 'Archive album')");
      db.run("INSERT INTO artist VALUES ('artist-1', 'Archive artist')");
      db.run("INSERT INTO playlist VALUES ('playlist-1', 'Saved songs'), ('playlist-2', 'saved SONGS'), ('playlist-3', 'Liked')");
      db.run("INSERT INTO song_artist_map VALUES ('abc123', 'artist-1', 0)");
      db.run("INSERT INTO playlist_song_map VALUES ('playlist-1', 'abc123', 0), ('playlist-2', 'abc123', 1), ('playlist-3', 'abc123', 2)");
      const converted = mapArchiveTuneToBloomee(db, "ArchiveTune.backup");
      expect(converted.report).toMatchObject({ playlists: 1, mediaItems: 1, skippedTracks: 0 });
      expect(converted.payload.playlists).toMatchObject([{ playlistName: "ArchiveTune · Saved songs" }]);
      expect(converted.payload.media_items).toMatchObject([{ mediaID: "content-resolver.bloomfactory.ytmusic::abc123", title: "Archive track", artist: "Archive artist", album: "Archive album", duration: 235, permaURL: "https://music.youtube.com/watch?v=abc123", mediaInPlaylists: [{ playlistName: "ArchiveTune · Saved songs" }] }]);
      expect(parseBloomeePortableBackup(converted.payload)).not.toBeNull();
    } finally { db.close(); }
  });

  it("maps Metrolist playlist tracks into the same validated Bloomee legacy-v2 contract", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT, duration INTEGER, thumbnailUrl TEXT, albumName TEXT)");
      db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE playlist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)");
      db.run("CREATE TABLE playlist_song_map (playlistId TEXT, songId TEXT, position INTEGER)");
      db.run("INSERT INTO song VALUES ('metrolist-42', 'Metro track', 201, 'https://image.example/metro.jpg', 'Metro album')");
      db.run("INSERT INTO artist VALUES ('artist-1', 'Metro artist')");
      db.run("INSERT INTO playlist VALUES ('playlist-1', 'Morning')");
      db.run("INSERT INTO song_artist_map VALUES ('metrolist-42', 'artist-1', 0)");
      db.run("INSERT INTO playlist_song_map VALUES ('playlist-1', 'metrolist-42', 0)");
      const converted = mapMetrolistToBloomee(db, "Metrolist.backup");
      expect(converted.payload._meta).toMatchObject({ format: "legacy-v2-full", sourceApplication: "Metrolist" });
      expect(converted.payload.playlists).toMatchObject([{ playlistName: "Metrolist · Morning" }]);
      expect(converted.payload.media_items).toMatchObject([{ mediaID: "content-resolver.bloomfactory.ytmusic::metrolist-42", title: "Metro track", artist: "Metro artist", mediaInPlaylists: [{ playlistName: "Metrolist · Morning" }] }]);
      expect(parseBloomeePortableBackup(converted.payload)).not.toBeNull();
    } finally { db.close(); }
  });

  it("merges portable Bloomee records into an ArchiveTune target while preserving valid SQLite integrity", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      createMetrolistTargetSchema(db);
      const payload = parseBloomeePortableBackup({ playlists: [{ playlistName: "Bloomee import", createdAt: "2026-08-27T00:00:00.000Z" }], media_items: [{ mediaID: "track-b", title: "Bridge track", artist: "Bridge artist", album: "Bridge album", duration: 180, mediaInPlaylists: [{ playlistName: "Bloomee import" }] }] });
      const mergeReport = mergeBloomeeIntoArchiveTuneDatabase(db, payload!, "ArchiveTune.backup", "Bloomee.json");
      expect(mergeReport.counts).toMatchObject({ songs: 1, artists: 1, albums: 1, playlists: 1 });
      expect(db.exec("SELECT count(*) FROM playlist_song_map")[0]?.values).toEqual([[1]]);
      expect(db.exec("PRAGMA integrity_check")[0]?.values).toEqual([["ok"]]);
    } finally { db.close(); }
  });

  it("keeps the unsupported native Bloomee Isar container limitation explicit", () => {
    expect(unsupportedContainerNotes.Bloomee).toContain("Isar");
    expect(unsupportedContainerNotes.Bloomee).toContain("Create Backup (JSON)");
  });

  it("identifies an erased native snapshot as containing no recoverable records", () => {
    const inspected = inspectBloomeeNativeSnapshot(new Uint8Array(12_288).fill(0xff));
    expect(inspected.empty).toBe(true);
    expect(inspected.detail).toContain("empty");
  });

  it("includes BitChord JSON backup in supportedApplicationNames", () => {
    expect(supportedApplicationNames).toContain("BitChord JSON backup");
  });

  it("parses real BitChord backup JSON correctly", () => {
    const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
    const parsed = parseBitChordBackup(JSON.parse(raw));
    expect(parsed).not.toBeNull();
    expect(parsed?.app).toBe("bitchord");
    expect(parsed?.version).toBe(1);
    expect(parsed?.versionName).toBe("1.9");
    expect(parsed?.listening).toHaveLength(1);
    expect(parsed?.listening[0]?.month).toBe("2026-11");
    expect(parsed?.listening[0]?.tracks.length).toBeGreaterThan(0);
    expect(parsed?.listening[0]?.tracks[0]?.id).toBe("cL0KKSPjZf8");
    expect(parsed?.listening[0]?.tracks[0]?.title).toBe("Boom Shaka");
    expect(parsed?.settings?.search_history?.value).toContain("M5OCLifZK1w");
  });

  it("maps BitChord backup tracks, artists, albums, and events for Metrolist target", () => {
    const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
    const parsed = parseBitChordBackup(JSON.parse(raw))!;
    const mapped = mapBitChordBackup(parsed, "bitchord-backup.json");
    expect(mapped.playlists).toHaveLength(1);
    expect(mapped.playlists[0]?.row.name).toBe("BitChord · 2026-11");
    expect(mapped.songs.length).toBeGreaterThanOrEqual(5);
    expect(mapped.songs.some(s => s.id === "cL0KKSPjZf8")).toBe(true);
    expect(mapped.artists.length).toBeGreaterThan(0);
    expect(mapped.events.length).toBeGreaterThan(0);
  });

  it("merges BitChord backup into Metrolist target database", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      createMetrolistTargetSchema(db);
      const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
      const parsed = parseBitChordBackup(JSON.parse(raw))!;
      const mergeReport = report();
      mergeBitChordBackup(db, parsed, "bitchord-backup.json", mergeReport);
      expect(mergeReport.counts.songs).toBeGreaterThan(0);
      expect(mergeReport.counts.artists).toBeGreaterThan(0);
      expect(mergeReport.counts.playlists).toBe(1);
      expect(mergeReport.counts.events).toBeGreaterThan(0);
      expect(db.exec("SELECT count(*) FROM song")[0]?.values[0]?.[0]).toBeGreaterThan(0);
      expect(db.exec("PRAGMA integrity_check")[0]?.values).toEqual([["ok"]]);
    } finally { db.close(); }
  });

  it("merges BitChord backup into ArchiveTune database with integrity check", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      createMetrolistTargetSchema(db);
      const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
      const parsed = parseBitChordBackup(JSON.parse(raw))!;
      const mergeReport = mergeBitChordIntoArchiveTuneDatabase(db, parsed, "ArchiveTune.backup", "bitchord-backup.json");
      expect(mergeReport.counts.songs).toBeGreaterThan(0);
      expect(mergeReport.counts.playlists).toBe(1);
      expect(db.exec("PRAGMA integrity_check")[0]?.values).toEqual([["ok"]]);
    } finally { db.close(); }
  });

  it("exports BitChord to valid Bloomee legacy-v2 JSON payload", () => {
    const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
    const parsed = parseBitChordBackup(JSON.parse(raw))!;
    const converted = mapBitChordToBloomee(parsed, "bitchord-backup.json");
    expect(converted.report.playlists).toBe(1);
    expect(converted.report.mediaItems).toBeGreaterThan(0);
    expect(converted.payload.playlists).toMatchObject([{ playlistName: "BitChord · 2026-11" }]);
    expect(converted.payload.media_items[0]?.mediaID).toContain("content-resolver.bloomfactory.ytmusic::");
    expect(parseBloomeePortableBackup(converted.payload)).not.toBeNull();
  });

  it("exports Bloomee portable backup into BitChord JSON backup format", () => {
    const bloomeePayload = {
      playlists: [{ playlistName: "My Favorites", createdAt: "2026-11-01T00:00:00.000Z" }],
      media_items: [{
        mediaID: "content-resolver.bloomfactory.ytmusic::cL0KKSPjZf8",
        title: "Boom Shaka",
        artist: "Krsna",
        album: "Still Here",
        duration: 210,
        mediaInPlaylists: [{ playlistName: "My Favorites" }],
      }],
    };
    const converted = mapBloomeeToBitChord(bloomeePayload, "Bloomee.json");
    expect(converted.payload.app).toBe("bitchord");
    expect(converted.payload.version).toBe(1);
    expect(converted.payload.listening).toHaveLength(1);
    expect(converted.payload.listening[0]?.tracks).toHaveLength(1);
    expect(converted.payload.listening[0]?.tracks[0]?.id).toBe("cL0KKSPjZf8");
    expect(converted.payload.listening[0]?.tracks[0]?.title).toBe("Boom Shaka");
  });

  it("exports SQLite backup into BitChord JSON backup format", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT, duration INTEGER, thumbnailUrl TEXT, albumName TEXT, dateModified INTEGER, inLibrary INTEGER)");
      db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)");
      db.run("INSERT INTO song VALUES ('song-123', 'Test Song', 180, 'https://art.example/1.jpg', 'Test Album', 1793521182824, 1793521182824)");
      db.run("INSERT INTO artist VALUES ('art-1', 'Artist One')");
      db.run("INSERT INTO song_artist_map VALUES ('song-123', 'art-1', 0)");

      const converted = mapSqliteBackupToBitChord(db, "Metrolist.backup", "Metrolist");
      expect(converted.payload.app).toBe("bitchord");
      expect(converted.payload.version).toBe(1);
      expect(converted.payload.listening[0]?.tracks[0]?.id).toBe("song-123");
      expect(converted.payload.listening[0]?.tracks[0]?.title).toBe("Test Song");
      expect(converted.payload.listening[0]?.artists[0]?.name).toBe("Artist One");
    } finally { db.close(); }
  });

  it("merges multiple BitChord backups into one consolidated BitChord backup", () => {
    const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
    const parsed1 = parseBitChordBackup(JSON.parse(raw))!;
    const parsed2 = parseBitChordBackup(JSON.parse(raw))!;

    const merged = mergeBitChordBackups([parsed1, parsed2], ["backup1.json", "backup2.json"]);
    expect(merged.payload.app).toBe("bitchord");
    expect(merged.payload.listening).toHaveLength(1);
    const track = merged.payload.listening[0]?.tracks.find(t => t.id === "cL0KKSPjZf8");
    expect(track).toBeDefined();
    expect(track?.ms).toBe(5001 * 2);
  });

  it("exports portable playlist bundle from BitChord backup", () => {
    const raw = readFileSync("e:/DOWNLOAD/bitchord-backup-2026-11-01.json", "utf8");
    const parsed = parseBitChordBackup(JSON.parse(raw))!;
    const playlists = portablePlaylistsFromBitChord(parsed);
    expect(playlists).toHaveLength(1);
    expect(playlists[0]?.name).toBe("BitChord · 2026-11");
    expect(playlists[0]?.tracks.length).toBeGreaterThan(0);
    expect(playlists[0]?.tracks[0]?.sourceUrl).toContain("https://music.youtube.com/watch?v=");
  });
});
