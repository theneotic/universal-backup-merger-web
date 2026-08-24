import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README", () => {
  it("documents the browser workflow and supported formats", () => {
    expect(readme).toContain("browser-first tool");
    expect(readme).toContain("Metrolist");
    expect(readme).toContain("ArchiveTune");
    expect(readme).toContain("Bloomee native Isar snapshot");
    expect(readme).toContain("Portable playlist exports");
    expect(readme).toContain("Echo Music · M3U");
    expect(readme).toContain("Latest validation status");
    expect(readme).toContain("DEPLOYMENT_NOT_FOUND");
    expect(readme).toContain("Transfer Metrolist into ArchiveTune");
    expect(readme).toContain("32,607 Metrolist songs");
  });

  it("documents the exact static build and manual deployment settings", () => {
    expect(readme).toContain("pnpm install --frozen-lockfile");
    expect(readme).toContain("pnpm build");
    expect(readme).toContain("dist/public");
    expect(readme).toContain("Rewrite unknown routes to `/index.html`");
  });

  it("documents the source-only backup-artifact policy", () => {
    expect(readme).toContain("User backup artifacts must never be committed");
    expect(readme).toContain(".blm");
    expect(readme).toContain("Do **not** attach music backups");
  });
});
