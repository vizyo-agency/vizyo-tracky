# TRACKY dans Vizyo Conductor

> Conductor exécute un prompt de dépôt. Il ne remplace ni les observations Google, ni la décision
> humaine de pousser, d'ouvrir une PR, de fusionner ou de déployer.

## Configuration retenue

- Projet : `Tracky` — `https://dev.conductor.vizyoagency.com/projects/tracky`
- Slug : `tracky`
- Dépôt : `vizyoagency-create/vizyo-tracky@main`
- Stack : Angular · Node.js · PostgreSQL · Docker
- Fuseau : Europe/Paris
- Simulation totale : activée à la création
- Équipe initiale : Reviewer et Task Manager, plannings en pause

Configuration cible d'Agent Lot :

- grade Senior ; modèle Claude Sonnet 5 ; période d'essai de 10 exécutions ;
- seuil hérité de 70 % ; un seul run simultané ;
- déclencheur manuel uniquement ; aucun planning et aucun webhook GitHub ;
- le push reste toujours une validation humaine dans Conductor.

## Blocages constatés le 25/10/2026

1. Le clonage échoue : l'App GitHub Conductor n'est pas installée dans l'organisation
   `vizyoagency-create`.
2. La protection de `main` ne peut donc pas être vérifiée ; Conductor refuse à juste titre
   l'embauche d'Agent Lot.
3. Le pilotage `/lot` est dans la branche locale `chore/tracky-lot-pilotage`. Tant qu'elle n'est pas
   poussée puis fusionnée, un workspace cloné depuis `main` ne possède ni le skill ni le plan.
4. `S2.1` exige une session Search Console et un navigateur. Agent Lot n'a que GitHub et le
   filesystem : ce lot reste manuel et en lecture seule.
5. Le formulaire Agent Lot accepte un lot comme `S2.2` et un prompt `P1`, mais pas `cloture`.

Ne pas contourner ces blocages. L'installation de l'App GitHub change l'accès à un dépôt privé et
demande une validation humaine explicite.

## Conditions avant le premier run

- l'App GitHub a accès au dépôt Tracky ;
- le workspace Conductor est `prêt` et la protection de `main` est vérifiable ;
- le présent pilotage est fusionné sur `main` ;
- Agent Lot est embauché avec la configuration ci-dessus ;
- `S2.1` est clos dans le dépôt et dans Asana ;
- `node scripts/lot.mjs S2.2 P1 --conductor` répond `PRÊT` depuis un worktree de test.

## Lancer un prompt

Depuis la fiche de l'emploi Agent Lot :

```text
Lot     S2.2
Prompt  P1
```

Puis, un prompt à la fois :

1. Conductor fournit un worktree isolé.
2. Agent Lot reprend `origin/lot/S2.2-corrections-seo-courtes` si elle existe ; sinon il crée cette
   branche depuis `origin/main`. Il ne crée pas de worktree dans le worktree fourni.
3. `/lot` vérifie le statut, la date, les dépendances, la compatibilité Conductor et la branche.
4. L'agent réalise seulement le prompt, lance son test ciblé et produit le commit exact.
5. L'agent ne pousse pas. Conductor propose le push dans Validations.
6. Le prompt suivant ne part qu'après approbation du push précédent et présence du commit sur la
   branche distante.

Ordre prévu pour le premier lot compatible : `S2.2 P1`, `P2`, `P3`, puis `P4`.

## Clôture et livraison

Après le push approuvé de `P4`, ouvrir une session dédiée sur la branche et lancer :

```text
/lot S2.2 cloture
```

La clôture exécute la suite complète, les deux relectures, puis prépare la PR. Elle ne fusionne et
ne déploie rien sans autorisation. Un déploiement marketing reste interdit avant le relevé S2.1 et
reste régi par `CLAUDE.md` et `deploy.sh` ensuite.

## Lots non compatibles

Un lot est refusé en mode Conductor tant que `plan.json` ne porte pas explicitement :

```json
"execution": {
  "mode": "conductor-agent-lot",
  "prompts": ["P1"]
}
```

Les tâches de navigateur, Search Console, GBP, décision humaine, secrets, communication externe ou
déploiement ne deviennent jamais compatibles par défaut.
