# Visibilité IA (GEO) — protocole d'un passage

> Décrit le protocole. Ne contient ni prompt, ni sortie, ni chiffre d'un passage réel : la version
> exacte des cinq prompts et les sorties intégrales vivent dans le dossier local de l'audit `G4.4`,
> hors de ce dépôt public. Seule la synthèse chiffrée d'un passage y entre.

## La grille

Un passage est une grille figée de **cinq prompts** sur **quatre assistants**, soit **vingt tests**.
Les cinq prompts ne sont jamais reformulés d'un passage à l'autre : c'est ce qui rend deux passages
comparables (voir « Règle de comparaison » ci-dessous). Ils ne sont pas recopiés ici ; leur texte
exact est conservé dans le dossier local de l'audit `G4.4`.

## Les six champs archivés par test

Chaque test de la grille (un couple prompt × assistant) archive exactement ces six champs :

| Champ | Contenu |
|---|---|
| Prompt exact | Le texte du prompt tel que soumis, sans reformulation. |
| Assistant | Son nom, sa version et l'état de sa recherche web (activée ou non) au moment du test. |
| Date et heure | Date et heure de Paris du test. |
| Sortie intégrale | La réponse complète de l'assistant, telle que reçue. |
| Preuve | Capture ou export de la sortie, avec son chemin local. |
| Lecture | Cité ou non, position de la citation, entités nommées, sources citées par l'assistant. |

## Règles de relevé

- Chaque test se fait dans une **session neuve, sans historique** avec l'assistant.
- Les réglages (modèle, version, recherche web activée ou non) sont **les mêmes à chaque passage**.
- **Un seul essai par test** : jamais de relance pour « améliorer » la réponse obtenue.
- Un échec technique (assistant indisponible, erreur, quota atteint) s'écrit littéralement
  « indisponible » — jamais une case vide ni un résultat inventé.

## Niveaux de preuve

Les quatre niveaux de preuve de [`veille/FORMAT.md`](../veille/FORMAT.md) s'appliquent aussi ici :

- **MESURÉ** — lu directement dans un outil de mesure, à l'instant du relevé.
- **OBSERVÉ** — constaté par une vérification manuelle, datée.
- **INFÉRÉ** — déduit de plusieurs faits MESURÉS ou OBSERVÉS, sans mesure directe.
- **À CONFIRMER** — avancé sans vérification suffisante ; à revérifier avant d'agir dessus.

La **lecture** d'une réponse d'assistant (cité ou non, position, entités nommées, sources citées)
est **OBSERVÉE** : elle vient d'une vérification manuelle de la sortie intégrale, datée, et non
d'une mesure directe d'un outil.

## Confidentialité

- Aucune donnée personnelle, aucun compte ni cookie ne figure dans une preuve ou une synthèse.
- Aucune capture ne montre une identité (compte connecté, e-mail, nom d'utilisateur).
- Les sorties intégrales et les captures restent **hors du dépôt public**, dans le dossier local de
  l'audit. Seule la synthèse chiffrée d'un passage (nombre de citations, par exemple) entre dans ce
  dépôt.

## Règle de comparaison

Un passage ne se compare qu'à un passage de **même grille** : mêmes cinq prompts, mêmes quatre
assistants. Si un prompt ou un assistant change, ce n'est plus le même passage — c'est une **nouvelle
grille**, qui ne se compare pas rétroactivement aux passages précédents.

La seule référence historique de ce protocole est la baseline de l'audit initial (`G4.4`) :
**0 citation sur 20**.
