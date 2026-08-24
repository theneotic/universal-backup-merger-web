import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const documentation = readFileSync(new URL("../docs/conversion-schemas-and-usage.md", import.meta.url), "utf8");

describe("conversion schemas and usage documentation", () => {
  it("documents direct bidirectional routes, portable exports, and native Isar restrictions", () => {
    expect(documentation).toContain("# Conversion Schemas and Usage Guide");
    expect(documentation).toContain("ArchiveTune into Metrolist");
    expect(documentation).toContain("Metrolist into ArchiveTune");
    expect(documentation).toContain("title,artist,album,duration_seconds,source_url");
    expect(documentation).toContain("Native Bloomee `.isar` / MDBX");
  });

  it("documents validation, source-only publishing, and externally sourced destination limits", () => {
    expect(documentation).toContain("PRAGMA integrity_check");
    expect(documentation).toContain("source-only");
    expect(documentation).toContain("Publish");
    expect(documentation).toContain("References");
    expect(documentation).toContain("OuterTune cross-fork backup compatibility discussion");
  });
});
