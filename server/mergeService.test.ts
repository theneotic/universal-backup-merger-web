import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { inspectBackups, mergeBackups } from "./mergeService";

const fixture = (name: string) => ({
  name,
  buffer: fs.readFileSync(path.join("/home/ubuntu/upload", name)),
});

describe("inspectBackups", () => {
  it("detects the Metrolist backup as the target without relying on upload order", async () => {
    const detected = await inspectBackups([
      fixture("ArchiveTune_20260821180022.backup"),
      fixture("Metrolist_20260821180458.backup"),
    ]);

    expect(detected.find(file => file.role === "target")?.name).toBe("Metrolist_20260821180458.backup");
    expect(detected.filter(file => file.role === "source").map(file => file.name)).toEqual(["ArchiveTune_20260821180022.backup"]);
  });

  it("requires at least two uploaded backups", async () => {
    await expect(inspectBackups([fixture("Metrolist_20260821180458.backup")])).rejects.toThrow("uploading:");
  });

  it("returns exact report labels and a valid downloadable backup", async () => {
    const merged = await mergeBackups([
      fixture("Metrolist_20260821180458.backup"),
      fixture("ArchiveTune_20260821180022.backup"),
    ], () => undefined);

    expect(Object.keys(merged.report.counts)).toEqual(["songs", "artists", "albums", "playlists", "lyrics", "events"]);
    expect(merged.report.counts.songs).toBeGreaterThan(0);
    expect(merged.report.counts.artists).toBeGreaterThan(0);
    const zip = new AdmZip(merged.output);
    expect(zip.getEntry("song.db")).toBeTruthy();
    expect(zip.getEntry("settings.preferences_pb")).toBeTruthy();
  });
});
