---
name: lot
description: Préparer, développer ou clôturer un lot TRACKY avec `/lot ID [P1 | cloture]`, depuis Claude Code ou Vizyo Conductor. Vérifie le mode d'exécution, les dépendances, la date, le worktree et la branche avant un prompt ciblé. À utiliser pour toute tâche TRACKY qui modifie le dépôt ou produit une preuve de chantier.
---

# Travailler un lot TRACKY

Arguments : `$ARGUMENTS`. Sans identifiant, demander lequel.

## Avant toute action

1. Lire `CLAUDE.md`, puis `docs/pilotage/GUIDE.md`.
2. Si le brief mentionne Vizyo Conductor ou Agent Lot, **ou si la branche courante commence par
   `conductor/`**, lire `docs/pilotage/CONDUCTOR.md`, puis exécuter `git fetch origin` et
   `node scripts/lot.mjs $ARGUMENTS --conductor`. Sinon, exécuter `git fetch origin`, puis
   `node scripts/lot.mjs $ARGUMENTS`.
3. **Tout code de sortie non nul arrête le travail**, sauf 4. Code 2 : erreur d'usage ou de plan ; code 3 :
   non prêt (`PAS PRÊT`, `TROP TÔT`, `TERMINÉ`, `PARTIEL`, `BACKLOG`, `DÉCISION REQUISE`,
   `EN ATTENTE`, `MAUVAISE BRANCHE`, `DÉJÀ FAIT`, `ORDRE DES PROMPTS`, `NON COMPATIBLE CONDUCTOR`).
   Dire la dépendance, la date, la branche ou le prompt manquant. Code 4 (`ACTION HUMAINE REQUISE`) :
   suivre le contrat ci-dessous ; ce n'est ni un échec ni une validation de code. En mode `--conductor`,
   la dernière ligne de stdout est `CONDUCTOR_RESULT <json>` : c'est elle que Conductor lit.
4. Utiliser un worktree par branche. Ne jamais coder dans le dossier partagé ni sur `main`.
   Dans Conductor, **une seule branche par lot** : `conductor/agent-lot/<ID>` (le lot demandé, exactement),
   la même de P1 à Pn ; en dépôt manuel, `lot/<ID>-<slug>`. Tout autre `conductor/*` est refusé (`MAUVAISE
   BRANCHE`). Dans un worktree isolé fourni par Conductor, reprendre la branche distante indiquée ou la
   créer depuis `origin/main`, puis relancer le script. Ne pas créer un worktree imbriqué.

## `/lot <ID> P<n>`

Le script affiche fichiers, sources, gestes, test, critère, hors périmètre et message de commit.
Faire seulement ce prompt :

- lire les sources citées et les fichiers concernés ;
- réaliser les gestes indiqués ;
- lancer le test ciblé et le lint des fichiers touchés si applicable ;
- committer avec le message exact affiché, en ajoutant les fichiers du prompt par chemins explicites
  (`git add <chemins>`, jamais `-A` ni `.`) : le dépôt est partagé ;
- hors Conductor, pousser seulement si le mandat courant l'autorise ; dans Conductor, ne jamais
  pousser : rendre le commit et laisser la plateforme proposer l'action à la validation humaine ;
- rendre compte : changement, test, prompt suivant ; puis s'arrêter.

Pas de suite complète, relecture globale, PR ou déploiement pendant un prompt. Une tâche de mesure
peut utiliser le navigateur si son prompt le demande ; elle reste en lecture seule sauf autorisation explicite.

Tout prompt présent dans un découpage est candidat à Agent Lot : il n'a pas besoin d'une liste blanche
propre au lot. Les verrous restent le statut, la date, les dépendances, la branche, les prompts déjà
committés et les actions humaines déclarées. Un prompt absent du découpage reste refusé.

## Action humaine requise

Quand une étape exige un navigateur authentifié, un secret manquant, une décision, une communication
externe ou un geste de déploiement, ne pas déclarer tout le lot incompatible et ne pas simuler l'action.
La sortie `/lot` décrit une action avec un identifiant stable, un responsable, une URL éventuelle, une
preuve attendue, des interdits et le prompt de reprise.

Dans Conductor :

- demander une tâche humaine durable dans Notes/Tâches, distincte de la file des validations Git ;
- mettre le run en attente d'action sans commit vide et sans le classer en échec ;
- ne jamais demander qu'un cookie, jeton, mot de passe ou valeur de secret soit copié dans GitHub ;
- après la preuve attendue, relancer le prompt indiqué ; `/lot` vérifiera le fichier avant de l'autoriser.
  La preuve doit se trouver sur la branche de l'exécution (`conductor/agent-lot/<ID>`) ; comment elle y
  arrive est décrit, avec ses points non démontrés, dans `CONDUCTOR.md` (§ La preuve).

Si la version courante de Conductor ne sait pas encore créer cette tâche automatiquement, rendre le bloc
`ACTION HUMAINE REQUISE` tel quel et s'arrêter. Ne pas contourner avec une fausse validation.

S'arrêter si un fait métier manque ou si le prompt déborde nettement de 30 minutes. L'ordre des prompts
est imposé par le script (un prompt antérieur sans commit donne `ORDRE DES PROMPTS`, un prompt déjà
committé `DÉJÀ FAIT`). Formuler la décision manquante avec options et recommandation.

## `/lot <ID>` sans découpage

Lire le lot dans `docs/pilotage/plan.json`. S'il dépasse quatre heures ou porte plusieurs critères
indépendants, écrire d'abord `docs/pilotage/decoupe/<ID>.md` selon son README. Sinon, réaliser un
critère à la fois, un commit chacun, puis clôturer.

## `/lot <ID> cloture`

Une fois par branche, après tous ses prompts :

1. lancer `pnpm verify` et les contrôles du périmètre ; pour le site, `pnpm verif:lp-links` ;
2. lancer en lecture seule les agents `relecteur-securite` et `relecteur-conformite`
   (`.claude/agents/`), en leur fournissant le diff `git diff origin/main...HEAD` (ils n'ont pas de shell) ;
3. revérifier chaque constat, corriger les bloquants et majeurs, conserver les mineurs dans la PR ;
4. pousser seulement si le mandat de la session l'autorise, puis demander l'autorisation avant
   d'ouvrir une PR, sauf mandat explicite déjà donné ;
5. attendre les contrôles de la PR (la CI du pilotage, si elle existe) ; ne jamais fusionner sa propre
   PR ni déployer sans autorisation ;
6. mettre à jour le plan et Asana avec les preuves vérifiables.

Le formulaire Agent Lot accepte seulement `P1` à `P999`, pas `cloture`. Après le dernier prompt et
son push approuvé, exécuter la clôture dans une session dédiée sur la branche du lot (`lot/<ID>-<slug>`
ou `conductor/agent-lot/<ID>`), hors Conductor. Elle reste
possible même si le dernier prompt a passé le lot à `done` dans le plan, tant que les commits de la
branche le prouvent. Ne pas transformer silencieusement le dernier prompt en clôture complète.

Le déploiement suit toujours les règles de `CLAUDE.md`, même si le lot est clôturé.
