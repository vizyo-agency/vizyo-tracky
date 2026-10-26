# Prompt — corriger l'incident veilleur du 06/10 et refondre l'espace veilleur

> À coller tel quel dans un **nouveau chat** ouvert sur le dépôt Tracky.
> Le dossier mesuré : [`00-INCIDENT-2026-10-06-ET-REFONTE.md`](./00-INCIDENT-2026-10-06-ET-REFONTE.md).

```text
Dépôt Tracky : D:\www\vizyo-agency\vizyo-tracky\vizyo-tracky (monorepo pnpm : apps/api NestJS +
Prisma + Jest, apps/web Angular 20 standalone + signals, packages/shared). Avant le moindre geste,
lis EN ENTIER le CLAUDE.md du dépôt et le dossier
docs/espace-veilleur-2026-10/00-INCIDENT-2026-10-06-ET-REFONTE.md. Ce dossier a été écrit le 06/10
au soir, à partir de mesures faites en production en lecture seule.

Le contexte en deux phrases : le 06/10 à 22:05, la coupure horaire de HM-733-GA (cdef31) a été
exécutée par le boîtier mais jamais accusée. L'écran du veilleur a alors affiché « Moteur actif »
avec « Rallumer » grisé ; le veilleur a cliqué 4 fois « couper » (201 à chaque fois, sans effet,
et un gel du planning posé à chaque clic), puis il a appelé le WhatsApp d'urgence, et il a fallu
rallumer par SMS manuel.

Je veux que ça ne puisse plus jamais se reproduire, et que l'espace veilleur devienne le plus
rapide et le plus fiable possible : le veilleur l'utilise toutes les nuits.

Mission, en deux lots :
A. Corriger l'incident : P0-1 à P0-6 du dossier (§ 3), puis P1-1 à P1-3. P0-6 compte autant que
   P0-1 : pendant l'urgence, l'écran du veilleur était saturé de « Action impossible » (166
   réponses 403 en 8 minutes).
B. Refondre complètement l'espace veilleur (§ 4 et annexe A) : tous les filtres qui marchent, les
   vues par groupe, l'onglet Assistance, aucun défaut d'affichage, et les états bien visibles
   (maintenance, garage, immobilisé, débranché, boîtier muet, coupure non confirmée…).

Méthode :
1. État réel d'abord. git fetch, branche courante, lecture du code de origin/main. Vérifie que
   chaque cause C1 à C8 du dossier, et chaque défaut de l'annexe A, est toujours vrai dans le
   code actuel, et dis-moi ce qui a changé. Vérifie aussi si le gel du planning de HM-733-GA
   (§ 0) a été levé, en lecture seule.
2. Un agent = un worktree :
   git worktree add ../wt-veilleur -b fix/veilleur-coupure-non-confirmee origin/main
3. Lot A, les tests d'abord. Écris des tests qui rejouent les séquences réelles :
   - CUT SENT puis SENT_UNCONFIRMED, sans RESTORE accusé ;
   - 4 POST de coupe sur une coupure en vol ;
   - un SMS entrant « Resume engine Succeed » venant de la SIM du boîtier, et le même venant d'un
     autre numéro ;
   - un push d'urgence (sévérité, destinataires).
   Vois-les échouer, corrige, puis lance pnpm verify, ng build et les 8 verif:* (depuis la
   racine du dépôt).
4. Présente le diff, les tests et les risques, puis attends mon GO pour le merge, puis mon GO pour
   le déploiement (deploy.sh --attendre ; jamais entre 05:30 et 09:00, ni entre HH:42 et HH:46).
   Après le déploiement : vérifie l'artefact compilé dans les conteneurs, puis fais avec moi la
   recette du § 5 sur « Client test ».
5. Lot B : propose d'abord le plan de l'écran veilleur (états, filtres, groupes, assistance,
   téléphone et ordinateur) et attends mon accord. Implémente ensuite par étapes, avec des tests
   et des captures à 375 px et sur ordinateur, en thème clair et en thème sombre.
6. Tiens à jour le dossier (ajoute une section « Suivi » : quoi, hash, heure de Paris) et la
   mémoire (tracky_incident_veilleur_coupure_non_confirmee.md).

Coordination : le commit b0f9e066 (élément E3 de docs/menage-depot-2026-10/00-ELEMENTS-GARDES.md)
modifie aussi engine-control-button.component.ts et urgence-vehicule.component.ts. Regarde s'il
est déjà dans main avant de commencer ; sinon, prévois le rebase.

Interdits :
- toute écriture en production hors de « Client test » (cdef31 en lecture seule) ;
- tout courriel à CDEF31 (phase de test) ;
- git add -A ou git add . ; git stash ;
- docker compose up à la main ; une commande docker sur le VPS sans timeout 20 ;
- saisir un mot de passe ou créer un compte (c'est moi qui crée le compte veilleur de test et qui
  m'y connecte) ;
- « Réactiver » un planning de nuit (la transition due partirait dans la minute).

Commence par l'étape 1, et rends-moi compte avant d'écrire du code.
```
