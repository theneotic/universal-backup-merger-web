import { Archive, ChevronDown, Github, HardDrive, Menu, Search, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const mainLinks = [
  { href: "/#merge", label: "Merge" },
  { href: "/archivetune-to-bloomee", label: "ArchiveTune → Bloomee" },
  { href: "/bloomee-bridges", label: "Bloomee bridges" },
  { href: "/metrolist-to-archivetune", label: "Metrolist → ArchiveTune" },
  { href: "/portable-playlists", label: "Portable exports" },
  { href: "/#history-search", label: "Search" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

function Brand() {
  return <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label="VibeBridge home">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#14212b] text-[#f5c77a] shadow-[0_12px_25px_rgba(20,33,43,0.15)] sm:size-10 sm:rounded-2xl"><Archive className="size-4 sm:size-5" /></span>
    <span className="min-w-0"><span className="block truncate font-display text-sm font-bold tracking-[-0.04em] sm:text-lg">VibeBridge</span><span className="block truncate text-[8px] font-medium tracking-[0.08em] text-[#7a766d] uppercase sm:text-xs">Music backup transfers</span></span>
  </Link>;
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return <header className="sticky top-0 z-40 border-b border-[#d9d7cf]/80 bg-[#f6f4ef]/92 backdrop-blur-xl">
    <div className="container flex min-h-16 items-center justify-between gap-3 sm:min-h-20 sm:gap-4">
      <Brand />
      <nav aria-label="Primary navigation" className="hidden items-center gap-1 lg:flex">
        {mainLinks.map(link => <a className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-[#59656a] transition hover:bg-white hover:text-[#14212b]" href={link.href} key={link.label}>{link.label}</a>)}
      </nav>
      <div className="hidden items-center gap-3 sm:flex"><span className="inline-flex items-center gap-2 rounded-full border border-[#d8d3c7] bg-white/70 px-3 py-2 text-xs font-semibold text-[#57616a]"><HardDrive className="size-3.5 text-[#b5672c]" /> On-device</span><a className="rounded-xl bg-[#b5672c] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#98501f]" href="/#merge">Start merge</a></div>
      <button type="button" className="inline-flex size-9 items-center justify-center rounded-xl border border-[#d8d3c7] bg-white text-[#14212b] lg:hidden sm:size-10" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <X className="size-4 sm:size-5" /> : <Menu className="size-4 sm:size-5" />}</button>
    </div>
    {open && <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-[#e2ded5] bg-[#f6f4ef] px-4 py-3 lg:hidden"><nav aria-label="Mobile primary navigation" className="container grid gap-1">{mainLinks.map(link => <a href={link.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-semibold text-[#435058] hover:bg-white" key={link.label}>{link.label}</a>)}<a href="/#merge" onClick={() => setOpen(false)} className="mt-2 rounded-xl bg-[#b5672c] px-4 py-3 text-center text-sm font-bold text-white">Start merge</a></nav></div>}
  </header>;
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return <footer className="border-t border-[#d9d7cf] bg-[#edeae2]">
    <div className="container grid grid-cols-2 gap-x-5 gap-y-7 py-8 sm:grid-cols-[1.35fr_repeat(2,minmax(0,0.75fr))] sm:gap-8 sm:py-10">
      <div className="col-span-full max-w-md sm:col-span-1"><div className="flex items-center gap-2 text-[#14212b]"><Archive className="size-4 text-[#b5672c]" /><p className="font-display text-lg font-semibold">VibeBridge</p></div><p className="mt-3 text-sm leading-6 text-[#657078]">A browser-based utility for inspecting, converting, and organizing compatible music-app backups. Your selected backup contents are processed on your device.</p><a className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#8d4b1f] hover:text-[#6f3713]" href="https://github.com/theneotic/universal-backup-merger-web" target="_blank" rel="noreferrer"><Github className="size-4" /> View source code</a></div>
      <div><p className="text-xs font-bold tracking-[0.14em] text-[#8b552c] uppercase">Explore</p><div className="mt-3 grid gap-2 text-sm font-semibold text-[#59656a]"><a href="/#merge" className="hover:text-[#14212b]">Merge backups</a><Link href="/metrolist-to-archivetune" className="hover:text-[#14212b]">Metrolist → ArchiveTune</Link><Link href="/archivetune-to-bloomee" className="hover:text-[#14212b]">ArchiveTune → Bloomee</Link><Link href="/bloomee-bridges" className="hover:text-[#14212b]">Bloomee bridges</Link><Link href="/portable-playlists" className="hover:text-[#14212b]">Portable exports</Link><a href="/#history-search" className="inline-flex items-center gap-2 hover:text-[#14212b]"><Search className="size-3.5" /> Search local history</a></div></div>
      <div><p className="text-xs font-bold tracking-[0.14em] text-[#8b552c] uppercase">Support & legal</p><div className="mt-3 grid gap-2 text-sm font-semibold text-[#59656a]"><Link href="/about" className="hover:text-[#14212b]">About</Link><Link href="/contact" className="hover:text-[#14212b]">Contact</Link><Link href="/privacy" className="hover:text-[#14212b]">Privacy</Link><Link href="/terms" className="hover:text-[#14212b]">Terms</Link></div></div>
    </div>
    <div className="border-t border-[#d8d4ca]"><div className="container flex flex-col gap-2 py-4 text-xs text-[#747a79] sm:flex-row sm:items-center sm:justify-between"><p>© {year} VibeBridge. All rights reserved.</p><p className="inline-flex items-center gap-1.5"><ChevronDown className="size-3.5 rotate-[-90deg]" /> Backup files stay on-device during processing.</p></div></div>
  </footer>;
}
