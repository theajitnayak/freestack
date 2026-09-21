#!/usr/bin/env node
// Fills in any missing company logo in assets/logos/.
//
// Logos are self-hosted: fetched once here, at build time, and committed. The
// page never calls a third party at runtime, so nothing about a visitor leaks
// to a logo CDN. Run this after adding programmes:  node scripts/fetch-logos.mjs
//
// A company that yields nothing keeps the neutral letter tile. That is a valid
// outcome, not a failure: several government portals serve no usable icon.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const LOGOS = new URL('assets/logos/', ROOT);
const UA = 'Mozilla/5.0 (compatible; startupcredits-logo-fetch/1.0)';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
const isIco = (b) => b.length >= 4 && b.readUInt32LE(0) === 0x00010000;

// Google returns its generic globe with a 404 when it has nothing for a host.
// The body is still a valid PNG, so status alone is the reliable signal.
const GOOGLE_PLACEHOLDER_BYTES = 726;

// Modern .ico files usually wrap a PNG. Read the icon directory, take the
// largest entry, and return it when that frame is PNG encoded. A BMP encoded
// frame needs a real image library, so it is skipped rather than half handled.
function pngInsideIco(buf) {
  if (!isIco(buf)) return null;
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    if (e + 16 > buf.length) break;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    if (offset + size > buf.length) continue;
    // 0 in the width byte means 256px, which is the largest an ICO can hold.
    const w = buf[e] === 0 ? 256 : buf[e];
    if (!best || w > best.w) best = { w, size, offset };
  }
  if (!best) return null;
  const frame = buf.subarray(best.offset, best.offset + best.size);
  return isPng(frame) ? frame : null;
}

async function tryFetch(url, { allowNotOk = false } = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok && !allowNotOk) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === GOOGLE_PLACEHOLDER_BYTES) return null;
    if (isPng(buf)) return buf;
    return pngInsideIco(buf);
  } catch {
    return null;
  }
}

async function fetchLogo(host) {
  const candidates = [
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/apple-touch-icon-precomposed.png`,
    // Next.js sites commonly serve these two instead of the apple-touch pair.
    `https://${host}/apple-icon.png`,
    `https://${host}/icon.png`,
    `https://${host}/favicon.png`,
    // Content is sniffed by magic bytes, not by extension: several sites serve
    // a PNG, or a PNG wrapped in an ICO, from this path.
    `https://${host}/favicon.ico`,
    // Last resort. Build time only, and the result is committed.
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
  ];
  for (const url of candidates) {
    const buf = await tryFetch(url);
    // A tiny file is a blank or 1px placeholder, not a usable mark.
    if (buf && buf.length >= 400) return { buf, url };
  }
  return null;
}

if (!existsSync(LOGOS)) await mkdir(LOGOS, { recursive: true });

const raw = JSON.parse(await readFile(new URL('data/programs.json', ROOT), 'utf8'));
const programmes = Array.isArray(raw) ? raw : raw.programs || raw.items || [];
const have = new Set(
  (await readdir(LOGOS)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
);

const missing = new Map();
for (const p of programmes) {
  let host = '';
  try {
    host = new URL(p.url).hostname;
  } catch {
    continue;
  }
  if (host && !have.has(host) && !missing.has(host)) missing.set(host, p.company);
}

if (missing.size === 0) {
  console.log('logos: nothing missing');
  process.exit(0);
}

console.log(`logos: ${missing.size} missing`);
let got = 0;
for (const [host, company] of missing) {
  const hit = await fetchLogo(host);
  if (!hit) {
    console.log(`  no icon  ${company} (${host}) — keeps its letter tile`);
    continue;
  }
  await writeFile(new URL(`${host}.png`, LOGOS), hit.buf);
  got++;
  console.log(`  saved    ${company} (${host}) ${(hit.buf.length / 1024).toFixed(1)}kB`);
}
console.log(`logos: ${got} of ${missing.size} fetched`);
