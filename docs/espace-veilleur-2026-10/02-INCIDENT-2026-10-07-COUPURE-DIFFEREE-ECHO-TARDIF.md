# HM-733-GA, deuxième nuit (07/10/2026, 23:06) — la cause racine

> Écrit le 08/10/2026 à 01 h, à partir de mesures en production faites en **lecture seule** (base,
> trames des boîtiers, journal système). Code de référence : `origin/main` = `88cd0711`, celui qui
> tourne en production.
>
> Correctif : branche `fix/coupe-non-accusee-rallumer` (commit `ff8b2187`, repris après une
> relecture indépendante — § « Relecture »). **Ni fusionnée ni déployée**, en attente de l'accord
> du propriétaire.
>
> Le dossier du premier soir, `00-INCIDENT-2026-10-06-ET-REFONTE.md`, est resté hors du dépôt
> (non commité, il cite des données personnelles). Ce document le complète et **corrige un point
> de son diagnostic** : le boîtier avait bien répondu.

---

## En une phrase

Le boîtier **a coupé et l'a dit**, en TCP, mais **en retard** (157 s le 06/10, 69 s le 07/10).
Tracky n'écoute que 15 s : il a jeté la réponse, la coupure est restée « envoyée ». L'écran du
veilleur ne compte qu'une coupure **acquittée** : il a affiché « Moteur actif » et grisé
« Rallumer ». Le véhicule ne démarrait plus, et le veilleur n'avait aucun bouton pour le libérer.

---

## Les trois questions du propriétaire

### « Pourquoi TCP ne marche pas ? » — TCP a marché, dans les deux sens

| Heure (Paris) | Fait mesuré | Source |
|---|---|---|
| 23:06:29 | Le boîtier se reconnecte (login TCP), encore sans position GPS | `wire_logs` |
| 23:06:45.555 | Ordre de coupure `J` **écrit sur la socket TCP** (coupure demandée par le veilleur) | `wire_logs`, `engine_control_commands` |
| 23:07:00 | Fin de l'attente de 15 s : tentative `TIMED_OUT`, la commande reste `SENT` | `engine_delivery_attempts` |
| 23:07:48 → 23:07:52 | Contact coupé, le véhicule avance de 7 m à 3–7 km/h | trames de position |
| **23:07:54.211** | **Le boîtier répond `jt` : coupure exécutée — 69 s après l'ordre** | `wire_logs` |
| 23:07:57 → 23:19:09 | Contact remis, vitesse 0 : on essaie de démarrer, en vain | trames de position |

La réponse `jt` est arrivée **sur la même connexion TCP**, avec une position GPS valide. Tracky l'a
enregistrée comme une **simple position** : le guetteur d'accusé l'avait abandonnée à 23:07:00.

**Même chose le 06/10** : ordre à 22:05:20 (planning), `jt` à **22:07:57**, 157 s plus tard, jeté
de la même façon. Le rapport d'audit du 07/10 (TRK-104) concluait « c'est le boîtier qui n'a pas
répondu » : c'est faux, il a répondu, trop tard pour un guetteur de 15 s.

**Pourquoi le boîtier répond-il en retard ?** Le 403C **diffère** l'exécution de la coupure et
n'envoie `jt` qu'au moment où il coupe réellement. Ce n'est pas propre à ce véhicule : on ne le
voit simplement que lorsque l'ordre arrive dans un moment où le boîtier n'est pas prêt.
Hypothèse la plus compatible avec les deux soirs : il attend une **position GPS valide**. Le
06/10, le GPS dormait (une position toutes les 6,6 min, contact coupé) ; le 07/10, le boîtier
venait de se reconnecter sans position. Aucune trame `jt` n'a jamais été vue sans position valide
(281 échos depuis le 04/10, tous avec `A`). *Hypothèse, pas preuve : à confirmer au banc.*

**Sur 4 jours de trames** (rétention de `wire_logs` : depuis le 04/10), 137 `jt` et 144 `kt` reçus,
**3 jamais rapprochés** de leur commande :

| Échos perdus | Quand | Pourquoi |
|---|---|---|
| `jt` HM-733-GA | 06/10 22:07:57 | arrivé **157 s** après l'ordre (guetteur abandonné à 15 s) |
| `jt` HM-733-GA | 07/10 23:07:54 | arrivé **69 s** après l'ordre |
| `kt` EP-047-TY | 07/10 05:00:05 | arrivé **0,4 s** après l'ordre, **avant** l'inscription du guetteur (TRK-083 / T71) → SMS payant envoyé pour rien |

Sur 30 jours, 5 coupures TCP sont restées sans accusé, dont **3 sur HM-733-GA** (23/09, 06/10,
07/10). Les trames antérieures au 04/10 ne sont plus en base ; les deux plus anciennes ne
peuvent pas être vérifiées.

À côté, sans lien avec l'incident : le boîtier se reconnecte souvent (187 logins le 07/10), comme
plusieurs autres du parc (GS-928-NX : 222 le 06/10). C'est le sujet de la branche C1
« provenance des connexions », pas celui-ci.

### « Pourquoi pas de SMS de secours si TCP ne passe pas ? »

Deux réponses.

1. **Pour une coupure, c'est voulu** (`engine-control.service.ts`, bloc « V1.15 ») : une coupure
   écrite en TCP sans accusé reste `SENT`, sans SMS. Le code part du principe que le Coban
   « exécute en silence ». **Cette prémisse est fausse pour le 403C** : il répond, mais parfois
   tard. Un SMS de secours n'aurait rien arrangé : il aurait renvoyé une seconde coupure, payante,
   à un boîtier qui avait déjà la première.
2. **Pour un rallumage, le secours SMS existe** : TCP d'abord, puis SMS prioritaire après 15 s
   sans `kt`. Le SMS manuel du propriétaire a d'ailleurs fonctionné : la SIM du boîtier est
   joignable. **Mais le veilleur n'a jamais pu envoyer de rallumage** : le bouton était grisé
   (question suivante).

### « Ou c'est un bug d'écran ? » — Oui, et c'est lui qui a bloqué le veilleur

`engine-control-button.component.ts`, `isCutActive()`, quand la liste des commandes est servie
(c'est le cas du veilleur depuis C7, le 24/09) : « coupé » = dernière coupure **ACKNOWLEDGED**.
Une coupure `SENT` ne comptait pas. L'écran du veilleur, de 23:06 à 23:20 :

- état : **« Moteur actif »** ;
- « Rallumer » : **grisé**, motif « Le moteur n'est pas coupé. » (dans l'infobulle, invisible au doigt) ;
- « Couper » : **offert**.

Le seul bouton actif était « Couper ». Le veilleur l'a pressé **onze fois de plus** :

| Heure | Réponse de l'API |
|---|---|
| 23:06:54, 23:07:06, 23:07:20 | 201 : la coupure déjà en vol est renvoyée, rien ne part |
| 23:08:18, 23:08:35 | 403 : « Véhicule arrêté depuis seulement 27 s / 44 s » (les 7 m de 23:07:48) |
| 23:10:04, 23:10:33, 23:11:04, 23:11:08, 23:11:40, 23:11:55, 23:13:12 | 201 : même coupure renvoyée |

Chaque 201 réécrit le gel du planning (`overrideUntil = 9999-12-31`). Puis l'appel au
propriétaire, le SMS manuel (« Resume engine Succeed » reçu à 23:19:51), et le véhicule repart à
23:20:16.

L'API, elle, **accepte un rallumage dans cette situation** : un RESTORE supplante toute coupure en
vol. Il ne manquait que le bouton.

---

## Le piège secondaire : le planning de HM-733-GA est gelé depuis le 06/10

`vehicle_schedules.overrideUntil = 9999-12-31 23:59:59` depuis les clics du 06/10 au soir, et
jamais levé (le SMS manuel est fait hors de Tracky). Conséquences **mesurées** :

- **07/10 07:00** : pas de rallumage automatique. Le véhicule, coupé par le veilleur à 05:55, est
  resté immobilisé jusqu'à son rallumage manuel à **07:22**.
- **07/10 22:00** : pas de coupure automatique. C'est le veilleur qui a coupé, à 23:06.
- Tant que personne ne clique « Réactiver » (page Horaires), ce sera pareil chaque soir et chaque
  matin.

---

## Ce que corrige la branche `fix/coupe-non-accusee-rallumer`

**1. L'écho tardif d'une coupure n'est plus jeté (API).**
- `TcpServerService` : une trame `imei:<IMEI>,jt,…` ou `kt` qu'aucun guetteur n'a prise, reçue sur
  la connexion en cours du boîtier, est diffusée (`tracker.engine-echo`) **avec l'heure GPS de la
  trame**.
- `EngineControlService.onEchoMoteur` la confronte à la **dernière intention** du boîtier (24 h,
  refus et échecs exclus) :
  - écho daté de plus de 15 s **avant** cette intention : trame rejouée (les Coban revident leur
    tampon à la reconnexion) ou réponse à un ordre plus ancien → ignoré ;
  - `jt` et dernière intention = coupure non acquittée (`PENDING`, `SENT`, `SENT_UNCONFIRMED`) →
    `ACKNOWLEDGED`, et l'écran est prévenu par WebSocket. Jamais une coupure **supplantée** par un
    rallumage, même supplantée entre la lecture et l'écriture (condition dans le `where`) ;
  - écho **contraire** à la dernière intention : rien ne change. S'il dément une commande
    acquittée, il est écrit au centre d'alerte — `CRITICAL` pour un `jt` après un rallumage
    acquitté (véhicule immobilisé que tout le monde croit libre) ;
  - `kt` d'un rallumage : rien. Le rallumage a déjà sa route (relance TCP, secours SMS, alerte à
    60 s), et toutes ses écritures ne sont pas conditionnelles : un acquittement posé en parallèle
    pourrait y être écrasé.
- Le même chemin rattrape l'écho **précoce** d'une coupure (arrivé avant l'inscription du guetteur,
  TRK-083 — GR-898-HY le 16/09). Celui d'un rallumage reste T71 (un SMS payant pour rien).

Avec ce correctif, le 07/10 à 23:07:54, la coupure serait passée « acquittée » : l'écran aurait
affiché « Moteur coupé » et offert « Rallumer ».

**2. L'écran offre « Rallumer » sur toute coupure non prouvée (web).** C'est le filet, pour le jour
où l'écho n'arrive jamais.

| État de la dernière coupure (plus récente que le dernier rallumage acquitté) | Pastille | Rallumer | Couper |
|---|---|---|---|
| acquittée | Moteur coupé | ✅ | grisé « déjà coupé » |
| partie, sans preuve (`PENDING`, `SENT`) | Coupure non confirmée | ✅ | grisé « une coupure est déjà partie » |
| échue sans preuve (`SENT_UNCONFIRMED`) | Coupure non confirmée | ✅ | ✅ (nul ne sait) |
| aucune | Moteur actif | grisé | ✅ |

- Une phrase sous les boutons dit la sortie : « Si le véhicule doit repartir, utilisez
  « Rallumer » ».
- Une coupure restée `PENDING` plus de 2 min est orpheline (le serveur la renverra) : « Couper »
  redevient offert, sinon il resterait grisé pour toujours.
- Les observations `DEVICE_OBSERVED` ne comptent plus, comme côté serveur.
- La liste lue passe de 5 à 20 lignes. Avec 5, quelques refus suffisaient à pousser la vraie
  coupure hors de la fenêtre.
- Un bouton ne relit sa liste que pour un événement **de son boîtier**. Avant, chaque événement de
  la flotte faisait relire la liste à chaque bouton déjà concerné (30 boutons × 90 événements à
  22:00) : de quoi heurter la limite de 100 requêtes par minute, et faire retomber l'écran sur
  l'overlay temps réel, moins précis.

**Tests**
- Web : 9 nouveaux cas, dont les séquences réelles des 06 et 07/10. Sur l'ancien code, le cas du
  07/10 rend exactement l'écran du veilleur (« Moteur actif », « Rallumer » grisé).
- API : 10 cas sur le chemin TCP (trames réelles, IMEI fictif, heure GPS transportée) ; 16 cas sur
  `onEchoMoteur` (dont trame rejouée, écho sans heure, coupure supplantée, `kt` sans effet).

### Relecture indépendante (08/10, avant toute fusion)

Une relecture contradictoire de la première version a trouvé trois défauts, corrigés :
- **un écho n'était pas daté** : une trame rejouée aurait pu acquitter une commande neuve
  (`kt` d'hier → rallumage d'aujourd'hui arrêté en silence) ;
- **le worker des rallumages peut écraser un acquittement** (écritures non conditionnelles dans
  `retryTcpOnly` et les échecs SMS) : d'où « coupure seule » ;
- **une supplantation entre lecture et écriture** pouvait faire acquitter une coupure abandonnée.

Elle a aussi relevé ce qui reste ouvert (section suivante).

---

## Ce qui n'est PAS corrigé ici (dossier 00, P0 à traiter ensuite)

- **P0-2** : un « couper » sur une coupure en vol répond encore 201 et réécrit le gel. Depuis le
  correctif web, le bouton « Couper » est grisé dans ce cas : la cause du 07/10 ne peut plus se
  produire depuis l'écran.
- **P0-5** : un « Resume engine Succeed » reçu par SMS du numéro du boîtier n'est pas appris comme
  état ; il ne lève pas le gel du veilleur.
- **P0-3, P0-4, P0-6** : alerte « veilleur bloqué », push d'urgence `CRITICAL`, 403 en rafale
  sur `/schedule`.
- La règle serveur `etatCoupeParTracker` ignore toujours `SENT_UNCONFIRMED`, et le passage à cet
  état n'est jamais diffusé par WebSocket. La **liste** servie au bouton en tient compte ; le
  **repli** sur l'overlay temps réel (liste illisible trois fois de suite, pendant un déploiement
  par exemple) ne le fait pas encore. C'est le cœur de P0-1 : un seul modèle d'état, partagé.
- Un écho `jt` dans une trame sans position GPS (`no_fix`) n'est pas lu. Jamais observé.
- **Une coupure différée peut-elle s'exécuter APRÈS un rallumage ?** Personne ne le sait : la
  supplantation ne touche que la base et le SMS en file, pas un `J` déjà différé dans le boîtier.
  Si cela arrive, le `jt` lève un `CRITICAL`, mais l'écran reste « Moteur actif ». La sortie est
  alors « Couper » puis « Rallumer ». À vérifier au banc 403C avant d'aller plus loin.
- Les écritures non conditionnelles du worker des rallumages (`retryTcpOnly`, échecs SMS) restent
  à rendre conditionnelles (`ackedAt: null`), avec T71 et T78.
- En coupure « en vol », le bandeau « Le boîtier n'a pas confirmé » offre encore « Renvoyer la
  commande », qui renvoie une coupure que le bouton refuse (l'API la rend telle quelle, sans
  effet).

---

## À faire par un humain, aujourd'hui 08/10

1. **« Réactiver » le planning de HM-733-GA en journée** (entre 07:00 et 22:00), page Horaires.
   ⛔ Jamais de nuit : « Réactiver » applique la transition due dans la minute, donc une coupure
   hors plage.
2. **Demander au client si la plage 07:00–22:00 convient à HM-733-GA.** Trois nuits de suite, le
   veilleur en a eu besoin après 22:00 : rallumé le 05/10 à 22:34, puis les 06 et 07/10.
3. **Relire et décider du déploiement** du correctif. Fenêtres : jamais entre 05:30 et 09:00, ni
   entre HH:42 et HH:46. Ensuite, recette sur « Client test » (dossier 00, § 5, scénarios 1 et 2).

---

## Annexe — mesures

Toutes les heures sont celles de Paris. Les colonnes de `tracky_prod` sont en UTC sans fuseau :
conversion `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`, recalée sur `now()`.

- `engine_control_commands` HM-733-GA, 3 jours : CUT 06/10 22:05:20 `SENT_UNCONFIRMED` (TCP,
  0 SMS) ; CUT 07/10 05:55:59 `ACKNOWLEDGED` en 0,8 s ; RESTORE 07/10 07:22:51 `ACKNOWLEDGED` ;
  CUT 07/10 23:06:45 `SENT_UNCONFIRMED` (TCP, 0 SMS) ; 2 `REJECTED_SPEED` à 23:08.
- `engine_delivery_attempts` : les deux coupures, `TCP TIMED_OUT`, « ACK timeout after 15000ms ».
- `wire_logs` : `J` sortant à 23:06:45.555, `jt` entrant à 23:07:54.211 (classé `position`, sans
  trame `ack` jumelle) ; le 06/10, `J` à 22:05:20.225 et `jt` à 22:07:57.483.
- `sms_logs` : « Resume engine Succeed » entrant à 23:19:51, depuis la SIM du boîtier.
- `system_activity_logs` : 12 POST « couper » du veilleur sur HM-733-GA entre 23:06:45 et 23:13:12
  (1 créée, 9 renvoyées en 201, 2 refusées en 403).
- `vehicle_schedules` : `overrideUntil` 9999-12-31, `lastEvaluatedState` `OUT_OF_WINDOW` depuis le
  06/10 22:05 ; `schedule_history` vide depuis.
