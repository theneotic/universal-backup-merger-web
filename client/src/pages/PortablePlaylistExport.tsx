import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { exportPortablePlaylistBundle, type PortablePlaylistExportReport } from "@/lib/browserMerger";
import { ArrowDownToLine, Check, FileArchive, HardDrive, Loader2, Music2, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Stage = "uploading" | "detecting" | "merging" | "validating";
type Destination = "metrolist-csv" | "echo-csv" | "echo-m3u" | "archivetune-csv" | "archivetune-m3u" | "riplay-csv";
type Result = { report: PortablePlaylistExportReport; url: string; destination: Destination };
const stages: Stage[] = ["uploading", "detecting", "merging", "validating"];
const destinations: Array<{ id: Destination; title: string; detail: string; format: "csv" | "m3u" }> = [
  { id: "metrolist-csv", title: "Metrolist · CSV", detail: "Title and artist columns for Metrolist’s CSV playlist importer.", format: "csv" },
  { id: "echo-csv", title: "Echo Music · CSV", detail: "One CSV per playlist for Echo Music’s CSV import flow.", format: "csv" },
  { id: "echo-m3u", title: "Echo Music · M3U", detail: "Extended M3U playlists for Echo Music’s M3U import flow.", format: "m3u" },
  { id: "archivetune-csv", title: "ArchiveTune · CSV", detail: "CSV playlists for ArchiveTune’s reviewed source-matching importer.", format: "csv" },
  { id: "archivetune-m3u", title: "ArchiveTune · M3U", detail: "Extended M3U playlists for ArchiveTune’s reviewed source-matching importer.", format: "m3u" },
  { id: "riplay-csv", title: "RiPlay · CSV", detail: "Title-and-artist CSV playlists for RiPlay’s source-matching importer.", format: "csv" },
];

function bytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.ceil(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function filename(destination: Destination) { const stem: Record<Destination, string> = { "metrolist-csv": "Metrolist_CSV", "echo-csv": "EchoMusic_CSV", "echo-m3u": "EchoMusic_M3U", "archivetune-csv": "ArchiveTune_CSV", "archivetune-m3u": "ArchiveTune_M3U", "riplay-csv": "RiPlay_CSV" }; return `Universal_Playlists_${stem[destination]}_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}.zip`; }

export default function PortablePlaylistExport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [destination, setDestination] = useState<Destination>("metrolist-csv");
  const [stage, setStage] = useState<Stage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const selected = destinations.find(item => item.id === destination)!;
  const stageIndex = stage ? stages.indexOf(stage) : -1;

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  const select = (next: File | null) => {
    if (!next) return;
    if (!/\.(backup|zip|db|json|blm)$/i.test(next.name)) { setError("uploading: Choose a supported .backup, .zip, .db, .json, or .blm music-library export."); return; }
    setFile(next); setError(null); setResult(null);
  };
  const convert = async () => {
    if (!file || processing) return;
    setProcessing(true); setError(null); setResult(null); setStage("uploading");
    try {
      const exported = await exportPortablePlaylistBundle(file, selected.format, setStage);
      setResult({ report: exported.report, url: URL.createObjectURL(exported.output), destination });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "validating: The portable playlist package could not be generated.");
    } finally { setStage(null); setProcessing(false); }
  };

  return <div className="min-h-screen bg-[#f6f4ef] text-[#14212b]"><SiteHeader /><main className="container py-10 md:py-16"><section className="mx-auto max-w-5xl"><div className="mb-9 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end"><div><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#bee0d0] bg-[#eaf2ee] px-3 py-1.5 text-xs font-bold tracking-wide text-[#2a6a54]"><ArrowDownToLine className="size-3.5" /> Safe reverse conversion</div><h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.98] tracking-[-0.055em] md:text-6xl">Portable playlist exports.</h1><p className="mt-5 max-w-2xl text-base leading-7 text-[#657078]">Turn one readable music backup into destination-friendly CSV or M3U playlist files. We preserve titles, artists, albums, durations, source URLs when available, playlist order, and playlist boundaries — without pretending another app’s database is a native backup.</p></div><div className="flex items-center gap-2 rounded-full border border-[#d8d3c7] bg-white/70 px-3 py-2 text-xs font-semibold text-[#57616a]"><HardDrive className="size-3.5 text-[#b5672c]" /> On-device processing</div></div>
    <section className="overflow-hidden rounded-[30px] border border-[#d8d4ca] bg-white shadow-[0_24px_70px_rgba(38,48,54,0.08)]"><div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]"><div className="p-5 sm:p-7"><div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eaf2ee] text-[#2a6a54]"><Music2 className="size-5" /></div><div><p className="text-xs font-bold tracking-[0.14em] text-[#2a6a54] uppercase">Source file</p><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em]">Choose a readable backup</h2><p className="mt-2 text-sm leading-6 text-[#707a81]">Accepts the supported SQLite-based backups and Bloomee’s portable JSON. Native Bloomee Isar files are intentionally excluded because they cannot be read safely in this browser.</p></div></div><div className="mt-6 rounded-2xl border border-dashed border-[#d2cdc3] bg-[#fbfaf7] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><FileArchive className="size-4 shrink-0 text-[#a36b3a]" /><p className="truncate text-sm font-bold">{file ? file.name : "No backup selected"}</p></div><p className="mt-1 text-xs text-[#858780]">{file ? bytes(file.size) : "Accepts .backup, .zip, .db, .json, or .blm"}</p></div><Button variant="outline" className="shrink-0 rounded-xl border-[#d8cabb] bg-white text-[#8b552c] hover:bg-[#fff4df]" onClick={() => inputRef.current?.click()}><UploadCloud className="mr-2 size-4" />Choose file</Button></div><input ref={inputRef} className="sr-only" type="file" accept=".backup,.zip,.db,.json,.blm,application/zip,application/json,application/octet-stream" onChange={event => select(event.target.files?.[0] ?? null)} /></div><div className="mt-5"><p className="text-xs font-bold tracking-[0.14em] text-[#8b552c] uppercase">Destination route</p><div className="mt-2 grid gap-2">{destinations.map(item => <button type="button" key={item.id} onClick={() => { setDestination(item.id); setResult(null); }} className={`rounded-xl border px-4 py-3 text-left transition ${destination === item.id ? "border-[#2a6a54] bg-[#eaf2ee]" : "border-[#dfdbd1] bg-white hover:border-[#b7c7bd]"}`}><p className="text-sm font-bold">{item.title}</p><p className="mt-0.5 text-xs leading-5 text-[#667278]">{item.detail}</p></button>)}</div></div><Button disabled={!file || processing} onClick={() => void convert()} className="mt-5 h-12 w-full rounded-xl bg-[#2a6a54] text-sm font-bold text-white hover:bg-[#215640] disabled:bg-[#a7b5ae]">{processing ? <><Loader2 className="mr-2 size-4 animate-spin" />{stage ?? "processing"}</> : <>Create {selected.format.toUpperCase()} playlist package <ArrowDownToLine className="ml-2 size-4" /></>}</Button>{error && <p className="mt-4 rounded-xl bg-[#fff0ed] px-3 py-2.5 text-sm font-medium text-[#943f31]">{error}</p>}</div>
      <aside className="border-t border-[#e8e4dc] bg-[#14212b] p-5 text-white lg:border-t-0 lg:border-l sm:p-7"><p className="text-xs font-bold tracking-[0.14em] text-[#f5c77a] uppercase">Conversion workflow</p><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em]">Portable by design</h2><div className="mt-6 space-y-2">{stages.map((item, index) => { const current = stage === item; const done = stageIndex > index || (!stage && Boolean(result)); return <div key={item} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${current ? "border-[#f5c77a] bg-[#22323e]" : done ? "border-[#385563] bg-[#1a2a35]" : "border-[#304650] bg-[#172730]"}`}><div className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[#86c39d] text-[#14212b]" : current ? "bg-[#f5c77a] text-[#14212b]" : "bg-[#304650] text-[#aebcc1]"}`}>{done ? <Check className="size-3" /> : index + 1}</div><p className="text-xs font-bold capitalize">{item}</p></div>; })}</div><div className="mt-6 rounded-2xl bg-white/8 p-4"><div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#86c39d]" /><p className="text-xs leading-5 text-[#c8d4d7]">Every result is a ZIP with one playlist file per source playlist plus a short import note. It is never a copied or renamed native app database.</p></div></div><p className="mt-3 rounded-xl border border-[#8f6740]/50 bg-[#382c24] px-3 py-2.5 text-xs leading-5 text-[#f5d2a0]"><strong>OuterTune is intentionally blocked as a native destination.</strong> It does not safely restore backups from related music-app forks, so this tool will not generate an OuterTune database.</p></aside></div>
      {result && <div className="border-t border-[#d9e5de] bg-[#eaf2ee] p-5 sm:flex sm:items-center sm:justify-between sm:p-6"><div><p className="text-sm font-bold text-[#215640]">Portable playlist package ready</p><p className="mt-1 text-xs leading-5 text-[#49806a]">{result.report.sourceApplication} · {result.report.playlists} playlists · {result.report.tracks} tracks · {result.report.skippedTracks} skipped tracks</p></div><a href={result.url} download={filename(result.destination)} className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-[#2a6a54] px-4 text-sm font-bold text-white transition hover:bg-[#215640] sm:mt-0"><ArrowDownToLine className="mr-2 size-4" />Download ZIP</a></div>}</section>
    <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-[#d9d7cf] bg-white/70 px-4 py-3 text-center text-xs leading-5 text-[#59656a]"><strong className="text-[#215640]">Import safely:</strong> extract the ZIP first, then import one file at a time. In Metrolist use the CSV playlist importer. In Echo Music use <strong>Settings → Backup and Restore → Import</strong>, then choose its CSV or M3U playlist option. ArchiveTune accepts CSV and M3U playlist imports, and RiPlay accepts its CSV source-matching route. SimpMusic accepts only files from its own official converter; OuterTune does not have a safe cross-fork backup route here.</div></section></main><SiteFooter /></div>;
}
