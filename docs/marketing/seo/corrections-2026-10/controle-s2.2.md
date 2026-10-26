# S2.2 — contrôle avant clôture et baseline après déploiement

Lot exécuté par Agent Lot (Conductor, instance dev) le 26/10/2026 : trois prompts, trois commits, PR n° 148
fusionnée (`8e57e60c`). Ce document porte les contrôles du prompt P4, faits à la main : un prompt ne lance ni
la suite complète ni le déploiement. Niveaux de preuve : **MESURÉ** (lu par un outil), **OBSERVÉ** (constaté),
**INFÉRÉ**.

## Contrôles avant déploiement (MESURÉ le 26/10/2026)

| Contrôle | Résultat |
|---|---|
| `node lp/build.mjs` sur une copie propre de `main` | 22 pages générées, **arbre propre après le build** (le sitemap n'est redaté que pour les pages réellement modifiées, PR n° 146) |
| `node lp/verify-links.mjs` | 20 pages indexables reliées depuis la Home, aucune orpheline ; liens et ancres valides ; FAQPage = FAQ visible |
| Blocs JSON-LD de toutes les pages | 52 blocs, 0 illisible |
| Sitemap | 20 URL, les mêmes qu'en production |
| `robots.txt` | identique à la production |
| Pages comparées à la production avant déploiement | 21 identiques sur 23 ; seules `index.html` (liens du footer) et `tarifs.html` (badge retiré, FAQ à source unique) diffèrent ; canonical, robots et H1 identiques |
| Home et Tarifs à 390 px et à 1440 px (copie locale) | aucun débordement horizontal ; plus de « 30 sept » ; footer : Secteur public → `secteur-public.html`, Sécurité & RGPD → `securite.html` ; Tarifs : 4 questions visibles |
| CI de la PR | verte (« Plan, lanceur /lot et liens de la landing ») |

`pnpm verify` et les relectures restent à la clôture du lot, comme le prévoit le découpage. Aucun code de l'application
n'a changé.

## Déploiement (OBSERVÉ)

- 26/10/2026 à 19:18 UTC, `deploy.sh --marketing-seul`, commit `8e57e60c` ; seul `tracky-lp` est recréé, sain en 5 s ;
  l'API et le Web applicatif ne sont pas touchés.
- Repli : `bash /opt/vizyo-tracky/deploy/vps/deploy.sh --marketing-seul --repli avant-20261026-1918-1b08f753`
  (l'image du site avant ce déploiement, commit `1b08f753`).

## Baseline après déploiement (MESURÉ le 26/10/2026, après le déploiement)

- 23 pages en ligne comparées au texte exact des pages construites : **aucun écart**.
- Home : plus aucune mention « 30 sept » ; liens du footer vers les deux pages dédiées.
- Tarifs : plus aucune mention « 30 sept » ; 4 questions visibles, JSON-LD FAQPage identique.
- Sitemap en ligne : 20 URL ; la Home et Tarifs portent la date du 2026-10-26, les autres pages gardent leur date
  du 2026-10-22.
- Pages d'accueil de la vitrine et de l'application : HTTP 200.

Cette baseline est **datée du 26/10/2026 et distincte du relevé S2.1** (Search Console J+4, même jour, avant le
déploiement) : les effets de ce lot ne se lisent qu'à partir de maintenant. Prochaine lecture utile, sans
action Google : à J+4 du déploiement, chercher un recrawl de la Home et de Tarifs, pas un classement.

## Ce que ce lot ne fait pas

Il ne tranche pas la contradiction « pose comprise » contre 49 € par véhicule (la FAQ visible garde ses quatre
questions, dont les frais d'installation), ne redemande pas l'indexation, ne resoumet pas le sitemap et ne touche
pas à la fiche d'établissement.
