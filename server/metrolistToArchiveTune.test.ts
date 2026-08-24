import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { mergeMetrolistIntoArchiveTuneDatabase } from "../client/src/lib/browserMerger";

describe("Metrolist to ArchiveTune target merge", () => {
  it("merges shared library rows, preserves target-only schema, and avoids generated map-id collisions", async () => {
    const SQL = await initSqlJs({ wasmBinary: readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url)) });
    const source = new SQL.Database();
    const target = new SQL.Database();
    try {
      for (const db of [source, target]) {
        db.run("CREATE TABLE artist (id TEXT PRIMARY KEY, name TEXT NOT NULL, lastUpdateTime INTEGER NOT NULL, isLocal INTEGER NOT NULL)");
        db.run("CREATE TABLE album (id TEXT PRIMARY KEY, title TEXT NOT NULL, songCount INTEGER NOT NULL, duration INTEGER NOT NULL, explicit INTEGER NOT NULL, lastUpdateTime INTEGER NOT NULL, isLocal INTEGER NOT NULL)");
        db.run("CREATE TABLE song (id TEXT PRIMARY KEY, title TEXT NOT NULL, duration INTEGER NOT NULL, explicit INTEGER NOT NULL, liked INTEGER NOT NULL, totalPlayTime INTEGER NOT NULL, isLocal INTEGER NOT NULL)");
        db.run("CREATE TABLE playlist (id TEXT PRIMARY KEY, name TEXT NOT NULL, isEditable INTEGER NOT NULL, isLocal INTEGER NOT NULL)");
        db.run("CREATE TABLE song_artist_map (songId TEXT NOT NULL, artistId TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(songId, artistId))");
        db.run("CREATE TABLE song_album_map (songId TEXT NOT NULL, albumId TEXT NOT NULL, 'index' INTEGER NOT NULL, PRIMARY KEY(songId, albumId))");
        db.run("CREATE TABLE playlist_song_map (id INTEGER PRIMARY KEY AUTOINCREMENT, playlistId TEXT NOT NULL, songId TEXT NOT NULL, position INTEGER NOT NULL, setVideoId TEXT)");
        db.run("CREATE TABLE lyrics (id TEXT PRIMARY KEY, lyrics TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'REMOTE', updatedAt INTEGER NOT NULL DEFAULT 0)");
        db.run("CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, songId TEXT NOT NULL, timestamp INTEGER NOT NULL, playTime INTEGER NOT NULL)");
      }
      target.run("CREATE TABLE archive_tune_only (id INTEGER PRIMARY KEY, retained TEXT NOT NULL)");
      target.run("INSERT INTO archive_tune_only VALUES (1, 'keep')");
      target.run("INSERT INTO playlist VALUES ('target-playlist', 'Existing target list', 1, 1)");
      target.run("INSERT INTO song VALUES ('target-song', 'Existing target song', 1, 0, 0, 0, 0)");
      target.run("INSERT INTO playlist_song_map (playlistId, songId, position) VALUES ('target-playlist', 'target-song', 0)");
      source.run("INSERT INTO artist VALUES ('artist-1', 'Metrolist artist', 100, 0)");
      source.run("INSERT INTO album VALUES ('album-1', 'Metrolist album', 1, 240, 0, 100, 0)");
      source.run("INSERT INTO song VALUES ('song-1', 'Metrolist track', 240, 0, 1, 80, 0)");
      source.run("INSERT INTO playlist VALUES ('playlist-1', 'Metrolist list', 1, 1)");
      source.run("INSERT INTO song_artist_map VALUES ('song-1', 'artist-1', 0)");
      source.run("INSERT INTO song_album_map VALUES ('song-1', 'album-1', 0)");
      source.run("INSERT INTO playlist_song_map (id, playlistId, songId, position) VALUES (1, 'playlist-1', 'song-1', 0)");
      source.run("INSERT INTO lyrics (id, lyrics) VALUES ('song-1', 'Metrolist lyrics')");
      source.run("INSERT INTO event (id, songId, timestamp, playTime) VALUES (1, 'song-1', 101, 22)");
      const report = mergeMetrolistIntoArchiveTuneDatabase(target, source, "ArchiveTune.backup", "Metrolist.backup");
      expect(report.counts).toMatchObject({ songs: 1, artists: 1, albums: 1, playlists: 1, lyrics: 1, events: 1 });
      expect(target.exec("SELECT count(*) FROM playlist_song_map")[0]?.values).toEqual([[2]]);
      expect(target.exec("SELECT retained FROM archive_tune_only")[0]?.values).toEqual([["keep"]]);
      expect(target.exec("SELECT source, updatedAt FROM lyrics WHERE id = 'song-1'")[0]?.values).toEqual([["REMOTE", 0]]);
      expect(target.exec("PRAGMA integrity_check")[0]?.values).toEqual([["ok"]]);
    } finally { source.close(); target.close(); }
  });
});
