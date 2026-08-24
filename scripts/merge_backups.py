#!/usr/bin/env python3
"""SQLite backup inspection and Metrolist-compatible merge worker."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

SQLITE_HEADER = b"SQLite format 3\x00"
MERGE_TABLES = ["artist", "album", "song", "format", "playlist", "album_artist_map", "song_album_map", "song_artist_map", "set_video_id", "playCount"]
SUPPORTED = set(MERGE_TABLES + ["lyrics", "event", "search_history", "related_song_map", "playlist_song_map", "android_metadata", "room_master_table", "sqlite_sequence"])


class MergeError(Exception):
    pass


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def table_exists(con: sqlite3.Connection, schema: str, table: str) -> bool:
    return bool(con.execute(f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?", (table,)).fetchone())


def cols(con: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [row[1] for row in con.execute(f"PRAGMA {schema}.table_info({q(table)})")]


def pks(con: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in sorted(con.execute(f"PRAGMA main.table_info({q(table)})").fetchall(), key=lambda row: row[5]) if row[5]]


def count(con: sqlite3.Connection, table: str) -> int:
    return int(con.execute(f"SELECT count(*) FROM main.{q(table)}").fetchone()[0])


def find_database(zip_file: zipfile.ZipFile):
    members = [member for member in zip_file.infolist() if not member.is_dir()]
    members.sort(key=lambda member: (0 if Path(member.filename).name.lower() == "song.db" else 1 if member.filename.lower().endswith(".db") else 2, member.filename))
    for member in members:
        with zip_file.open(member) as handle:
            if handle.read(16) == SQLITE_HEADER:
                return member
    return None


def extract_backup(input_path: Path, workspace: Path, index: int):
    try:
        archive = zipfile.ZipFile(input_path)
    except zipfile.BadZipFile as exc:
        raise MergeError(f"detecting: {input_path.name} is not a readable backup archive.") from exc
    with archive:
        if archive.testzip() is not None:
            raise MergeError(f"detecting: {input_path.name} is not a readable backup archive.")
        database = find_database(archive)
        if not database:
            raise MergeError(f"detecting: {input_path.name} does not contain a SQLite database.")
        folder = workspace / f"input-{index}"
        folder.mkdir(parents=True, exist_ok=True)
        db_path = folder / "song.db"
        with archive.open(database) as source, db_path.open("wb") as target:
            shutil.copyfileobj(source, target)
        for suffix in ("-wal", "-shm"):
            entry = archive.getinfo(f"{database.filename}{suffix}") if f"{database.filename}{suffix}" in archive.namelist() else None
            if entry:
                with archive.open(entry) as source, Path(str(db_path) + suffix).open("wb") as target:
                    shutil.copyfileobj(source, target)
        preferences = None
        for member in archive.infolist():
            if Path(member.filename).name == "settings.preferences_pb":
                preferences = archive.read(member)
                break

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = {row[0]: cols(con, "main", row[0]) for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.DatabaseError as exc:
        raise MergeError(f"detecting: {input_path.name} contains an unsupported SQLite database.") from exc
    finally:
        con.close()
    song_cols = set(tables.get("song", []))
    score = 0
    if "metrolist" in input_path.name.lower(): score += 80
    if preferences: score += 35
    if "speed_dial_item" in tables: score += 20
    if len({"libraryAddToken", "lyricsOffset", "isUploaded", "isVideo"} & song_cols) >= 3: score += 35
    if {"song", "artist", "playlist"}.issubset(tables): score += 10
    return {"name": input_path.name, "db": db_path, "preferences": preferences, "tables": tables, "score": score}


def pick_target(backups):
    ordered = sorted(backups, key=lambda backup: backup["score"], reverse=True)
    target = ordered[0] if ordered else None
    if not target or target["score"] < 35:
        raise MergeError("detecting: a Metrolist backup could not be identified.")
    if len(ordered) > 1 and ordered[1]["score"] == target["score"] and target["score"] >= 35:
        raise MergeError("detecting: more than one Metrolist backup was detected. Upload one target backup only.")
    return target, [backup for backup in backups if backup is not target]


def merge_same_table(con: sqlite3.Connection, schema: str, table: str, report):
    if not table_exists(con, "main", table) or not table_exists(con, schema, table):
        return
    common = [column for column in cols(con, "main", table) if column in set(cols(con, schema, table))]
    if not common or not pks(con, table):
        return
    before = count(con, table)
    names = ", ".join(q(column) for column in common)
    try:
        con.execute(f"INSERT OR IGNORE INTO main.{q(table)} ({names}) SELECT {names} FROM {schema}.{q(table)}")
    except sqlite3.DatabaseError:
        report["skippedTables"].append(table)
        return
    inserted = count(con, table) - before
    labels = {"song": "songs", "artist": "artists", "album": "albums", "playlist": "playlists"}
    if table in labels:
        report["counts"][labels[table]] += inserted


def merge_lyrics(con: sqlite3.Connection, schema: str, report):
    if not table_exists(con, "main", "lyrics") or not table_exists(con, schema, "lyrics"):
        return
    source_cols = set(cols(con, schema, "lyrics"))
    if not {"id", "lyrics"}.issubset(source_cols):
        report["skippedTables"].append("lyrics")
        return
    provider = f"{schema}.\"lyrics\".\"provider\"" if "provider" in source_cols else f"{schema}.\"lyrics\".\"source\"" if "source" in source_cols else "'Imported'"
    before = count(con, "lyrics")
    con.execute(f"INSERT OR IGNORE INTO main.\"lyrics\" (\"id\", \"lyrics\", \"provider\", \"translatedLyrics\", \"translationLanguage\", \"translationMode\") SELECT \"id\", \"lyrics\", COALESCE(NULLIF({provider}, ''), 'Imported'), '', '', '' FROM {schema}.\"lyrics\"")
    report["counts"]["lyrics"] += count(con, "lyrics") - before


def merge_events(con: sqlite3.Connection, schema: str, report):
    if not table_exists(con, "main", "event") or not table_exists(con, schema, "event"):
        return
    if not {"songId", "timestamp", "playTime"}.issubset(set(cols(con, schema, "event"))):
        report["skippedTables"].append("event")
        return
    before = count(con, "event")
    con.execute(f"INSERT INTO main.\"event\" (\"songId\", \"timestamp\", \"playTime\") SELECT \"songId\", \"timestamp\", \"playTime\" FROM {schema}.\"event\"")
    report["counts"]["events"] += count(con, "event") - before


def merge_extras(con: sqlite3.Connection, schema: str):
    if table_exists(con, "main", "search_history") and table_exists(con, schema, "search_history") and "query" in cols(con, schema, "search_history"):
        con.execute(f"INSERT OR IGNORE INTO main.\"search_history\" (\"query\") SELECT \"query\" FROM {schema}.\"search_history\"")
    if table_exists(con, "main", "related_song_map") and table_exists(con, schema, "related_song_map") and {"songId", "relatedSongId"}.issubset(set(cols(con, schema, "related_song_map"))):
        con.execute(f"INSERT INTO main.\"related_song_map\" (\"songId\", \"relatedSongId\") SELECT source.\"songId\", source.\"relatedSongId\" FROM {schema}.\"related_song_map\" source WHERE NOT EXISTS (SELECT 1 FROM main.\"related_song_map\" target WHERE target.\"songId\" = source.\"songId\" AND target.\"relatedSongId\" = source.\"relatedSongId\")")
    if table_exists(con, "main", "playlist_song_map") and table_exists(con, schema, "playlist_song_map") and {"playlistId", "songId", "position"}.issubset(set(cols(con, schema, "playlist_song_map"))):
        source_cols = set(cols(con, schema, "playlist_song_map"))
        set_video = 'source."setVideoId"' if "setVideoId" in source_cols else "NULL"
        con.execute(f"INSERT INTO main.\"playlist_song_map\" (\"playlistId\", \"songId\", \"position\", \"setVideoId\") SELECT source.\"playlistId\", source.\"songId\", source.\"position\", {set_video} FROM {schema}.\"playlist_song_map\" source WHERE EXISTS (SELECT 1 FROM main.\"playlist\" playlist WHERE playlist.\"id\" = source.\"playlistId\") AND EXISTS (SELECT 1 FROM main.\"song\" song WHERE song.\"id\" = source.\"songId\") AND NOT EXISTS (SELECT 1 FROM main.\"playlist_song_map\" target WHERE target.\"playlistId\" = source.\"playlistId\" AND target.\"songId\" = source.\"songId\" AND target.\"position\" = source.\"position\")")


def inspect(inputs):
    with tempfile.TemporaryDirectory(prefix="inspect-") as name:
        workspace = Path(name)
        backups = [extract_backup(Path(file), workspace, index) for index, file in enumerate(inputs)]
        target, _ = pick_target(backups)
        return {"files": [{"name": backup["name"], "role": "target" if backup is target else "source", "confidence": "high" if backup is target and backup["score"] >= 80 else "medium", "tables": len(backup["tables"])} for backup in backups]}


def merge(inputs, output):
    with tempfile.TemporaryDirectory(prefix="merge-") as name:
        workspace = Path(name)
        backups = [extract_backup(Path(file), workspace, index) for index, file in enumerate(inputs)]
        target, sources = pick_target(backups)
        output_db = workspace / "song.db"
        source_con = sqlite3.connect(f"file:{target['db']}?mode=ro", uri=True)
        target_con = sqlite3.connect(output_db)
        try:
            source_con.backup(target_con)
        finally:
            source_con.close()
        report = {"counts": {"songs": 0, "artists": 0, "albums": 0, "playlists": 0, "lyrics": 0, "events": 0}, "skippedTables": [], "targetFileName": target["name"], "sourceFileNames": [source["name"] for source in sources]}
        target_con.execute("PRAGMA foreign_keys=OFF")
        try:
            for index, source in enumerate(sources):
                schema = f"source_{index}"
                target_con.execute(f"ATTACH DATABASE ? AS {q(schema)}", (str(source["db"]),))
                try:
                    target_con.execute("BEGIN")
                    for table in MERGE_TABLES:
                        merge_same_table(target_con, schema, table, report)
                    merge_lyrics(target_con, schema, report)
                    merge_events(target_con, schema, report)
                    merge_extras(target_con, schema)
                    target_con.commit()
                    report["skippedTables"].extend(table for table in source["tables"] if table not in SUPPORTED and table not in report["skippedTables"])
                except Exception:
                    target_con.rollback()
                    raise
                finally:
                    target_con.execute(f"DETACH DATABASE {q(schema)}")
            target_con.execute("PRAGMA foreign_keys=ON")
            target_con.execute("VACUUM")
            integrity = target_con.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise MergeError("validating: SQLite integrity check failed.")
            if target_con.execute("PRAGMA foreign_key_check").fetchall():
                raise MergeError("validating: foreign-key validation failed.")
        finally:
            target_con.close()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.write(output_db, "song.db")
            if target["preferences"]:
                archive.writestr("settings.preferences_pb", target["preferences"])
        return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["inspect", "merge"])
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.command == "merge" and not args.output:
        parser.error("--output is required for merge")
    try:
        result = inspect(args.input) if args.command == "inspect" else merge(args.input, args.output)
        print(json.dumps(result))
    except MergeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("validating: The merge could not be completed.", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
