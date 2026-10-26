// ──────────────────────────────────────────────────────────────────────────
//  Générateur statique Vizyo Tracky (zéro dépendance) — design premium.
//  Prend les pages "design" (format x-dc de claude.ai/design) dans lp/design/,
//  retire le runtime React/Babel (support.js), injecte un <head> SEO complet
//  (title/description/canonical/OG/JSON-LD/geo) + l'interactivité vanilla vt.js,
//  et produit du HTML statique autonome dans lp/public/ (servi tel quel).
//  Usage : node build.mjs
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { site } from './src/data/site.mjs';
import { pricing } from './src/data/pricing.mjs';
import { cities } from './src/data/cities.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = (p) => join(__dir, p);
const readDesign = (p) => readFileSync(root('design/' + p), 'utf8');
const pub = (p) => root('public/' + p);
const fmt = (n) => n.toFixed(2).replace('.', ',');

// ── Phase 3.4 — `node build.mjs --sync-pricing` : rebake le HTML statique (SEO) avec la grille DB
// (source de vérité, éditée dans l'app admin). Sans le flag ou API muette → fallback pricing.mjs.
// L'hydratation runtime (vt.js initPricing) reste active par-dessus dans tous les cas.
let activePricing = pricing;
if (process.argv.includes('--sync-pricing')) {
  try {
    const res = await fetch('https://app-tracky.vizyoagency.com/api/public/pricing');
    const remote = res.ok ? await res.json() : null;
    if (remote?.plans?.lite?.serenite) {
      activePricing = remote;
      console.log(`✔ grille synchronisée depuis l'API (Sérénité ${remote.plans.lite.serenite}/${remote.plans.pro.serenite}/${remote.plans.signature.serenite})`);
    } else console.warn(`⚠ sync-pricing : réponse invalide (HTTP ${res.status}) — fallback pricing.mjs`);
  } catch {
    console.warn('⚠ sync-pricing : API injoignable — fallback pricing.mjs');
  }
}
const P = activePricing.plans, A = activePricing.addons;

// Cache-busting de vt.js (hash de contenu)
const VT_V = createHash('md5').update(readFileSync(pub('assets/vt.js'))).digest('hex').slice(0, 8);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const abs = (path) => site.baseUrl + (path.startsWith('/') ? path : '/' + path);

// ── JSON-LD ──
// Graphe d'entités (lot A2, 22/10/2026) : UNE identité stable par @id, déclarée sur la Home ; les autres pages
// (Service des villes/Occitanie, Product, WebSite) la référencent par son @id — jamais de second "LocalBusiness".
// Seule implantation réelle : 20 Rue Hermès, 31520 Ramonville-Saint-Agne (mentions légales + fiche Google Business Profile).
// Pas de `geo` : aucune coordonnée exacte de Ramonville dans une source fiable du projet — on n'en invente pas.
const ID_ORG = site.baseUrl + '/#organization';
const ID_WEBSITE = site.baseUrl + '/#website';
const REGION_AREA = { '@type': 'AdministrativeArea', name: site.region };
const ORG_REF = { '@type': 'Organization', '@id': ID_ORG, name: site.name, url: site.baseUrl };
const ORG_LD = { '@context': 'https://schema.org', '@type': ['Organization', 'LocalBusiness'], '@id': ID_ORG, name: site.name, url: site.baseUrl, logo: abs('/favicon-512.png'), image: abs(site.ogImage), email: site.email, telephone: site.phoneE164, address: { '@type': 'PostalAddress', streetAddress: '20 Rue Hermès', postalCode: '31520', addressLocality: 'Ramonville-Saint-Agne', addressRegion: site.region, addressCountry: 'FR' }, areaServed: REGION_AREA, sameAs: [site.agencyUrl] };
const WEBSITE_LD = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': ID_WEBSITE, name: site.name, url: site.baseUrl, inLanguage: 'fr-FR', publisher: { '@id': ID_ORG } };
const crumb = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.out === 'index.html' ? site.baseUrl + '/' : abs(it.out) })) });
const faqLd = (qa) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });
// Product : @id propre à chaque page qui le porte ; fourchette de prix DÉRIVÉE des offres listées (grille réelle, jamais saisie à la main).
const productLd = (out) => {
  const offers = [['Tracky Lite', P.lite.serenite], ['Tracky Pro', P.pro.serenite], ['Tracky Signature', P.signature.serenite]]
    .map(([n, price]) => ({ '@type': 'Offer', name: `${n} (Sérénité, tout inclus, prix par véhicule et par an)`, price, priceCurrency: 'EUR' }));
  const prices = offers.map((o) => o.price);
  return { '@context': 'https://schema.org', '@type': 'Product', '@id': abs(out) + '#product', name: 'Vizyo Tracky — traceur GPS de flotte', url: abs(out), description: 'Solution tout inclus (boîtier, SIM, pose, garantie) : géolocalisation temps réel, coupure moteur, alertes, rapports, comptes conducteurs.', brand: { '@type': 'Brand', name: 'Vizyo Tracky' }, offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: offers.length, offers, seller: ORG_REF } };
};
// Pages villes / Occitanie : un Service (pas un LocalBusiness) fourni par l'entité canonique, avec une zone desservie
// typée ; aucune adresse locale, aucune coordonnée de centre-ville, aucun délai ni chiffre.
const serviceLd = (c, out) => {
  const region = c.region === true;
  return { '@context': 'https://schema.org', '@type': 'Service', '@id': abs(out) + '#service', name: region ? 'Vizyo Tracky — géolocalisation et suivi de flotte en Occitanie' : `Vizyo Tracky — géolocalisation et suivi de flotte à ${c.name}`, serviceType: 'Géolocalisation et suivi de flotte', url: abs(out),
    description: region ? "Géolocalisation et suivi de flotte pour les entreprises d'Occitanie, avec intervention de nos techniciens dans toute la région." : `Géolocalisation et suivi de flotte pour les entreprises de ${c.name} (${c.dept}), avec installation sur site sur rendez-vous par nos techniciens en Occitanie.`,
    provider: ORG_REF,
    areaServed: region ? REGION_AREA : { '@type': 'City', name: c.name, containedInPlace: { '@type': 'AdministrativeArea', name: c.dept, containedInPlace: REGION_AREA } } };
};
const HOME = { name: 'Accueil', out: 'index.html' };

// ── Maillage local : cities.mjs reste la source unique des pages villes ──
const cityPin = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const generatedCities = cities.filter((city) => city.generate);
const toulouse = generatedCities.find((city) => city.slug === 'toulouse');
const otherCities = generatedCities.filter((city) => city.slug !== 'toulouse');
// Ancres variées (une par ville, sans gabarit unique) ; repli générique si une ville est ajoutée sans entrée ici.
const CITY_ANCHORS = {
  montpellier: 'Solution GPS de flotte à',
  nimes: 'Suivi de véhicules à',
  perpignan: 'Traceur GPS pour entreprises à',
  albi: 'Géolocalisation de véhicules à',
  montauban: 'GPS pour flottes professionnelles à',
  tarbes: 'Suivi de flotte à',
  carcassonne: 'Traceurs GPS de flotte à',
  rodez: 'Gestion de flotte GPS à',
  auch: 'Traceur GPS de véhicules à',
  foix: 'Suivi GPS des véhicules à',
  cahors: 'Solution de géolocalisation à',
  mende: 'GPS de flotte professionnelle à',
};
const cityAnchor = (city) => `${CITY_ANCHORS[city.slug] || 'Suivi de flotte à'} ${esc(city.name)}`;
const REGION_CITY_LINKS = `${toulouse ? `<a href="gps-flotte-${toulouse.slug}.html" style="display:flex;align-items:center;justify-content:space-between;gap:20px;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 38%,transparent);border-radius:16px;padding:22px 24px;margin-bottom:18px;transition:transform .2s,border-color .2s" data-vth="transform:translateY(-2px);border-color:var(--accent)"><span><span style="display:block;font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:6px">Zone desservie depuis Ramonville-Saint-Agne · ${esc(toulouse.dept)}</span><strong style="display:block;font-size:1.08rem;color:var(--tx)">Géolocalisation de flotte à ${esc(toulouse.name)}</strong></span><span style="display:flex;flex:none;color:var(--accent)" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span></a>` : ''}
<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px">
${otherCities.map((city) => `<a href="gps-flotte-${city.slug}.html" style="display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-weight:600;font-size:.92rem;transition:all .2s" data-vth="border-color:var(--accent);color:var(--accent)">${cityPin}${cityAnchor(city)} <span style="color:var(--tx3);font-weight:500">· ${esc(city.dept)}</span></a>`).join('\n')}
</div>`;

// ── <head> SEO (le design fournit polices + styles via son <helmet>) ──
function seoHead({ title, description, canonical, jsonld = [], geo, robots }) {
  const img = abs(site.ogImage);
  const ld = jsonld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');
  const geoTags = geo ? `<meta name="geo.region" content="FR-${geo.dept}"><meta name="geo.placename" content="${esc(geo.place)}"><meta name="geo.position" content="${geo.lat};${geo.lng}"><meta name="ICBM" content="${geo.lat}, ${geo.lng}">` : '';
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${robots || 'index,follow'}">
<meta name="theme-color" content="#080B0A">
${geoTags}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site.name)}"><meta property="og:locale" content="${site.locale}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${img}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png"><link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png"><link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png"><link rel="manifest" href="/site.webmanifest">
${ld}
<script>window.VT_CFG=${JSON.stringify({ leadApi: site.leadApi, partnerApi: site.appUrl + '/api/partner/activity', consentApi: site.appUrl + '/api/consent/lp', statsApi: site.appUrl + '/api/public/stats', pricingApi: site.appUrl + '/api/public/pricing', wa: 'https://wa.me/' + site.whatsapp, tel: site.phoneDisplay, telE164: site.phoneE164 })};</script>`;
}

// ── Simulateur tarifs : styles initiaux (identiques à vt.js) ──
const seg = (a) => `flex:1;padding:11px;border-radius:9px;border:none;cursor:pointer;font-weight:700;font-size:.9rem;font-family:inherit;transition:all .2s;${a ? 'background:var(--accent);color:var(--accent-ink)' : 'background:transparent;color:var(--tx2)'}`;
const opt = (a) => `padding:13px 10px;border-radius:11px;cursor:pointer;font-weight:700;font-size:.88rem;font-family:inherit;text-align:center;transition:all .2s;${a ? 'background:var(--accent-soft);border:1.5px solid var(--accent);color:var(--accent)' : 'background:var(--surface);border:1px solid var(--border);color:var(--tx2)'}`;
const tog = (a) => `flex:none;width:50px;height:28px;border-radius:16px;border:none;cursor:pointer;padding:3px;display:flex;transition:all .2s;justify-content:${a ? 'flex-end' : 'flex-start'};background:${a ? 'var(--accent)' : 'var(--border2)'}`;
const THUMB = 'width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3)';
const optRow = (title, note, val) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);margin-bottom:14px"><div><div style="font-weight:700;font-size:.92rem">${title}</div><div style="font-size:.78rem;color:var(--tx2)">${note}</div></div><button data-sim="opt" data-val="${val}" aria-label="${esc(title)}" style="${tog(false)}"><span style="${THUMB}"></span></button></div>`;
const resCard = (label, out, sub, accent) => `<div style="border:${accent ? '1.5px solid var(--accent)' : '1px solid var(--border)'};border-radius:12px;padding:15px;background:${accent ? 'var(--accent-soft)' : 'var(--surface2)'}"><div style="font-size:.7rem;color:var(--tx2);margin-bottom:5px">${label}</div><div data-out="${out}" style="font-size:1.35rem;font-weight:800;letter-spacing:-.02em${accent ? ';color:var(--accent)' : ''}">…</div><div${sub.o ? ` data-out="${sub.o}"` : ''} style="font-size:.66rem;color:var(--tx3);margin-top:2px">${sub.t}</div></div>`;

// ── Champs de formulaire lead (réutilisés par la section démo et le devis) ──
const leadField = (label, name, type, req, ph) =>
  `<div style="display:flex;flex-direction:column;gap:6px;text-align:left"><label style="font-size:.8rem;font-weight:600;color:var(--tx2)">${label}${req ? ' *' : ''}</label><input type="${type}" name="${name}"${req ? ' required' : ''} placeholder="${esc(ph || '')}" style="width:100%;min-width:0;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--tx);font:inherit;font-size:.92rem;outline:none"></div>`;

// ── Section « Recevoir une présentation » : VRAI formulaire lead → POST site.leadApi (vt.js) ──
const DEMO_SECTION = `<section id="demo" class="vt-sec" style="padding:72px 0;position:relative;overflow:hidden;border-bottom:1px solid var(--border)">
<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:640px;height:320px;background:radial-gradient(ellipse,var(--accent-soft),transparent 70%);pointer-events:none"></div>
<div data-reveal style="max-width:560px;margin:0 auto;padding:0 32px;text-align:center;position:relative">
<div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:16px"><span style="width:26px;height:2px;background:var(--accent);border-radius:2px"></span><span style="font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)">Réponse rapide · Sans engagement</span><span style="width:26px;height:2px;background:var(--accent);border-radius:2px"></span></div>
<h2 style="font-size:clamp(1.7rem,3.4vw,2.3rem);font-weight:800;letter-spacing:-.03em;line-height:1.08;margin:0 0 8px">Demandez votre démo gratuite.</h2>
<p style="font-size:1rem;line-height:1.55;color:var(--tx2);margin:0 0 22px">Laissez vos coordonnées — on s'occupe du reste.</p>
<form data-vt-lead="${site.leadApi}" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:var(--shadow-sm);display:grid;gap:12px;text-align:left">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${leadField('Nom', 'name', 'text', true, 'Jean Dupont')}${leadField('E-mail', 'email', 'email', true, 'vous@societe.fr')}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${leadField('Téléphone', 'phone', 'tel', false, '06 12 34 56 78')}${leadField('Nombre de véhicules', 'fleetSize', 'text', false, 'ex : 8')}</div>
<button type="submit" style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:.98rem;padding:14px;border-radius:11px;border:none;cursor:pointer;transition:transform .2s" data-vth="transform:translateY(-2px)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Recevoir ma démo</button>
<div data-form-status style="font-size:.84rem;min-height:1.1em;color:var(--tx2);text-align:center"></div>
</form>
<div style="margin-top:14px;font-size:.86rem;color:var(--tx2)">ou <a href="https://wa.me/${site.whatsapp}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">WhatsApp</a> · <a href="tel:${site.phoneE164}" style="color:var(--accent);font-weight:600">${site.phoneDisplay}</a></div>
</div>
</section>`;

// Section simulateur → devis signable (remplace le composant React du design).
const SIM_SECTION = `<section class="vt-sec" id="simulateur" style="padding:96px 0">
<style>@media(max-width:760px){.vt-sim4{grid-template-columns:repeat(2,1fr)!important}}</style>
<div style="max-width:780px;margin:0 auto;padding:0 32px">
<div data-reveal style="text-align:center;max-width:40rem;margin:0 auto 40px">
<p style="font-family:'JetBrains Mono',monospace;font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 14px">Devis en ligne</p>
<h2 style="font-size:clamp(1.8rem,3.4vw,2.5rem);font-weight:800;letter-spacing:-.025em;line-height:1.1;margin:0 0 14px">Composez votre devis.</h2>
<p style="font-size:1.04rem;line-height:1.6;color:var(--tx2);margin:0">Configurez votre flotte, obtenez votre tarif tout compris, puis validez votre devis en un clic. Tarif bloqué à la souscription.</p>
</div>
<div id="vt-sim" data-reveal style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:30px;box-shadow:var(--shadow-sm)">
<div style="display:flex;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:5px;margin-bottom:26px">
<button data-sim="plan" data-val="lite" style="${seg(false)}">Lite</button>
<button data-sim="plan" data-val="pro" style="${seg(true)}">Pro</button>
<button data-sim="plan" data-val="signature" style="${seg(false)}">Signature</button>
</div>
<div style="margin-bottom:26px">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><label style="font-weight:700;font-size:.95rem">Nombre de véhicules</label><span data-out="vehicles" style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1.4rem;color:var(--accent)">5</span></div>
<input type="range" min="1" max="50" step="1" value="5" data-sim="vehicles" aria-label="Nombre de véhicules" style="width:100%;height:6px;cursor:pointer;accent-color:var(--accent)">
<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.74rem;color:var(--tx3)"><span>1</span><span>50+ → tarif dégressif, contactez-nous</span></div>
</div>
<div style="margin-bottom:26px">
<label style="display:block;font-weight:700;font-size:.95rem;margin-bottom:11px">Formule</label>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
<button data-sim="formule" data-val="serenite" style="${opt(true)}">Sérénité<small style="display:block;font-weight:500;font-size:.72rem;opacity:.7;margin-top:2px">tout inclus · 36 mois</small></button>
<button data-sim="formule" data-val="liberte" style="${opt(false)}">Liberté<small style="display:block;font-weight:500;font-size:.72rem;opacity:.7;margin-top:2px">sans engagement · 12 mois</small></button>
</div>
</div>
${optRow('Option Live temps réel (20 s)', `+${A.live.perVehYear} €/véhicule/an · incluse en Signature`, 'live')}
${optRow("Option Micro d'assistance <span style=\"font-weight:500;color:var(--tx3)\">(légal)</span>", `+${A.micro.perVehYear} €/véhicule/an · incluse en Signature`, 'micro')}
${optRow('Option Assistant IA <span style="font-weight:500;color:var(--tx3)">(optimisation)</span>', `+${A.agent.perVehYear} €/véhicule/an · incluse en Signature`, 'agent')}
<div style="margin-bottom:26px;margin-top:12px">
<label style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-weight:700;font-size:.95rem;margin-bottom:11px">Rétention de l'historique</label>
<div class="vt-sim4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
<button data-sim="ret" data-val="90j" style="${opt(true)}">90 jours<small style="display:block;font-weight:500;font-size:.68rem;opacity:.7;margin-top:2px">inclus</small></button>
<button data-sim="ret" data-val="1an" style="${opt(false)}">1 an<small style="display:block;font-weight:500;font-size:.68rem;opacity:.7;margin-top:2px">+47 €/an</small></button>
<button data-sim="ret" data-val="2ans" style="${opt(false)}">2 ans<small style="display:block;font-weight:500;font-size:.68rem;opacity:.7;margin-top:2px">+83 €/an</small></button>
<button data-sim="ret" data-val="3ans" style="${opt(false)}">3 ans<small style="display:block;font-weight:500;font-size:.68rem;opacity:.7;margin-top:2px">+119 €/an</small></button>
</div>
</div>
<div style="height:1px;background:var(--border);margin:0 0 24px"></div>
<div class="vt-sim4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
${resCard('Par jour / véhicule', 'perDay', { t: 'tout compris' })}
${resCard('Par véhicule / an', 'perVehYear', { o: 'perVehMonth', t: '' }, true)}
${resCard('Total flotte / an', 'totalYear', { t: 'tout inclus, HT' })}
${resCard('Soit par mois', 'totalMonth', { t: 'équivalent mensuel' })}
</div>
<div style="border:1px solid var(--border);border-radius:12px;padding:18px;background:var(--surface2);margin-bottom:22px">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:.82rem;color:var(--tx2)">Économies estimées</span><span data-out="roi" style="font-weight:800;font-size:1.15rem;color:var(--accent)">…</span></div>
<div style="height:8px;border-radius:5px;background:var(--border);overflow:hidden"><div style="height:100%;width:62%;background:linear-gradient(90deg,var(--accent2),var(--accent))"></div></div>
<p style="font-size:.74rem;color:var(--tx3);margin:10px 0 0">Carburant &amp; usage maîtrisés, par an pour votre flotte.</p>
</div>
<div style="display:flex;align-items:flex-start;gap:9px;font-size:.82rem;color:var(--tx2);margin-bottom:22px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" style="flex:none;margin-top:1px"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></svg><span data-out="installNote">Tout inclus : boîtier, SIM &amp; data, pose par nos équipes et garantie.</span></div>
<form data-vt-lead="${site.leadApi}" data-require-accord style="display:grid;gap:14px;border-top:1px solid var(--border);padding-top:24px;text-align:left">
<div style="font-weight:800;font-size:1.05rem;text-align:center;margin-bottom:2px">Recevez ce devis et validez-le</div>
<input type="hidden" name="message"><input type="hidden" name="fleetSize">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${leadField('Nom', 'name', 'text', true, 'Jean Dupont')}${leadField('Société', 'company', 'text', false, 'Votre entreprise')}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${leadField('E-mail', 'email', 'email', true, 'vous@societe.fr')}${leadField('Téléphone', 'phone', 'tel', false, '06 12 34 56 78')}</div>
<label style="display:flex;align-items:flex-start;gap:10px;font-size:.86rem;color:var(--tx2);cursor:pointer"><input type="checkbox" name="accord" style="margin-top:2px;width:18px;height:18px;accent-color:var(--accent);flex:none"><span><strong style="color:var(--tx)">Bon pour accord.</strong> Je valide ce devis indicatif et souhaite être recontacté(e) pour le finaliser — tarif bloqué à la souscription, sans engagement de ma part à ce stade.</span></label>
<button type="submit" style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:.98rem;padding:15px;border-radius:12px;border:none;cursor:pointer;transition:transform .2s" data-vth="transform:translateY(-2px)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Valider et recevoir mon devis</button>
<div data-form-status style="font-size:.84rem;min-height:1.1em;color:var(--tx2);text-align:center"></div>
</form>
</div>
</div>
</section>`;

// ── Transformation d'une page design → contenu statique ──
function transform(html, out) {
  const helmetM = html.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const bodyM = html.match(/<\/helmet>([\s\S]*?)<\/x-dc>/);
  if (!helmetM || !bodyM) throw new Error('structure x-dc introuvable dans ' + out);
  const helmet = helmetM[1].trim();
  let body = bodyM[1].trim();
  // bindings support.js → hooks vanilla
  body = body
    .replace(/onClick="\{\{ toggleTheme \}\}"/g, 'data-vt="theme"')
    .replace(/onClick="\{\{ toggleMenu \}\}"/g, 'data-vt="menu"')
    .replace(/style="display:\{\{ menuDisplay \}\};/g, 'id="vt-menu" style="display:none;')
    .replace(/ style-hover="([^"]*)"/g, ' data-vth="$1"');
  // Page tarifs : remplace la section simulateur (bindings React) par le devis signable autonome
  if (out === 'tarifs.html') body = body.replace(/<section[^>]*id="simulateur"[\s\S]*?<\/section>/, SIM_SECTION);
  // Page accueil : remplace la section #demo (2 boutons morts) par le VRAI formulaire lead.
  if (out === 'index.html') body = body.replace(/<section[^>]*id="demo"[\s\S]*?<\/section>/, DEMO_SECTION);
  // Hub Occitanie : les destinations locales suivent automatiquement cities.mjs.
  if (out === 'gps-flotte-occitanie.html') body = body.replace('<div data-vt-region-cities></div>', REGION_CITY_LINKS);
  // Répare le lien mort de l'agence en footer (toutes pages).
  body = body.replace(/<a href="#"([^>]*)>vizyoagency\.com<\/a>/g, `<a href="${site.agencyUrl}"$1 target="_blank" rel="noopener">vizyoagency.com</a>`);
  // Phase 3.4 — rebake des prix balisés [data-vt-price] avec la grille ACTIVE (DB si --sync-pricing).
  // Le HTML statique (SEO) reste ainsi aligné sur les prix réels ; vt.js ré-hydrate par-dessus.
  body = body.replace(/data-vt-price="([a-z0-9_.]+)">[0-9]+(<\/span>)/g, (m, path, close) => {
    let v = activePricing;
    for (const k of path.split('.')) v = v?.[k];
    return typeof v === 'number' ? `data-vt-price="${path}">${v}${close}` : m;
  });
  // « Connexion » dans la navbar de TOUTES les pages (l'accueil l'a déjà via son hero → sauté).
  if (!body.includes('btn-login')) {
    const loginIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
    const hasMenu = body.includes('id="vt-menu"');
    // Desktop : juste après le bouton thème (→ [thème][Connexion][CTA][burger], comme l'accueil).
    // Page sans menu mobile (mentions légales) → pas de `vt-nav` (sinon Connexion masqué <900px sans repli burger).
    body = body.replace(/(<button data-vt="theme"[\s\S]*?<\/button>)/, `$1<a class="btn-login${hasMenu ? ' vt-nav' : ''}" href="https://app-tracky.vizyoagency.com/" rel="noopener" title="Accéder à l'application">${loginIcon}Connexion</a>`);
    // Mobile : en tête du menu déroulant (uniquement si la page a un menu).
    if (hasMenu) body = body.replace(/(<div id="vt-menu"[^>]*>)/, `$1<a href="https://app-tracky.vizyoagency.com/" rel="noopener" style="padding:11px 8px;font-weight:600;color:var(--tx2);border-radius:8px;display:flex;align-items:center;gap:8px">${loginIcon}Connexion</a>`);
  }
  return { helmet, body };
}

// Pages dont le HTML a réellement changé à ce passage : seules elles reçoivent la date du jour dans le sitemap.
const pagesReecrites = new Set();
function buildPage(meta) {
  const canonical = meta.out === 'index.html' ? site.baseUrl + '/' : abs(meta.out);
  const { helmet, body } = transform(readDesign(meta.file || meta.out), meta.out);
  const head = seoHead({ title: meta.title, description: meta.description, canonical, jsonld: meta.jsonld || [], geo: meta.geo, robots: meta.robots });
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
${head}
${helmet}
<style>/* Garde anti-débordement mobile (global) : médias bornés + enfants de
grilles/flex peuvent rétrécir sous leur contenu (sinon un tableau/prix/e-mail
force une largeur > écran → scroll horizontal). Sûr : ne rétrécit que là où la
grille/flex l'autorise déjà. */
img,svg,video{max-width:100%}
[style*="display:grid"]>*,[style*="display:flex"]>*{min-width:0}
/* Bouton « Connexion » navbar (injecté sur toutes les pages) */
.btn-login{display:inline-flex;align-items:center;gap:7px;color:var(--tx2);font-weight:600;font-size:.87rem;padding:9px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);transition:color .2s,border-color .2s;white-space:nowrap;text-decoration:none}
.btn-login:hover{color:var(--tx);border-color:var(--border2)}
/* Bouton « revenir en haut » — masqué sous le bandeau consentement / une pop-in (piloté par vt.js) */
#vt-totop{position:fixed;right:22px;bottom:22px;z-index:110;width:46px;height:46px;border-radius:50%;border:1px solid var(--border2);background:color-mix(in srgb,var(--surface) 90%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--tx);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;visibility:hidden;transform:translateY(12px);transition:opacity .3s,transform .3s,visibility .3s}
#vt-totop.show{opacity:1;visibility:visible;transform:none}
#vt-totop:hover{border-color:var(--accent);color:var(--accent)}
@media(max-width:520px){#vt-totop{right:14px;bottom:14px;width:42px;height:42px}}</style>
</head>
<body>
${body}
<button id="vt-totop" type="button" aria-label="Revenir en haut" title="Revenir en haut"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="6"/><polyline points="5 12 12 5 19 12"/></svg></button>
<script src="assets/vt.js?v=${VT_V}"></script>
</body>
</html>`;
  const leftover = html.match(/\{\{[^}]*\}\}/);
  if (leftover) console.warn('  ⚠︎ binding non résolu dans', meta.out, ':', leftover[0]);
  let avant = null;
  try { avant = readFileSync(pub(meta.out), 'utf8'); } catch { /* page nouvelle */ }
  if (avant !== html) pagesReecrites.add(meta.out);
  writeFileSync(pub(meta.out), html, 'utf8');
  return meta.out === 'index.html' ? site.baseUrl + '/' : abs(meta.out);
}

// ── Manifeste des pages principales (SEO) ──
const PAGES = [
  { out: 'index.html', title: 'Traceur GPS pour flotte en Occitanie | Vizyo Tracky', description: "Suivez vos véhicules en temps réel, coupez le moteur à distance, recevez des alertes. Boîtier GPS et application française, installation sur site par nos techniciens en Occitanie.", jsonld: [ORG_LD, WEBSITE_LD] },
  { out: 'fonctionnalites.html', title: 'Fonctionnalités du traceur GPS de flotte | Vizyo Tracky', description: "Suivi temps réel, historique des trajets, coupure moteur par plage horaire, alertes, rapports, conducteurs identifiés et mode vie privée CNIL : toutes les fonctionnalités de Vizyo Tracky.", jsonld: [productLd('fonctionnalites.html'), crumb([HOME, { name: 'Fonctionnalités', out: 'fonctionnalites.html' }])] },
  { out: 'tarifs.html', title: `Tarifs GPS flotte tout inclus — dès ${P.lite.serenite} €/véhicule/an | Vizyo Tracky`, description: `Modèle tout inclus : boîtier, SIM, pose et garantie compris. Tracky Lite ${P.lite.serenite} €, Pro ${P.pro.serenite} €, Signature ${P.signature.serenite} €/véhicule/an HT (Sérénité, 36 mois). Sans engagement dès ${P.lite.liberte} €/an. Devis en ligne.`, jsonld: [productLd('tarifs.html'), crumb([HOME, { name: 'Tarifs', out: 'tarifs.html' }]), faqLd([{ q: 'Quels sont les tarifs de Vizyo Tracky ?', a: `Formule Sérénité (tout inclus, engagement 36 mois) : Tracky Lite ${P.lite.serenite} €, Pro ${P.pro.serenite} €, Signature ${P.signature.serenite} € par véhicule et par an HT — boîtier, SIM, pose et garantie compris. Formule Liberté (sans engagement, 12 mois, matériel restitué) : ${P.lite.liberte}, ${P.pro.liberte} et ${P.signature.liberte} €/an.` }, { q: 'Que veut dire « tout inclus » ?', a: `Le boîtier, la SIM et les données, la pose par nos équipes et la garantie échange sont compris dans l'abonnement. Rien à acheter, rien à installer vous-même.` }, { q: 'Le temps réel est-il inclus ?', a: `Le suivi standard est inclus. Le Live temps réel (20 s) est une option à ${A.live.perVehYear} €/véhicule/an, incluse dans Tracky Signature.` }, { q: 'Le tarif peut-il augmenter ?', a: "Non : le tarif est garanti à la souscription et reconduit au même prix. Pas d'augmentation surprise." }])] },
  { out: 'secteur-public.html', title: 'GPS véhicules de service — secteur public & médico-social | Vizyo Tracky', description: "Géolocalisation des véhicules de service pour établissements publics, foyers, structures médico-sociales et collectivités : conformité CNIL, conducteurs identifiés, données souveraines, marchés publics.", jsonld: [crumb([HOME, { name: 'Secteur public', out: 'secteur-public.html' }])] },
  { out: 'securite.html', title: 'Sécurité & conformité RGPD — hébergement France | Vizyo Tracky', description: "Vos données restent en France, sous votre contrôle : hébergement souverain, chiffrement TLS 1.3, conformité RGPD by design, mode vie privée CNIL.", jsonld: [crumb([HOME, { name: 'Sécurité', out: 'securite.html' }])] },
  { out: 'partenariat-maestroo.html', title: 'Vizyo Tracky × Maestroo — le GPS de flotte dans votre gestion de transport', description: "Vizyo Tracky en partenariat avec Maestroo : GPS temps réel, coupe-circuit moteur, analyse IA des trajets et pilotage des économies, bientôt intégrés à votre logiciel de gestion de transport. Découvrez la présentation animée.", jsonld: [crumb([HOME, { name: 'Partenariat Maestroo', out: 'partenariat-maestroo.html' }])] },
  { out: 'decouvrir.html', title: 'Vizyo Tracky en vidéo — présentation des services', description: "Présentation animée de Vizyo Tracky : supervision, analyse et administration de votre flotte. Lien partagé par e-mail après une demande.", robots: 'noindex,follow', noSitemap: true, jsonld: [] },
  { out: 'gps-flotte-occitanie.html', title: 'Traceurs GPS pour entreprises en Occitanie | Vizyo Tracky', description: "Traceurs GPS pour flottes professionnelles dans les 13 départements d'Occitanie : suivi temps réel, coupure moteur, alertes. Nos techniciens interviennent sur site, sur rendez-vous.", jsonld: [serviceLd({ name: 'Occitanie', region: true }, 'gps-flotte-occitanie.html'), crumb([HOME, { name: 'Zones desservies', out: 'gps-flotte-occitanie.html' }])] },
  { out: 'mentions-legales.html', title: 'Mentions légales | Vizyo Tracky', description: 'Mentions légales du site Vizyo Tracky (Vizyo Agency).', robots: 'index,follow', noSitemap: true, jsonld: [crumb([HOME, { name: 'Mentions légales', out: 'mentions-legales.html' }])] },
];

let built = 0;
const sitemapUrls = [];
function seoWeight(out) {
  if (out === 'index.html') return { priority: '1.0', changefreq: 'weekly' };
  if (out === 'gps-flotte-toulouse.html' || out === 'gps-flotte-occitanie.html') return { priority: '0.9', changefreq: 'monthly' };
  if (out.startsWith('gps-flotte-')) return { priority: '0.7', changefreq: 'monthly' };
  return { priority: '0.8', changefreq: 'monthly' };
}
function emit(meta) {
  const loc = buildPage(meta);
  if (!meta.noSitemap) sitemapUrls.push({ loc, changed: pagesReecrites.has(meta.out), ...seoWeight(meta.out) });
  built++; console.log('✓', meta.out);
}

for (const meta of PAGES) emit(meta);

// FAQ propre à Toulouse (A5, 22/10/2026) : IDENTIQUE au texte visible de lp/design/gps-flotte-toulouse.html.
const TOULOUSE_FAQ = [
  { q: "Comment installer un traceur GPS sur une flotte à Toulouse ?", a: "L'installation se fait sur site, sur rendez-vous. Nos techniciens posent les boîtiers sur vos véhicules, vous accompagnent à l'installation, puis vos conducteurs sont invités par e-mail à créer leur compte." },
  { q: "Votre équipe intervient-elle seulement à Toulouse ?", a: "Non. L'équipe est basée à Ramonville-Saint-Agne et accompagne les entreprises de Toulouse et de sa métropole, et nos techniciens interviennent dans toute l'Occitanie, dont la Haute-Garonne." },
  { q: "Que devient la vie privée d'un salarié qui utilise le véhicule hors du travail ?", a: "Vous définissez le temps de travail du véhicule : en dehors, aucune position n'est enregistrée. Le conducteur voit son cadre horaire et peut passer en mode privé pour un trajet personnel." },
  { q: "Qui répond après l'installation ?", a: "Le support local est joignable 24 h/24, 7 j/7, par WhatsApp ou par e-mail, pour une question sur l'application, un réglage ou un incident." },
  { q: "Peut-on immobiliser un véhicule à distance ?", a: "Oui, avec la formule Tracky Pro : la coupure moteur se déclenche à la demande ou sur une plage horaire, à l'arrêt uniquement et jamais en roulant. La formule Tracky Lite est une géolocalisation simple, sans coupure." },
];

// ── Pages villes (SEO local depuis cities.mjs, contenu depuis le design) ──
for (const c of cities.filter((x) => x.generate)) {
  const out = `gps-flotte-${c.slug}.html`;
  emit({
    out, file: out,
    title: c.slug === 'toulouse' ? 'Géolocalisation de flotte à Toulouse | Vizyo Tracky' : `GPS flotte ${c.name} — géolocalisation véhicules entreprise (${c.dept})`,
    description: c.slug === 'toulouse'
      ? 'Géolocalisation de flotte à Toulouse et en Haute-Garonne par une équipe basée à Ramonville-Saint-Agne : suivi temps réel, coupure moteur, alertes. Installation sur site sur rendez-vous.'
      : `Installation de traceurs GPS de flotte à ${c.name} et ${c.inDept} (${c.deptNum}). Géolocalisation temps réel, coupure moteur, alertes. Application française, support local, installation sur site sur rendez-vous.`,
    // Pas de meta geo.* / ICBM : centre-ville sans établissement (décision A2, 22/10/2026).
    // FAQ : textes IDENTIQUES à ceux visibles dans lp/design/gps-flotte-*.html (A4, 22/10/2026).
    jsonld: [serviceLd(c, out), crumb([HOME, { name: 'Occitanie', out: 'gps-flotte-occitanie.html' }, { name: c.name, out }]), faqLd(c.slug === 'toulouse' ? TOULOUSE_FAQ : [
      { q: `Installez-vous les boîtiers GPS à ${c.name} ?`, a: `Oui, nous intervenons à ${c.name} et partout ${c.inDept}. Installation sur site sur rendez-vous, réalisée par nos techniciens, avec accompagnement à l'installation.` },
      { q: `Quel est le tarif à ${c.name} ?`, a: `Les mêmes tarifs transparents partout : tout inclus dès ${P.lite.serenite} €/véhicule/an (Tracky Lite) et ${P.pro.serenite} €/an pour Tracky Pro avec coupure moteur — boîtier, SIM et pose compris. Voir le simulateur.` },
      { q: `Le suivi fonctionne-t-il hors de ${c.name} ?`, a: `Oui. Vos véhicules restent visibles sur la carte lorsqu'ils quittent la ville (SIM & data incluses).` },
    ])],
  });
}

// ── Sitemap + robots ──
const today = new Date().toISOString().slice(0, 10);
// lastmod = la dernière modification réelle de la page : un build qui ne change rien laisse le sitemap intact (sinon chaque build
// redate tout le site et salit l'arbre de travail, ce qui bloque aussi Agent Lot dans Conductor).
const lastmodPrecedent = new Map();
try {
  for (const m of readFileSync(pub('sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) lastmodPrecedent.set(m[1], m[2]);
} catch { /* premier build */ }
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.changed ? today : (lastmodPrecedent.get(u.loc) ?? today)}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
writeFileSync(pub('sitemap.xml'), sitemap, 'utf8');
writeFileSync(pub('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`, 'utf8');

console.log(`\n${built} page(s) générée(s) · sitemap.xml (${sitemapUrls.length} URL) · robots.txt · vt.js?v=${VT_V}`);
