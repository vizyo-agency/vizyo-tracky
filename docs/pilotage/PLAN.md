# TRACKY — plan de travail

Source machine : [`plan.json`](./plan.json). Mode d'emploi : [`GUIDE.md`](./GUIDE.md).

## Prochaine séquence SEO

| Ordre | Lot | État | Commande | Résultat attendu |
|---:|---|---|---|---|
| 1 | **S2.1** Relevé Google J+4 | **fait le 26/10** — classement A : aucune des 5 pages prioritaires recrawlée après le déploiement, sitemap relu le 24/10 | — | comparaison honnête avec la baseline du 22/10, sans action Google |
| 2 | **S2.2** Corrections courtes du site | prêt (S2.1 clos) | `/lot S2.2 P1` | tarif périmé retiré, FAQ visible = JSON-LD, bons liens de footer, nouvelle baseline |
| 3 | **S2.11** Snippets, PDF et performance | partiel | `/lot S2.11` après redécoupage | finir ce que le sprint du 22/10 n'a pas traité |
| 4 | **S2.12** Douze villes restantes | décision après mesure | `/lot S2.12` après arbitrage | enrichir, regrouper ou noindexer — jamais douze textes artificiels |
| 5 | **S2.13** E-E-A-T | backlog | `/lot S2.13` | preuves publiques réelles, aucune preuve fabriquée |
| 6 | **V5.2** Format d'archive hebdomadaire | **fait le 26/10** — premier lot confié à Agent Lot (3 prompts, PR n° 142) | — | format et modèle vides dans `docs/marketing/seo/veille/`, aucune donnée réelle |

## Catalogue des lots

### B0 — baseline et mesure

`B0.1` actifs GBP · `B0.2` conversions · `B0.3` Keyword Planner · `B0.4` CPL maximal ·
`B0.5` cohérence des comptages · `B0.6` lint ESLint API.

### A1 — Google Ads

`A1.1` médias · `A1.2` architecture Search · `A1.3` pilote Toulouse · `A1.4` benchmark annonces ·
`A1.5` optimisation par leads qualifiés · `A1.6` mots-clés négatifs.

### S2 — SEO et site

`S2.1` relevé J+4 (fait) · `S2.2` corrections courtes · `S2.3` pack visuel · `S2.4` vidéos ·
`S2.5` plan de contenus · `S2.6` pages métier · `S2.7` audit d’un concurrent local · `S2.8` landing Toulouse
(fait) · `S2.9` maillage et entités (fait) · `S2.10` hub Occitanie (fait) · `S2.11` snippets/PDF/perf
(partiel) · `S2.12` pages locales (Toulouse faite, 12 restantes) · `S2.13` E-E-A-T.

### L3 — présence locale

`L3.1` citations locales · `L3.2` stratégie d'avis.

### G4 — référencement IA / GEO

`G4.1` part de voix · `G4.2` entité sur le web · `G4.3` contenus citables · `G4.4` audit initial
(fait) · `G4.5` protocole de preuves · `G4.6` page canonique · `G4.7` rejeu 5×4 après indexation ·
`G4.8` entité/schema/preuves · `G4.9` page PME 5–20 véhicules · `G4.10` page Toulouse (faite) ·
`G4.11` graphe LocalBusiness/Service (fait).

### V5 — veille

`V5.1` revue mensuelle · `V5.2` archive hebdomadaire (fait, pilote Agent Lot) · `V5.3` archivage local ·
`V5.4` routine du lundi · `V5.5` panel SERP.

### C8 — intégration Vizyo Conductor

`C8.1` transférer Tracky vers `vizyo-agency`, protéger `main` et autoriser l'App · `C8.2` publier puis fusionner le pilotage
`/lot` (PR n° 139) · `C8.3` embaucher et vérifier Agent Lot sans lancer de prompt · `C8.4`
ajouter la passerelle Action humaine · `C8.5` cartographier les secrets sans leurs valeurs. Ces lots
restent séparés : accès GitHub, livraison, configuration, interaction humaine et secrets ne partagent
pas la même autorisation.

État constaté le 26/10/2026 : le dépôt est transféré à `vizyo-agency/vizyo-tracky` et `main` est protégée
(une approbation requise, aucun contrôle requis). L'accès de l'App GitHub à ce dépôt et l'état du workspace
sont **à vérifier sur l'instance Conductor**. Voir [`CONDUCTOR.md`](CONDUCTOR.md).

### P6 — produit TRACKY

`P6.1` refonte admin · `P6.2` étude dashcam/particulier/éthanol · `P6.3` agenda CDEF + tutoriel ·
`P6.4` lancement Ads et influence locale. Ces quatre cartes doivent être qualifiées avant découpage :
aucune ne part en code sous son intitulé actuel. `P6.5` conserve la trace d’une démo historique,
déjà clôturée ; elle ne doit pas revenir dans le flux actif.

### H7 — historique clôturé

`H7.1` à `H7.20` reprennent les anciennes cartes SEO, déploiement, local et audit IA déjà closes
dans Asana. Elles restent visibles pour la traçabilité, mais le lanceur `/lot` interdit leur relance.

## Règle de préparation

Tous les lots existent dans le plan, mais seuls les lots proches du démarrage sont découpés. C'est
la même règle que les autres projets de l’organisation : ne pas fabriquer cinquante prompts qui vieilliront avant leur exécution.
