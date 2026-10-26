# Espace veilleur — incident du 06/10/2026 (HM-733-GA) et refonte complète

> **Statut : dossier de travail. Rien n'est corrigé.** Écrit le 06/10/2026 au soir, à partir de
> mesures faites en production en **lecture seule** (base, journaux de l'API, code de `origin/main`
> = `80d09cc2`).
>
> **La correction et la refonte se font dans un autre chat**, avec le prompt
> [`01-PROMPT-AUTRE-CHAT.md`](./01-PROMPT-AUTRE-CHAT.md). La recette en prod se fait sur la société
> **« Client test »**, jamais en écriture sur cdef31.
>
> Exigence du propriétaire : *« On prend le temps de faire les choses correctement pour que ça ne se
> reproduise plus. »* Les veilleurs utilisent cet espace toutes les nuits : il doit être **le plus
> rapide et le plus fiable possible**.

---

## 0. À faire tout de suite, hors code (avant le 07/10 à 22:00)

1. **Le planning de HM-733-GA est GELÉ** (`overrideUntil = 9999-12-31 23:59:59`, « tenu jusqu'au
   rallumage manuel »). Chaque clic « couper » du veilleur a posé ce gel, et le rallumage par SMS
   manuel, fait hors de Tracky, ne l'a pas levé. **Sans intervention, HM-733-GA ne sera plus coupé à
   22:00, ni demain ni les soirs suivants.** C'est le seul véhicule dans ce cas (vérifié sur toutes
   les sociétés).
   - **Le 07/10, en journée (entre 07:00 et 22:00)** : page Horaires → ligne HM-733-GA →
     **« Réactiver »**. Le planificateur envoie un rallumage, sans effet sur un véhicule qui tourne,
     puis le véhicule est coupé normalement à 22:00.
   - ⛔ **Jamais de nuit** : « Réactiver » applique la transition due dans la minute. Hors plage,
     c'est une **coupe**, pendant qu'un veilleur roule peut-être avec le véhicule.
   - Le bouton « Rallumer » ne lève pas le gel aujourd'hui : il est grisé, à cause du défaut C1
     ci-dessous.
2. **L'état affiché de HM-733-GA est faux** : « coupure non confirmée » alors qu'il roule. Tracky
   n'a pas pris en compte le SMS manuel (C6). L'affichage se corrigera au prochain rallumage passé
   par Tracky (point 1).

---

## 1. L'incident, minute par minute (heure de Paris, 06/10/2026)

| Heure | Fait mesuré | Source |
|---|---|---|
| 22:05:20 | Coupure **horaire** de HM-733-GA (cdef31, plage 07:00–22:00, boîtier 403C, IMEI `<IMEI masqué>`), partie en TCP. **Pas d'accusé en 15 s** (`TIMED_OUT`), **aucun SMS de secours** (`smsAttemptCount` 0) : la commande reste `SENT`. Le boîtier l'a pourtant **exécutée** : le véhicule ne démarre plus. | `engine_control_commands`, `engine_delivery_attempts` |
| 22:11:38 → 22:12:10 | La connexion TCP du boîtier tombe puis revient. | journal de l'API |
| 22:15 → 22:25 | Contact mis (ignition `true`), vitesse 0 : le veilleur essaie de démarrer. | `positions` |
| 22:16:25 | Le même veilleur rallume GR-294-VW **sans problème** : la coupure de ce véhicule-là était accusée, et l'accusé de rallumage arrive en 515 ms. | journal, commandes |
| 22:19:55, 22:20:01, 22:20:41, 22:22:08 | **4 POST « couper »** du veilleur `le compte « Emu CDEF31 »` (rôle `NIGHT_WATCHMAN`) sur HM-733-GA, **tous en 201**. L'API renvoie la coupure déjà en vol (collision de `activeKey`) ; rien ne part vers le boîtier. Chaque requête écrit `Watchman cut — schedule held until manual restore`. | journal de l'API |
| 22:20 → 22:22 | Côté écran : 7 clics « Veilleur HM-733-GA — couper », chacun suivi de « Fermer la notification ». **Aucun clic « rallumer » possible.** Sur la même période, **166 réponses 403** à `GET /api/vehicles/:id/schedule` (22:15 → 22:23) : autant de messages « Action impossible » possibles à l'écran. | `user_activities`, journal de l'API |
| 22:22:42 | Appui sur la **ligne d'urgence WhatsApp** depuis la liste des véhicules. Tracé : centre d'activité (`URGENCE_WHATSAPP`), journal système (`ASSISTANCE`, avec l'e-mail du veilleur), push aux super-admins. | `system_activity_logs`, `notification_deliveries` |
| 22:23 → 22:27 | Messages WhatsApp (« le véhicule ne démarre pas », « pouvez-vous le débloquer ») ; le propriétaire demande e-mail, nom et groupe. | capture du propriétaire |
| ≈ 22:25 | **Rallumage par SMS manuel** (hors de Tracky). Tracky reçoit la réponse du boîtier « Resume engine Succeed » à 22:25:59, en SMS entrant, **sans la traiter comme un rallumage**. | `sms_logs` |
| 22:25 → | Le véhicule roule (jusqu'à 47 km/h). | `positions` |
| 22:40:00 | La coupure passe `SENT_UNCONFIRMED` (fin de vie à 30 min) : l'écran dit désormais « coupure non confirmée » pour un véhicule qui roule. | commandes |

**La veille (05/10)** : même véhicule, même veilleur. La coupure de 22:05 avait été **accusée** (par
SMS), donc l'écran a proposé « Rallumer », et le veilleur a rallumé seul à 22:34 (accusé TCP en 2 s).
Il a eu besoin de ce véhicule **après 22:00 deux soirs de suite**.

**Ce qui n'a PAS été en cause** : le boîtier (il a exécuté la coupure puis le rallumage par SMS), le
réseau (connexion revenue en 32 s), le planning (il a coupé à l'heure dite). Ce soir-là, 21 coupures
de la société ont été accusées ; une seule ne l'a pas été.

---

## 2. Ce qui a fait défaut — huit causes, toutes vérifiées

### C1 — 🔴 L'écran n'offre pas « Rallumer » quand la coupure n'est pas accusée (cause directe)

`apps/web/src/app/features/engine-control/engine-control-button.component.ts`, `isCutActive()` :
- **quand la liste des commandes est servie**, « coupé » veut dire « dernière CUT `ACKNOWLEDGED` plus
  récente que le dernier RESTORE `ACKNOWLEDGED` ». Une CUT `SENT` ou `SENT_UNCONFIRMED` ne compte
  pas ;
- l'écran affiche alors **« Moteur actif »**, **« Rallumer » grisé** (« Le moteur n'est pas coupé. »)
  et **« Couper » actif** ;
- le correctif de ce piège exact (« coupé OU en attente → proposer Rallumer ») n'existe que dans la
  branche **« liste vide »**, qui était celle du veilleur jusqu'au 24/09 ;
- **C7 (24/09) a servi la liste au veilleur** : il est passé dans l'autre branche, et le piège s'est
  rouvert. Le commentaire de `etatMoteur` (« tous rôles sauf le veilleur ») est faux depuis.

⚠️ Le défaut touche **tous les rôles** : un administrateur voit lui aussi « Rallumer » grisé sur une
coupure non accusée. Il n'a donc pas pu servir de recours ce soir-là.

### C2 — 🔴 L'API dit « succès » à un clic qui ne fait rien, et gèle le planning à chaque fois

`apps/api/src/engine-control/engine-control.service.ts` :
- une CUT demandée alors qu'une CUT est déjà en vol tombe sur la contrainte unique `activeKey`.
  L'API **renvoie la commande existante en 201** ;
- l'écran affiche alors **« Coupure déjà en cours — Commande xxxxxxxx créée à 22:05 — toujours en
  attente de confirmation du boîtier. »** (info, 9 s ; sous 60 s, le même message qu'une commande
  neuve). Ce message ne dit à aucun moment comment rallumer ;
- un 409 explicite n'existe que pour une CUT `PENDING`, ou `SENT` avec `confirmationExpected`, de
  moins de 90 s ;
- le **gel du planning par le veilleur** (`overrideUntil = WATCHMAN_HOLD_UNTIL`) est écrit **avant**
  la création de la commande. Il est donc posé à chaque clic, **même quand aucune commande n'est
  créée**.

### C3 — 🟠 Une coupure non accusée est un état NORMAL côté serveur, pas une exception

Même fichier (bloc « V1.15 », après un `ACK timeout`) : une CUT livrée en TCP sans accusé **reste
`SENT`** par conception. Le Coban exécute sans écho fiable, et la seule preuve serait l'ignition de la
trame suivante. Il n'y a **pas de SMS de secours pour une CUT**, et la sentinelle de confirmation ne
vaut que si `confirmationExpected`.

Conséquence : l'état « coupure envoyée, non prouvée » arrivera encore, et l'écran **doit** le traiter
comme un état de premier rang. Le serveur le considère « livré », l'écran le considère « inexistant » :
c'est cette contradiction qu'il faut fermer.

### C4 — 🟠 Aucune alerte pour un veilleur qui s'acharne sans effet

`signalerAcharnement()` (seuil 4 commandes en 10 min) ne compte que les commandes **réellement
créées**. Les 4 clics renvoyés par collision n'ont rien compté : aucune ligne au centre d'alerte,
aucun push. Or « des clics répétés qui ne produisent rien » est précisément le signal d'un écran qui
ment, celui que l'alerte avait été créée pour attraper (incident CDEF31 du 24/09).

### C5 — 🟠 Le push d'urgence est parti, mais comme une notification ordinaire

`notification_deliveries` / `push_logs`, 22:22:42 :

| Destinataire | Résultat |
|---|---|
| `le compte administrateur` | iPhone Safari + Windows Chrome : 2 envoyés, 2 acceptés (HTTP 201) |
| `un veilleur (Android Chrome)` | Android Chrome : 1 envoyé (appareil vu pour la dernière fois le 29/09) |
| `un second veilleur` | supprimé : push désactivé dans ses préférences |
| `system@tracky.local` | échec `no_device` : un compte système ne devrait pas être destinataire |

L'envoi part bien avec `urgency: 'high'` et `TTL: 86400`. Mais la notification n'est pas
`CRITICAL`, donc ni `requireInteraction`, ni `renotify`, ni vibration longue (`apps/web/public/sw.js`,
`web-push.service.ts`).

Et le compte propriétaire a reçu **123 pushs de routine en 3 jours** (51 `alert`, 72
`system_notice`) : l'urgence s'est noyée dans le bruit.

À vérifier sur l'iPhone : notifications de l'application installée, mode Concentration.

### C6 — 🟠 Un rallumage par SMS fait hors de Tracky laisse un état faux

Tracky a reçu « Resume engine Succeed » (SMS entrant, 22:25:59) mais ne l'a pas appliqué comme
**état observé**. Conséquences : un état affiché faux (« coupure non confirmée » sur un véhicule qui
roule) et un gel du planning jamais levé (voir § 0).

⚠️ Toute prise en compte d'un SMS entrant doit vérifier qu'il vient **du numéro de la SIM du
boîtier**. Sinon, n'importe qui pourrait fabriquer un faux état.

### C7 — 🟢 L'assistance ne relie pas le WhatsApp au compte

Le compte `le compte « Emu CDEF31 »` (« Emu CDEF31 », veilleur, cdef31) **n'a pas de téléphone**, alors que ses
WhatsApp viennent du <numéro masqué>. Le propriétaire a dû demander e-mail, nom et groupe, alors
que la trace de la ligne d'urgence les donnait déjà.

### C8 — 🔴 L'écran du veilleur se remplit de messages d'erreur, à chaque chargement

Chaque bouton moteur appelle `GET /api/vehicles/:id/schedule` à son affichage, puis à chaque clic
« Couper » ou « Rallumer » (`engine-control-button.component.ts` l.926-929, 946-952, 1060-1070).
- Le veilleur n'a pas `schedules_manage` : le compte d'EMU l'a explicitement à `false`, et c'est le
  défaut du rôle. La route répond donc **403** (`vehicle-schedules.controller.ts` l.34-36).
- Chaque 403 déclenche un message **« Action impossible — Vous n'avez pas l'autorisation de
  consulter ces données. »** (`auth.interceptor.ts` l.257-258), dans la limite de 3 visibles à la
  fois.
- **Mesuré : 166 réponses 403 entre 22:15 et 22:23.** C'est l'origine des 42 fermetures de
  notifications en 7 jours (ci-dessous). Pendant l'urgence, l'écran était saturé d'erreurs qui
  n'avaient rien à voir avec le problème.
- Cette rafale pèse aussi sur la limite globale de 100 requêtes par minute (voir annexe A).

### Observations d'usage (7 derniers jours, compte veilleur)

- **42 clics pour fermer des notifications** (31 « Fermer toutes les notifications », 11 « Fermer la
  notification ») : le veilleur passe son temps à faire taire les « Action impossible » de C8.
- L'onglet **Assistance** (conversation d'aide) n'a **jamais** été ouvert ; la ligne d'urgence
  WhatsApp a été utilisée une fois (ce soir-là).
- Usage réel : la liste des véhicules (`/vehicles`), la recherche (17 fois), « rallumer » sur
  plusieurs véhicules, une vue par groupe (« ARC EN CIEL ») une seule fois.
- Il n'y a **qu'un seul compte veilleur** en production (`le compte « Emu CDEF31 »`). cdef31 compte 30
  véhicules, dont 7 déclarés hors service (immobilisés, boîtier débranché).

---

## 3. Corrections attendues (P0 = avant toute autre chose)

| # | Correction | Critère d'acceptation |
|---|---|---|
| **P0-1** | **Un seul modèle d'état du moteur**, partagé (`packages/shared`), utilisé par tous les écrans et tous les rôles, avec ou sans liste de commandes : *coupé (accusé)*, *coupure envoyée non accusée*, *rallumage en cours*, *actif*. Une CUT non accusée plus récente que le dernier RESTORE accusé ⇒ **« Rallumer » actif**, « Couper » grisé avec sa raison. Rallumer est toujours sûr : l'API supplante toute CUT en vol. | Tests qui rejouent la séquence du 06/10 (CUT `SENT` puis `SENT_UNCONFIRMED`) et celles du 24/09 ; mêmes boutons dans les deux branches ; plus aucun commentaire qui contredit le code. |
| **P0-2** | **API honnête** : une CUT sur une CUT déjà en vol renvoie un état explicite (« déjà en cours, en attente du boîtier »), pas un succès silencieux. Le **gel du planning par le veilleur n'est posé que si une commande est réellement créée**. | Test d'intégration : 4 POST sur une CUT en vol ⇒ un seul gel, une réponse « déjà en cours » lisible, un message à l'écran qui dit quoi faire. |
| **P0-3** | **Alerte « veilleur bloqué »** : N clics sans effet (collision, refus) sur le même véhicule en quelques minutes ⇒ ligne `CRITICAL` au centre d'alerte + push critique aux super-admins. | Test unitaire de la série ; vérification en recette. |
| **P0-4** | **Push d'urgence `CRITICAL`** : `requireInteraction`, `renotify`, vibration longue, `tag` unique par appui. Exclure les comptes système des destinataires. | Envoi constaté sur l'iPhone et le Chrome du propriétaire, en recette. |
| **P0-5** | **Levée du gel et état juste après un rallumage hors Tracky** : traiter « Resume engine Succeed » (et la réponse de coupure) venant du **numéro de la SIM du boîtier** comme état observé (`DEVICE_OBSERVED`), et lever le gel du veilleur. | Test : SMS entrant authentique ⇒ état « actif », gel levé ; SMS d'un autre numéro ⇒ ignoré et tracé. |
| **P0-6** | **Plus aucune requête vouée au refus** : ne jamais appeler `GET /vehicles/:id/schedule` sans `schedules_manage`. Une lecture de fond refusée ne produit **jamais** de message à l'écran ; seule une action de l'utilisateur en produit, avec sa vraie raison. | Recette : un chargement de la liste veilleur ⇒ 0 réponse 403 dans le journal, 0 message « Action impossible ». |
| P1-1 | **Moins de bruit**, côté super-admin : réduire les 123 pushs de routine en 3 jours, pour que l'urgence ne s'y noie plus. | Inventaire des pushs par modèle ; décision du propriétaire. |
| P1-2 | **Relier le WhatsApp au compte** : téléphone du veilleur sur son compte, affiché dans la trace d'urgence et dans l'écran de réponse admin. | La trace montre nom, e-mail, société, téléphone. |
| P1-3 | **Accusé de coupure** : pourquoi aucune preuve pour une CUT TCP (403C) ; confirmation par l'ignition de la trame suivante (« amélioration future » écrite en V1.15) ? | Étude chiffrée sur 30 jours : part des CUT restées `SENT`. |

---

## 4. Refonte complète de l'espace veilleur

> Demande du propriétaire : *« une refonte complète de tout l'espace veilleur — le top du top, car
> ils l'utilisent beaucoup. Le plus rapide et efficace possible pour Emu : tous les filtres doivent
> fonctionner, les vues par groupe, l'onglet Assistance, plus aucun bug d'affichage. Tout revoir et
> tout fiabiliser, notamment bien afficher les voitures qui sont en maintenance, au garage, etc. »*

**L'état actuel (cartographie du code) est en annexe A.** En résumé : le veilleur n'a qu'**une
page**, `/vehicles` ; il ne contrôle que la **recherche** ; il ne voit que l'état du moteur et
« boîtier muet » ; l'**Assistance lui est fermée** ; la page fait **2 requêtes par véhicule**.

Exigences :

1. **Rapidité.**
   - La liste charge véhicules, états et dernières commandes en **une ou deux requêtes**, pas deux
     par ligne. Aujourd'hui, une flotte de 40 véhicules coûte environ 81 requêtes, avec un 429
     probable vers 50 véhicules (limite globale de 100 par minute).
   - Replier un groupe ou chercher ne relance aucune requête.
   - Pas de squelette quand l'onglet revient au premier plan.
2. **Un état par véhicule, dit en toutes lettres** : le modèle unique de P0-1, plus les états
   **aujourd'hui invisibles au veilleur** :
   - déclarés (immobilisé / au garage / à l'atelier, accidenté, boîtier débranché) ;
   - maintenance ou incident de l'agenda ;
   - zone « Garage » ;
   - GPS perdu, hors ligne ;
   - « coupes auto suspendues ».

   Un véhicule indisponible le dit, avec depuis quand et pourquoi. Couper un véhicule déclaré
   indisponible demande au minimum un avertissement, à trancher avec le propriétaire.
3. **Deux boutons fixes** (« Couper » / « Rallumer »).
   - Celui qui ne s'applique pas est grisé **avec sa raison**.
   - Après chaque geste, un retour clair : envoyé, accusé, non accusé, refusé avec son motif. Un seul
     message, jamais deux (aujourd'hui, une coupe refusée en produit deux).
   - La fenêtre de confirmation décrit le **vrai** véhicule. Elle dit aujourd'hui toujours « à
     l'arrêt, contact mis » et promet une libération du planning que le serveur n'applique pas au
     veilleur.
4. **Filtres qui marchent tous, accessibles au veilleur** :
   - par groupe, par état (coupés, coupure non confirmée, indisponibles, muets) ;
   - recherche par plaque ;
   - tri utile la nuit : coupés d'abord, puis états incertains.

   Plus de filtre caché (`?etat=indisponibles` filtre en silence, « Réinitialiser » ne l'enlève
   pas) ni de lien mort (`?group=` est sans effet). Le compteur affiche ce qui est réellement montré.
5. **Onglet Assistance pour le veilleur** (route aujourd'hui bloquée, `app.routes.ts` l.338-349) :
   - la ligne d'urgence en évidence, avec la **plaque transmise** (aujourd'hui, champ vide) ;
   - la fiche d'urgence de nuit ;
   - ce que l'astreinte reçoit ;
   - un formulaire simple, sans IA si le propriétaire le décide.
6. **Plus aucun défaut d'affichage ni de navigation.**
   - Une erreur de chargement n'est **jamais** affichée comme « Aucun véhicule accessible » : il faut
     un bouton « Réessayer ».
   - « Horaires flotte » est atteignable sur téléphone.
   - Aucune entrée de menu ne mène à une route bloquée (« Couverture vie privée »).
   - Le logo et l'assistant d'accueil ne mènent plus à `/dashboard`.
   - La plaque ne ressemble plus à un lien mort.
   - Règle tactile respectée, icônes SVG (jamais d'emoji), du téléphone (375 px) à l'ordinateur, en
     clair et en sombre.
7. **Fiabilité.**
   - Indicateur de connexion temps réel.
   - Après une reconnexion, recharger aussi les commandes et l'état « en mouvement ».
   - Même règle que le serveur pour l'état coupé (dernière ligne par action, sans
     `DEVICE_OBSERVED` ; aujourd'hui, fenêtre de 5 commandes).
   - Aucun bouton qui dépende d'un seul canal.
   - Tests de non-régression pour chaque piège connu (24/09, 06/10), une spec pour la garde du
     veilleur, et une pour la branche veilleur de la liste.
8. **Sécurité, « zéro donnée » réellement appliqué côté serveur.** Aujourd'hui, le veilleur
   reçoit :
   - IMEI, SIM, positions et conducteur (`GET /vehicles`, snapshot) ;
   - les événements de **toute** la flotte par le WebSocket, quel que soit son périmètre ;
   - la ligne complète d'une commande d'un autre utilisateur, `reason` compris, sur une collision
     201.

   À réduire au strict nécessaire, avec tests.

---

## 5. Recette en production sur « Client test »

**Ce qui existe** : la société « Client test » a **un seul compte** (le propriétaire, FLEET_ADMIN) et
**8 véhicules TEST-001-XX à TEST-008-XX, sans boîtier**.

**Contraintes** :
- Tracky ne stocke aucun mot de passe : l'authentification est déléguée à Vizyo Auth. Un agent ne
  peut ni créer un compte ni « se connecter en tant que ».
- Jamais d'écriture sur cdef31.
- **Aucun courriel à CDEF31** (phase de test).

**À préparer par le propriétaire** :
1. Un **compte veilleur sur « Client test »** (invitation Tracky + Vizyo Auth), auquel le propriétaire
   se connecte lui-même sur un téléphone.
2. Un **boîtier réel** sur un véhicule TEST : le boîtier de banc 403C (`docs/prompts/bench-403c.md`).
   Sans lui, la coupe et le rallumage ne se testent pas pour de vrai.
3. L'iPhone du propriétaire, pour constater le push critique.

**Scénarios minimum** :
1. Coupe accusée ⇒ « Moteur coupé », « Rallumer » actif ⇒ rallumage accusé.
2. **Coupe non accusée** (couper la connexion du boîtier au bon moment, ou une CUT restée `SENT`) ⇒
   « Coupure non confirmée », « Rallumer » actif ⇒ rallumage effectif.
3. Clics répétés sur une coupure en vol ⇒ message « déjà en cours », un seul gel, alerte « veilleur
   bloqué ».
4. Ligne d'urgence ⇒ push critique reçu sur l'iPhone ; trace complète (nom, e-mail, société,
   téléphone).
5. Rallumage par SMS manuel depuis la SIM ⇒ état « actif », gel levé.
6. Liste du veilleur : tous les filtres, les groupes, chaque état déclaré (maintenance, garage,
   immobilisé, débranché, muet), à 375 px et sur ordinateur, en clair et en sombre.

**Déploiement** : `deploy.sh --attendre` uniquement, jamais entre 05:30 et 09:00, ni entre HH:42 et
HH:46.

---

## 6. Coordination avec les autres chantiers

- Le commit `b0f9e066` (« trois contrôles rouges sur main », élément E3 de
  [`docs/menage-depot-2026-10/00-ELEMENTS-GARDES.md`](../menage-depot-2026-10/00-ELEMENTS-GARDES.md))
  modifie **aussi** `engine-control-button.component.ts` et `urgence-vehicule.component.ts` (couleur
  de la pastille « Coupure non confirmée » : rouge → ambre). Le premier qui arrive sur `main` gagne,
  l'autre se rebase.
- Le plan des éléments gardés (E1 à E14) est exécuté dans la session d'origine.
- Mémoire : `tracky_incident_veilleur_coupure_non_confirmee.md`.

---

## Annexe A — Cartographie de l'espace veilleur (code de `origin/main` @ `80d09cc2`)

Chemins relatifs à la racine du dépôt ; `l.` = ligne.

### A.1 Accès et navigation

- **Rôle** : `isWatchman = role === 'NIGHT_WATCHMAN'` (`apps/web/src/app/core/services/auth.service.ts` l.79-80).
- **Garde** `watchmanChildGuard` (`core/guards/watchman.guard.ts` l.23-39), en `canActivateChild` sur le layout (`app.routes.ts` l.127-129) :
  - autorise le chemin exact `/vehicles`, et `/fleet-schedules` si `schedules_manage` ;
  - tout le reste est renvoyé vers `/vehicles` ;
  - **aucun spec**.
- **Bloquées** : `/vehicles/:id`, `/account`, `/settings`, `/dashboard`, `/assistance` (exclusion voulue, l.342-344).
- **Menu** (`dashboard-layout.component.ts` l.1296-1311) :
  - « Véhicules », plus « Horaires flotte » si `schedules_manage` ;
  - plus « Couverture vie privée » vers une route bloquée.
- **Téléphone** : barre du bas « Véhicules » seule, ni burger ni barre latérale (l.1146-1150, 220-228, 905-906). « Horaires flotte » y est **inatteignable**.
- **Liens qui mènent à `/dashboard`** : le logo (l.235) et la fin de l'assistant d'accueil (`onboarding-wizard.component.ts` l.480).
- **Boucle possible** : `permissionGuard` redirige vers `/dashboard`, que la garde du veilleur renvoie vers `/vehicles` (si `vehicles_view` est faux).

### A.2 La liste (`apps/web/src/app/features/vehicles/vehicles-list.component.ts`)

- **Branche veilleur** l.57-162 : en-tête + compteur, bandeau WhatsApp, recherche, accordéon par groupe. Chaque ligne affiche logo, type, plaque, marque et modèle, puis le bouton moteur ou « Pas de boîtier ».
- **Absents** : statut, connectivité, badges d'état, conducteur, position, filtres.
- **Recherche** (l.1328-1334) : porte sur plaque, marque, modèle et IMEI. Le placeholder n'annonce que plaque et marque.
- **Filtres internes** (l.1322-1340) : `groupFilter`, `statutFiltre`, `indisponiblesSeuls`.
  - Le veilleur ne contrôle que la recherche.
  - `?etat=indisponibles` filtre en silence (l.1525). Le compteur affiche alors le total (l.69), et « Réinitialiser » ne vide que la recherche (l.112).
- **Groupes** (l.1363-1379) : « Sans groupe » d'abord, puis ordre alphabétique.
  - Le repli est gardé en mémoire seulement.
  - `?group=` est sans effet : les ids `vg-…` n'existent que dans la vue non-veilleur (l.425, 1933-1940).
- **Tri** : aucun. L'ordre est celui de l'API (`createdAt desc`).
- **Pagination** : `list()` enchaîne les pages de 50, jusqu'à 2 000 véhicules (commit `c2128f1d` du 05/10). Toutes les lignes sont rendues, sans virtualisation.
- **Requêtes par chargement** : ≈ (⌊N/50⌋+1) + **2T** (+1), avec T = véhicules équipés d'un boîtier :
  - `GET /engine-control/commands?limit=5` et `GET /vehicles/:id/schedule` (403 pour le veilleur, C8), par bouton ;
  - jusqu'à 3 tentatives par requête ;
  - tout recommence à chaque repli/dépli ou recherche.
- **Limite globale** : 100 requêtes par minute (`app.module.ts` l.95).
- **Erreur de chargement** : `chargementEnErreur` est ignoré dans la branche veilleur, qui affiche « Aucun véhicule accessible » sans réessai (l.85-93 contre 1397-1401, 1926).
- **Temps réel**
  - Le veilleur rejoint `ops:fleet:<flotte>` et reçoit les événements moteur, statut et mouvement de **toute** la flotte (`realtime.gateway.ts` l.228-234, 283-296).
  - Les entrées de `engineCommandUpdates` ne sont jamais purgées pour lui (`realtime.service.ts` l.819-830).
  - Aucun rechargement périodique de `/vehicles` ni de `/commands`.

### A.3 Le bouton moteur (`apps/web/src/app/features/engine-control/engine-control-button.component.ts`)

- **`isCutActive`** l.413-454 (voir C1) :
  - liste vide : `cutActiveTrackerIds ∪ cutPendingTrackerIds` ;
  - sinon : dernier CUT `ACKNOWLEDGED` plus récent que le dernier RESTORE `ACKNOWLEDGED`, sur les **5 dernières commandes**, `DEVICE_OBSERVED` compris.
- **Règle du serveur, à trois états** : `etatCoupeParTracker` (API `vehicles.service.ts` l.1180-1221) prend la dernière ligne par action, sans `DEVICE_OBSERVED`. **Un CUT `SENT` y vaut `pending`.**
- **Calculs dérivés** : `etatMoteur` l.772-776 ; `canCut` l.694-753 (veilleur : refus si en mouvement) ; `canRestore` l.755-759 ; `peutCouperMaintenant` / `peutRallumerMaintenant` l.791-796.
- **Envoi** (`onConfirm`, l.954-1058) :
  - toast « Coupure déjà en cours » si la commande renvoyée a plus de 60 s (l.997-1012) ;
  - sinon, le même toast qu'une commande neuve (l.1029-1038).
- **Fenêtre de coupure** : `etatVehicule` (l.849-861) affiche toujours « à l'arrêt, contact mis · position non confirmée » ; la case « immobilisation durable » est hors sujet pour le veilleur (l.218-232, 863-896).
- **Règles du serveur pour le veilleur** (`engine-control.service.ts`) :
  - CUT refusé au-dessus de 5 km/h, ou après une trame au-dessus de 5 km/h dans les 120 dernières secondes (l.1030-1063) ;
  - un CUT du veilleur suspend le planning sans fin (l.1106-1114), **écrit avant le `create`**, donc aussi sur une collision ;
  - acharnement compté seulement à la création (l.1193-1204).

### A.4 États montrés au veilleur

| État | Montré ? |
|---|---|
| Moteur (coupé / non confirmé / actif) | **Oui** — le seul état affiché |
| Boîtier muet (72 h) | **Oui**, dans le bouton seulement (l.93-95, 113-122) |
| Sans boîtier | **Oui** (« Pas de boîtier ») |
| En mouvement | **Indirect** : « Couper » grisé avec sa raison |
| Déclaré : immobilisé (« au garage, à l'atelier »), accidenté, boîtier débranché (`packages/shared/src/utils/etat-vehicule.ts`, `hors-service.ts`) | **Non** |
| Maintenance / incident d'agenda (`immobilisationAgenda`) | **Non** |
| Zone « Garage » (« Garage — Aucamville » chez cdef31), stationnement présumé | **Non** |
| GPS perdu, hors ligne, recherche GPS | **Non** |
| `coupesAutoSuspendues` | **Non**, et la coupe manuelle ne lit aucun état d'indisponibilité |

### A.5 Assistance

- **Bandeau WhatsApp** (`shared/ui/urgence-vehicule.component.ts` l.42-50) :
  - texte « Véhicule bloqué ? WhatsApp … — assistance 24 h/24 » ;
  - **sans plaque** ;
  - `POST /api/assistance/urgence/whatsapp {ecran:'vehicules'}` sans attendre la réponse.
- La fiche d'urgence imprimable n'apparaît que dans la variante « complet » (l.84-98).
- **API** : `assistance.controller.ts` l.107-116, sans `@Roles`, limite 10 par minute ; traces et push dans `assistance.service.ts` l.538-608.
- **Page « Assistance »** : bloquée et absente du menu du veilleur. Ses routes API lui restent pourtant ouvertes (`assistance.roles.spec.ts`).

### A.6 Droits

- **Défauts du rôle** (`packages/shared/src/permissions/permissions.ts` l.345-398) : seuls `vehicles_view` et `engine_control`. `schedules_manage` est l'interrupteur prévu pour ce rôle.
- **Le compte d'EMU** : exactement ces deux droits (`schedules_manage: false`, vérifié en base).
- **Vue restreinte** : `listCommands` ne retire que `reason` (l.2972-2981). La réponse du POST n'est pas caviardée.
- **Côté client** : repli sur `user.permissions` brut. **Côté serveur** : fusion avec les défauts du rôle. Les deux peuvent diverger.

### A.7 Tests existants

- **API** :
  - `apps/api/src/auth/night-watchman.security.spec.ts` (droits, périmètre, routes) ;
  - `engine-control.service.spec.ts` (règles du veilleur, gel, acharnement du 24/09) ;
  - `realtime/live-split.spec.ts`.
- **Web** :
  - `engine-control-button.component.spec.ts`, joué en veilleur ;
  - `realtime.service.spec.ts` ;
  - `urgence-vehicule.component.spec.ts`.
- **Non testés** :
  - les toasts de `onConfirm` ;
  - le 201 sur collision ;
  - le 403 sur `/schedule` ;
  - un CUT `SENT` avec la liste servie (le cas du 06/10) ;
  - la garde du veilleur ;
  - la branche veilleur de la liste ;
  - aucun test de bout en bout du veilleur.

### A.8 Commentaires périmés à corriger avec le code

| Fichier | Ce que dit le commentaire | La réalité |
|---|---|---|
| `vehicles-list.component.ts` l.59-63 | pas de recherche ni de détail | les deux existent |
| `engine-control-button.component.ts` l.166-167 | le veilleur ne peut pas couper | faux |
| `engine-control-button.component.ts` l.651 et 713-714 | aucune donnée de position servie | des positions sont servies |
| `engine-control-button.component.ts` l.768-770 | « tous rôles sauf le veilleur » | périmé depuis C7 |
| `engine-control.service.ts` l.65-66 | « grâce 1h » | c'est jusqu'à la prochaine bascule |
| `tracky-knowledge.ts` l.282-283 et 459-460 | règles du planning | fausses si le veilleur a `schedules_manage` |
| plusieurs fichiers | « 403 sur `/commands` » | périmé depuis C7 |

Le correctif C1…C7 du 24/09 est détaillé dans
`docs/fiabilite-coupe-circuit-2026-09/37-INCIDENT-CDEF31-2026-09-24-…md` (l.204-216).
