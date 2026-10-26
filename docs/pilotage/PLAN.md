# TRACKY — plan de travail

Source machine : [`plan.json`](./plan.json). Mode d'emploi : [`GUIDE.md`](./GUIDE.md).

## Prochaine séquence SEO

| Ordre | Lot | État | Commande | Résultat attendu |
|---:|---|---|---|---|
| 1 | **S2.1** Relevé Google J+4 | **fait le 26/10** — classement A : aucune des 5 pages prioritaires recrawlée après le déploiement, sitemap relu le 24/10 | — | comparaison honnête avec la baseline du 22/10, sans action Google |
| 2 | **S2.2** Corrections courtes du site | **fait le 26/10** — déployé (PR n° 148, marketing-seul) | — | tarif périmé retiré, FAQ visible = JSON-LD, bons liens de footer ; baseline datée dans `docs/marketing/seo/corrections-2026-10/controle-s2.2.md` |
| 3 | **S2.11** Performance mobile et PDF DPA | **partiel** — P1 à P3 faits et déployés le 26/10 ; LCP < 2,5 s non atteint (voir `controle-s2.11.md`) | investigation par trace de performance, puis prompts P4+ | image du héros responsive, police de repli ajustée, cartes de prix sans saut |
| 4 | **V5.5** Panel hebdomadaire de SERP | **fait le 26/10** — PR n° 152 | — | huit requêtes figées, trois surfaces, règle de version |
| 5 | **G4.5** Protocole et preuves IA | **fait le 26/10** — PR n° 153 | — | protocole d'un passage 5×4 et gabarits vides |
| 6 | **A1.6** Mots-clés négatifs | **fait le 26/10** — PR n° 154 | — | liste de départ à compléter avec les termes réels du pilote |
| 7 | **S2.12** Douze villes restantes | décision après mesure (J+4 du déploiement, 30/10) | `/lot S2.12` après arbitrage | enrichir, regrouper ou noindexer — jamais douze textes artificiels |
| 8 | **S2.13** E-E-A-T | backlog | `/lot S2.13` | preuves publiques réelles, aucune preuve fabriquée |
| 9 | **V5.2** Format d'archive hebdomadaire | **fait le 26/10** — premier lot d'Agent Lot | — | format, modèle vide et README dans `docs/marketing/seo/veille/` |

## À faire par une personne

Ces lots ne peuvent pas être confiés à Agent Lot : un compte, un poste, une décision ou une preuve réelle est nécessaire. Ils sont marqués
`execution.mode = manual-human` dans [`plan.json`](./plan.json), leur carte Asana porte **« À TOI »** dans son titre (cherche ces deux mots
dans Asana), et le lot S2.14 a une date d'échéance. Dès qu'un lot de cette liste est fait, dis-le : le plan, Asana et ce tableau sont mis à jour.

| Lot | Ce qu'il faut faire | Quand |
|---|---|---|
| **A1.1** Produire les assets visuels de campagne | Visuels de campagne à produire ou commander. | Avant le pilote Ads |
| **A1.3** Lancer un pilote Google Ads Toulouse | Lancement du pilote Google Ads : compte, budget et paiement. | Quand B0.2, A1.1, A1.2 et A1.6 sont prêts |
| **A1.4** Benchmark des annonces concurrentes | Benchmark des annonces concurrentes : lecture manuelle des annonces en ligne. | À tout moment |
| **A1.5** Optimiser selon les leads qualifiés | Optimisation selon les contacts qualifiés : données du compte Ads. | Après le pilote |
| **B0.1** Produire les actifs visuels authentiques GBP | Photos et vidéos authentiques de l'établissement : à produire sur place. | Dès que possible |
| **B0.2** Configurer la mesure des conversions | Configuration de la mesure des conversions dans les comptes Google (Analytics, Ads). | Avant le pilote Ads |
| **B0.3** Débloquer les volumes exacts Keyword Planner | Volumes exacts de Keyword Planner : compte Google Ads requis. | Avant l'architecture Search |
| **B0.4** Définir le CPL maximal acceptable | Décision : coût maximal acceptable par contact. | Avant le pilote Ads |
| **G4.1** Mesurer la part de voix IA dans le temps | Rejouer la grille de visibilité IA sur les assistants : relevé manuel. | Après G4.7 |
| **G4.2** Renforcer l'entité Vizyo Tracky sur le web | Renforcer l'entité sur le web : profils et mentions à créer. | À planifier |
| **G4.7** Rejouer le panel 5×4 après indexation | Rejouer le panel 5×4 sur les assistants après indexation : relevé manuel. | Après recrawl (voir S2.14) |
| **G4.8** Structurer entité, schema.org et preuves tierces | Preuves tierces et entité : sources extérieures à obtenir. | Après S2.13 |
| **L3.1** Renforcer les citations locales | Citations locales : inscriptions dans des annuaires, comptes à créer. | À planifier |
| **L3.2** Mettre en place une stratégie d'avis clients | Stratégie d'avis clients : demande réelle aux clients. | À planifier |
| **P6.1** Qualifier puis refondre l'espace admin | Décision : qualifier puis refondre l'espace admin. | À arbitrer |
| **P6.2** Étudier dashcams, offre particuliers et éthanol | Décision : étude dashcams, offre particuliers, éthanol. | À arbitrer |
| **P6.3** Recetter l'agenda CDEF puis produire le tutoriel | Décision : recette de l'agenda CDEF puis tutoriel. | À arbitrer |
| **P6.4** Préparer le lancement Ads et influence locale | Lancement Ads et influence locale : comptes et partenaires. | Après le pilote Ads |
| **S2.3** Produire le pack visuel SEO, local et GEO | Pack visuel à produire. | À planifier |
| **S2.4** Produire les formats vidéo courts | Vidéos courtes à tourner et monter. | À planifier |
| **S2.7** Auditer un concurrent local à Toulouse | Audit d'un concurrent local : recherche web manuelle avec outils SEO. | À tout moment |
| **S2.12** Traiter les douze pages villes restantes | Décision après lecture du relevé S2.14 : enrichir, regrouper ou noindexer les douze pages villes. | Après S2.14 |
| **S2.13** Renforcer E-E-A-T et les preuves publiques | Preuves publiques réelles (avis, références, certifications) : à fournir par toi, aucune preuve fabriquée. | À planifier |
| **S2.14** Relever Search Console à J+4 du déploiement du 26/10 | Search Console ne se lit que dans ton Chrome connecté. | À partir du 30/10 |
| **V5.1** Faire une revue mensuelle des tendances | Revue mensuelle des tendances : lecture et décision humaines. | Après le premier mois de veille |
| **V5.3** Configurer l'archivage local | Vérifier l'écriture dans docs/marketing depuis Work Desktop : poste à toi. | À tout moment |
| **V5.4** Mettre en place la routine du lundi | Mettre en place la routine du lundi dans Work Desktop : planification à créer. | Après V5.3 |

Règle : un lot qui passe d'humain à confiable (compte ouvert, décision prise, preuve fournie) est découpé en prompts, puis confié à Agent Lot ; son mode redevient `conductor-agent-lot`.

## Catalogue des lots

### B0 — baseline et mesure

`B0.1` actifs GBP · `B0.2` conversions · `B0.3` Keyword Planner · `B0.4` CPL maximal ·
`B0.5` cohérence des comptages · `B0.6` lint ESLint API.

### A1 — Google Ads

`A1.1` médias · `A1.2` architecture Search · `A1.3` pilote Toulouse · `A1.4` benchmark annonces ·
`A1.5` optimisation par leads qualifiés · `A1.6` mots-clés négatifs.

### S2 — SEO et site

`S2.1` relevé J+4 (fait) · `S2.2` corrections courtes (fait) · `S2.3` pack visuel · `S2.4` vidéos ·
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

État constaté le 26/10/2026 (soir) : le dépôt est transféré à `vizyo-agency/vizyo-tracky`, `main` est protégée
(une approbation requise, aucun contrôle requis), le pilotage `/lot` est fusionné (PR n° 139 à 141), Agent Lot est
embauché et configuré en profil pilote sur l'instance dev, et V5.2 a été exécuté de bout en bout (PR n° 142).
C8.5 (inventaire des secrets, sans valeurs) est fait : aucun secret propre au projet. Voir [`CONDUCTOR.md`](CONDUCTOR.md).

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
