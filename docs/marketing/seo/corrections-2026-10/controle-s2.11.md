# S2.11 — performance mobile et PDF DPA : contrôle et résultat

Lot exécuté par Agent Lot (Conductor, instance dev) le 26/10/2026 : trois prompts, trois commits, PR n° 155
fusionnée (`757a8ef6`). Niveaux de preuve : **MESURÉ** (outil), **OBSERVÉ** (constat), **INFÉRÉ**.

## Ce qui a été fait

| Prompt | Effet | Preuve |
|---|---|---|
| P1 | la feuille Google Fonts se charge sans bloquer le rendu (`preload` puis `rel="stylesheet"` au `onload`, repli `<noscript>`) | OBSERVÉ : Home en ligne contient les deux ; Lighthouse ne liste plus la feuille comme ressource bloquante |
| P2 | les valeurs par défaut du simulateur (Pro, 5 véhicules) sont écrites dans le HTML | MESURÉ dans un navigateur : textes identiques avant et après l'exécution du script (8 champs) |
| P3 | le PDF `vizyo-tracky-dpa-fiche-securite.pdf` reste téléchargeable avec `X-Robots-Tag: noindex, follow` | MESURÉ sur la production : en-tête présent, `nosniff` et `SAMEORIGIN` conservés ; les trois autres PDF sans en-tête |

Décision du 26/10/2026 sur le PDF : fiche contractuelle et de sécurité, déjà présentée par la page Sécurité ; son
indexation séparée dupliquerait cette page. Réversible : retirer le bloc `location` de `deploy/vps/nginx.lp.conf`.

## Déploiement

26/10/2026, 19:57 UTC, `deploy.sh --marketing-seul`, commit `757a8ef6` ; seul `tracky-lp` est recréé, sain.
Repli : `bash /opt/vizyo-tracky/deploy/vps/deploy.sh --marketing-seul --repli avant-20261026-1957-8e57e60c`.
Après déploiement : 23 pages en ligne identiques aux pages construites, sitemap de 20 URL (toutes datées du
2026-10-26 puisque toutes les pages ont changé).

## Mesure Lighthouse mobile (4G simulé), production, avant → après

| Page | Score | LCP | FCP | CLS |
|---|---:|---:|---:|---:|
| Home | 77 → 78 | 4,3 s → 4,3 s | 2,9 s → 2,9 s | 0,001 → 0,001 |
| Tarifs | 86 → 86 | 2,9 s → 2,9 s | 2,9 s → 2,9 s | 0,119 → 0,119 |
| Sécurité | 91 → 90 | 2,8 s → 2,8 s | 2,8 s → 2,8 s | 0,005 → 0,086 |

## Ce que le lot n'a PAS atteint

- **Le critère « LCP mobile < 2,5 s » n'est pas atteint** : le retrait de la feuille de polices bloquante ne change pas
  le LCP mesuré (Home 4,3 s, Tarifs 2,9 s, Sécurité 2,8 s). Le lot reste **partiel**.
- **Le CLS de Tarifs (0,119) n'a pas bougé.** L'hypothèse du prompt P2 (le saut vient du simulateur) est fausse : Lighthouse
  désigne la section des **cartes de prix** (Lite, Pro, Signature). Le pré-calcul du simulateur reste utile (le HTML montre
  de vrais prix aux robots) mais ne règle pas le critère.
- **Le CLS de Sécurité est passé de 0,005 à 0,086** (sous le seuil de 0,1, mais en hausse) : probablement le changement de police
  qui n'est plus appliqué avant le premier rendu (INFÉRÉ, non vérifié).

## Suite à prévoir (non faite)

1. Mesurer d'abord avec une trace de performance (outils de développement), pas avec un seul score : le délai d'affichage de
   l'élément LCP (≈ 1,5 s) n'est pas expliqué par les ressources bloquantes.
2. Piste image du héros : image AVIF de 149 Ko servie à toutes les largeurs, pas de variante mobile.
3. Piste polices : police de repli ajustée (taille et métriques) pour que le passage à Manrope ne déplace plus les cartes de
   prix ni la page Sécurité ; puis décider si le premier retour de P1 reste justifié.
