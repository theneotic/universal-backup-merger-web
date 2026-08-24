import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export type UploadedBackup = { name: string; buffer: Buffer };
export type DetectedBackup = { name: string; role: "target" | "source"; confidence: "high" | "medium"; tables: number };
export type MergeReport = {
  counts: { songs: number; artists: number; albums: number; playlists: number; lyrics: number; events: number };
  skippedTables: string[];
  targetFileName: string;
  sourceFileNames: string[];
};

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backup-merger-"));
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function materialize(files: UploadedBackup[], directory: string) {
  if (files.length < 2) throw new Error("uploading: Upload one Metrolist backup and at least one source backup.");
  return files.map(file => {
    if (!/\.(backup|zip)$/i.test(file.name)) throw new Error(`uploading: ${file.name} is not a .backup or .zip file.`);
    const target = path.join(directory, safeName(file.name));
    fs.writeFileSync(target, file.buffer);
    return target;
  });
}

function runWorker(args: string[]) {
  const script = path.join(process.cwd(), "scripts", "merge_backups.py");
  return new Promise<any>((resolve, reject) => {
    const worker = spawn("python3", [script, ...args], { cwd: process.cwd() });
    let output = "";
    let errors = "";
    worker.stdout.on("data", chunk => { output += String(chunk); });
    worker.stderr.on("data", chunk => { errors += String(chunk); });
    worker.on("error", () => reject(new Error("validating: The SQLite merge worker could not start.")));
    worker.on("close", code => {
      if (code !== 0) return reject(new Error(errors.trim() || "validating: The merge could not be completed."));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("validating: The merge worker returned an invalid report."));
      }
    });
  });
}

export async function inspectBackups(files: UploadedBackup[]): Promise<DetectedBackup[]> {
  const directory = workspace();
  try {
    const inputs = materialize(files, directory);
    const report = await runWorker(["inspect", ...inputs.flatMap(input => ["--input", input])]);
    return report.files as DetectedBackup[];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function mergeBackups(files: UploadedBackup[], onStage: (stage: "detecting" | "merging" | "validating") => void) {
  const directory = workspace();
  try {
    const inputs = materialize(files, directory);
    onStage("detecting");
    await runWorker(["inspect", ...inputs.flatMap(input => ["--input", input])]);
    const output = path.join(directory, "Metrolist_Merged.backup");
    onStage("merging");
    const report = await runWorker(["merge", ...inputs.flatMap(input => ["--input", input]), "--output", output]) as MergeReport;
    onStage("validating");
    return { output: fs.readFileSync(output), report };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function outputName() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `Metrolist_Merged_${stamp}.backup`;
}

export function createVisitorId() {
  return crypto.randomBytes(18).toString("base64url");
}
