# TRACKY dans Vizyo Conductor

> Conductor exécute le travail de dépôt et orchestre les interruptions. Une action humaine n'est ni
> un échec, ni une validation Git : elle a sa propre tâche, sa preuve attendue et son point de reprise.

## État réel au 25/10/2026

- Projet : `Tracky` — `https://dev.conductor.vizyoagency.com/projects/tracky`
- Dépôt déclaré : `vizyoagency-create/vizyo-tracky@main`
- Propriétaire GitHub actuel : compte personnel `vizyoagency-create`
- Organisation GitHub : `vizyo-agency` ; elle contient `nisiv`, `vizyo-conductor` et `dispocar`, pas Tracky
- App GitHub : `Vizyo Conductor`, privée et installée uniquement sur `vizyo-agency`
- Branche de pilotage : `chore/tracky-lot-pilotage`
- PR de pilotage : `https://github.com/vizyoagency-create/vizyo-tracky/pull/139`, ouverte et non fusionnée
- Workspace Tracky : bloqué ; Conductor ne peut ni cloner avec son App ni vérifier `main`
- Stack : Angular · Node.js · PostgreSQL · Docker ; fuseau Europe/Paris
- Équipe : Reviewer et Task Manager, plannings en pause
- Coffre Tracky : aucun secret propre au projet ; les secrets de plateforme restent hérités

Le dépôt Tracky est public, mais Agent Lot a quand même besoin d'une installation GitHub App pour
les jetons d'installation, les écritures, les protections de branche et les webhooks. Un clone public
anonyme ne suffit pas au workflow.

## Décision GitHub à prendre sans précipitation

L'App est privée. GitHub autorise alors son installation uniquement sur le compte qui la possède,
ici `vizyo-agency`. Deux chemins existent :

1. **Transférer Tracky vers `vizyo-agency`** — cohérent avec NISIV, Dispocar et Conductor. GitHub
   conserve commits, branches, PR, issues, secrets, deploy keys et webhooks, et redirige l'ancienne
   URL. Il faut toutefois auditer protections, Actions, Pages/packages, intégrations externes,
   remotes des worktrees et scripts qui contiennent l'ancien owner avant le transfert.
2. **Rendre l'App publique, puis l'installer sur `vizyoagency-create` avec Tracky seulement** — ne
   déplace aucun dépôt, mais rend l'App installable par d'autres comptes. Une App publique installée
   ailleurs ne peut pas redevenir privée tant que ces installations existent.

Ne créer ni second dépôt ni miroir : ils diviseraient les branches et les PR. Ne changer aucun
remote avant la décision et l'inventaire. Le transfert vers l'organisation est la cible recommandée
à long terme ; l'App publique est le chemin le moins disruptif à court terme.

## Configuration cible d'Agent Lot

- grade Senior ; Claude Sonnet 5 ; période d'essai de 10 exécutions ;
- seuil hérité de 70 % ; parallélisme 1 ;
- déclencheur manuel uniquement ; aucun planning et aucun webhook GitHub ;
- un worktree isolé par run ; branche `lot/<ID>-<slug>` ;
- Agent Lot committe mais ne pousse pas ; Conductor propose le push dans Validations ;
- Reviewer relit la PR ; Merger peut préparer une fusion séparée si cet agent est ensuite embauché ;
- aucun déploiement ne découle d'un push ou d'une fusion : il exige son propre geste autorisé.

La limitation initiale à `S2.2 P1`–`P4` n'était pas liée au risque du dev. S2.2 était simplement le
seul lot prêt, découpé et décrit pour Agent Lot. Désormais, tout prompt existant dans un découpage
est candidat ; statut, date, dépendances, branche et actions humaines continuent de bloquer.

## Passerelle « Action humaine »

Le format cible est `ACTION HUMAINE REQUISE`. Quand `/lot --conductor` le renvoie, l'orchestrateur
doit créer une tâche dans **Notes → Tâches**, mettre le run en `waiting_action`, puis attendre la
preuve. La tâche contient :

- identifiant stable, lot et prompt ;
- responsable et échéance éventuelle ;
- type : `authenticated-browser`, `secret`, `decision`, `external-submit` ou `deployment` ;
- URL à ouvrir ;
- consignes courtes et gestes interdits ;
- fichier ou signal attendu ;
- commande exacte de reprise.

La clôture de la tâche ne doit pas relancer tout le lot. Elle relance uniquement le prompt indiqué,
sur la même branche distante. La première application est `S2.1-A1` : ouvrir Search Console dans un
Chrome déjà connecté, relever treize lignes sans action Google, déposer
`docs/marketing/seo/search-console/2026-10-26/capture-gsc-j4.md`, puis reprendre `S2.1 P1`.

Tant que Conductor ne transforme pas automatiquement le bloc structuré en tâche, l'agent rend le
bloc et s'arrête. Un humain crée/termine la tâche ; le run n'est pas converti en approbation Git.

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

Avant le premier run : accès GitHub opérationnel, PR #139 fusionnée sur `main`, workspace prêt,
Agent Lot embauché avec la configuration cible et lot réellement prêt.

Depuis la fiche de l'emploi :

```text
Lot     S2.2
Prompt  P1
```

Puis :

1. Conductor fournit un worktree isolé.
2. Agent Lot reprend la branche distante du lot ou la crée depuis `origin/main`, sans worktree imbriqué.
3. `/lot` vérifie statut, date, dépendances, découpage, action requise, branche et commits antérieurs.
4. Le prompt produit son test ciblé et son commit exact.
5. Conductor propose le push ; le prompt suivant attend le commit distant.
6. Après le dernier prompt, une session dédiée lance `/lot <ID> cloture`.

Le formulaire accepte `P1` à `P999`, pas `cloture`. La clôture lance les contrôles complets, les deux
relectures et prépare la PR. Fusion et déploiement restent des actions distinctes. Jusqu'au
26/10/2026 à 08:41 Paris, aucun changement SEO, sitemap, Search Console, GBP ou déploiement marketing
ne doit brouiller la mesure S2.1.
