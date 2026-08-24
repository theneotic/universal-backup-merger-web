import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import JSZip from "jszip";
import { createPortablePlaylistBundle, mapSqliteBackupToPortablePlaylists } from "../client/src/lib/browserMerger";

describe("portable playlist exports", () => {
  it("writes a destination-neutral CSV package that preserves playlist boundaries and source fields", async () => {
    const result = await createPortablePlaylistBundle([{ name: "Road, trip", tracks: [{ title: "A \"quoted\" song", artists: ["Artist One", "Artist Two"], album: "Album", durationSeconds: 245, sourceUrl: "https://music.example/watch?v=1" }] }], "csv", "source.backup", "ArchiveTune");
    expect(result.report).toMatchObject({ sourceApplication: "ArchiveTune", format: "csv", playlists: 1, tracks: 1, skippedTracks: 0 });
    const zip = await JSZip.loadAsync(await result.output.arrayBuffer());
    expect(await zip.file("README.txt")?.async("string")).toContain("not a native application database backup");
    expect(await zip.file("csv/01_Road_trip.csv")?.async("string")).toBe('title,artist,album,duration_seconds,source_url\n"A ""quoted"" song",Artist One; Artist Two,Album,245,https://music.example/watch?v=1');
  });

  it("writes Extended M3U playlists with a conservative no-URL marker when no resolver URL exists", async () => {
    const result = await createPortablePlaylistBundle([{ name: "Late night", tracks: [{ title: "Moonlight", artists: ["Example artist"], durationSeconds: 201 }] }], "m3u", "source.backup", "RiPlay");
    const zip = await JSZip.loadAsync(await result.output.arrayBuffer());
    expect(await zip.file("m3u/01_Late_night.m3u")?.async("string")).toBe("#EXTM3U\n#PLAYLIST:Late night\n#EXTINF:201,Example artist - Moonlight\n#NOURL:Moonlight");
  });

  it("normalizes a SQLite playlist schema without fabricating a destination database", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const db = new SQL.Database();
    try {
      db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT, albumName TEXT, duration INTEGER)");
      db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE playlist (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)");
      db.run("CREATE TABLE playlist_song_map (playlistId TEXT, songId TEXT, position INTEGER)");
      db.run("INSERT INTO song VALUES ('song-1', 'Portable track', 'Portable album', 187)");
      db.run("INSERT INTO artist VALUES ('artist-1', 'Portable artist')");
      db.run("INSERT INTO playlist VALUES ('playlist-1', 'Portable list')");
      db.run("INSERT INTO song_artist_map VALUES ('song-1', 'artist-1', 0)");
      db.run("INSERT INTO playlist_song_map VALUES ('playlist-1', 'song-1', 0)");
      const mapped = mapSqliteBackupToPortablePlaylists(db, { app: "ArchiveTune", tables: ["song", "artist", "playlist", "song_artist_map", "playlist_song_map"] });
      expect(mapped.skippedTracks).toBe(0);
      expect(mapped.playlists).toEqual([{ name: "Portable list", tracks: [{ title: "Portable track", artists: ["Portable artist"], album: "Portable album", durationSeconds: 187, artwork: undefined, sourceUrl: undefined }] }]);
    } finally { db.close(); }
  });
});
