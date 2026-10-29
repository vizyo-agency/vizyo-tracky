# Audit du 29/10/2026 — MH-971-TD : « Couper » affiché sur un véhicule déjà coupé

> Suite de [`02-INCIDENT-2026-10-07-COUPURE-DIFFEREE-ECHO-TARDIF.md`](./02-INCIDENT-2026-10-07-COUPURE-DIFFEREE-ECHO-TARDIF.md).
> Données lues en LECTURE SEULE sur `tracky_prod` le 29/10 vers 07 h (heures de Paris).

## 1. Ce qui s'est passé

| Heure | Fait | Source |
|---|---|---|
| 28/10 22:08:00 | Coupure du planning, ordre `J` envoyé en TCP | `engine_control_commands` |
| 28/10 22:08:04 | **Le boîtier répond `jt` — 4 s après** — dans une trame `no_fix` (drapeau `L`, aucune coordonnée) | `wire_logs` |
| 28/10 22:40 | Commande échue : `SENT_UNCONFIRMED`, `smsAttemptCount 0` | idem |
| 29/10 06:45:04 | Le veilleur (`emu@`) envoie « Couper » : l'écran ne considérait pas le véhicule comme coupé | idem |
| 29/10 06:45:07 | **Nouveau `jt`, 3 s après** — encore en trame `no_fix` | `wire_logs` |
| 29/10 ≈ 06:50 | Appel au support ; le veilleur ne peut pas rallumer (« Rallumer » grisé) | |
| 29/10 06:48:27 | SMS manuel du propriétaire (`resume…`) → le boîtier répond « Resume engine Succeed » | `sms_logs` |
| 29/10 07 h | Tracky n'a toujours pas pris acte du rallumage : dernière intention = coupure | `engine_control_commands` |

Le véhicule était en « mode hors GPS » (souterrain). Les deux coupures ont bel et bien été exécutées et
**accusées par le boîtier en moins de 5 s**, bien dans la fenêtre de 15 s du guetteur d'accusé.

## 2. Pourquoi le bouton ne s'actualisait pas — quatre causes, dans l'ordre où elles agissent

1. **Le serveur TCP ne rapproche pas un écho moteur reçu en trame `no_fix`.**
   `tcp-server.service.ts`, cas `position` : `ackWaiter.tryMatch(...)`. Cas `no_fix` : rien. Or un boîtier
   sans fix répond `imei:…,jt,…,L,,,…`, que le décodeur classe `no_fix`. Le `jt` de 3-4 s est donc jeté :
   le guetteur expire à 15 s (`TIMED_OUT`), la commande reste `SENT` puis devient `SENT_UNCONFIRMED`.
   *Le correctif du 08/10 (écho tardif) ne couvrait que le cas `position` : il n'aurait pas sauvé ce matin.*
2. **L'écran ne compte une coupure que si elle est `ACKNOWLEDGED`** (branche non corrigée en production :
   `fix/coupe-non-accusee-rallumer` n'a jamais été déployée). Une coupure `SENT` / `SENT_UNCONFIRMED` donne
   « Moteur actif », « Couper » en rouge, « Rallumer » grisé. C'est ce que voyaient le veilleur **et** le
   compte admin. Le correctif existe depuis le 08/10 (branche locale `ff8b2187`…) : il est fusionné ici.
3. **Une coupure n'avait aucun secours SMS.** Une remise en route en a un (TCP → SMS → relances) ; une coupure
   dont l'ordre TCP est parti reste « envoyée » si rien ne revient. Mesuré : `smsAttemptCount = 0` les deux fois.
4. **Un rallumage fait par SMS à la main n'était jamais enregistré.** « Resume engine Succeed » ne
   rapprochait qu'une RESTORE `SENT` ; sans elle, la réponse était écrite dans `sms_logs` et ignorée. Le
   véhicule roulait, l'écran disait « coupé » — et le gel veilleur du planning (`overrideUntil` 9999) restait posé.

## 3. Étendue (production, depuis le 25/10 03:00 UTC, rétention de `wire_logs`)

- Échos `jt`/`kt` en trame `position` : 297 sur 40 boîtiers. **En trame `no_fix` : 2, sur un seul boîtier (MH-971-TD).**
  Le défaut est rare — mais c'est exactement le véhicule en souterrain, la nuit, qu'on veut pouvoir rallumer.
- Commandes non acquittées sur 7 jours : 6, dont 2 expliquées par ce défaut (les deux de MH-971-TD).
  Les autres : `FG-669-DQ` / `FN-644-CL` (coupures du planning parties par SMS, jamais accusées), `GR-294-VW`
  (RESTORE supplantée par une coupure plus récente : normal).
- ⚠️ **À regarder aujourd'hui, hors périmètre de ce correctif :** `FN-644-CL` (flotte « MH Cars ») est muet
  depuis le 28/10 17:01, coupé à 20:01 par SMS, et sa remise en route de 05:00 est toujours `SENT` après trois
  SMS (06:01, 07:02 …) restés « queued ». Il est peut-être encore immobilisé.

## 4. Ce que change ce correctif

| # | Changement | Fichier |
|---|---|---|
| A | `no_fix` : un écho `jt`/`kt` (seulement lui) est rapproché du guetteur, sinon diffusé comme écho orphelin (avant l'écriture en base). L'horloge d'un boîtier sans GPS étant interne, l'écho n'est daté que s'il tombe à moins de 2 min de la réception ; sinon il est diffusé sans heure, donc jamais rapproché. | `tracker-tcp/tcp-server.service.ts` |
| B | Un SMS « Stop/Resume engine Succeed » acquitte une commande `SENT` **ou** `SENT_UNCONFIRMED` créée depuis moins de 24 h — une commande échue n'est acquittable que si aucune demande **contraire** ne l'a suivie | `engine-control/engine-control.service.ts` |
| C | « Resume engine Succeed » sans RESTORE en attente, alors que la dernière intention est une coupure ≥ 10 s plus ancienne : une ligne RESTORE `ACKNOWLEDGED` (canal SMS, motif explicite, **datée de la réception du SMS**) est enregistrée, les coupures ouvertes antérieures sont closes, une alerte est écrite au centre d'alerte. **Aucun ordre n'est émis, aucun SMS annulé, le planning n'est pas touché** (un SMS usurpé ne doit pas défaire un antivol) : le gel veilleur éventuel reste posé jusqu'à un « Réactiver » humain. Abstention si une RESTORE de Tracky est partie par SMS sans accusé (la réponse est probablement la sienne). Dédoublonné par SMS. | idem (`constaterRemiseEnRouteParSms`) |
| D | **Synchronisation manuelle, à la demande — jamais automatique** (décision du propriétaire, 29/10 : un message coûte, le cas est rare). Quand une coupure reste sans preuve, l'écran propose « Synchroniser le boîtier » : une question explique que le véhicule est peut-être dans un souterrain ou une zone non couverte par le GPS ; si l'utilisateur confirme, le MÊME ordre (`stop<mdp>`, validité 120 s) repart par un canal de secours et la réponse du boîtier remet l'écran d'accord. **L'écran ne nomme jamais le canal.** Une seule synchronisation par coupure ; route `POST /engine-control/trackers/:trackerId/sync` (mêmes rôles et même permission `engine_control` par véhicule que l'envoi d'une commande, cloisonnée par société). Toute remise en route rappelle au relais les messages de coupure encore valides, même d'une coupure déjà acquittée (`annulerSmsCoupuresRecentes`). Offerte dans la fenêtre d'attente (après 15 s sans réponse) et sur l'écran du véhicule (coupure « non confirmée » de la liste, y compris à l'arrêt). | idem (`synchroniserBoitier`) + contrôleur + écran |
| E | **Fenêtre d'attente** : dès le glissement de confirmation, un voile plein écran « Coupure/Rallumage du moteur en cours » suit la commande (ordre enregistré → envoyé → confirmation, « par SMS » si le secours est parti), tient le verrou du boîtier **qui lui appartient** (jeton : une fin de requête tardive ne relâche pas le verrou d'une autre surface), se referme seule 1,8 s après « Moteur coupé/rallumé », et dit « non confirmée — vérifiez sur place » après 150 s. Relit la liste toutes les 2 s (indépendant du WebSocket). Rendue à la **racine du document** (sur la carte, un parent à `backdrop-filter` la confinerait) et retirée explicitement à la destruction du bouton. Messages exacts : boîtier muet, commande remplacée. | `engine-control-button.component.ts` |
| F | Le correctif du 08/10 (état « Coupure non confirmée », « Rallumer » offert) est fusionné dans la même branche | (commits `ff8b2187`, `f69f9d43`, `747138bf`, `ea718c06`) |

## 5. Ce qui n'est PAS corrigé

- Le gel veilleur sans échéance (voir `tracky_incident_cdef31_2026_10_28_gel_veilleur`) : la popup d'information est dans un autre chantier.
- `FN-644-CL` : voir § 3.
- SMS « queued » jamais « sent » pour ce véhicule : à examiner côté passerelle (`vizyo-texto`).
- Aucun envoi de secours AUTOMATIQUE pour une coupure (planning ou manuelle) : décision du propriétaire, par économie. L'écho `no_fix` rapproché suffit pour le cas mesuré ; sinon, synchronisation à la demande (§ 4, D).
- Des textes EXISTANTS de l'écran mentionnent encore « SMS » (bloc « boîtier muet », infobulle de dormance) : seuls les textes de la nouvelle synchronisation sont neutres.
- Un rallumage manuel par SMS **ne lève pas** le gel veilleur : « Réactiver » en journée (Horaires flotte).
- Le constat d'un rallumage par SMS ne porte que sur une coupure de moins de 24 h.
- Recette sur « Client test » avant déploiement ; la fenêtre d'attente n'a été vue que dans une maquette statique avec les jetons de l'application (thèmes clair et sombre), pas encore en situation réelle.

## 5 ter. MH Cars — zone « Garage »

`FN-644-CL` a été débranché dans un garage (information du propriétaire) : ce n'est donc pas une panne. Une zone
**« Garage — FN-644-CL »** a été créée pour MH Cars sur le modèle de celles de CDEF : cercle, règle entrée + sortie, orange
`#f59e0b`, centre 43.39547 / 1.70867 (dernière position du véhicule), rayon 100 m, valable pour tous les véhicules de la société
(id `1165f3e8-fc4e-4bb3-9ef2-c14a6c67d508`). ⚠️ Insérée en base, sans passer par le service : le cache des zones de l'API est
mémorisé par société sans échéance, elle ne sera donc prise en compte qu'à la **prochaine recréation de l'API** (le déploiement de
ce correctif) ou dès qu'une zone de MH Cars est modifiée dans l'application. À renommer / recentrer / agrandir depuis l'écran des zones
si besoin (CDEF a dû passer de 100 à 140 m : un véhicule garé dérive jusqu'à 250 m).

## 5 bis. Relecture contradictoire (sous-agent, 29/10) — 13 constats, traités

Défauts réels corrigés : SMS de secours survivant à une remise en route (→ ttl 120 s + rappel de tous les SMS de coupure valides) ;
accusé SMS sur une vieille commande échue (→ borne 24 h + « aucune demande contraire ») ; remise en route constatée qui
avalait ou usurpait (→ abstention, datation, aucun effet sur planning/SMS) ; course sur les coupures ouvertes (→ bornées) ;
`tryMatch` ouvert à toute trame sans GPS (→ réservé à `jt`/`kt`) ; horloge interne d'un boîtier sans GPS (→ écart ≤ 2 min) ;
verrou relâché pour une autre surface (→ jeton) ; fenêtre confinée sur la carte (→ racine du document) ; messages inexacts.
Un défaut de ma propre correction, trouvé par les tests : le voile déplacé à la racine n'était pas retiré à la destruction du
bouton (→ retiré explicitement).
Non retenu : durée du constat > 24 h (voir ci-dessus) ; compte système requis (repli sur l'auteur de la coupure conservé).

## 5 quater. Seconde relecture (synchronisation manuelle) — 11 constats, traités sauf un

Corrigés : un véhicule qui a BOUGÉ depuis l'ordre ne peut plus être synchronisé (renvoyer `stop` l'immobiliserait) ;
**réservation atomique** avant tout envoi (deux onglets = un seul message) ; **course** avec une remise en route (relecture
APRÈS l'écriture : coupure remplacée ou demande plus récente → message rappelé, 409) ; l'écran désigne la coupure visée
(`commandId`, 409 si une autre l'a remplacée) et revérifie avant d'envoyer ; un « Stop engine Succeed » reçu APRÈS une
remise en route lève une alerte CRITICAL (véhicule probablement re-coupé par un message en retard) ; la fenêtre affiche
« synchronisation en cours » (et non « non confirmée ») juste après une synchronisation ; pas de fermeture automatique pendant
l'envoi ; « Annuler » depuis l'écran du véhicule referme la fenêtre ; l'icône de messagerie et tout texte nommant le canal
sont retirés (y compris des textes existants : bloc « boîtier muet », toasts).

⚠️ **À TRANCHER — non modifié** : quand la socket TCP du boîtier est absente au moment de l'ordre, une coupure (manuelle ET
planning) part encore par SMS, avec une validité de 15 min (`dispatchCommand`, branche « socket absente »). C'est le comportement
d'AVANT ce chantier (c'est ce qui permet une coupure antivol sur un boîtier hors ligne) ; il contredit l'esprit de la consigne « pas
de SMS par économie ». Le retirer pour la coupure du planning est une ligne ; pour la coupure manuelle, ce serait supprimer
l'antivol hors ligne.

## 6. Déploiement

API + web, via `deploy/vps/deploy.sh` (jamais entre 05:30 et 09:00, jamais autour de HH:45). Aucune migration.
Relecture contradictoire du correctif par un sous-agent AVANT fusion (règle du coupe-circuit).
