# S2.15 — Home : police de repli et image du héros pour mobile — mesure, déploiement et retour arrière

Lot exécuté par Agent Lot (Conductor, instance dev) le 27/10/2026 : trois prompts, trois commits, PR n° 161 fusionnée
(`94fa7597`), déployé en `--marketing-seul` à 00:06 UTC, **puis annulé le même jour** (revert sur `main`, redéploiement) parce que
la mesure en production n'a pas rempli la règle fixée : « ne déployer que si le LCP et le CLS sont meilleurs ».

## Protocole de mesure (identique avant et après)

Lighthouse 12.8.2, mobile, `--throttling-method=devtools` (réseau et processeur réellement ralentis, pas la simulation par défaut),
Chrome sans interface, 6 passages ou plus par état, médiane retenue. Copie locale servie avec compression, puis production.

## Ce que le lot faisait

- P1 : le héros de la Home sert un recadrage de 640 × 1032 px (AVIF 53 Ko, WebP 64 Ko) aux écrans de 480 px et moins, et précharge l'image
  (mobile ou grand écran) ; fidélité vérifiée : zone visible identique à 1 px près (gauche 877 contre 878, largeur 407, hauteur 1032).
- P2 : police de repli « Manrope Fallback » (Arial, `size-adjust:105%`, ascent 101,5 %, descent 28,6 %) dans la pile du `body`.
- P3 : contrôles dans `lp/verify-links.mjs`.

## Résultats

| État | LCP (médiane) | Étendue | CLS | FCP | TBT |
|---|---:|---|---:|---:|---:|
| Avant — copie locale (12 passages) | 2,27 s | 2,16–2,47 | 0,138 | 1,10 s | 1,5 s |
| Après — copie locale (6 passages) | 2,12 s | 1,84–2,60 | 0,004 | 1,27 s | 2,3 s |
| **Avant — production (6 passages)** | **2,32 s** | 2,25–2,40 | **0,138** | 1,19 s | 1,4 s |
| **Après — production (12 passages)** | **2,65 s** | 1,99–3,14 | **0,004** | 1,36 s | 2,3 s |

Dans tous les passages, l'élément LCP est l'image du héros.

## Lecture

- **Le CLS est réglé** (0,138 → 0,004) : la police de repli ajustée supprime le saut de mise en page de la Home.
- **Le LCP est moins bon en production** (2,32 → 2,65 s, avec une forte dispersion), alors que la copie locale le donnait meilleur. Hypothèse (INFÉRÉE,
  non vérifiée) : avant, le saut de mise en page repoussait l'image hors de l'écran et la mesure s'arrêtait sur un élément plus tôt ;
  une fois la page stable, c'est l'image elle-même qui est mesurée, et son téléchargement réel depuis le serveur est plus lent que sur la copie locale.
- **Le temps de blocage du navigateur (TBT) est plus élevé après** (2,3 s contre 1,4–1,5 s) : non expliqué.
- Trouvaille annexe : les fichiers `.avif` n'ont pas d'en-tête de cache (`Cache-Control`) en production, contrairement aux `.webp`,
  `.png` ou `.js` : l'expression régulière de `deploy/vps/nginx.lp.conf` ne cite pas `avif`.

## Décision

Règle du propriétaire non remplie (LCP en production moins bon) : **retour arrière**. `main` est remis dans l'état d'avant (revert de `94fa7597`),
la landing est redéployée depuis cet état. Les deux images recadrées (PR n° 159) restent dans le dépôt, sans être référencées. Repli de
sécurité du déploiement : `--marketing-seul --repli avant-20261027-0006-757a8ef6`.

## Pistes avant de retenter (non faites)

1. Ajouter `avif` à la règle de cache de nginx (gain probable pour les visites répétées, sans toucher au rendu).
2. Servir l'image du héros avec un en-tête de cache et tester `fetchpriority` seul, sans la police de repli, en production.
3. Mesurer la police de repli seule en production : elle règle le CLS, mais l'effet isolé sur le LCP réel n'est connu que sur copie locale.
4. Mesurer sur plusieurs jours avec des données de visiteurs réels (CrUX) quand le site en aura assez.
