# TRACKY — guide du chantier

> Page d'entrée du travail humain et de Claude Code. Le dépôt décide ; Asana reflète.

## 1. Les quatre niveaux

1. `plan.json` porte les identifiants stables, l'état, les dépendances et les critères.
2. `PLAN.md` rend ce plan lisible et dit ce qui vient ensuite.
3. `decoupe/<ID>.md` transforme un lot actif en prompts de 15 à 30 minutes.
4. Asana reprend le même identifiant, la commande `/lot`, les critères et les dépendances.

Vizyo Conductor est un exécuteur optionnel, pas une nouvelle source de vérité. Lire
[`CONDUCTOR.md`](CONDUCTOR.md) avant d'y embaucher ou lancer Agent Lot.

Une information n'est pas corrigée seulement dans Asana. Elle est corrigée ici, puis reportée.

## 2. Lire une carte

Une carte exécutable porte toujours :

- `RESPONSABLE`, `RELECTEUR`, `PISTE`, `CHARGE` ;
- `▶ DÉMARRER /lot <ID> ...` ;
- `DÉPEND DE` ;
- ce qui est livré et pourquoi ;
- des critères `FAIT QUAND` vérifiables ;
- les sources à lire et ce qui est hors périmètre.

Les statuts du dépôt sont : `done`, `partial`, `ready`, `waiting`, `decision`, `backlog`.
`ready` signifie que le lot est prêt hors dépendances : une dépendance ouverte le bloque dans tous les
cas, quel que soit son statut, et `/lot` s'arrête (un lot `ready` peut donc dépendre d'un lot encore
ouvert ; il part quand celui-ci est `done`). `waiting` signifie qu'il faut attendre une date ou un
signal extérieur. `decision` exige une réponse de Youness avant tout code.

## 3. La commande `/lot`

```text
/lot S2.1 P1
/lot S2.1 P2
/lot S2.1 cloture
```

`node scripts/lot.mjs S2.1` affiche le brief. `P1` affiche exactement les fichiers, les sources,
les gestes, le test, le critère et le message de commit. `cloture` refuse de se déclarer prête si un
prompt de la branche n'a pas de commit.

Dans Conductor, un prompt découpé est compatible par défaut avec Agent Lot. Si une étape dépend d'un
navigateur connecté, d'un secret non disponible, d'une décision, d'une communication ou d'un
déploiement, le lanceur retourne `ACTION HUMAINE REQUISE` avec une preuve attendue et un prompt de
reprise. Cette action vit dans Notes/Tâches ; elle ne doit pas être maquillée en validation Git.

Un prompt :

1. lit seulement les sources citées ;
2. réalise seulement les gestes demandés ;
3. lance le test ciblé et le lint des fichiers touchés quand il s'agit de code ;
4. committe avec le message exact affiché, puis pousse ;
5. rend compte en trois lignes et s'arrête.

La clôture, une fois par branche :

1. lance `pnpm verify` et les contrôles propres au périmètre (`pnpm verif:lp-links` pour le site) ;
2. lance une relecture sécurité et une relecture conformité en lecture seule ;
3. revérifie chaque constat, corrige les bloquants et majeurs ;
4. ouvre la PR vers `main`, attend sa CI et ne fusionne jamais sa propre PR ;
5. met à jour le plan et la carte Asana avec des preuves, pas avec « fait ».

## 4. Git et worktrees

- Une branche par PR : `lot/<ID>-<slug>`.
- Un worktree par branche. Une session ne code jamais dans le worktree d'une autre branche.
- Une branche poussée se met à jour par fusion de `origin/main`, jamais par rebase.
- Au-delà d'environ 500 lignes de code hors tests, séparer les PR ou justifier l'écart.
- Le déploiement de production reste régi par `CLAUDE.md` et `deploy.sh`.

## 5. Le cycle SEO en cours

Le déploiement SEO de référence a eu lieu le 22/10/2026 à 08:41 Paris (`1b08f753`). La baseline est
dans `seo/BASELINE-2026-10-22.md`. Comme le quatrième jour tombe le 26/10, aucun nouveau déploiement
marketing ne doit brouiller la mesure avant le relevé `S2.1`.

Ordre actuel :

1. `S2.1` — relevé Google J+4, en lecture seule ;
2. `S2.2` — petites corrections datées (tarif, FAQ Tarifs, footer), puis nouvelle baseline ;
3. `S2.11` — finir snippets/PDF/performance ;
4. `S2.12` — décision puis traitement des douze pages villes restantes ;
5. `S2.13` — preuves publiques E-E-A-T, uniquement avec des preuves réelles.

## 6. Ce qu'un report de fin de lot dit

1. fichiers touchés ;
2. critères vérifiés un par un ;
3. tests et sorties ;
4. ce qui a été refusé et pourquoi ;
5. incohérences ou décisions encore ouvertes ;
6. prochain lot autorisé.
