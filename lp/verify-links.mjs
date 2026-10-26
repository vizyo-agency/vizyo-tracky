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

// Footer Home « Produit » : Secteur public et Sécurité doivent pointer vers leurs pages dédiées,
// jamais revenir aux anciennes ancres de section (#produit, #faq) — lot S2.2 P3.
const footerProduitLinks = anchors('index.html').filter((anchor) => ['Secteur public', 'Sécurité & RGPD'].includes(anchor.text));
const footerSecteurPublic = footerProduitLinks.find((anchor) => anchor.text === 'Secteur public');
const footerSecurite = footerProduitLinks.find((anchor) => anchor.text === 'Sécurité & RGPD');
assert(footerSecteurPublic && localTarget('index.html', footerSecteurPublic.href) === 'secteur-public.html', 'Le lien « Secteur public » du footer Home ne doit plus pointer vers #produit : il doit cibler secteur-public.html.');
assert(footerSecurite && localTarget('index.html', footerSecurite.href) === 'securite.html', 'Le lien « Sécurité & RGPD » du footer Home ne doit plus pointer vers #faq : il doit cibler securite.html.');

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

// FAQPage JSON-LD ↔ FAQ visible : même texte, question pour question (lot S2.2 P2 — Tarifs, source
// unique dans pricing.mjs `faqTarifs`). Limité à tarifs.html : les FAQ villes ont leur propre lien
// « Voir le simulateur » non repris dans leur JSON-LD, hors périmètre de ce prompt.
function faqPageLd(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (data['@type'] === 'FAQPage') return data;
  }
  return null;
}
function visibleFaqItems(html) {
  const section = html.match(/<!-- FAQ -->([\s\S]*?)<\/section>/);
  if (!section) return null;
  return [...section[1].matchAll(/<summary[^>]*>([\s\S]*?)<svg[\s\S]*?<\/svg><\/summary><p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ q: textContent(m[1]), a: textContent(m[2]) }));
}
let faqPagesChecked = 0;
for (const file of ['tarifs.html']) {
  const html = readFileSync(join(publicDir, file), 'utf8');
  const ld = faqPageLd(html);
  if (!ld) continue;
  const visible = visibleFaqItems(html);
  assert(visible, `${file} porte un FAQPage JSON-LD sans section FAQ visible repérable.`);
  const ldItems = ld.mainEntity.map((x) => ({ q: textContent(x.name), a: textContent(x.acceptedAnswer.text) }));
  assert(ldItems.length === visible.length, `${file} : le FAQPage JSON-LD (${ldItems.length} question(s)) et la FAQ visible (${visible.length}) n'ont pas le même nombre de questions.`);
  for (let i = 0; i < ldItems.length; i++) {
    assert(ldItems[i].q === visible[i].q, `${file} : la question #${i + 1} du FAQPage ("${ldItems[i].q}") n'existe pas au même texte dans la FAQ visible.`);
    assert(ldItems[i].a === visible[i].a, `${file} : la réponse #${i + 1} du FAQPage diffère du texte visible pour "${ldItems[i].q}".`);
  }
  faqPagesChecked++;
}

// Héros Home : image recadrée servie aux téléphones et préchargée (lot S2.15 P1).
const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8');
for (const ext of ['avif', 'webp']) {
  const re = new RegExp(`<source media="\\(max-width:480px\\)" srcset="assets/img/screen-carte-toulouse-mobile\\.${ext}" type="image/${ext}">`);
  assert(re.test(indexHtml), `La Home doit contenir une source <picture> media="(max-width:480px)" en ${ext} pour le héros mobile.`);
}
assert(/<link rel="preload" as="image" type="image\/avif" href="assets\/img\/screen-carte-toulouse-mobile\.avif" fetchpriority="high" media="\(max-width:480px\)">/.test(indexHtml), 'La Home doit précharger l\'image mobile du héros (media (max-width:480px)).');
assert(/<link rel="preload" as="image" type="image\/avif" href="assets\/img\/screen-carte-toulouse\.avif" fetchpriority="high" media="\(min-width:481px\)">/.test(indexHtml), 'La Home doit précharger l\'image grand écran du héros (media (min-width:481px)).');
for (const ext of ['avif', 'webp']) {
  assert(existsSync(join(publicDir, 'assets', 'img', `screen-carte-toulouse-mobile.${ext}`)), `Le fichier assets/img/screen-carte-toulouse-mobile.${ext} doit exister.`);
}

// Police de repli Home : Manrope Fallback avec size-adjust, utilisée dans la pile du body (lot S2.15 P2).
assert(/@font-face\{font-family:"Manrope Fallback";[^}]*size-adjust:[^}]*\}/.test(indexHtml), 'La Home doit déclarer @font-face "Manrope Fallback" avec size-adjust.');
assert(/body\{[^}]*font-family:'Manrope','Manrope Fallback',sans-serif/.test(indexHtml), 'Le body de la Home doit utiliser la pile de police \'Manrope\',\'Manrope Fallback\',sans-serif.');

// Le préchargement de l'image du héros est propre à la Home ; aucune autre page ne doit le reprendre.
for (const file of htmlFiles.filter((f) => f !== 'index.html')) {
  const html = readFileSync(join(publicDir, file), 'utf8');
  assert(!/rel="preload" as="image"/.test(html), `${file} ne doit pas précharger l'image du héros : ce préchargement est propre à la Home.`);
}

const sitemap = readFileSync(join(publicDir, 'sitemap.xml'), 'utf8');
const indexedPages = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => {
  const pathname = new URL(match[1]).pathname.replace(/^\//, '');
  return pathname || 'index.html';
});
const orphans = indexedPages.filter((page) => !depth.has(page));
assert(orphans.length === 0, `Pages indexables orphelines depuis la Home : ${orphans.join(', ')}`);

// Feuille Google Fonts non bloquante (lot S2.11 P1) : jamais en rel="stylesheet" hors d'un <noscript>.
// decouvrir-depot.html n'a pas de source dans lp/design/ et n'est pas régénéré par build.mjs : hors périmètre ici.
for (const file of htmlFiles.filter((f) => f !== 'decouvrir-depot.html')) {
  const html = readFileSync(join(publicDir, file), 'utf8');
  const noscriptFree = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
  const blocking = /<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*rel="stylesheet"[^>]*>/i.test(noscriptFree);
  assert(!blocking, `${file} charge la feuille Google Fonts en rel="stylesheet" bloquant hors d'un <noscript>.`);
}

// PDF DPA : reste téléchargeable, mais non indexé (lot S2.11 P3).
const nginxConf = readFileSync(join(root, '..', 'deploy', 'vps', 'nginx.lp.conf'), 'utf8');
const dpaBlockMatch = nginxConf.match(/location\s*=\s*\/vizyo-tracky-dpa-fiche-securite\.pdf\s*\{([\s\S]*?)\}/);
assert(dpaBlockMatch, 'deploy/vps/nginx.lp.conf doit contenir un bloc location = /vizyo-tracky-dpa-fiche-securite.pdf.');
const dpaBlock = dpaBlockMatch[1];
assert(/add_header\s+X-Robots-Tag\s+"noindex,\s*follow"\s+always;/.test(dpaBlock), 'Le bloc du PDF DPA doit poser X-Robots-Tag "noindex, follow" always.');
assert(/add_header\s+X-Frame-Options\s+"SAMEORIGIN"\s+always;/.test(dpaBlock), 'Le bloc du PDF DPA doit répéter X-Frame-Options "SAMEORIGIN" always.');
assert(/add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/.test(dpaBlock), 'Le bloc du PDF DPA doit répéter X-Content-Type-Options "nosniff" always.');

console.log('✓ PDF DPA : noindex posé en nginx, sans retirer les en-têtes de sécurité');
console.log(`✓ ${generatedCities.length} pages villes reliées depuis Occitanie`);
console.log('✓ Occitanie à profondeur 1 ; Toulouse et les autres villes à profondeur 2 maximum');
console.log(`✓ ${indexedPages.length} pages indexables accessibles depuis la Home, sans orpheline`);
console.log('✓ Liens internes HTML valides et ancres du cluster local visibles');
console.log(`✓ FAQPage JSON-LD aligné texte pour texte avec la FAQ visible sur ${faqPagesChecked} page(s)`);
console.log('✓ Héros Home : sources et préchargements mobile/grand écran présents, images mobiles sur disque');
console.log('✓ Police de repli "Manrope Fallback" déclarée avec size-adjust et utilisée dans la pile du body');
console.log('✓ Aucune autre page ne précharge l\'image du héros de la Home');
