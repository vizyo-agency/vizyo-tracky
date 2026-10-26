# TRACKY dans Vizyo Conductor

> Conductor exécute le travail de dépôt et orchestre les interruptions. Une action humaine n'est ni
> un échec, ni une validation Git : elle a sa propre tâche, sa preuve attendue et son point de reprise.

Étiquettes : **OBSERVÉ** (constaté, avec sa date), **INFÉRÉ** (déduit), **À VÉRIFIER SUR L'INSTANCE**
(seule l'instance Conductor le sait ; ce dépôt ne peut ni le prouver ni l'affirmer).

## État au 26/10/2026

- Dépôt : `vizyo-agency/vizyo-tracky`, public, branche de base `main`. Le dépôt a été transféré depuis
  un compte personnel ; l'ancienne adresse redirige. OBSERVÉ le 26/10.
- `main` est protégée : une approbation est requise avant fusion, aucun contrôle automatique n'est exigé
  par la protection, et `enforce_admins` vaut `false` (les administrateurs ne sont pas soumis à la règle).
  OBSERVÉ le 26/10 par lecture de la protection. Ce dernier réglage est **à trancher par le propriétaire** ;
  ce dépôt n'affirme rien de plus. Le dépôt n'avait aucun workflow au 25/10 ; la CI minimale du pilotage
  est décrite dans `.github/workflows/pilotage.yml` (non exigée). OBSERVÉ le 26/10.
- Branche de pilotage : `chore/tracky-lot-pilotage` ; PR de pilotage : n° 139. Sa fusion est une décision
  humaine séparée (lot C8.2).
- Projet Conductor `tracky`, agent `agent-lot`, fuseau Europe/Paris, pile Angular · Node.js ·
  PostgreSQL · Docker.
- **À vérifier sur l'instance** : que l'App GitHub « Vizyo Conductor » est installée sur ce dépôt, l'état
  du workspace du projet (clone possible, protection de `main` lisible), l'équipe embauchée et ses
  plannings, la configuration réelle de l'emploi Agent Lot (grade, modèle, essai, parallélisme).
- Coffre Tracky : aucun secret propre au projet n'est documenté ici ; les secrets de plateforme restent
  hérités.

Le dépôt Tracky est public, mais Agent Lot a quand même besoin d'une installation GitHub App pour
les jetons d'installation, les écritures, les protections de branche et les webhooks. Un clone public
anonyme ne suffit pas au workflow.

Historique daté : le 25/10 le dépôt appartenait à un compte personnel alors que l'App privée ne
s'installe que sur l'organisation ; le transfert vers l'organisation a depuis été fait. Aucune
référence à l'ancien propriétaire n'est à réécrire : les liens d'anciennes PR sont redirigés.

## Prérequis avant le premier run

Conductor lit `scripts/lot.mjs`, `docs/pilotage/` et le skill `/lot` sur **`origin/main`** (INFÉRÉ de sa
phase de préparation) ; rien de ce qui n'y est pas fusionné n'existe pour lui. Dans l'ordre :

1. **La PR #139 doit être fusionnée, par squash**, pour ne pas publier l'historique de ses anciens
   commits (ils portent des noms qui ont été généralisés depuis ; le dépôt est public). Sa fusion est une
   décision humaine séparée (lot C8.2).
2. **Puis la branche de correctifs, en PR séparée** : le contrat `CONDUCTOR_RESULT`, la branche unique,
   l'historique `origin/main..HEAD` et le reste de ce document n'existent que sur elle. Après un squash de
   la #139, cette branche (bâtie sur les commits d'origine de la #139, dernier commit `3ee922da`) doit être
   refaite sur la nouvelle `origin/main` avant d'ouvrir sa PR (INFÉRÉ : sans cela, ses commits
   rejouent les changements déjà squashés) ; ce geste est celui du propriétaire, il n'est pas fait ici.
3. Les autres prérequis (App GitHub, workspace, emploi Agent Lot, essai à blanc de la preuve) sont listés
   ci-dessus et restent **à vérifier sur l'instance**.

Tant que 1 et 2 ne sont pas faits, la phase de préparation de Conductor ne trouve pas le contrat et
répond « illisible » : c'est un arrêt sûr, pas une panne.

## Configuration cible d'Agent Lot

- grade Senior ; Claude Sonnet 5 ; période d'essai de 10 exécutions ;
- seuil hérité de 70 % ; parallélisme 1 ;
- déclencheur manuel uniquement ; aucun planning et aucun webhook GitHub ;
- un worktree isolé par branche ; **une branche par lot** : `conductor/agent-lot/<ID>`, réutilisée de P1
  à Pn (un seul run à la fois pour un lot), ou, en dépôt manuel, `lot/<ID>-<slug>` ;
- Agent Lot committe mais ne pousse jamais et n'ouvre pas de PR ; Conductor propose le push dans
  Validations ; la PR, la fusion et le déploiement sont des gestes séparés, chacun avec sa décision ;
- Reviewer relit la PR ; Merger peut préparer une fusion séparée si cet agent est ensuite embauché ;
- aucun déploiement ne découle d'un push ou d'une fusion : il exige son propre geste autorisé.

Ces valeurs sont la cible ; leur état réel est **à vérifier sur l'instance**.

La limitation initiale à `S2.2 P1`–`P4` n'était pas liée au risque du dev. S2.2 était simplement le
seul lot prêt, découpé et décrit pour Agent Lot. Désormais, tout prompt existant dans un découpage
est candidat ; statut, date, dépendances, branche, ordre des prompts et actions humaines continuent
de bloquer.

## Contrat `lot.mjs --conductor` ↔ Conductor (v1.1)

Invocation, depuis la racine du **worktree de la branche du lot** pour exécuter un prompt. Lancé depuis un
worktree de base à HEAD détaché, `--conductor` répond **volontairement** `blocked` (« HEAD détaché »,
`branch.current = null`) : c'est la porte de branche, qui dit à Conductor qu'il doit fournir ou créer
`conductor/agent-lot/<ID>`. Ce worktree n'a ni la branche ni les preuves : on n'y exécute jamais un prompt.

```text
node scripts/lot.mjs <LOT_ID> <PROMPT_ID> --conductor     # PROMPT_ID = P1 … P999
```

**`--racine <chemin absolu>`** (contrat v1.2 § 1) : la racine du dépôt à lire (plan, découpages, preuves,
historique git, branche courante) au lieu du dossier parent du script. Conductor exécute ainsi une **copie de
confiance** de `scripts/lot.mjs` (extraite de `origin/main`, posée hors du worktree de l'agent) avec
`--racine <worktree de la branche du lot>` : le `scripts/lot.mjs` de la branche de l'agent n'est **jamais**
exécuté ni importé (ses données, `plan.json` et découpages, restent lues : S2.1 P3 et S2.2 P4 les modifient
légitimement). Le chemin doit être absolu et être **la racine** d'un dépôt ou worktree git
(`git rev-parse --show-toplevel` y mène) ; un lien symbolique, une jonction, un sous-dossier, un fichier, un
dossier hors dépôt ou un chemin relatif donnent `error` (2) avec la ligne finale en mode `--conductor`, sans
chemin local dans `reason`. L'option se donne au plus une fois, sa valeur est obligatoire (la forme
`--racine=<chemin>` n'existe pas) ; elle se combine avec `--check` (`--check --racine <chemin>`). Les variables
`GIT_DIR`, `GIT_WORK_TREE` et voisines héritées de l'environnement sont retirées des `git` lancés, pour qu'un
processus parent ne détourne pas la lecture vers un autre dépôt. Sans l'option, comportement inchangé.

`cloture` n'est jamais accepté en mode Conductor. La sortie reste lisible par un humain ; la **dernière
ligne de stdout**, toujours, est `CONDUCTOR_RESULT <json compact>` :

```json
{"version":1,"status":"ready","exit_code":0,"lot":"S2.1","prompt":"P1","reason":null,
 "branch":{"current":"conductor/agent-lot/S2.1","accepted":["conductor/agent-lot/S2.1","lot/S2.1-<slug>"]},
 "action":null,"commit_message":"[S2.1] P1 — Titre du prompt"}
```

| Code | `status` | Sens |
|---:|---|---|
| 0 | `ready` | Le prompt peut être exécuté. |
| 2 | `error` | Usage ou erreur interne : arguments, prompt inconnu, plan ou découpage illisible, date invalide, git indisponible. |
| 3 | `blocked` / `too_early` | Non prêt : statut, dépendance ouverte, prompt déjà fait, ordre des prompts, branche non conforme, lot non découpé, clôture demandée. `too_early` : la date minimale n'est pas atteinte. |
| 4 | `action_required` | Action humaine requise : ni échec, ni validation de code. |

`exit_code` du JSON = code de sortie du processus. Hors `--conductor`, la ligne n'est pas émise ; les codes
sont 0 prêt, 2 usage ou erreur interne, 3 non prêt. **Trois comportements sont nouveaux** par rapport au
lanceur d'avant le contrat, même hors Conductor : un prompt déjà committé est refusé (3, `DÉJÀ FAIT`, au
lieu d'un simple avertissement), l'ordre des prompts est imposé (3, `ORDRE DES PROMPTS`) et une panne de
git donne 2 (au lieu d'un historique vide).

Ordre des portes en mode Conductor : usage et plan → statut/date/dépendances → clôture refusée →
prompt connu et autorisé (`execution.prompts`) → **branche** → prompt déjà committé → ordre des prompts →
**action humaine** → `ready`. La branche passe avant la preuve : la preuve vit dans le worktree de la
branche du lot, la chercher ailleurs donnerait un faux « absent ».

- **Identifiant de lot (format unique, contrat v1.2 § 3)** : `^[A-Z]\d+\.\d+$` — une lettre majuscule, un
  ou plusieurs chiffres, un point, un ou plusieurs chiffres (`S2.1`, `S12.34`). Le même format vaut pour
  `lot.mjs`, les `id` de `plan.json` (`--check`), les noms de branche `conductor/agent-lot/<ID>` et le code de
  Conductor. Invalides : `S2`, `s2.1`, `S2.1.1`, `S2.1/../x`, `-S2.1`, espaces, lettres ou chiffres non ASCII.
  À la ligne de commande, un humain peut taper `s2.1` ou `p1` (mise en majuscules des seules lettres ASCII) ;
  la sortie, elle, ne porte jamais que la forme canonique. Un identifiant invalide dans `plan.json` ne sert
  jamais à fabriquer un chemin de fichier.
- **Branche (une par lot)** : en mode `--conductor`, la branche d'exécution est `conductor/agent-lot/<ID>`
  où `<ID>` est **exactement** le lot demandé (`conductor/agent-lot/S2.1` pour `S2.1`), la même de P1 à
  Pn ; ou, en dépôt manuel, `lot/<ID>-<slug>` du même lot (exactement celle du plan si elle y est
  déclarée). `branch.accepted` liste ces deux motifs avec l'identifiant rempli. **Tout autre `conductor/*`**
  (autre lot, autre agent, ancien format `conductor/<agent>/<exec>`, casse différente), HEAD détaché,
  `main` et les branches d'intégration donnent `blocked` : la branche d'un autre lot ne sert jamais.
  Pour un HEAD détaché, `branch.current = null` et la raison demande à Conductor de fournir ou créer la
  branche `conductor/agent-lot/<ID>` : jamais d'exécution sur HEAD détaché ni sur `main`. Sur la branche
  unique, l'ordre des prompts compte **tous** les prompts précédents du lot, quelle que soit la `Branche :`
  de leur étape dans le découpage (cette ligne décrit le dépôt manuel).
- **Historique** : un prompt `P<n>` exige que les prompts qui le précèdent dans le découpage, sur la même
  branche, soient déjà committés ; un prompt déjà committé est refusé (`blocked`). Hors Conductor,
  `--rejouer` reprend volontairement un prompt committé (il ne lève jamais l'ordre) ; l'option est interdite
  avec `--conductor`. Le commit peut n'être que local. « Prompt déjà committé » = les commits accessibles
  depuis `HEAD` et absents de `origin/main` (`git log origin/main..HEAD`) : **aucune fenêtre de N commits**,
  des deux côtés (contrat v1.1 § 3). **Détecteur unique (contrat v1.2 § 2), identique côté Conductor** : un
  commit compte comme le prompt `P<n>` du lot `<ID>` si, et seulement si, son **sujet** (première ligne)
  correspond à `^\[<ID>\] P<n> — ` : `<ID>` échappé, `<n>` entier sans zéro initial, un espace, le tiret
  cadratin U+2014, un espace. Aucune tolérance : ni tiret simple, ni double espace, ni casse différente, ni
  préfixe (`fixup!`, `squash!`, `contrat:`, `Merge …`) ; `[S2.10] P1 — …` n'est pas un prompt de `S2.1`,
  `P10` n'est pas `P1`. Un sujet `Revert` ne compte **jamais** comme prompt fait ; un sujet qui correspond à
  `^Revert "?\[<ID>\] P<n> — ` (`Revert` insensible à la casse, guillemets facultatifs : ce que produit
  `git revert`) situé **après** le commit d'origine **annule** ce prompt : il redevient à faire, l'ordre des
  prompts l'attend de nouveau, et `cloture` n'est autorisée que si tous les prompts sont non annulés. Un
  nouveau commit `[<ID>] P<n> — …` le remet à fait. Un revert de revert (`Revert "Revert "…""`, `Reapply "…"`)
  n'est pas défini par le contrat et n'est pas reconnu : le prompt reste à faire jusqu'à un nouveau commit de
  prompt. Sans `origin/main`
  (jamais récupéré), `lot.mjs` répond `error` (2) en demandant `git fetch origin` au lieu de deviner un
  historique. Un prompt déjà fusionné dans `origin/main` n'est plus « fait » pour une nouvelle branche :
  le lot est alors normalement `done` dans le plan.
- **Action** : quand `status = action_required`, `action` porte `id`, `type`
  (`authenticated-browser`, `secret`, `decision`, `external-submit`, `deployment`), `responsible`, `url`,
  `instructions`, `forbidden`, `evidence_path`, `evidence_rule` (`file_exists_nonempty`),
  `resume_command` et `not_before`. Clé d'idempotence côté Conductor : `action.id` + `lot` + `prompt`.
  Une seule action humaine par `before_prompt` et par lot : `--check` refuse un plan qui en déclare deux
  avant le même prompt (exit 2).
- **Secrets** : aucune valeur de secret ni donnée de compte ne figure dans `CONDUCTOR_RESULT`. `reason` ne
  contient jamais de chemin absolu local : chemins relatifs au dépôt seulement (un chemin absolu d'un
  message d'erreur est remplacé par `<chemin local>`).
- **Compatibilité** : `--depuis <ref>` (passé par les versions de Conductor antérieures au contrat) est
  accepté et sans effet, mais sa valeur est obligatoire et ne peut pas commencer par `-` (`--depuis
  --conductor` n'avale pas `--conductor` : `error`, avec la ligne finale). Toute autre option inconnue
  (dont `--depuis=<ref>` et les options courtes) et tout argument en trop donnent `error` (2).

### Clôture d'un lot

La clôture se lance hors Conductor, dans une session dédiée : `node scripts/lot.mjs <ID> cloture`. Elle
accepte la branche du plan (`lot/<ID>-<slug>`) **et** la branche unique d'une exécution Conductor
(`conductor/agent-lot/<ID>`), qui porte alors tous les prompts du lot. Le dernier prompt d'un lot peut
passer le lot à `done` dans le plan (S2.1 P3) ; la clôture reste alors autorisée si, et seulement si, la
branche courante est l'une de ces deux branches du lot, le lot a un découpage et **tous** les prompts de
cette branche ont leur commit : le statut `done` vient alors des commits de la branche. La branche
Conductor d'un autre lot, ou tout autre `conductor/*`, ne clôture rien. Un lot `done` avant le début des travaux
reste « TERMINÉ » et non relançable.

## Passerelle « Action humaine »

Le format est `ACTION HUMAINE REQUISE` (texte) et `CONDUCTOR_RESULT.action` (JSON). Quand
`/lot --conductor` le renvoie, l'orchestrateur doit créer une tâche dans **Notes → Tâches**, terminer le
run sans échec ni validation de code, puis attendre la preuve. Le statut exact du run est celui de
l'instance : la version de Conductor lue le 26/10 termine le run en `skipped` avec la tâche créée (INFÉRÉ
de sa lecture), un état d'attente dédié (`waiting_action`) restant une cible ; ce dépôt ne garantit pas
ce libellé. La tâche contient :

- identifiant stable, lot et prompt ;
- responsable et échéance éventuelle ;
- type : `authenticated-browser`, `secret`, `decision`, `external-submit` ou `deployment` ;
- URL à ouvrir ;
- consignes courtes et gestes interdits ;
- fichier ou signal attendu ;
- commande exacte de reprise.

La clôture de la tâche ne doit pas relancer tout le lot. Elle relance uniquement le prompt indiqué,
sur la même branche. La première application est `S2.1-A1` : ouvrir Search Console dans un Chrome déjà
connecté, relever les indicateurs de la baseline sans action Google, déposer
`docs/marketing/seo/search-console/2026-10-26/capture-gsc-j4.md`, puis reprendre `S2.1 P1`.

Tant que Conductor ne transforme pas automatiquement le bloc structuré en tâche, l'agent rend le
bloc et s'arrête. Un humain crée/termine la tâche ; le run n'est pas converti en approbation Git.

### La preuve : ce que `lot.mjs` vérifie, et comment elle arrive dans le worktree

`lot.mjs` considère la preuve valide si le fichier `evidence_path` : existe **dans le dépôt** (chemin
relatif, sans `..`, sans lien symbolique qui sorte du dépôt), est un fichier régulier et n'est **pas vide**
(pas seulement des blancs). Il ne dit rien de qui l'a écrit ni du contenu : le contenu minimal se vérifie
dans le prompt de reprise (S2.1 P1 le relit face à la baseline) et à la relecture.

L'agent ne crée jamais la preuve lui-même. La preuve doit se trouver **sur la branche de l'exécution**,
c'est-à-dire, en mode Conductor, sur `conductor/agent-lot/<ID>` (pour `S2.1` : `conductor/agent-lot/S2.1`).
Son nom étant connu d'avance et identique de P1 à Pn, une personne peut y déposer la preuve avant même le
premier run. Hypothèse de travail (**INFÉRÉ, non démontré ; seul Conductor décide comment il rapatrie un
fichier dans le worktree d'un run**) : la personne responsable dépose le fichier assaini, chiffres et
libellés seulement, sur la branche distante `conductor/agent-lot/S2.1` (créée depuis `origin/main` si elle
n'existe pas, un commit au message libre, **jamais** `[S2.1] P1 — …` qui compterait comme prompt fait,
puis push), ou bien Conductor recopie le fichier fourni par la tâche humaine dans le worktree de cette
branche. Aucune de ces deux voies n'est confirmée. **INCONNU, à vérifier sur l'instance :**

- si Conductor crée le worktree d'un lot à partir de la branche distante `conductor/agent-lot/<ID>`
  quand elle existe, ou depuis la base ;
- si un worktree déjà créé est mis à jour depuis la branche distante avant la reprise (le code de
  Conductor réutilise un worktree existant d'un prompt à l'autre, INFÉRÉ de sa lecture du 26/10 ; le
  contrat v1.1 § 7 ne parle que de resynchroniser la branche avec la base) ;
- si un fichier non suivi déposé dans le worktree survit à la reprise ;
- si la tâche humaine peut recevoir le fichier ou seulement un lien ;
- si la configuration de l'emploi autorise un push humain sur le préfixe `conductor/` de ce dépôt.

Tant que ce point n'est pas démontré par un essai à blanc, l'action `S2.1-A1` n'est pas considérée comme
levée par Conductor : l'humain relance le prompt après avoir vérifié que `lot.mjs` voit le fichier
(`node scripts/lot.mjs S2.1 P1 --conductor` dans le worktree de la branche `conductor/agent-lot/S2.1`).

## Dépôt public : politique des pilotes

Le dépôt cible est **public** : tout ce qui est poussé est lisible par tous, et ce que l'agent peut lire
en lecture libre peut finir dans un commit. Politique côté Tracky, jusqu'à décision contraire du
propriétaire :

- **Les pilotes se limitent à des lots documentaires** (relevé ou texte, sans code applicatif, sans
  migration, sans déploiement). Lesquels des lots découpés (S2.1 : relevé en Markdown ; S2.2 : textes et
  liens de la landing `lp/`) entrent dans cette définition est une décision du propriétaire, pas de ce
  document.
- **Aucun secret ni donnée sensible dans une preuve ou un commit** : chiffres et libellés seulement ; pas
  de cookie, jeton, mot de passe, adresse e-mail, identifiant de compte, adresse réseau interne ni capture
  portant un compte. Les interdits de chaque action le répètent.
- **Avant d'approuver un push**, relire le diff (`git diff origin/main...<branche>` dans le worktree) :
  l'écran de validation de Conductor n'est pas supposé montrer le diff complet.
- Contrat v1.1 § 8, côté Conductor : scan des lignes ajoutées avant tout push (fermé en cas d'erreur),
  diff et résultat du scan visibles dans la validation avant approbation. **INCONNU : à vérifier sur
  l'instance** que c'est livré ; ce dépôt ne peut pas l'affirmer.
- `enforce_admins` de `main` vaut actuellement `false` (OBSERVÉ le 26/10) : à trancher par le propriétaire.
  Rien de plus n'est affirmé ici sur ses conséquences.

## Secrets

Le coffre projet masque les valeurs, accepte un nom de variable, une portée et un grade minimal, et
journalise lectures d'agents et révélations humaines. Règles Tracky :

- documenter seulement nom, usage, propriétaire, portée, grade minimal et rotation ;
- ne jamais committer de valeur, cookie, jeton, export de navigateur ou capture portant un compte ;
- préférer un secret propre au projet à une surcharge globale ;
- donner le grade minimal réellement nécessaire ;
- un secret absent produit une action `secret`, avec lien vers le coffre, jamais une demande de le
  coller dans un prompt ;
- revoir le journal après les premiers runs puis à chaque élargissement d'agent.

## Lancer un prompt

Avant le premier run : les prérequis ci-dessus (PR #139 fusionnée par squash, puis les correctifs en PR
séparée, lot C8.2), accès GitHub vérifié sur l'instance, workspace prêt, Agent Lot embauché avec la
configuration cible et lot réellement prêt.

Depuis la fiche de l'emploi :

```text
Lot     S2.2
Prompt  P1
```

Puis :

1. Conductor fournit un worktree isolé sur la branche du lot (`conductor/agent-lot/<ID>`, ou
   `lot/<ID>-<slug>` en dépôt manuel), la même pour tous les prompts du lot.
2. `/lot` vérifie statut, date, dépendances, découpage, branche, prompt déjà fait, ordre des prompts et
   action requise (voir « Contrat »).
3. Le prompt produit son test ciblé et son commit exact (`commit_message`).
4. Conductor propose le push à la validation humaine ; Agent Lot ne pousse pas.
5. Le prompt suivant exige que les précédents soient committés dans le worktree de la branche.
   Contrat v1.1 § 7, côté Conductor : avant d'exécuter un prompt, le worktree de la branche est
   resynchronisé avec la base (`fetch`, puis vérification que `docs/pilotage/**` et `scripts/lot.mjs` de
   la branche ne divergent pas de `origin/main`) ; en cas de divergence, `blocked` « branche en retard »,
   sans rebase automatique. **À VÉRIFIER SUR L'INSTANCE** : S2.1 P3 et S2.2 P4 modifient
   `docs/pilotage/plan.json` (et `PLAN.md`) sur la branche du lot ; si la vérification compare naïvement
   la branche à `origin/main`, elle bloquerait ces prompts. Ce que l'implémentation tolère (retard de la
   branche seulement, ou aussi ses propres commits) n'est pas décidé ici.
6. Après le dernier prompt, une session dédiée, hors Conductor, lance `node scripts/lot.mjs <ID> cloture`.

Le formulaire accepte `P1` à `P999`, pas `cloture`. La clôture lance les contrôles complets, les deux
relectures et prépare la PR. Fusion et déploiement restent des actions distinctes. Jusqu'au
26/10/2026 à 08:41 Paris, aucun changement SEO, sitemap, Search Console, GBP ou déploiement marketing
ne doit brouiller la mesure S2.1.
