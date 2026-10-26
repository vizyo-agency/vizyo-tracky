# Découper un lot TRACKY

Un fichier `docs/pilotage/decoupe/<ID>.md` est la source unique des prompts d'un lot actif.
`node scripts/lot.mjs <ID> P<n>` le lit ; les sous-tâches Asana le recopient sans en changer le sens.

Format :

```markdown
---
lot: S2.2
etat_au: 2026-10-25
---

# S2.2 — Titre

## État
Deux à cinq lignes vérifiables.

## Étape 1 · Titre
Responsable : Youness
Branche : lot/S2.2-slug
Branche Conductor : conductor/agent-lot/S2.2

### P1 · Titre du prompt
Durée : 25 min
Fichiers : fichier-a · fichier-b
Sources : document § section · autre source

Faire :
- gestes précis à l'impératif

Test : `commande ciblée`
Fini quand : critère vérifiable
Hors périmètre : ce que le prompt ne fait pas
```

Branches : `Branche :` est la branche du dépôt **manuel** (`lot/<ID>-<slug>`). Dans Vizyo Conductor, un lot
se code sur **une seule branche**, `conductor/agent-lot/<ID>`, de P1 à Pn, quel que soit le nombre
d'étapes : la ligne `Branche Conductor :` (facultative, recommandée) la rappelle et `--check` refuse une
valeur différente de `conductor/agent-lot/<ID>`. Voir `CONDUCTOR.md`.

Règles : 15 à 30 minutes, un commit, cinq fichiers environ, un test avec le code. Pas de prompt
« tests seulement », pas de suite complète, pas de relecture, pas de PR : la clôture les fait une
fois. Les numéros déjà utilisés ne changent jamais.
