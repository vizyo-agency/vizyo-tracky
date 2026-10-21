import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cities } from './src/data/cities.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const htmlFiles = readdirSync(publicDir).filter((file) => file.endsWith('.html'));
const htmlSet = new Set(htmlFiles);
const generatedCities = cities.filter((city) => city.generate);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function textContent(html) {
  return html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function anchors(file) {
  const html = readFileSync(join(publicDir, file), 'utf8');
  return [...html.matchAll(/<a\b([^>]*?)\bhref=(['"])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attrs: `${match[1]} ${match[4]}`,
    href: match[3],
    text: textContent(match[5]),
  }));
}

function localTarget(from, href) {
  if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) return null;
  const clean = href.split(/[?#]/, 1)[0];
  if (!clean) return null;
  if (clean === '/') return 'index.html';
  const relative = clean.startsWith('/') ? clean.slice(1) : join(dirname(from), clean).replace(/\\/g, '/');
  return relative.endsWith('/') ? `${relative}index.html` : relative;
}

function isHidden(anchor) {
  return /(?:^|\s)hidden(?:\s|=|$)/i.test(anchor.attrs)
    || /aria-hidden\s*=\s*(['"])true\1/i.test(anchor.attrs)
    || /style\s*=\s*(['"])[^'"]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^'"]*\1/i.test(anchor.attrs);
}

const graph = new Map();
for (const file of htmlFiles) {
  const edges = [];
  for (const anchor of anchors(file)) {
    const target = localTarget(file, anchor.href);
    if (!target || !target.endsWith('.html')) continue;
    assert(existsSync(join(publicDir, target)), `${file} contient un lien interne cassé vers ${anchor.href}`);
    edges.push(target);
  }
  graph.set(file, edges);
}

const depth = new Map([['index.html', 0]]);
const queue = ['index.html'];
while (queue.length) {
  const page = queue.shift();
  for (const target of graph.get(page) || []) {
    if (!htmlSet.has(target) || depth.has(target)) continue;
    depth.set(target, depth.get(page) + 1);
    queue.push(target);
  }
}

const homeHubLinks = anchors('index.html').filter((anchor) => localTarget('index.html', anchor.href) === 'gps-flotte-occitanie.html');
assert(homeHubLinks.some((anchor) => !isHidden(anchor) && /zones d'intervention en Occitanie/i.test(anchor.text)), 'La Home doit contenir une ancre visible et descriptive vers le hub Occitanie.');
assert(depth.get('gps-flotte-occitanie.html') === 1, `Le hub Occitanie doit être à profondeur 1 (profondeur constatée : ${depth.get('gps-flotte-occitanie.html') ?? 'inaccessible'}).`);

const hubAnchors = anchors('gps-flotte-occitanie.html');
for (const city of generatedCities) {
  const page = `gps-flotte-${city.slug}.html`;
  const cityLinks = hubAnchors.filter((anchor) => localTarget('gps-flotte-occitanie.html', anchor.href) === page);
  assert(cityLinks.length === 1, `Le hub Occitanie doit contenir exactement un lien vers ${page}.`);
  assert(!isHidden(cityLinks[0]), `Le lien du hub vers ${page} ne doit pas être masqué.`);
  assert(cityLinks[0].text.length >= 18 && cityLinks[0].text.includes(city.name), `L'ancre vers ${page} doit décrire naturellement sa destination.`);
  assert((depth.get(page) ?? Infinity) <= 2, `${page} doit être accessible à profondeur maximale 2.`);
}

const sitemap = readFileSync(join(publicDir, 'sitemap.xml'), 'utf8');
const indexedPages = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => {
  const pathname = new URL(match[1]).pathname.replace(/^\//, '');
  return pathname || 'index.html';
});
const orphans = indexedPages.filter((page) => !depth.has(page));
assert(orphans.length === 0, `Pages indexables orphelines depuis la Home : ${orphans.join(', ')}`);

console.log(`✓ ${generatedCities.length} pages villes reliées depuis Occitanie`);
console.log('✓ Occitanie à profondeur 1 ; Toulouse et les autres villes à profondeur 2 maximum');
console.log(`✓ ${indexedPages.length} pages indexables accessibles depuis la Home, sans orpheline`);
console.log('✓ Liens internes HTML valides et ancres du cluster local visibles');
