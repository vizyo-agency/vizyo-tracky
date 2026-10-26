# Veille SEO — format de l'archive hebdomadaire

> Décrit le format. Ne contient aucune archive réelle : voir [`V5.3`](../../../pilotage/plan.json)
> pour l'archivage et [`V5.4`](../../../pilotage/plan.json) pour la routine qui les produit.

## Arborescence

Chaque relevé hebdomadaire vit dans son propre dossier daté :

```text
docs/marketing/seo/veille/YYYY-MM-DD/
```

`YYYY-MM-DD` est la date du relevé, en heure de Paris (celle du jour où les données sont lues, pas
celle d'une éventuelle rédaction différée).

## Les cinq fichiers obligatoires

Chaque archive `docs/marketing/seo/veille/YYYY-MM-DD/` contient exactement ces cinq fichiers :

| Fichier | Rôle |
|---|---|
| `donnees-brutes.md` | Consigne les valeurs lues telles quelles, requête par requête, sans interprétation. |
| `synthese.md` | Résume en quelques lignes ce que montrent les données brutes de la semaine. |
| `changements.md` | Liste les évolutions par rapport à la semaine N-1, chacune avec son niveau de preuve. |
| `sources.md` | Référence chaque source utilisée : URL, date de consultation, fraîcheur. |
| `recommandations.md` | Propose les actions à envisager, séparées du constat qui les motive. |

## Niveaux de preuve

Chaque fait rapporté dans `donnees-brutes.md`, `synthese.md` et `changements.md` porte l'un de ces
quatre niveaux :

- **MESURÉ** — lu directement dans un outil de mesure (Search Console, analytics…), à l'instant du
  relevé.
- **OBSERVÉ** — constaté par une vérification manuelle (lecture d'une page, d'un résultat de
  recherche…), datée.
- **INFÉRÉ** — déduit de plusieurs faits MESURÉS ou OBSERVÉS, sans mesure directe.
- **À CONFIRMER** — avancé sans vérification suffisante ; à revérifier avant d'agir dessus.

## Règles

- Chaque fait porte son niveau de preuve (MESURÉ, OBSERVÉ, INFÉRÉ ou À CONFIRMER).
- Chaque source listée dans `sources.md` porte une URL, une date de consultation et sa fraîcheur
  (date de la donnée qu'elle rapporte, si elle diffère de la date de consultation).
- Une valeur qu'on n'a pas pu obtenir s'écrit littéralement « indisponible » — jamais 0, un tiret ou
  une case vide, qui se confondraient avec une vraie mesure.
- Aucune donnée personnelle, aucun cookie, jeton ou export de compte ne figure dans une archive : le
  dépôt est public.

## Comparaison semaine N / semaine N-1

`changements.md` compare toujours la semaine courante à la semaine précédente, jamais à une autre
période :

- les **mêmes requêtes figées** d'une semaine à l'autre (le panel ne change pas en cours de
  comparaison ; le faire évoluer est un sujet séparé, voir `V5.5`) ;
- les **mêmes colonnes** dans `donnees-brutes.md` des deux semaines, dans le même ordre ;
- les **mêmes unités** (clics, impressions, position moyenne…), sans conversion ni arrondi différent
  d'une semaine à l'autre.

Une valeur « indisponible » une semaine ne bloque pas la comparaison : elle rend seulement
l'évolution correspondante « indisponible » plutôt que de l'inventer.
