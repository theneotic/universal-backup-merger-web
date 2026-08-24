import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../client/src/components/SiteChrome.tsx", import.meta.url), "utf8");
const info = readFileSync(new URL("../client/src/pages/PublicInfo.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
const portable = readFileSync(new URL("../client/src/pages/PortablePlaylistExport.tsx", import.meta.url), "utf8");
const metrolistToArchiveTune = readFileSync(new URL("../client/src/pages/MetrolistToArchiveTune.tsx", import.meta.url), "utf8");

describe("public site structure", () => {
  it("registers the requested public information pages", () => {
    ["/about", "/contact", "/privacy", "/terms"].forEach(route => expect(app).toContain(`path={"${route}"}`));
  });

  it("registers the portable playlist export route", () => {
    expect(app).toContain('path={"/portable-playlists"}');
    expect(chrome).toContain("Portable exports");
    expect(portable).toContain("ArchiveTune · M3U");
    expect(portable).toContain("RiPlay · CSV");
    expect(portable).toContain("OuterTune is intentionally blocked");
  });

  it("registers the direct Metrolist-to-ArchiveTune target route", () => {
    expect(app).toContain('path={"/metrolist-to-archivetune"}');
    expect(chrome).toContain("Metrolist → ArchiveTune");
    expect(metrolistToArchiveTune).toContain("Create ArchiveTune backup");
    expect(metrolistToArchiveTune).toContain("requires an existing ArchiveTune target backup");
  });

  it("exposes identity, navigation, support, and legal links", () => {
    ["Universal Backup Merger", "Start merge", "ArchiveTune → Bloomee", "Contact", "Privacy", "Terms", "© {year}"].forEach(label => expect(chrome).toContain(label));
  });

  it("keeps the main workflow and local-history search discoverable", () => {
    expect(home).toContain('id="merge"');
    expect(home).toContain('id="history-search"');
  });

  it("discloses browser-local backup handling and safe support guidance", () => {
    expect(info).toContain("process the backup files you choose in your browser");
    expect(info).toContain("Never attach music backups");
  });
});
