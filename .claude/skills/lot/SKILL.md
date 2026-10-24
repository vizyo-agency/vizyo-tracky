---
name: lot
description: Préparer, développer ou clôturer un lot TRACKY avec `/lot ID [P1 | cloture]`, depuis Claude Code ou Vizyo Conductor. Vérifie le mode d'exécution, les dépendances, la date, le worktree et la branche avant un prompt ciblé. À utiliser pour toute tâche TRACKY qui modifie le dépôt ou produit une preuve de chantier.
---

# Travailler un lot TRACKY

Arguments : `$ARGUMENTS`. Sans identifiant, demander lequel.

## Avant toute action

1. Lire `CLAUDE.md`, puis `docs/pilotage/GUIDE.md`.
2. Si le brief mentionne Vizyo Conductor ou Agent Lot, lire `docs/pilotage/CONDUCTOR.md`, puis
   exécuter `git fetch origin` et `node scripts/lot.mjs $ARGUMENTS --conductor`.
   Sinon, exécuter `git fetch origin`, puis `node scripts/lot.mjs $ARGUMENTS`.
3. Si la sortie dit `PAS PRÊT`, `TROP TÔT` ou que la branche courante ne correspond pas, s'arrêter.
   Dire la dépendance, la date ou le worktree attendu. Ne pas contourner le verrou.
4. Utiliser un worktree par branche. Ne jamais coder dans le dossier partagé ni sur `main`.
   Dans un worktree isolé fourni par Conductor, reprendre la branche distante indiquée ou la créer
   depuis `origin/main`, puis relancer le script. Ne pas créer un worktree imbriqué.

## `/lot <ID> P<n>`

Le script affiche fichiers, sources, gestes, test, critère, hors périmètre et message de commit.
Faire seulement ce prompt :

- lire les sources citées et les fichiers concernés ;
- réaliser les gestes indiqués ;
- lancer le test ciblé et le lint des fichiers touchés si applicable ;
- committer avec le message exact affiché ;
- hors Conductor, pousser seulement si le mandat courant l'autorise ; dans Conductor, ne jamais
  pousser : rendre le commit et laisser la plateforme proposer l'action à la validation humaine ;
- rendre compte : changement, test, prompt suivant ; puis s'arrêter.

Pas de suite complète, relecture globale, PR ou déploiement pendant un prompt. Une tâche de mesure
peut utiliser le navigateur si son prompt le demande ; elle reste en lecture seule sauf autorisation explicite.
Agent Lot ne dispose pas du navigateur ni de Search Console : un lot `manual-observation` est refusé
en mode Conductor, même s'il est autrement prêt.

S'arrêter si un fait métier manque, si le prompt déborde nettement de 30 minutes ou si un prompt
antérieur de la même branche n'a pas de commit. Formuler la décision manquante avec options et recommandation.

## `/lot <ID>` sans découpage

Lire le lot dans `docs/pilotage/plan.json`. S'il dépasse quatre heures ou porte plusieurs critères
indépendants, écrire d'abord `docs/pilotage/decoupe/<ID>.md` selon son README. Sinon, réaliser un
critère à la fois, un commit chacun, puis clôturer.

## `/lot <ID> cloture`

Une fois par branche, après tous ses prompts :

1. lancer `pnpm verify` et les contrôles du périmètre ; pour le site, `pnpm verif:lp-links` ;
2. lancer en lecture seule `.claude/agents/relecteur-securite.md` et
   `.claude/agents/relecteur-conformite.md` sur `origin/main...HEAD` ;
3. revérifier chaque constat, corriger les bloquants et majeurs, conserver les mineurs dans la PR ;
4. pousser puis demander l'autorisation avant d'ouvrir une PR, sauf mandat explicite déjà donné ;
5. attendre tous les jobs de CI ; ne jamais fusionner sa propre PR ni déployer sans autorisation ;
6. mettre à jour le plan et Asana avec les preuves vérifiables.

Le formulaire Agent Lot accepte seulement `P1` à `P999`, pas `cloture`. Après le dernier prompt et
son push approuvé, exécuter la clôture dans une session dédiée sur la branche. Ne pas transformer
silencieusement le dernier prompt en clôture complète.

Le déploiement suit toujours les règles de `CLAUDE.md`, même si le lot est clôturé.
