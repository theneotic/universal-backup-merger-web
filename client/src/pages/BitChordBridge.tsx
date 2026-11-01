import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  exportArchiveTuneToBitChord,
  exportBitChordToBloomee,
  exportBloomeeToBitChord,
  exportMetrolistToBitChord,
  mergeBitChordFiles,
  mergeBitChordToArchiveTune,
  type BitChordExportReport,
  type BloomeeExportReport,
  type MergeReport,
} from "@/lib/browserMerger";
import {
  ArrowDownToLine,
  Check,
  FileArchive,
  FileCode,
  Files,
  HardDrive,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Stage = "uploading" | "detecting" | "merging" | "validating";
type Direction =
  | "metrolist-to-bitchord"
  | "archivetune-to-bitchord"
  | "bloomee-to-bitchord"
  | "bitchord-to-archivetune"
  | "bitchord-to-bloomee"
  | "bitchord-merge";

type Result = {
  kind: Direction;
  url: string;
  filename: string;
  bitchordReport?: BitChordExportReport;
  bloomeeReport?: BloomeeExportReport;
  mergeReport?: MergeReport;
};

const stages: Stage[] = ["uploading", "detecting", "merging", "validating"];
const resultTables = ["songs", "artists", "albums", "playlists", "lyrics", "events"] as const;

function bytes(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.ceil(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

export default function BitChordBridge() {
  const sourceInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const multiInput = useRef<HTMLInputElement>(null);

  const [direction, setDirection] = useState<Direction>("metrolist-to-bitchord");
  const [source, setSource] = useState<File | null>(null);
  const [target, setTarget] = useState<File | null>(null);
  const [multiFiles, setMultiFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const stageIndex = stage ? stages.indexOf(stage) : -1;

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const reset = (next: Direction) => {
    setDirection(next);
    setSource(null);
    setTarget(null);
    setMultiFiles([]);
    setResult(null);
    setError(null);
  };

  const selectSource = (file: File | null) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setSource(file);
  };

  const selectTarget = (file: File | null) => {
    if (!file) return;
    if (!/\.(backup|zip|db)$/i.test(file.name)) {
      setError("uploading: Choose an ArchiveTune .backup, .zip, or .db target file.");
      return;
    }
    setError(null);
    setResult(null);
    setTarget(file);
  };

  const addMultiFiles = (incoming: File[]) => {
    setError(null);
    setResult(null);
    const valid = incoming.filter(f => /\.json$/i.test(f.name));
    if (valid.length !== incoming.length) {
      setError("uploading: Only BitChord .json backup files can be added.");
    }
    const combined = [...multiFiles, ...valid].slice(0, 10);
    setMultiFiles(combined);
  };

  const removeMultiFile = (idx: number) => {
    setMultiFiles(files => files.filter((_, i) => i !== idx));
    setResult(null);
  };

  const convert = async () => {
    if (processing) return;
    if (direction === "bitchord-merge" && multiFiles.length < 2) {
      setError("uploading: Select at least two BitChord backup JSON files to merge.");
      return;
    }
    if (direction === "bitchord-to-archivetune" && (!source || !target)) {
      setError("uploading: Select both a BitChord source JSON and an ArchiveTune target backup.");
      return;
    }
    if (direction !== "bitchord-merge" && !source) {
      setError("uploading: Please select a source backup file.");
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);
    setStage("uploading");

    try {
      if (direction === "metrolist-to-bitchord") {
        const exported = await exportMetrolistToBitChord(source!, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(exported.output),
          filename: `bitchord-backup-from-metrolist-${stamp()}.json`,
          bitchordReport: exported.report,
        });
      } else if (direction === "archivetune-to-bitchord") {
        const exported = await exportArchiveTuneToBitChord(source!, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(exported.output),
          filename: `bitchord-backup-from-archivetune-${stamp()}.json`,
          bitchordReport: exported.report,
        });
      } else if (direction === "bloomee-to-bitchord") {
        const exported = await exportBloomeeToBitChord(source!, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(exported.output),
          filename: `bitchord-backup-from-bloomee-${stamp()}.json`,
          bitchordReport: exported.report,
        });
      } else if (direction === "bitchord-to-archivetune") {
        const merged = await mergeBitChordToArchiveTune(source!, target!, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(merged.output),
          filename: `ArchiveTune_BitChord_Merged_${stamp()}.backup`,
          mergeReport: merged.report,
        });
      } else if (direction === "bitchord-to-bloomee") {
        const exported = await exportBitChordToBloomee(source!, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(exported.output),
          filename: `Bloomee_BitChord_Import_${stamp()}.blm`,
          bloomeeReport: exported.report,
        });
      } else if (direction === "bitchord-merge") {
        const merged = await mergeBitChordFiles(multiFiles, setStage);
        setResult({
          kind: direction,
          url: URL.createObjectURL(merged.output),
          filename: `bitchord-backup-merged-${stamp()}.json`,
          bitchordReport: merged.report,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "validating: The operation could not be completed.");
    } finally {
      setStage(null);
      setProcessing(false);
    }
  };

  const getSourceAccept = () => {
    switch (direction) {
      case "metrolist-to-bitchord":
      case "archivetune-to-bitchord":
        return ".backup,.zip,.db,application/zip,application/octet-stream";
      case "bloomee-to-bitchord":
        return ".json,.blm,.zip,application/json,application/zip,application/octet-stream";
      case "bitchord-to-archivetune":
      case "bitchord-to-bloomee":
        return ".json,application/json";
      default:
        return ".json,application/json";
    }
  };

  const getSourceLabel = () => {
    switch (direction) {
      case "metrolist-to-bitchord":
        return "Metrolist backup (.backup, .zip, .db)";
      case "archivetune-to-bitchord":
        return "ArchiveTune backup (.backup, .zip, .db)";
      case "bloomee-to-bitchord":
        return "Bloomee JSON export (.blm, .json, .zip)";
      case "bitchord-to-archivetune":
      case "bitchord-to-bloomee":
        return "BitChord backup (.json)";
      default:
        return "Source backup";
    }
  };

  const getDirectionHeading = () => {
    switch (direction) {
      case "metrolist-to-bitchord":
        return "Export Metrolist to BitChord JSON";
      case "archivetune-to-bitchord":
        return "Export ArchiveTune to BitChord JSON";
      case "bloomee-to-bitchord":
        return "Convert Bloomee to BitChord JSON";
      case "bitchord-to-archivetune":
        return "Merge BitChord into ArchiveTune";
      case "bitchord-to-bloomee":
        return "Export BitChord to Bloomee";
      case "bitchord-merge":
        return "Merge Multiple BitChord Backups";
    }
  };

  const getDirectionDescription = () => {
    switch (direction) {
      case "metrolist-to-bitchord":
        return "Converts your Metrolist songs, play history, and preferences into a BitChord-native JSON backup file ready for immediate restore in BitChord.";
      case "archivetune-to-bitchord":
        return "Converts your ArchiveTune library, artists, albums, and play statistics into a verified BitChord-native JSON backup.";
      case "bloomee-to-bitchord":
        return "Converts Bloomee portable playlist JSON exports into a BitChord-native JSON backup file.";
      case "bitchord-to-archivetune":
        return "Merges BitChord songs, artists, albums, and play counts into your existing ArchiveTune target backup while preserving settings and destination tables.";
      case "bitchord-to-bloomee":
        return "Converts BitChord listening history and tracks into Bloomee's legacy-v2 JSON format (.blm) for direct import in Bloomee.";
      case "bitchord-merge":
        return "Combines 2 or more BitChord monthly or device JSON backups into one deduplicated, consolidated BitChord backup file.";
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#14212b]">
      <SiteHeader />
      <main className="container py-10 md:py-16">
        <section className="mx-auto max-w-5xl">
          <div className="mb-9 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#bee0d0] bg-[#eaf2ee] px-3 py-1.5 text-xs font-bold tracking-wide text-[#2a6a54]">
                <FileCode className="size-3.5" /> BitChord Bridge
              </div>
              <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.98] tracking-[-0.055em] md:text-6xl">
                BitChord Universal Bridge &amp; JSON Backup
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#657078]">
                Since BitChord exports and restores exclusively via structured JSON backups, this bridge allows full bidirectional
                migration between BitChord and <strong>Metrolist</strong>, <strong>ArchiveTune</strong>, and <strong>Bloomee</strong>.
                All parsing, conversion, and merging runs 100% on-device in this browser.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#d8d3c7] bg-white/70 px-3 py-2 text-xs font-semibold text-[#57616a]">
              <HardDrive className="size-3.5 text-[#b5672c]" /> On-device processing
            </div>
          </div>

          <section className="overflow-hidden rounded-[30px] border border-[#d8d4ca] bg-white shadow-[0_24px_70px_rgba(38,48,54,0.08)]">
            <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="p-5 sm:p-7">
                <div className="flex flex-wrap gap-2" aria-label="BitChord bridge mode">
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "metrolist-to-bitchord"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("metrolist-to-bitchord")}
                  >
                    Metrolist → BitChord
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "archivetune-to-bitchord"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("archivetune-to-bitchord")}
                  >
                    ArchiveTune → BitChord
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "bloomee-to-bitchord"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("bloomee-to-bitchord")}
                  >
                    Bloomee → BitChord
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "bitchord-to-archivetune"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("bitchord-to-archivetune")}
                  >
                    BitChord → ArchiveTune
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "bitchord-to-bloomee"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("bitchord-to-bloomee")}
                  >
                    BitChord → Bloomee
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={`rounded-xl text-xs font-bold ${
                      direction === "bitchord-merge"
                        ? "border-[#2a6a54] bg-[#eaf2ee] text-[#215640]"
                        : "border-[#d8cabb] bg-white text-[#8b552c]"
                    }`}
                    onClick={() => reset("bitchord-merge")}
                  >
                    Merge BitChord Backups
                  </Button>
                </div>

                <div className="mt-6 flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eaf2ee] text-[#2a6a54]">
                    <Files className="size-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold tracking-[0.14em] text-[#2a6a54] uppercase">
                      {direction.includes("to-bitchord")
                        ? "BitChord JSON Generator"
                        : direction === "bitchord-merge"
                        ? "Multi-file Merger"
                        : "Target-Aware Bridge"}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em]">
                      {getDirectionHeading()}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#707a81]">
                      {getDirectionDescription()}
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {direction === "bitchord-merge" ? (
                    <div className="rounded-2xl border border-dashed border-[#d2cdc3] bg-[#fbfaf7] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#14212b]">
                            Select BitChord JSON files to merge
                          </p>
                          <p className="mt-1 text-xs text-[#858780]">
                            {multiFiles.length} file(s) selected (minimum 2 required)
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 rounded-xl border-[#d8cabb] bg-white text-[#8b552c] hover:bg-[#fff4df]"
                          onClick={() => multiInput.current?.click()}
                        >
                          <Plus className="mr-2 size-4" />
                          Add files
                        </Button>
                      </div>
                      <input
                        ref={multiInput}
                        className="sr-only"
                        type="file"
                        multiple
                        accept=".json,application/json"
                        onChange={e => {
                          if (e.target.files) addMultiFiles(Array.from(e.target.files));
                        }}
                      />
                      {multiFiles.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {multiFiles.map((f, i) => (
                            <div
                              key={`${f.name}-${i}`}
                              className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs border border-[#e8e4dc]"
                            >
                              <div className="truncate font-medium text-[#14212b]">
                                {f.name} <span className="text-[#858780]">({bytes(f.size)})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeMultiFile(i)}
                                className="text-[#943f31] hover:text-[#73291d] p-1"
                                aria-label="Remove file"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="rounded-2xl border border-dashed border-[#d2cdc3] bg-[#fbfaf7] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <FileArchive className="size-4 shrink-0 text-[#a36b3a]" />
                              <p className="truncate text-sm font-bold">
                                {source ? source.name : `No ${getSourceLabel()} selected`}
                              </p>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-[#858780]">
                              {source ? bytes(source.size) : `Accepts ${getSourceLabel()}`}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0 rounded-xl border-[#d8cabb] bg-white text-[#8b552c] hover:bg-[#fff4df]"
                            onClick={() => sourceInput.current?.click()}
                          >
                            <UploadCloud className="mr-2 size-4" />
                            Choose source
                          </Button>
                        </div>
                        <input
                          ref={sourceInput}
                          className="sr-only"
                          type="file"
                          accept={getSourceAccept()}
                          onChange={e => selectSource(e.target.files?.[0] ?? null)}
                        />
                      </div>

                      {direction === "bitchord-to-archivetune" && (
                        <div className="rounded-2xl border border-dashed border-[#d2cdc3] bg-[#fbfaf7] p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <FileArchive className="size-4 shrink-0 text-[#a36b3a]" />
                                <p className="truncate text-sm font-bold">
                                  {target ? target.name : "No ArchiveTune target selected"}
                                </p>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-[#858780]">
                                {target ? bytes(target.size) : "Accepts ArchiveTune .backup, .zip, or .db"}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0 rounded-xl border-[#d8cabb] bg-white text-[#8b552c] hover:bg-[#fff4df]"
                              onClick={() => targetInput.current?.click()}
                            >
                              <UploadCloud className="mr-2 size-4" />
                              Choose target
                            </Button>
                          </div>
                          <input
                            ref={targetInput}
                            className="sr-only"
                            type="file"
                            accept=".backup,.zip,.db,application/zip,application/octet-stream"
                            onChange={e => selectTarget(e.target.files?.[0] ?? null)}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <Button
                  disabled={
                    processing ||
                    (direction === "bitchord-merge" && multiFiles.length < 2) ||
                    (direction === "bitchord-to-archivetune" && (!source || !target)) ||
                    (direction !== "bitchord-merge" && !source)
                  }
                  onClick={() => void convert()}
                  className="mt-5 h-12 w-full rounded-xl bg-[#2a6a54] text-sm font-bold text-white hover:bg-[#215640] disabled:bg-[#a7b5ae]"
                >
                  {processing ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {stage ?? "processing"}
                    </>
                  ) : (
                    <>
                      {direction.includes("to-bitchord")
                        ? "Create BitChord JSON backup"
                        : direction === "bitchord-to-archivetune"
                        ? "Merge into ArchiveTune backup"
                        : direction === "bitchord-to-bloomee"
                        ? "Create Bloomee .blm export"
                        : "Merge BitChord backups"}
                      <ArrowDownToLine className="ml-2 size-4" />
                    </>
                  )}
                </Button>

                {error && (
                  <p className="mt-4 rounded-xl bg-[#fff0ed] px-3 py-2.5 text-sm font-medium text-[#943f31]">
                    {error}
                  </p>
                )}
              </div>

              <aside className="border-t border-[#e8e4dc] bg-[#14212b] p-5 text-white lg:border-t-0 lg:border-l sm:p-7">
                <p className="text-xs font-bold tracking-[0.14em] text-[#f5c77a] uppercase">
                  Conversion workflow
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em]">
                  BitChord specifications
                </h2>
                <div className="mt-6 space-y-2">
                  {stages.map((item, index) => {
                    const current = stage === item;
                    const done = stageIndex > index || (!stage && Boolean(result));
                    return (
                      <div
                        key={item}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                          current
                            ? "border-[#f5c77a] bg-[#22323e]"
                            : done
                            ? "border-[#385563] bg-[#1a2a35]"
                            : "border-[#304650] bg-[#172730]"
                        }`}
                      >
                        <div
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            done
                              ? "bg-[#86c39d] text-[#14212b]"
                              : current
                              ? "bg-[#f5c77a] text-[#14212b]"
                              : "bg-[#304650] text-[#aebcc1]"
                          }`}
                        >
                          {done ? <Check className="size-3" /> : index + 1}
                        </div>
                        <p className="text-xs font-bold capitalize">{item}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 rounded-2xl bg-white/8 p-4">
                  <div className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#86c39d]" />
                    <p className="text-xs leading-5 text-[#c8d4d7]">
                      BitChord stores listening stats inside monthly buckets (`YYYY-MM`), with play counts, timestamps,
                      and typed preferences. Output files follow BitChord’s official BackupFile schema.
                    </p>
                  </div>
                </div>
              </aside>
            </div>

            {result && (
              <div className="border-t border-[#d9e5de] bg-[#eaf2ee] p-5 sm:flex sm:items-center sm:justify-between sm:p-6">
                <div>
                  <p className="text-sm font-bold text-[#215640]">
                    {result.kind.includes("to-bitchord") || result.kind === "bitchord-merge"
                      ? "BitChord JSON backup ready"
                      : result.kind === "bitchord-to-bloomee"
                      ? "Bloomee .blm import ready"
                      : "ArchiveTune backup ready"}
                  </p>
                  {result.bitchordReport && (
                    <p className="mt-1 text-xs leading-5 text-[#49806a]">
                      {result.bitchordReport.months} month(s) · {result.bitchordReport.tracks} tracks ·{" "}
                      {result.bitchordReport.artists} artists · {result.bitchordReport.albums} albums
                    </p>
                  )}
                  {result.bloomeeReport && (
                    <p className="mt-1 text-xs leading-5 text-[#49806a]">
                      {result.bloomeeReport.playlists} playlists · {result.bloomeeReport.mediaItems} tracks ·{" "}
                      {result.bloomeeReport.skippedTracks} skipped
                    </p>
                  )}
                  {result.mergeReport && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resultTables.map(name => (
                        <span key={name} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[#39715c]">
                          {result.mergeReport?.counts[name] ?? 0} {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <a
                  href={result.url}
                  download={result.filename}
                  className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-[#2a6a54] px-4 text-sm font-bold text-white transition hover:bg-[#215640] sm:mt-0"
                >
                  <ArrowDownToLine className="mr-2 size-4" />
                  Download {result.filename.endsWith(".json") ? "BitChord JSON" : result.filename.endsWith(".blm") ? "Bloomee .blm" : "ArchiveTune backup"}
                </a>
              </div>
            )}
          </section>

          <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-[#d9d7cf] bg-white/70 px-4 py-3 text-center text-xs leading-5 text-[#59656a]">
            <strong className="text-[#215640]">In BitChord:</strong> open <strong>Settings → Replay / Backup → Restore Backup</strong> and select your downloaded <strong>.json</strong> file.
            BitChord will restore all your playback stats, replay history, and preferences safely.
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
