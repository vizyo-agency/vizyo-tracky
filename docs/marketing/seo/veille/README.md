# Veille SEO

Suivi hebdomadaire des indicateurs SEO, archivé un dossier daté à la fois.

> Format détaillé : [`FORMAT.md`](./FORMAT.md). Panel des requêtes figées : [`PANEL.md`](./PANEL.md).
> Ce dossier ne contient aucune archive réelle pour l'instant : voir `V5.3` et `V5.4` dans
> `docs/pilotage/plan.json`.

## Modèle

Chaque archive `YYYY-MM-DD/` reprend les cinq fichiers vides de [`_modele/`](./_modele/) :

- [`_modele/donnees-brutes.md`](./_modele/donnees-brutes.md)
- [`_modele/synthese.md`](./_modele/synthese.md)
- [`_modele/changements.md`](./_modele/changements.md)
- [`_modele/sources.md`](./_modele/sources.md)
- [`_modele/recommandations.md`](./_modele/recommandations.md)

## Liste de contrôle d'une archive terminée

- [ ] les cinq fichiers sont présents
- [ ] le dossier de l'archive est nommé `YYYY-MM-DD`
- [ ] chaque fait porte un niveau de preuve (MESURÉ, OBSERVÉ, INFÉRÉ ou À CONFIRMER)
- [ ] chaque source listée dans `sources.md` est datée (consultation, et fraîcheur si elle diffère)
- [ ] `recommandations.md` propose trois recommandations au plus
- [ ] aucune donnée personnelle, cookie, jeton ou export de compte ne figure dans l'archive
- [ ] `changements.md` compare à la semaine précédente avec les mêmes requêtes, colonnes et unités
- [ ] les requêtes relevées sont celles du panel en vigueur, version citée
