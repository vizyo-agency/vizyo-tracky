import { swallow } from '../../core/error/swallow';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CircleCheck, LoaderCircle, LucideAngularModule, Power, PowerOff, TriangleAlert } from 'lucide-angular';
import {
  DORMANT_STOP_ACTING_MS,
  formatSilenceLabel,
  trackerSilenceMs,
} from '@vizyo/tracky-shared';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DemoModeService } from '../../core/services/demo-mode.service';
import {
  EngineControlService,
  type EngineControlCommandDto,
} from '../../core/services/engine-control.service';
import { EngineCommandLockService } from '../../core/services/engine-command-lock.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { VehicleSchedulesApiService } from '../../core/services/vehicle-schedules.service';
import { ConfirmModalComponent } from '../../shared/ui/confirm-modal/confirm-modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

/** Sprint 2 — fenêtre d'attente de confirmation côté UI (aligne le défaut backend 90s). */
const CONFIRM_WINDOW_MS = 90_000;

/**
 * Profondeur de la liste lue pour l'état du moteur. 5 ne suffisait pas : chaque refus
 * (REJECTED_SPEED) est une ligne, et quelques clics refusés suffisaient à pousser la vraie
 * coupure hors de la fenêtre — l'écran repassait alors à « Moteur actif ». L'API plafonne à 50.
 */
const PROFONDEUR_HISTORIQUE = 20;

/**
 * Statuts d'une COUPURE qui peut avoir immobilisé le véhicule : acquittée, ou partie sans preuve
 * (en vol, ou échue « nul ne sait »). Un refus ou un échec d'envoi n'a rien coupé.
 */
const COUPE_POSSIBLE: ReadonlySet<EngineControlCommandDto['status']> = new Set([
  'PENDING',
  'SENT',
  'SENT_UNCONFIRMED',
  'ACKNOWLEDGED',
]);

/**
 * Au-delà, une coupure encore PENDING n'est plus « en vol » : elle est orpheline (T48 — le bail de
 * dispatch du serveur est de 60 s) et le serveur la renverra à la prochaine demande. « Couper »
 * doit alors rester offert, sinon il resterait grisé pour toujours.
 */
const PENDING_ORPHELINE_MS = 120_000;

/**
 * ══ LA FENÊTRE D'ATTENTE (29/10/2026) ═══════════════════════════════════════════════════════
 *
 * Après le glissement de confirmation, la modale se fermait et il ne restait qu'un toast de 8 s :
 * rien ne disait que l'ordre était parti, ni où il en était. Mesuré chez CDEF31 : onze « couper »
 * d'affilée un soir de 06/10, vingt-trois « rallumer » en six secondes une nuit de septembre. On ne
 * clique pas vingt fois sur un écran qui répond — on clique quand il ne dit rien.
 *
 * Désormais une fenêtre s'ouvre à l'instant du geste, bloque l'écran, et suit la commande jusqu'à
 * son issue : confirmée, échouée, ou « sans preuve » après SUIVI_MAX_MS. Ces durées sont celles de
 * l'API (15 s avant le secours SMS, ENGINE_ACK_TIMEOUT_MS).
 */
const SUIVI_ATTENTE_LONGUE_MS = 15_000;
/** Au-delà, la fenêtre cesse de promettre : la commande peut encore aboutir, l'écran ne l'attend plus. */
const SUIVI_MAX_MS = 150_000;
/** Délai avant de proposer « Masquer » : assez long pour ne pas inviter à fuir, assez court pour ne pas piéger. */
const SUIVI_MASQUER_APRES_MS = 10_000;
/** Succès : la fenêtre se referme seule, le temps de lire « Moteur coupé ». */
const SUIVI_FERMETURE_OK_MS = 1_800;
/** Relecture de la liste pendant le suivi : le WebSocket peut être coupé, le suivi ne doit pas en dépendre. */
const SUIVI_RELECTURE_MS = 2_000;

type SuiviPhase = 'envoi' | 'attente' | 'attente-longue' | 'sms' | 'ok' | 'echec' | 'sans-preuve';

interface SuiviVue {
  phase: SuiviPhase;
  action: 'CUT' | 'RESTORE';
  titre: string;
  message: string;
  etapes: ReadonlyArray<{ libelle: string; etat: 'fait' | 'en-cours' | 'attente' | 'erreur' }>;
  /** Issue connue (succès, échec, sans preuve) : la fenêtre n'attend plus rien. */
  terminal: boolean;
  /** Le suivi dure : on laisse sortir, la commande continue d'être suivie par l'écran. */
  peutMasquer: boolean;
  /** Une coupure sans preuve : l'utilisateur peut demander la synchronisation manuelle du boîtier. */
  peutSynchroniser: boolean;
  /** La question « Synchroniser le boîtier ? » est posée (elle remplace le suivi). */
  question: boolean;
  synchroEnCours: boolean;
  synchroErreur: string | null;
}

@Component({
  selector: 'app-engine-control-button',
  standalone: true,
  imports: [LucideAngularModule, ConfirmModalComponent, FormsModule, RouterLink],
  template: `
    <div class="ec-hote" (click)="$event.stopPropagation()">
     <!--
       C4 — DEUX BOUTONS DISTINCTS, JAMAIS UNE BASCULE (incident CDEF31 du 24/09/2026).
       Avant : un seul bouton qui changeait de sens AU MÊME PIXEL. Après un rallumage réussi il
       devenait « Couper » ; le véhicule ne démarrant pas tout seul (il faut encore tourner la
       clé), le geste naturel était de réappuyer — et l'on recoupait. Trace mesurée sur
       GS-187-NY : RESTORE, CUT, RESTORE, CUT, RESTORE, RESTORE, CUT, RESTORE en six minutes.
       Un opérateur ne se trompe pas huit fois : c'est la commande qui était piégée.
       Désormais « Couper » et « Rallumer » occupent deux places FIXES, et celui qui ne
       s'applique pas est désactivé AVEC SA RAISON — un clic de trop ne peut plus rien défaire.
     -->
     <div class="inline-flex items-center gap-1.5 shrink-0 flex-wrap">
      @if (canCut().allowed || canRestore() || isCutActive()) {
        <!--
          L'ÉTAT, ÉCRIT. Le défaut central de l'incident : l'opératrice ne pouvait pas savoir si
          le véhicule était coupé — le libellé du bouton était sa seule indication, et il
          disait l'ACTION, pas l'ÉTAT. Ici l'état est dit, toujours, avant les boutons.
        -->
        <span class="ec-etat" [class]="'ec-etat-' + etatMoteur()">
          <span class="ec-etat-pastille"></span>
          {{ etatMoteurLibelle() }}
        </span>

        <button
          (click)="peutCouperMaintenant() ? openAction('cut') : null"
          [disabled]="!peutCouperMaintenant()"
          [title]="motifCoupeIndisponible() ?? 'Immobiliser le véhicule'"
          [attr.data-track]="trackLabel() ? trackLabel() + ' — couper' : null"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          [class]="peutCouperMaintenant()
            ? 'bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30'
            : 'bg-bg-tertiary text-fg-secondary border border-border-subtle'"
        >
          <lucide-icon [img]="PowerOff" [size]="14"></lucide-icon>
          <span class="hidden sm:inline">Couper le moteur</span>
          <span class="sm:hidden">Couper</span>
        </button>

        <button
          (click)="peutRallumerMaintenant() ? openAction('restore') : null"
          [disabled]="!peutRallumerMaintenant()"
          [title]="motifRallumageIndisponible() ?? 'Lever l’immobilisation'"
          [attr.data-track]="trackLabel() ? trackLabel() + ' — rallumer' : null"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          [class]="peutRallumerMaintenant()
            ? 'bg-tracky/20 text-texte-succes border border-tracky/30 hover:bg-tracky/30'
            : 'bg-bg-tertiary text-fg-secondary border border-border-subtle'"
        >
          <lucide-icon [img]="Power" [size]="14"></lucide-icon>
          <span class="hidden sm:inline">Rallumer le moteur</span>
          <span class="sm:hidden">Rallumer</span>
        </button>

        <!-- Boîtier muet : affiché pour la coupe COMME pour le rallumage. Sur les deux
             l'opérateur doit savoir que rien ne reviendra confirmer son geste. Une
             infobulle ne suffit pas : elle n'existe pas au doigt, et le mobile est
             l'usage principal (cas réel FV-941-LZ, 89 j de silence). -->
        @if (dormantWarning(); as d) {
          <span class="ec-muet-court">Boîtier muet depuis {{ d.silence }}</span>
        }
      }
     </div>

      <!--
        LA RAISON DU REFUS SORT DE L'INFOBULLE. Elle n'y existait pas au doigt : sur un
        telephone, un bouton grise sans explication est un mur. Et c'est exactement la
        situation ou l'operateur a besoin de savoir POURQUOI — vehicule en mouvement,
        position trop ancienne, regle du veilleur.
      -->
      @if (motifBloquantAffiche(); as motif) {
        <p class="ec-refus">{{ motif }}</p>
      }
      <!-- Coupure partie sans preuve (06 et 07/10/2026) : la sortie est dite, en clair. -->
      @if (aideCoupureNonConfirmee(); as aide) {
        <p class="ec-refus ec-aide">{{ aide }}</p>
        <!-- Le bandeau rouge (ci-dessous) porte déjà ce bouton quand il est affiché. -->
        @if (peutSynchroniserEcran() && !(nonConfirmee() && !verifieSurPlace())) {
          <button type="button" class="ec-sortie" (click)="ouvrirSynchro()" [disabled]="commandLocked()">
            Synchroniser le boîtier
          </button>
        }
      }

      <!--
        BOITIER MUET, EN TROIS ETAPES NUMEROTEES. La phrase unique disait le fait sans dire
        quoi faire : l'operateur restait avec « envoi non garanti » et aucune suite.
      -->
      @if (dormantWarning(); as d) {
        <div class="ec-muet">
          <div class="ec-muet-t">Boîtier muet depuis {{ d.silence }} — l'envoi n'est pas garanti</div>
          <ol class="ec-etapes">
            <li><span class="ec-num">1</span> Envoyez quand même : le serveur tente un canal de secours.</li>
            <li><span class="ec-num">2</span> Attendez la confirmation du boîtier — {{ fenetreSecondes }} s.</li>
            <li><span class="ec-num">3</span> Sans confirmation, <strong>vérifiez le véhicule sur place</strong> : rien ne prouve la coupure.</li>
          </ol>
        </div>
      }

      <!--
        L'ETAT NON CONFIRME A TROIS SORTIES (deux hors FLEET_ADMIN / SUPER_ADMIN, cf.
        voitHistorique). C'etait un constat rouge, definitif, sans
        aucune suite : « Non confirmee » et rien d'autre — sur l'ecran ou l'on vient de
        tenter d'immobiliser un vehicule.
      -->
      @if (nonConfirmee() && !verifieSurPlace()) {
        <div class="ec-nc">
          <div class="ec-nc-t">Le boîtier n'a pas confirmé</div>
          <p class="ec-nc-p">
            La commande est partie, mais rien ne prouve qu'elle a été appliquée.
            Ne considérez pas le véhicule comme immobilisé tant que ce n'est pas vérifié.
          </p>
          <div class="ec-nc-sorties">
            <button type="button" class="ec-sortie" (click)="renvoyer()" [disabled]="commandLocked()">
              {{ commandLocked() ? 'Envoi…' : 'Renvoyer la commande' }}
            </button>
            <!-- Véhicule peut-être hors de portée du GPS : l'état affiché n'est pas fiable. Offert pour une
                 coupure seulement, une fois par commande (décision du 29/10/2026 : jamais automatique). -->
            @if (peutSynchroniserEcran()) {
              <button type="button" class="ec-sortie" (click)="ouvrirSynchro()" [disabled]="commandLocked()">
                Synchroniser le boîtier
              </button>
            }
            <!-- L'onglet Agenda est désormais l'onglet par défaut de la page : ce lien demande Moteurs.
                 Seulement pour les rôles que la route admet (voitHistorique) : ailleurs, un lien mort. -->
            @if (voitHistorique()) {
              <a class="ec-sortie" routerLink="/fleet-admin/activity" [queryParams]="{ tab: 'engine' }">Voir l'historique</a>
            }
            <button type="button" class="ec-sortie" (click)="verifieSurPlace.set(true)">
              J'ai vérifié sur place
            </button>
          </div>
        </div>
      }

      <!-- Sprint 2 — etat honnete de la derniere commande (jamais de faux succes). -->
      @if (commandState(); as st) {
        <span class="ml-2 inline-flex items-center gap-1 text-[11px] font-medium {{ st.textClass }} whitespace-nowrap"
              [title]="st.label">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {{ st.dotClass }}"></span>
          {{ st.short }}
        </span>
      }

      <!--
        NIVEAU CRITIQUE, ET SEULEMENT SUR LA COUPURE (decision du 2026-08-11).
        Couper IMMOBILISE un bien, parfois avec quelqu'un dedans, et se trompe de vehicule
        en un clic depuis une liste. Rallumer ne fait que deblocker : c'est reversible, et
        ca reste une confirmation standard. C'est la meme asymetrie que le mode veilleur,
        qui peut rallumer mais pas couper.
        Le glissement complet n'est pas une formalite : il impose un geste continu et volontaire,
        identique au doigt sur la fiche et sur la carte, sans faire apparaître le clavier.
      -->
      <app-confirm-modal
        [open]="isOpen() === 'cut'"
        title="Couper le moteur ?"
        [description]="cutDescription()"
        [consequences]="cutConsequences()"
        confirmLabel="Couper le moteur"
        cancelLabel="Annuler"
        [danger]="true"
        [critique]="true"
        [etat]="etatVehicule()"
        [slideToConfirm]="true"
        slideLabel="Glissez pour couper le moteur"
        [loading]="commandLocked()"
        (confirmed)="onConfirm('CUT')"
        (cancelled)="isOpen.set(null)"
      >
        <!--
          ENVIRONNEMENT DE DÉMONSTRATION (2026-09). Le geste est le même qu'en production, et
          c'est voulu : le prospect doit voir la vraie modale, le vrai glissement, les vrais
          états. Mais il doit lire, AVANT de cliquer, qu'aucun véhicule n'est concerné — et ce qui
          se passerait sur un vrai boîtier. Le texte dit la réalité du produit : un Coban exécute
          la commande en silence, la preuve est la chute du contact sur la trame suivante.
        -->
        @if (demo.enabled()) {
          <div class="ec-demo" role="note">
            <div class="ec-demo-t">Démonstration — véhicule simulé, aucun véhicule n'est immobilisé</div>
            <p class="ec-demo-p">
              La commande suit le circuit réel — envoi au boîtier par le même chemin qu'en production,
              exécution silencieuse, puis confirmation par la chute du contact sur la trame suivante —
              sur un boîtier simulé.
            </p>
            <p class="ec-demo-p">
              En réel : le relais coupe le circuit à l'arrêt (jamais au-delà de 20 km/h), et le véhicule
              ne redémarre qu'après un rallumage depuis Tracky.
            </p>
          </div>
        }
        <textarea
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          placeholder="Raison (ex: véhicule volé, non-paiement...)"
          maxlength="500"
          rows="2"
          class="w-full mt-3 px-3 py-2 text-sm rounded-lg bg-bg-tertiary border border-border-subtle
                 text-fg-primary placeholder:text-fg-tertiary resize-none
                 focus:outline-none focus:border-tracky"
        ></textarea>
        @if (scheduleEnabled() && canDisableSchedule()) {
          <label class="flex items-start gap-2 mt-3 text-xs text-fg-secondary cursor-pointer">
            <input
              type="checkbox"
              [ngModel]="durableImmobilize()"
              (ngModelChange)="durableImmobilize.set($event)"
              class="mt-0.5 accent-red-500 shrink-0"
            />
            <span>
              <strong>Immobilisation durable</strong> — sort du planning horaire : le véhicule
              reste coupé jusqu'à un rallumage manuel (vol, non-paiement…). Sinon, le mode horaire
              reste actif et reprend à la prochaine bascule.
            </span>
          </label>
        }
      </app-confirm-modal>

      <app-confirm-modal
        [open]="isOpen() === 'restore'"
        title="Rallumer le moteur ?"
        [description]="restoreDescription()"
        confirmLabel="Oui, rallumer"
        cancelLabel="Annuler"
        [danger]="false"
        [slideToConfirm]="true"
        slideLabel="Glissez pour rallumer le moteur"
        [loading]="commandLocked()"
        (confirmed)="onConfirm('RESTORE')"
        (cancelled)="isOpen.set(null)"
      >
        @if (demo.enabled()) {
          <div class="ec-demo" role="note">
            <div class="ec-demo-t">Démonstration — rallumage simulé</div>
            <p class="ec-demo-p">
              Sur un vrai boîtier, le véhicule peut redémarrer dès réception de la commande. Ici, le
              boîtier simulé reprend sa tournée là où elle s'était arrêtée.
            </p>
          </div>
        }
      </app-confirm-modal>

      <!--
        LA FENÊTRE D'ATTENTE — elle s'ouvre à l'instant du geste (avant même la réponse HTTP), couvre
        l'écran et ne se referme qu'à l'issue de la commande : plus rien à cliquer pendant que
        l'ordre est en route. Rendue par le SEUL bouton qui a lancé la commande.
      -->
      @if (suiviVue(); as v) {
        <div #voileSuivi class="ec-suivi-voile" (click)="$event.stopPropagation()">
          <div
            class="ec-suivi"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ec-suivi-titre"
            aria-describedby="ec-suivi-msg"
            [class.ec-suivi--ok]="v.phase === 'ok'"
            [class.ec-suivi--alerte]="v.phase === 'echec' || v.phase === 'sans-preuve'"
          >
            <span class="ec-suivi-icone" aria-hidden="true">
              @switch (v.phase) {
                @case ('ok') { <lucide-icon [img]="CircleCheck" [size]="30"></lucide-icon> }
                @case ('echec') { <lucide-icon [img]="TriangleAlert" [size]="30"></lucide-icon> }
                @case ('sans-preuve') { <lucide-icon [img]="TriangleAlert" [size]="30"></lucide-icon> }
                @default { <lucide-icon [img]="LoaderCircle" [size]="30" class="ec-suivi-tourne"></lucide-icon> }
              }
            </span>
            <h2 id="ec-suivi-titre" class="ec-suivi-titre">{{ v.titre }}</h2>
            <p class="ec-suivi-plaque">{{ vehiclePlate() }}</p>

            @if (v.question) {
              <!--
                LA QUESTION. Elle dit POURQUOI (véhicule hors de portée du GPS) sans nommer le canal : c'est
                une « synchronisation manuelle ». Elle coûte un message — d'où la confirmation explicite.
              -->
              <p id="ec-suivi-msg" class="ec-suivi-msg" aria-live="polite">
                Le véhicule se trouve peut-être dans un souterrain ou dans une zone non couverte par le GPS :
                l’état affiché n’est peut-être pas à jour. Une synchronisation manuelle peut remettre le boîtier
                en ordre.
              </p>
              @if (v.synchroErreur) {
                <p class="ec-suivi-erreur" role="alert">{{ v.synchroErreur }}</p>
              }
              <button type="button" class="ec-suivi-btn" (click)="confirmerSynchro()" [disabled]="v.synchroEnCours">
                {{ v.synchroEnCours ? 'Synchronisation…' : 'Synchroniser le boîtier' }}
              </button>
              <button type="button" class="ec-suivi-lien" (click)="annulerSynchro()" [disabled]="v.synchroEnCours">
                Annuler
              </button>
            } @else {
              <ol class="ec-suivi-etapes">
                @for (e of v.etapes; track e.libelle) {
                  <li [class]="'ec-suivi-etape ec-suivi-etape--' + e.etat">
                    <span class="ec-suivi-etape-pastille" aria-hidden="true"></span>{{ e.libelle }}
                  </li>
                }
              </ol>

              <p id="ec-suivi-msg" class="ec-suivi-msg" aria-live="polite">{{ v.message }}</p>

              @if (v.peutSynchroniser) {
                <button type="button" class="ec-suivi-sync" (click)="demanderSynchro()">Synchroniser le boîtier</button>
              }
              @if (v.terminal) {
                <button type="button" class="ec-suivi-btn" (click)="fermerSuivi()">Fermer</button>
              } @else if (v.peutMasquer) {
                <button type="button" class="ec-suivi-lien" (click)="fermerSuivi()">
                  Masquer — la commande continue
                </button>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
    /* Le bouton d action sortait a 36 px : c est LA commande de l ecran, elle se touche. */
    @media (max-width: 768px) { .ec-hote button, .ec-hote a[href] { min-height: 44px; } }
    .ec-hote { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }

    /* Etats de la derniere commande — jetons, jamais de classe de palette Tailwind. */
    .ec-succes { color: var(--texte-succes); }
    .ec-alerte { color: var(--texte-alerte); }
    .ec-attente { color: var(--texte-attente); }
    .ec-neutre { color: var(--fg-secondary); }
    .ec-point-succes { background: var(--color-tracky-light); }
    .ec-point-alerte { background: var(--danger); }
    .ec-point-attente { background: var(--warning); animation: ec-pulse 1.4s ease-in-out infinite; }
    .ec-point-neutre { background: var(--fg-secondary); }
    @keyframes ec-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
    @media (prefers-reduced-motion: reduce) { .ec-point-attente { animation: none; } }

    .ec-muet-court { margin-left: 8px; font-size: 11.5px; font-weight: 600; color: var(--texte-attente); line-height: 1.3; }

    /* La raison du refus, en clair sous le bouton. */
    .ec-refus {
      margin: 0; max-width: 320px; font-size: 11.5px; line-height: 1.45;
      color: var(--fg-secondary); text-wrap: pretty;
    }
    /* La sortie d'une coupure non confirmée : même place que le refus, teinte de l'attente. */
    .ec-aide { color: var(--texte-attente); font-weight: 600; }

    /* C4 — l'état du moteur, lisible AVANT les boutons. Jetons uniquement, jamais de palette
       Tailwind en dur : cette pastille doit rester lisible dans les deux thèmes. */
    .ec-etat {
      display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
      padding: 3px 8px; border-radius: 8px; font-size: 11px; font-weight: 600;
      border: 1px solid var(--border-subtle); background: var(--bg-tertiary);
      color: var(--fg-secondary);
    }
    .ec-etat-pastille {
      width: 6px; height: 6px; border-radius: 9999px; flex: none;
      background: currentColor;
    }
    .ec-etat-coupe { color: var(--texte-alerte); border-color: color-mix(in srgb, currentColor 35%, transparent); }
    /* « Coupure non confirmée » est une ATTENTE, pas une alerte : ambre, pas rouge. Le jeton
       d'alerte que portait cette ligne faisait sortir les deux pastilles du même rouge — l'écart
       que la pastille existe pour montrer. */
    .ec-etat-attente { color: var(--texte-attente); border-color: color-mix(in srgb, currentColor 35%, transparent); }
    .ec-etat-actif { color: var(--texte-succes); border-color: color-mix(in srgb, currentColor 30%, transparent); }

    /* Boitier muet : trois etapes numerotees, pas une phrase. */
    .ec-muet {
      max-width: 340px; padding: 9px 11px; border-radius: 11px;
      background: color-mix(in srgb, var(--warning) 11%, transparent);
      border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
    }
    .ec-muet-t { font-size: 11.5px; font-weight: 800; color: var(--texte-attente); text-wrap: pretty; }
    .ec-etapes { list-style: none; margin: 7px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .ec-etapes li { display: flex; gap: 7px; font-size: 11.5px; line-height: 1.45; color: var(--fg-secondary); text-wrap: pretty; }
    .ec-etapes strong { color: var(--fg-primary); }
    .ec-num {
      flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      width: 17px; height: 17px; border-radius: 6px; margin-top: 1px;
      background: var(--warning); color: var(--accent-ink); font-size: 10px; font-weight: 800;
    }

    /* Les trois sorties de l'etat non confirme. */
    .ec-nc {
      max-width: 340px; padding: 10px 12px; border-radius: 11px;
      background: color-mix(in srgb, var(--danger) 11%, transparent);
      border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
    }
    .ec-nc-t { font-size: 12px; font-weight: 800; color: var(--texte-alerte); }
    .ec-nc-p { margin: 4px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--fg-secondary); text-wrap: pretty; }
    .ec-nc-sorties { display: flex; flex-direction: column; gap: 6px; margin-top: 9px; }
    .ec-sortie {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 44px; padding: 0 12px; border-radius: 10px;
      background: var(--bg-secondary); border: 1px solid var(--border-strong);
      color: var(--fg-primary); font: inherit; font-size: 12px; font-weight: 700;
      text-decoration: none; cursor: pointer;
    }
    .ec-sortie:disabled { opacity: .55; cursor: wait; }

    /* Environnement de démonstration — encart des confirmations. Famille verte, teinte fabriquée. */
    .ec-demo {
      margin-top: 10px; padding: 8px 10px; border-radius: 11px;
      background: color-mix(in srgb, var(--color-tracky-light) 11%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-tracky-light) 30%, transparent);
      text-align: left;
    }
    .ec-demo-t { font-size: 11.5px; font-weight: 800; color: var(--texte-succes); text-wrap: pretty; }
    .ec-demo-p { margin: 4px 0 0; font-size: 11px; line-height: 1.4; color: var(--fg-secondary); text-wrap: pretty; }

    /* ── La fenêtre d'attente de commande ───────────────────────────────────────────────────
       Elle BLOQUE (voile plein écran, y compris les autres boutons de la page) : c'est son but.
       Sous le consentement (4000), au-dessus de la proposition 2FA (3800). */
    .ec-suivi-voile {
      position: fixed; inset: 0; z-index: 3900; display: flex; align-items: center; justify-content: center;
      padding: 16px; background: color-mix(in srgb, var(--bg-primary) 62%, transparent);
      backdrop-filter: blur(3px); cursor: progress;
    }
    .ec-suivi {
      width: 100%; max-width: 380px; padding: 24px 22px 18px; text-align: center; cursor: default;
      background: var(--bg-secondary); border: 1px solid var(--border-strong);
      border-radius: var(--radius-card, 18px);
    }
    .ec-suivi-icone { display: inline-flex; color: var(--texte-attente); }
    .ec-suivi--ok .ec-suivi-icone { color: var(--texte-succes); }
    .ec-suivi--alerte .ec-suivi-icone { color: var(--texte-alerte); }
    .ec-suivi-tourne { animation: ec-suivi-tour 1.1s linear infinite; }
    @keyframes ec-suivi-tour { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .ec-suivi-tourne { animation: ec-pulse 1.6s ease-in-out infinite; } }
    .ec-suivi-titre { margin: 10px 0 2px; font-size: 1.15rem; font-weight: 800; letter-spacing: -.01em; color: var(--fg-primary); }
    .ec-suivi-plaque { margin: 0 0 14px; font-size: .8rem; font-weight: 700; letter-spacing: .06em; color: var(--fg-secondary); }
    .ec-suivi-etapes { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 7px; text-align: left; }
    .ec-suivi-etape { display: flex; align-items: center; gap: 9px; font-size: .86rem; color: var(--fg-secondary); }
    .ec-suivi-etape-pastille { width: 9px; height: 9px; border-radius: 9999px; flex: none; background: var(--border-strong); }
    .ec-suivi-etape--fait { color: var(--fg-primary); }
    .ec-suivi-etape--fait .ec-suivi-etape-pastille { background: var(--color-tracky-light); }
    .ec-suivi-etape--en-cours { color: var(--fg-primary); font-weight: 700; }
    .ec-suivi-etape--en-cours .ec-suivi-etape-pastille { background: var(--warning); animation: ec-pulse 1.2s ease-in-out infinite; }
    .ec-suivi-etape--erreur { color: var(--texte-alerte); font-weight: 700; }
    .ec-suivi-etape--erreur .ec-suivi-etape-pastille { background: var(--danger); }
    @media (prefers-reduced-motion: reduce) { .ec-suivi-etape--en-cours .ec-suivi-etape-pastille { animation: none; } }
    .ec-suivi-msg { margin: 0 0 14px; font-size: .86rem; line-height: 1.5; color: var(--fg-secondary); text-wrap: pretty; }
    .ec-suivi-btn {
      width: 100%; min-height: 46px; font: inherit; font-weight: 700; font-size: .95rem; cursor: pointer; border: 0;
      border-radius: 12px; background: var(--color-tracky-light); color: var(--accent-ink);
    }
    .ec-suivi-lien {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px;
      font: inherit; font-size: .82rem; font-weight: 600; background: none; border: 0; cursor: pointer;
      color: var(--fg-secondary); border-radius: 10px;
    }
    .ec-suivi-lien:hover { color: var(--fg-primary); text-decoration: underline; }
    .ec-suivi-sync {
      width: 100%; min-height: 44px; margin: 0 0 8px; font: inherit; font-size: .9rem; font-weight: 700; cursor: pointer;
      border-radius: 12px; background: transparent; color: var(--fg-primary); border: 1px solid var(--border-strong);
    }
    .ec-suivi-sync:hover { background: var(--bg-tertiary); }
    .ec-suivi-erreur { margin: 0 0 12px; font-size: .84rem; line-height: 1.45; color: var(--texte-alerte); font-weight: 600; text-wrap: pretty; }
    .ec-suivi-btn:disabled, .ec-suivi-lien:disabled { opacity: .6; cursor: wait; }
    `,
  ],
})
export class EngineControlButtonComponent implements OnInit {
  readonly trackerId = input.required<string>();
  readonly vehicleId = input<string | undefined>(undefined);
  readonly vehiclePlate = input.required<string>();
  readonly currentSpeedKmh = input<number | undefined>(undefined);
  readonly validFix = input(false);
  readonly positionAge = input<number | undefined>(undefined);
  readonly ignition = input(true);
  /**
   * Dernier signal reçu du BOÎTIER (pas de la position) — source unique de la dormance.
   *
   * Optionnel : laissé à `undefined`, le composant retombe sur l'entrée snapshot du
   * RealtimeService pour ce tracker (hydratée au login, rafraîchie par les trames WS).
   * On distingue volontairement `undefined` (fait INCONNU → on ne bloque rien, le serveur
   * reste seul juge) de `null` (boîtier connu qui n'a JAMAIS émis → pas « devenu muet »).
   */
  readonly trackerLastSeenAt = input<string | Date | null | undefined>(undefined);
  /** Si true, un schedule horaire est actif sur ce véhicule (input ou chargé dynamiquement). */
  readonly scheduleEnabledInput = input(false, { alias: 'scheduleEnabled' });
  /** Libellé de traçage d'activité posé sur les boutons d'action (data-track). Vide = fallback texte. */
  readonly trackLabel = input<string>('');
  /** Emis quand une action manuelle désactive le schedule horaire. */
  readonly scheduleDisabled = output<void>();

  protected readonly isOpen = signal<'cut' | 'restore' | null>(null);
  protected readonly loading = signal(false);
  protected readonly reason = signal('');
  /** Case optionnelle « immobilisation durable » (CUT + mode horaire actif) : sort du planning. */
  protected readonly durableImmobilize = signal(false);
  protected readonly recentCommands = signal<EngineControlCommandDto[]>([]);
  private readonly _scheduleEnabled = signal(false);
  protected readonly scheduleEnabled = computed(() => this.scheduleEnabledInput() || this._scheduleEnabled());
  /** Sortir durablement un véhicule du planning exige le droit de gérer SES horaires. */
  protected readonly canDisableSchedule = computed(() => {
    const vehicleId = this.effectiveVehicleId();
    return !!vehicleId && this.perms.can('schedules_manage', vehicleId);
  });

  protected readonly Power = Power;
  protected readonly PowerOff = PowerOff;
  protected readonly CircleCheck = CircleCheck;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly TriangleAlert = TriangleAlert;

  private readonly authService = inject(AuthService);
  private readonly engineControl = inject(EngineControlService);
  private readonly commandLocks = inject(EngineCommandLockService);
  private readonly perms = inject(PermissionsService);
  private readonly toast = inject(ToastService);
  private readonly realtime = inject(RealtimeService);
  private readonly schedulesApi = inject(VehicleSchedulesApiService);
  /** Environnement de démonstration : encarts des confirmations, toast et pastille « simulation ». */
  protected readonly demo = inject(DemoModeService);
  protected readonly commandLocked = computed(
    () => this.loading() || this.commandLocks.isLocked(this.trackerId()),
  );

  /**
   * V1.11 Phase 1 — VehicleId effectif : prend l'input si fourni, sinon resout
   * via le snapshot realtime (compat avec usages historiques). Nécessaire pour
   * la vérification de permission per-vehicle (engine_control).
   */
  protected readonly effectiveVehicleId = computed<string | undefined>(() => {
    const direct = this.vehicleId();
    if (direct) return direct;
    return this.realtime.snapshot().find((v) => v.trackerId === this.trackerId())?.vehicleId;
  });

  /**
   * ══ L'ÉTAT DU MOTEUR LU DANS LA LISTE — incident CDEF31 des 06 et 07/10/2026 ═══════════════
   *
   * Deux soirs de suite, une coupure (planning, puis veilleur) n'a pas été ACQUITTÉE : le boîtier
   * l'a différée, et son écho est arrivé après les 15 s d'attente du serveur. La règle d'avant ne
   * comptait qu'une coupure ACKNOWLEDGED : l'écran disait « Moteur actif », « Rallumer » était
   * grisé (« Le moteur n'est pas coupé. »), « Couper » restait offert. Le véhicule ne démarrait
   * plus, et le veilleur, privé du seul geste utile, a recoupé onze fois avant d'appeler. Débloqué
   * les deux soirs par un SMS manuel.
   *
   * Le correctif de ce piège existait déjà — dans la branche « liste vide » (coupé OU en attente →
   * Rallumer). C7 (24/09) ayant servi la liste au veilleur, il passait par l'autre branche. Les
   * deux disent désormais la même chose :
   *   - 'actif'          aucune coupure possible plus récente que le dernier rallumage ACQUITTÉ ;
   *   - 'coupe'          la dernière coupure est acquittée ;
   *   - 'en-vol'         partie (PENDING, SENT) sans preuve — elle peut s'appliquer à tout moment :
   *                      « Rallumer » offert, « Couper » refusé (une coupure en vol suffit) ;
   *   - 'non-confirmee'  échue sans preuve (SENT_UNCONFIRMED) : nul ne sait, les DEUX gestes ont
   *                      un sens et les deux sont offerts ;
   *   - null             liste vide → repli sur l'overlay temps réel (`isCutActive`).
   *
   * Rallumer est toujours sûr : l'API supplante toute coupure encore en vol. Les observations
   * (DEVICE_OBSERVED) ne comptent pas, comme côté serveur (`etatCoupeParTracker`) : c'étaient des
   * stationnements, pas des coupures.
   */
  private readonly etatDepuisListe = computed<'actif' | 'coupe' | 'en-vol' | 'non-confirmee' | null>(() => {
    const cmds = this.recentCommands();
    if (cmds.length === 0) return null;
    // La liste arrive de la plus récente à la plus ancienne (API : `createdAt desc`).
    const coupe = cmds.find(
      (c) => c.action === 'CUT' && c.source !== 'DEVICE_OBSERVED' && COUPE_POSSIBLE.has(c.status),
    );
    if (!coupe) return 'actif';
    // Un RESTORE seulement SENT ne nettoie jamais l'état : la soumission au transport n'est pas
    // une preuve d'exécution par le boîtier.
    const rallumage = cmds.find(
      (c) => c.action === 'RESTORE' && c.source !== 'DEVICE_OBSERVED' && c.status === 'ACKNOWLEDGED',
    );
    if (rallumage && new Date(rallumage.createdAt) > new Date(coupe.createdAt)) return 'actif';
    if (coupe.status === 'ACKNOWLEDGED') return 'coupe';
    if (coupe.status === 'SENT_UNCONFIRMED') return 'non-confirmee';
    if (coupe.status === 'PENDING' && this._now() - new Date(coupe.createdAt).getTime() > PENDING_ORPHELINE_MS) {
      return 'non-confirmee';
    }
    return 'en-vol';
  });

  readonly isCutActive = computed(() => {
    const etat = this.etatDepuisListe();
    if (etat !== null) return etat !== 'actif';
    // Sprint 3, RÉVISÉ le 24/09/2026 (C7) — le VEILLEUR recevait un `403` sur
    // `GET /engine-control/commands` : sa liste `recentCommands` était TOUJOURS vide, et ce repli
    // sur l'overlay temps réel était sa SEULE source d'état. Un canal que chaque recréation de
    // conteneur interrompt — d'où l'incident CDEF31 (quatre déploiements entre 00h56 et 01h40).
    // Il est désormais admis sur la route (vue restreinte : motif caviardé), donc sa liste est
    // servie comme aux autres rôles.
    //
    // Ce repli RESTE, et doit rester : la liste est également vide quand un boîtier n'a jamais
    // reçu de commande, quand la lecture échoue, et pendant le tout premier rendu. Le supprimer
    // sous prétexte que le 403 a disparu rouvrirait le même trou par une autre porte.
    //
    // L'état coupé vient alors du suivi temps
    // réel de RealtimeService (`cutActiveTrackerIds`, hydraté au login + MAJ par les events
    // `ENGINE_COMMAND_UPDATED` reçus via `ops:fleet`), même sémantique (CUT ACKNOWLEDGED =
    // coupé, RESTORE = rallumé). Sans ce repli le bouton restait bloqué sur « Couper » → le
    // veilleur ne pouvait JAMAIS rallumer (il recoupait à chaque clic).
    //
    // Coupé CONFIRMÉ (cutActiveTrackerIds) OU coupé EN ATTENTE de confirmation
    // (cutPendingTrackerIds) → on propose « Rétablir » dans les deux cas. Sinon le
    // veilleur — privé du détail des commandes (commandState) — reste sur « Couper »
    // tant que la coupe n'est pas confirmée et reclique en boucle (observé en prod :
    // 3 CUT d'affilée, véhicule bloqué « en attente »). Un RESTORE ou un FAILED nettoie
    // les DEUX ensembles côté RealtimeService → le bouton revient à « Couper ».
    // (La liste servie suit la même règle depuis le 08/10/2026 : cf. `etatDepuisListe`.)
    const tid = this.trackerId();
    return this.realtime.cutActiveTrackerIds().has(tid) || this.realtime.cutPendingTrackerIds().has(tid);
  });

  // Sprint 2 — tick 5s : fait basculer l'affichage "en attente" -> "non confirmee"
  // au depassement de la fenetre, sans refetch.
  private readonly _now = signal(Date.now());
  /**
   * Tick ADAPTATIF : 1 s pendant la fenêtre de confirmation, 5 s le reste du temps.
   *
   * Le compte à rebours des 90 s exige la seconde — à 5 s il sauterait de 5 en 5, ce qui se
   * lit comme un bug plutôt que comme une attente. Mais battre la seconde en permanence sur
   * chaque ligne d'une liste de véhicules serait du gaspillage pur : la cadence suit donc
   * l'état, et redescend d'elle-même dès que plus rien n'est en attente.
   */
  constructor() {
    let rapide = false;
    let id: ReturnType<typeof setInterval> | null = null;
    const armer = (ms: number) => {
      if (id) clearInterval(id);
      id = setInterval(() => {
        this._now.set(Date.now());
        const doitEtreRapide = this.attenteEnCours();
        if (doitEtreRapide !== rapide) { rapide = doitEtreRapide; armer(rapide ? 1000 : 5000); }
      }, ms);
    };
    armer(5000);
    inject(DestroyRef).onDestroy(() => { if (id) clearInterval(id); });
    // Un bouton détruit (navigation) en pleine attente ne doit ni laisser tourner ses minuteurs ni garder le boîtier verrouillé.
    inject(DestroyRef).onDestroy(() => {
      this.fermerSuivi();
      // ⚠️ Le voile a été déplacé à la racine du document : Angular, qui ne retire à la destruction d'un
      // composant que son élément hôte, ne l'emporterait PAS — la fenêtre resterait affichée par-dessus
      // l'application après un changement de page (trouvé par les tests, 29/10).
      this.voileRef()?.nativeElement.remove();
    });
  }

  /**
   * ══ LA FENÊTRE D'ATTENTE — l'état de la commande que CE bouton vient d'envoyer ═════════════
   *
   * `commandId` reste nul entre le geste et la réponse HTTP : la fenêtre est déjà là (« Envoi de
   * l'ordre… »), c'est tout son intérêt. Le verrou du boîtier (`EngineCommandLockService`) est tenu
   * tant qu'elle est ouverte : aucune autre surface — carte, liste, fiche — ne peut renvoyer un ordre.
   */
  protected readonly suivi = signal<{
    action: 'CUT' | 'RESTORE';
    commandId: string | null;
    depuis: number;
    /** Fenêtre ouverte POUR la question (depuis l'écran du véhicule) : « Annuler » la referme au lieu de montrer un suivi. */
    pourSynchro?: boolean;
    /** Le boîtier VERROUILLÉ par cette fenêtre : c'est lui qu'on relâche, pas celui que l'entrée désigne à l'instant. */
    trackerId: string;
    /** Propriétaire de la fenêtre : une fin d'`onConfirm` tardive ne ferme ni ne relâche celle d'un autre geste. */
    jeton: number;
  } | null>(null);
  private jetonSuivi = 0;
  private suiviRelecture: ReturnType<typeof setInterval> | null = null;
  private suiviFermetureAuto: ReturnType<typeof setTimeout> | null = null;

  /**
   * ══ SYNCHRONISATION MANUELLE (29/10/2026) — décision du propriétaire ═══════════════════════
   *
   * Aucun envoi de secours automatique : il coûte, et le cas est rare. Quand une coupure reste sans
   * preuve (véhicule en souterrain, zone non couverte par le GPS), l'utilisateur qui insiste se voit
   * poser la question ; s'il confirme, le serveur renvoie le même ordre par un canal de secours et la
   * réponse du boîtier remet l'écran d'accord. L'écran dit « synchronisation » — jamais le canal.
   */
  protected readonly suiviQuestion = signal(false);
  protected readonly synchroEnCours = signal(false);
  protected readonly synchroErreur = signal<string | null>(null);
  /** Les commandes pour lesquelles une synchronisation a déjà été demandée (une seule par commande). */
  private readonly synchroDemandee = signal<ReadonlySet<string>>(new Set());

  /** Une coupure encore ouverte, jamais confirmée, ni remplacée, ni déjà synchronisée. */
  private synchronisable(c: EngineControlCommandDto): boolean {
    if (c.action !== 'CUT') return false;
    if (c.status !== 'SENT' && c.status !== 'SENT_UNCONFIRMED') return false;
    if (c.channel === 'SMS') return false;
    if (c.lastError?.includes('supplantée')) return false;
    return !this.synchroDemandee().has(c.id);
  }

  /**
   * Sur l'écran du véhicule (hors fenêtre d'attente) : la même offre, là où l'utilisateur lit « coupure
   * non confirmée » — liste servie « non confirmée », ou « en vol » depuis plus de 15 s. Seulement pour qui
   * peut rallumer (même droit `engine_control`).
   *
   * ⚠️ Elle ne dépend PAS du bandeau rouge `nonConfirmee` : celui-ci n'existe que pour une coupure dont
   * l'ignition était attendue. MH-971-TD était à l'arrêt (`confirmationExpected` faux) — exactement le cas
   * qu'il fallait servir.
   */
  protected readonly peutSynchroniserEcran = computed<boolean>(() => {
    const c = this.lastAppCommand();
    if (!c || !this.synchronisable(c) || !this.canRestore()) return false;
    const etat = this.etatDepuisListe();
    if (etat === 'non-confirmee') return true;
    const age = this._now() - new Date(c.sentAt ?? c.createdAt).getTime();
    return etat === 'en-vol' && age >= SUIVI_ATTENTE_LONGUE_MS;
  });

  /** La commande suivie, lue dans la liste ou, à défaut, dans le dernier événement temps réel. */
  private commandeSuivie(commandId: string | null): EngineControlCommandDto | null {
    if (!commandId) return null;
    const deListe = this.recentCommands().find((c) => c.id === commandId);
    if (deListe) return deListe;
    const ev = this.realtime.engineCommandUpdates().get(this.trackerId());
    if (!ev || ev.commandId !== commandId) return null;
    return {
      id: ev.commandId,
      trackerId: ev.trackerId,
      action: ev.action,
      status: ev.status,
      reason: null,
      source: ev.source ?? 'MANUAL',
      lastError: ev.lastError,
      requestedBy: '',
      createdAt: ev.sentAt ?? '',
      sentAt: ev.sentAt ?? null,
      confirmationExpected: ev.confirmationExpected ?? false,
      ackedAt: ev.ackedAt ?? null,
      channel: ev.channel ?? null,
    };
  }

  protected readonly suiviVue = computed<SuiviVue | null>(() => {
    const s = this.suivi();
    if (!s) return null;
    const ecoule = this._now() - s.depuis;
    const cmd = this.commandeSuivie(s.commandId);
    const coupe = s.action === 'CUT';
    // Une commande REMPLACÉE par une demande plus récente (y compris une remise en route constatée par SMS) :
    // « non confirmée — peut-être déjà coupé » serait faux, c'est l'autre demande qui fait foi.
    const remplacee = !!cmd?.lastError && cmd.lastError.includes('supplantée');
    const muet = this.dormantWarning();

    let phase: SuiviPhase;
    // Une synchronisation demandée (ou une commande déjà repartie par le canal de secours) est EN COURS tant
    // que la fenêtre n'a pas expiré — y compris pour une coupure échue (SENT_UNCONFIRMED) : lui répondre
    // « non confirmée, vérifiez sur place » à l'instant même où l'utilisateur vient de la synchroniser
    // l'inviterait à renvoyer la commande (relecture du 29/10).
    const synchronisee =
      !!cmd &&
      (cmd.channel === 'SMS' || this.synchroDemandee().has(cmd.id)) &&
      (cmd.status === 'SENT' || cmd.status === 'SENT_UNCONFIRMED') &&
      !remplacee &&
      ecoule < SUIVI_MAX_MS;
    if (cmd?.status === 'ACKNOWLEDGED') phase = 'ok';
    else if (cmd?.status === 'FAILED') phase = 'echec';
    else if (synchronisee) phase = 'sms';
    else if (remplacee || cmd?.status === 'SENT_UNCONFIRMED' || ecoule >= SUIVI_MAX_MS) phase = 'sans-preuve';
    else if (!cmd || cmd.status === 'PENDING') phase = 'envoi';
    else if (cmd.channel === 'SMS') phase = 'sms';
    else if (ecoule >= SUIVI_ATTENTE_LONGUE_MS) phase = 'attente-longue';
    else phase = 'attente';

    const titres: Record<SuiviPhase, string> = {
      envoi: coupe ? 'Coupure du moteur en cours' : 'Rallumage du moteur en cours',
      attente: coupe ? 'Coupure du moteur en cours' : 'Rallumage du moteur en cours',
      'attente-longue': coupe ? 'Coupure du moteur en cours' : 'Rallumage du moteur en cours',
      sms: coupe ? 'Coupure du moteur en cours' : 'Rallumage du moteur en cours',
      ok: coupe ? 'Moteur coupé' : 'Moteur rallumé',
      echec: coupe ? 'Coupure échouée' : 'Rallumage échoué',
      'sans-preuve': coupe ? 'Coupure non confirmée' : 'Rallumage non confirmé',
    };
    const messages: Record<SuiviPhase, string> = {
      envoi: 'Envoi de l’ordre… Ne touchez à rien.',
      attente: 'Le boîtier répond en général en quelques secondes. Ne touchez à rien.',
      'attente-longue': 'Le boîtier tarde à répondre : le véhicule est peut-être hors de portée (souterrain, zone non couverte). Ne touchez à rien.',
      sms: 'Synchronisation avec le boîtier en cours : sa réponse peut prendre jusqu’à une minute.',
      ok: 'Le boîtier a confirmé.',
      echec:
        cmd?.lastError && !/sms/i.test(cmd.lastError)
          ? cmd.lastError
          : 'La commande n’a pas pu être envoyée au boîtier : il est peut-être hors de portée. Vérifiez le véhicule sur place.',
      'sans-preuve':
        `Le boîtier n’a pas confirmé. Le véhicule est peut-être déjà ${coupe ? 'coupé' : 'rallumé'} : ` +
        'vérifiez sur place avant de recommencer.',
    };

    // Boîtier muet : rien ne reviendra confirmer — le dire, au lieu de promettre une réponse « en quelques secondes ».
    if (muet && (phase === 'attente' || phase === 'attente-longue' || phase === 'sms')) {
      messages[phase] = `Boîtier muet depuis ${muet.silence} : aucune confirmation n’est attendue. Vérifiez le véhicule sur place.`;
    }
    if (remplacee) {
      titres['sans-preuve'] = 'Commande remplacée';
      messages['sans-preuve'] = 'Une demande plus récente a pris le relais de celle-ci : l’écran affiche l’état à jour.';
    }
    const enAttenteDeReponse = phase === 'envoi' || phase === 'attente' || phase === 'attente-longue' || phase === 'sms';
    const confirmation: 'fait' | 'en-cours' | 'attente' | 'erreur' =
      phase === 'ok' ? 'fait' : phase === 'echec' || phase === 'sans-preuve' ? 'erreur' : phase === 'envoi' ? 'attente' : 'en-cours';
    const etapes: SuiviVue['etapes'] = [
      { libelle: 'Ordre enregistré', etat: s.commandId ? 'fait' : 'en-cours' },
      {
        libelle: 'Envoyé au boîtier',
        etat: !s.commandId ? 'attente' : cmd && cmd.status !== 'PENDING' ? 'fait' : 'en-cours',
      },
      {
        libelle: phase === 'sms' ? 'Confirmation du boîtier (synchronisation)' : 'Confirmation du boîtier',
        etat: confirmation,
      },
    ];
    const question = this.suiviQuestion();
    return {
      phase,
      action: s.action,
      titre: question ? 'Synchroniser le boîtier ?' : titres[phase],
      message: messages[phase],
      etapes,
      terminal: !enAttenteDeReponse,
      peutMasquer: enAttenteDeReponse && ecoule >= SUIVI_MASQUER_APRES_MS,
      peutSynchroniser:
        coupe && !!cmd && this.synchronisable(cmd) && (phase === 'attente-longue' || phase === 'sans-preuve'),
      question,
      synchroEnCours: this.synchroEnCours(),
      synchroErreur: this.synchroErreur(),
    };
  });

  /**
   * Le voile vit à la RACINE du document, pas dans le bouton. Sur la carte, la fiche véhicule porte un
   * `backdrop-filter` et une animation : un élément `position: fixed` placé dedans est confiné à cette
   * feuille — le fond de carte restait cliquable, et un clic dehors détruisait le bouton en pleine
   * commande (relecture du 29/10). Déplacer le nœud est sans risque pour Angular : il retire un nœud par
   * son parent RÉEL.
   */
  private readonly voileRef = viewChild<ElementRef<HTMLElement>>('voileSuivi');
  private readonly voileHorsCarte = effect(() => {
    const el = this.voileRef()?.nativeElement;
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  });

  /** Succès : la fenêtre se referme seule, le temps de lire « Moteur coupé ». */
  private readonly suiviAutoFermeture = effect(() => {
    const vue = this.suiviVue();
    if (vue?.phase === 'ok' && !this.suiviFermetureAuto && !this.synchroEnCours()) {
      this.suiviFermetureAuto = setTimeout(() => this.fermerSuivi(), SUIVI_FERMETURE_OK_MS);
    }
  });

  private ouvrirSuivi(action: 'CUT' | 'RESTORE'): number {
    this.arreterMinuteursSuivi();
    this._now.set(Date.now());
    const jeton = (this.jetonSuivi += 1);
    this.suiviQuestion.set(false);
    this.synchroErreur.set(null);
    this.suivi.set({ action, commandId: null, depuis: Date.now(), trackerId: this.trackerId(), jeton });
    // Relecture régulière : le suivi ne doit pas dépendre du WebSocket (coupé pendant une bascule d'API
    // — c'est justement quand on envoie une commande qu'on veut qu'il tienne).
    this.suiviRelecture = setInterval(() => {
      this._now.set(Date.now());
      if (this.suivi()?.commandId) void this.loadRecentCommands(0);
    }, SUIVI_RELECTURE_MS);
    return jeton;
  }

  private arreterMinuteursSuivi(): void {
    if (this.suiviRelecture) clearInterval(this.suiviRelecture);
    if (this.suiviFermetureAuto) clearTimeout(this.suiviFermetureAuto);
    this.suiviRelecture = null;
    this.suiviFermetureAuto = null;
  }

  /** Ferme la fenêtre et rend la main : le verrou du boîtier est relâché, les boutons disent à nouveau le vrai. */
  protected fermerSuivi(): void {
    const s = this.suivi();
    this.arreterMinuteursSuivi();
    this.suivi.set(null);
    this.suiviQuestion.set(false);
    this.synchroErreur.set(null);
    this.synchroEnCours.set(false);
    if (s) this.commandLocks.release(s.trackerId);
  }

  /** Ouvre la question depuis la fenêtre d'attente. */
  protected demanderSynchro(): void {
    this.synchroErreur.set(null);
    this.suiviQuestion.set(true);
  }

  protected annulerSynchro(): void {
    if (this.synchroEnCours()) return;
    this.suiviQuestion.set(false);
    if (this.suivi()?.pourSynchro) this.fermerSuivi();
  }

  /**
   * Depuis le bandeau « le boîtier n'a pas confirmé » : la question s'ouvre dans la fenêtre, qui prend le
   * verrou — le boîtier ne reçoit pas un ordre pendant qu'on le synchronise.
   */
  protected ouvrirSynchro(): void {
    const c = this.lastAppCommand();
    if (!c || !this.synchronisable(c)) return;
    const trackerId = this.trackerId();
    if (this.commandLocked() || !this.commandLocks.acquire(trackerId)) {
      this.toast.info(
        'Commande déjà en cours',
        `Un envoi est en cours sur ${this.vehiclePlate()} — attendez sa réponse avant d’en lancer un autre.`,
      );
      return;
    }
    this.ouvrirSuivi('CUT');
    // L'horloge est celle de la COMMANDE (partie il y a plusieurs minutes), pas celle de l'ouverture : sinon
    // la fenêtre ressemblerait à un envoi neuf (« répond en quelques secondes », sans « Masquer » pendant 10 s).
    const depuis = new Date(c.sentAt ?? c.createdAt).getTime();
    this.suivi.update((x) => (x ? { ...x, commandId: c.id, depuis: Number.isFinite(depuis) ? depuis : x.depuis, pourSynchro: true } : x));
    this.suiviQuestion.set(true);
  }

  protected async confirmerSynchro(): Promise<void> {
    const s = this.suivi();
    const cmd = s ? this.commandeSuivie(s.commandId) : null;
    if (!s || !cmd || this.synchroEnCours()) return;
    // La situation a pu changer entre la question et la confirmation (écho reçu, rallumage…).
    if (!this.synchronisable(cmd)) {
      this.synchroErreur.set('La situation de ce véhicule a changé : fermez cette fenêtre, l’écran est à jour.');
      return;
    }
    this.synchroEnCours.set(true);
    this.synchroErreur.set(null);
    try {
      await firstValueFrom(this.engineControl.synchroniser(s.trackerId, cmd.id));
      this.synchroDemandee.update((set) => new Set(set).add(cmd.id));
      this.suiviQuestion.set(false);
      // Le suivi repart : 150 s pour que le boîtier réponde à la synchronisation.
      this.suivi.update((x) => (x && x.jeton === s.jeton ? { ...x, depuis: Date.now() } : x));
      await this.loadRecentCommands(0);
    } catch (err) {
      swallow('engine-control-button:confirmerSynchro', err);
      // Le message vient de l'API, qui ne nomme jamais le canal : on l'affiche tel quel.
      this.synchroErreur.set(this.extractErrorMessage(err));
    } finally {
      this.synchroEnCours.set(false);
    }
  }

  /** Une commande attend-elle encore sa confirmation ? Pilote la cadence du tick. */
  private attenteEnCours(): boolean {
    const c = this.lastAppCommand();
    if (!c || c.status !== 'SENT' || c.confirmationExpected === false) return false;
    return this._now() - new Date(c.sentAt ?? c.createdAt).getTime() < CONFIRM_WINDOW_MS;
  }

  /** Secondes restantes dans la fenêtre de confirmation, ou null hors fenêtre. */
  protected readonly secondesRestantes = computed<number | null>(() => {
    const c = this.lastAppCommand();
    if (!c || c.status !== 'SENT' || c.confirmationExpected === false) return null;
    const reste = CONFIRM_WINDOW_MS - (this._now() - new Date(c.sentAt ?? c.createdAt).getTime());
    return reste > 0 ? Math.ceil(reste / 1000) : null;
  });

  /** Sprint 2 — derniere commande APP (hors DEVICE_OBSERVED) = l'action en cours. */
  private readonly lastAppCommand = computed<EngineControlCommandDto | null>(() => {
    const fromList = this.recentCommands().find((c) => c.source !== 'DEVICE_OBSERVED');
    if (fromList) return fromList;
    // Sprint 3 — repli quand recentCommands est vide (veilleur avant C7, boîtier sans historique,
    // lecture en échec, premier rendu). On reconstruit la
    // dernière commande app depuis l'event WS ENGINE_COMMAND_UPDATED (reçu via ops:fleet) pour
    // que commandState (pastille « confirmée / non vérifiable / échec ») s'affiche aussi pour
    // lui — sinon le veilleur n'a AUCUN retour d'état après la coupe (cf. revue B5).
    const ev = this.realtime.engineCommandUpdates().get(this.trackerId());
    if (!ev || ev.source === 'DEVICE_OBSERVED') return null;
    return {
      id: ev.commandId,
      trackerId: ev.trackerId,
      action: ev.action,
      status: ev.status,
      reason: null,
      source: ev.source ?? 'MANUAL',
      lastError: ev.lastError,
      requestedBy: '',
      createdAt: ev.sentAt ?? ev.ackedAt ?? '',
      sentAt: ev.sentAt ?? null,
      confirmationExpected: ev.confirmationExpected ?? false,
      ackedAt: ev.ackedAt ?? null,
    };
  });

  /**
   * Sprint 2 — etat honnete de la derniere commande app : en attente / confirmee /
   * non confirmee / non verifiable / echec. Garantit qu'on n'affiche JAMAIS un faux
   * succes (l'etat "coupe" du bouton ne passe qu'a la confirmation reelle).
   */
  /**
   * Environnement de démonstration : la pastille dit « simulation » à côté de l'état RÉEL de la
   * commande. L'état, lui, n'est pas maquillé — il vient du même circuit qu'en production.
   */
  readonly commandState = computed<{ short: string; label: string; textClass: string; dotClass: string } | null>(() => {
    const etat = this.commandStateBrut();
    if (!etat || !this.demo.enabled()) return etat;
    return {
      ...etat,
      short: `${etat.short} · simulation`,
      label: `${etat.label} (environnement de démonstration : boîtier simulé, aucun véhicule réel)`,
    };
  });

  private readonly commandStateBrut = computed<{ short: string; label: string; textClass: string; dotClass: string } | null>(() => {
    const c = this.lastAppCommand();
    if (!c || c.status === 'PENDING' || c.status === 'REJECTED_SPEED') return null;
    const verb = c.action === 'CUT' ? 'Coupure' : 'Rallumage';
    if (c.status === 'ACKNOWLEDGED') {
      return {
        short: c.action === 'CUT' ? 'Coupure confirmée' : 'Rallumage confirmé',
        label: `${verb} confirmé(e) par le boîtier (chute d'ignition).`,
        textClass: 'ec-succes',
        dotClass: 'ec-point-succes',
      };
    }
    if (c.status === 'FAILED') {
      return {
        short: 'Échec d\'envoi',
        label: c.lastError ?? 'La commande n\'a pas pu être envoyée au boîtier.',
        textClass: 'ec-alerte',
        dotClass: 'ec-point-alerte',
      };
    }
    // status === 'SENT'
    if (c.action === 'RESTORE') {
      const ageMs = this._now() - new Date(c.sentAt ?? c.createdAt).getTime();
      const late = ageMs >= 60_000;
      return {
        short: late ? 'Rallumage non confirmé' : 'Rallumage en cours',
        label: late
          ? 'Le rallumage n’est toujours pas confirmé. Vérifiez l’alerte et le véhicule.'
          : 'RESTORE enregistré : l’envoi et son secours seront suivis jusqu’au statut final.',
        textClass: late ? 'ec-alerte' : 'ec-attente',
        dotClass: late ? 'ec-point-alerte' : 'ec-point-attente',
      };
    }
    if (c.confirmationExpected === false) {
      return {
        short: 'Envoyée',
        label: `${verb} envoyée — confirmation par ignition indisponible (véhicule à l'arrêt). À vérifier physiquement.`,
        textClass: 'ec-neutre',
        dotClass: 'ec-point-neutre',
      };
    }
    const ageMs = this._now() - new Date(c.sentAt ?? c.createdAt).getTime();
    if (ageMs < CONFIRM_WINDOW_MS) {
      // COMPTE A REBOURS : « En attente… » sans duree laisse croire que ca peut durer
      // indefiniment. Le boitier a 90 s pour repondre — autant le dire.
      const s = this.secondesRestantes();
      return {
        short: s != null ? `En attente… ${s} s` : 'En attente…',
        label: `${verb} envoyée — le boîtier a ${s ?? 90} s pour confirmer.`,
        textClass: 'ec-attente',
        dotClass: 'ec-point-attente',
      };
    }
    return {
      short: 'Non confirmée',
      label: `${verb} envoyée mais NON confirmée par le boîtier — à vérifier.`,
      textClass: 'ec-alerte',
      dotClass: 'ec-point-alerte',
    };
  });

  /** L'etat NON CONFIRME est-il a l'ecran ? Il ouvre alors ses trois sorties. */
  protected readonly nonConfirmee = computed<boolean>(
    () => {
      const short = this.commandStateBrut()?.short;
      return short === 'Non confirmée' || short === 'Rallumage non confirmé';
    },
  );
  /**
   * Sortie n° 3 : « j'ai verifie sur place ».
   *
   * ⚠️ Elle masque le bandeau et RIEN D'AUTRE : elle n'ecrit aucun etat, ne confirme rien
   * cote serveur, et ne fait pas passer le bouton en « coupe ». L'application n'a pas vu le
   * vehicule ; seul l'operateur l'a vu. Lui faire dire « confirme » ici recreerait le faux
   * succes que tout cet ecran existe pour eviter.
   */
  protected readonly verifieSurPlace = signal(false);

  /**
   * Sortie n° 2, « Voir l'historique » : /fleet-admin/activity n'admet que FLEET_ADMIN et
   * SUPER_ADMIN (roleGuard de la route, app.routes.ts — garder les deux listes d'accord).
   *
   * Revue du 29/09 : les autres rôles qui commandent un moteur voyaient un lien qui ne menait
   * nulle part, sans un mot, au moment de savoir si le véhicule est immobilisé — le veilleur
   * restait sur /vehicles (watchmanChildGuard passe avant le roleGuard), un gestionnaire à qui
   * l'on a donné engine_control repartait au tableau de bord. Ils gardent « Renvoyer » et « J'ai
   * vérifié sur place ». Pas de vue de repli : le client refuse tout historique au veilleur.
   */
  protected readonly voitHistorique = computed(() => {
    const role = this.authService.user()?.role;
    return role === 'FLEET_ADMIN' || role === 'SUPER_ADMIN';
  });

  /** La fenetre de confirmation, en secondes — pour l'etape 2 de l'avertissement. */
  protected readonly fenetreSecondes = CONFIRM_WINDOW_MS / 1000;

  /** Sortie n° 1 : rejouer exactement la meme commande, sans repasser par la confirmation. */
  protected renvoyer(): void {
    const c = this.lastAppCommand();
    if (!c || this.commandLocked()) return;
    this.verifieSurPlace.set(false);
    void this.onConfirm(c.action);
  }

  /**
   * Dernier signal du boîtier, résolu : input explicite d'abord, snapshot realtime ensuite.
   *
   * Retourne `undefined` quand le fait est INCONNU (aucun input, aucune entrée snapshot —
   * c'est le cas du VEILLEUR, à qui le serveur ne sert aucune donnée véhicule). On ne
   * grise JAMAIS sur une ignorance : sans fait, aucune garde.
   */
  private readonly resolvedLastSeenAt = computed<string | Date | null | undefined>(() => {
    const direct = this.trackerLastSeenAt();
    if (direct !== undefined) return direct;
    const snap = this.realtime.snapshot().find((v) => v.trackerId === this.trackerId());
    return snap ? snap.lastSeenAt : undefined;
  });

  /**
   * BOÎTIER MUET (seuil AGIR = 72 h) — non null quand le boîtier ne parle plus du tout.
   *
   * Cas réel : FV-941-LZ, muet depuis 89 jours. L'opérateur cliquait « Couper », lisait
   * « Coupure envoyée » et croyait le véhicule immobilisé. Ce n'est PAS le clic qu'il faut
   * empêcher (le serveur tente encore le repli SMS, cf. canCut) — c'est la CROYANCE au
   * succès. On date donc le silence partout où l'action se décide : sur le bouton, dans la
   * confirmation, dans le toast.
   *
   * DORMANT_STOP_ACTING_MS (72 h) et PAS le seuil de comptage (7 j) : c'est le seuil
   * d'ACTION, celui que le serveur applique à ses automatismes. Un véhicule simplement
   * garé une semaine ne doit jamais être signalé ici.
   *
   * Dépend de `_now()` (tick 5 s) : dès la première trame reçue, `lastSeenAt` redevient
   * frais et l'avertissement disparaît seul — aucun drapeau, aucune action manuelle.
   */
  protected readonly dormantWarning = computed<{ silence: string; title: string } | null>(() => {
    const lastSeen = this.resolvedLastSeenAt();
    // undefined = fait inconnu ; null = jamais émis (« pas configuré », pas « devenu muet »).
    if (lastSeen === undefined || lastSeen === null) return null;
    const now = this._now();
    const silent = trackerSilenceMs(lastSeen, now);
    if (silent == null || silent <= DORMANT_STOP_ACTING_MS) return null;
    const silence = formatSilenceLabel(lastSeen, now) ?? '—';
    return {
      silence,
      title:
        `Le boîtier n'a plus émis depuis ${silence} (batterie débranchée, SIM coupée ou boîtier déposé). ` +
        `La commande sera tout de même tentée, par un canal de secours : ne considérez l'action faite qu'une fois ` +
        `confirmée par le boîtier, ou vérifiée physiquement.`,
    };
  });

  readonly canCut = computed(() => {
    // ⚠️ AUCUNE porte « boîtier muet » ici, et c'est VÉRIFIÉ, pas supposé : côté serveur
    // (EngineControlService) la dormance ne suspend QUE la coupe automatique du planning
    // (`source === 'SCHEDULER'`). Une coupe MANUELLE part toujours, TCP puis repli SMS —
    // un boîtier peut avoir perdu sa data tout en recevant encore ses SMS, et c'est
    // exactement sur un véhicule volé qu'on veut tenter sa chance. Griser ce bouton
    // supprimerait le dernier levier disponible sur le seul cas qui compte vraiment.
    // On ne cache donc pas le fait : il est AFFICHÉ (cf. dormantWarning) dans le bouton,
    // dans la confirmation et dans le toast, pour que personne ne croie à un succès.

    // V1.11 Phase 1 — Permission per-vehicle. Admin bypass deja gere par perms.can.
    const vid = this.effectiveVehicleId();
    if (!vid) {
      return { allowed: false as const, reason: 'Vehicule non identifie' };
    }
    if (!this.perms.can('engine_control', vid)) {
      return { allowed: false as const, reason: 'Permission insuffisante' };
    }

    // Sprint 3 — VEILLEUR (NIGHT_WATCHMAN) : aucune donnée de position ne lui est servie
    // (le client ne reçoit ni vitesse, ni fix, ni âge — cf. liste épurée « zéro donnée »).
    // On NE peut donc PAS pré-valider l'immobilité côté client : on autorise l'envoi et on
    // laisse le SERVEUR seul juge (engine-control.service, bloc NIGHT_WATCHMAN, refuse une
    // coupe en mouvement avec un message clair affiché en toast). Sans ce court-circuit le
    // bouton resterait désactivé (« Aucune position connue ») et le veilleur ne pourrait
    // jamais couper depuis la liste.
    if (this.authService.isWatchman()) {
      // Fix veilleur — le client veilleur ne reçoit AUCUNE position, mais reçoit un flag
      // « en mouvement » minimal (hydraté via /vehicles + transitions WS VEHICLE_MOVEMENT).
      // Si le véhicule roule, on grise le bouton (au lieu d'un rouge trompeur) : la coupe
      // est réservée à l'arrêt. Si l'état est inconnu / à l'arrêt, on autorise l'envoi et
      // le SERVEUR reste seul juge (refus clair en toast si mouvement détecté côté backend).
      if (this.realtime.movingTrackerIds().has(this.trackerId())) {
        return {
          allowed: false as const,
          reason: 'Véhicule en mouvement — coupure réservée à l\'arrêt',
        };
      }
      return { allowed: true as const, reason: null };
    }

    const age = this.positionAge();
    if (age === undefined) {
      return { allowed: false as const, reason: 'Aucune position connue' };
    }
    const speed = this.currentSpeedKmh();
    // À l'arrêt (≤5 km/h) → pas de seuil stale, véhicule garé sans risque.
    // En mouvement → position fraîche (<60s) exigée pour confirmer la vitesse.
    const isAtRest = speed === undefined || speed <= 5;
    if (!isAtRest && age > 60) {
      return { allowed: false as const, reason: `Position trop ancienne (${Math.round(age)}s)` };
    }
    if (!this.validFix()) {
      return { allowed: false as const, reason: 'Fix GPS invalide' };
    }
    if (speed !== undefined && speed > 20) {
      return { allowed: false as const, reason: `Vitesse trop élevée (${speed.toFixed(1)} km/h)` };
    }
    return { allowed: true as const, reason: null };
  });

  readonly canRestore = computed(() => {
    const vid = this.effectiveVehicleId();
    if (!vid) return false;
    return this.perms.can('engine_control', vid);
  });

  /**
   * ══ C4 — L'ÉTAT DU MOTEUR, DIT EN TOUTES LETTRES (incident CDEF31 du 24/09/2026) ═══════════
   *
   * `isCutActive()` répond oui/non ; il manquait la nuance entre une coupure CONFIRMÉE et une
   * coupure COMMANDÉE mais pas encore prouvée. Pour l'opérateur de nuit ce n'est pas un détail :
   * « en attente » veut dire « ne considérez pas ce véhicule comme immobilisé ».
   *
   * Lecture alignée sur `isCutActive()` — quand la liste des commandes est servie (tous rôles,
   * veilleur compris depuis C7), l'état vient d'elle (`etatDepuisListe`) ; sinon de l'overlay
   * temps réel. Les deux distinguent confirmé et en attente.
   *
   * 08/10/2026 — l'ancienne lecture disait « une coupe active y est forcément ACQUITTÉE » : c'est
   * précisément ce qui cachait une coupure exécutée mais non acquittée (incident des 06 et 07/10).
   */
  protected readonly etatMoteur = computed<'coupe' | 'attente' | 'actif'>(() => {
    const etat = this.etatDepuisListe();
    if (etat !== null) return etat === 'actif' ? 'actif' : etat === 'coupe' ? 'coupe' : 'attente';
    if (!this.isCutActive()) return 'actif';
    return this.realtime.cutActiveTrackerIds().has(this.trackerId()) ? 'coupe' : 'attente';
  });

  protected readonly etatMoteurLibelle = computed<string>(() => {
    switch (this.etatMoteur()) {
      case 'coupe': return 'Moteur coupé';
      case 'attente': return 'Coupure non confirmée';
      default: return 'Moteur actif';
    }
  });

  /**
   * C4 — chaque bouton ne s'active que pour l'action qui a un SENS dans l'état courant. Couper un
   * véhicule déjà coupé, ou rallumer un véhicule qui tourne, n'a jamais été utile : c'était
   * seulement le moyen, pour un clic de trop, de défaire le geste précédent.
   */
  protected readonly peutCouperMaintenant = computed(
    // Coupure échue sans preuve (« nul ne sait ») : renvoyer la coupure a un sens, comme rallumer.
    () => (!this.isCutActive() || this.etatDepuisListe() === 'non-confirmee') && this.canCut().allowed,
  );
  protected readonly peutRallumerMaintenant = computed(
    () => this.isCutActive() && this.canRestore(),
  );

  protected readonly motifCoupeIndisponible = computed<string | null>(() => {
    if (this.peutCouperMaintenant()) return null;
    if (this.etatDepuisListe() === 'en-vol') {
      return 'Une coupure est déjà partie : le boîtier ne l’a pas encore confirmée.';
    }
    if (this.isCutActive() && this.etatDepuisListe() !== 'non-confirmee') return 'Le moteur est déjà coupé.';
    return this.canCut().reason ?? 'Coupure indisponible.';
  });

  /**
   * 06 et 07/10/2026 — une coupure sans preuve : on dit à l'opérateur ce qu'il PEUT faire, pas
   * seulement ce qu'il ne peut pas. C'est la phrase qui a manqué au veilleur deux soirs de suite.
   */
  protected readonly aideCoupureNonConfirmee = computed<string | null>(() => {
    if (!this.peutRallumerMaintenant()) return null;
    switch (this.etatDepuisListe()) {
      case 'en-vol':
        return 'Coupure envoyée, pas encore confirmée par le boîtier : elle peut s’appliquer à tout moment. Si le véhicule doit repartir, utilisez « Rallumer ».';
      case 'non-confirmee':
        return 'Le boîtier n’a jamais confirmé cette coupure : l’état réel du véhicule est inconnu. « Rallumer » le libère, « Couper » renvoie la coupure.';
      default:
        return null;
    }
  });

  protected readonly motifRallumageIndisponible = computed<string | null>(() => {
    if (this.peutRallumerMaintenant()) return null;
    if (!this.isCutActive()) return 'Le moteur n’est pas coupé.';
    return 'Vous n’avez pas le droit de rallumer ce véhicule.';
  });

  /**
   * C4 — LA RAISON SORT DE L'INFOBULLE, DANS LES DEUX SENS.
   *
   * Une infobulle n'existe pas au doigt, et le mobile est l'usage principal. Elle sortait déjà
   * pour un refus de COUPE ; elle ne sortait pas pour un rallumage impossible — exactement le
   * cas de la nuit du 24/09, où un véhicule coupé par le planning n'offrait aucun bouton et
   * aucune explication. L'opératrice a fait défiler la page de 0 à 100 % à la recherche d'une
   * commande qui n'était nulle part.
   */
  protected readonly motifBloquantAffiche = computed<string | null>(() => {
    if (this.isCutActive()) return this.canRestore() ? null : this.motifRallumageIndisponible();
    return this.canCut().allowed ? null : this.canCut().reason ?? null;
  });

  /**
   * Avertissement inséré dans les DEUX confirmations quand le boîtier est muet.
   *
   * C'est le moment décisif : l'opérateur s'apprête à considérer le geste comme fait.
   * Le dire ici, avant le clic, est ce qui empêche la fausse certitude — pas un grisage
   * qui, lui, retirerait le seul levier restant sur un véhicule volé.
   */
  private readonly dormantConfirmNotice = computed(() => {
    const d = this.dormantWarning();
    if (!d) return '';
    return (
      `<br><br><span class="text-amber-400 text-xs">Attention : le boîtier n'a plus émis depuis ` +
      `<strong>${d.silence}</strong>. La commande sera tentée (canal de secours) mais aucune confirmation ` +
      `n'est à attendre — à vérifier physiquement.</span>`
    );
  });

  /**
   * L'ETAT DE L'OBJET, rappele dans la confirmation (marqueur n° 2 du niveau critique).
   *
   * On ne demande pas « etes-vous sur ? » dans le vide : on redit ce que le vehicule fait
   * A CET INSTANT. « Roule a 74 km/h » n'est pas la meme decision que « a l'arret ». Les
   * trois faits qui changent le sens du geste, dans l'ordre de gravite : il roule, son
   * boitier est muet, le contact est coupe.
   */
  protected readonly etatVehicule = computed<string>(() => {
    const bouts: string[] = [];
    const v = this.currentSpeedKmh();
    if (v != null && v > 0) bouts.push(`roule à ${Math.round(v)} km/h`);
    else if (this.ignition()) bouts.push("à l'arrêt, contact mis");
    else bouts.push('contact coupé');

    const muet = this.dormantWarning();
    if (muet) bouts.push(`boîtier muet depuis ${muet.silence}`);
    else if (!this.validFix()) bouts.push('position non confirmée');

    return `${this.vehiclePlate()} — ${bouts.join(' · ')}`;
  });

  protected readonly cutDescription = computed(
    () => {
      const duree = this.scheduleEnabled() && !this.durableImmobilize()
        ? `Le mode horaire reste actif : le véhicule sera de nouveau libéré à sa prochaine ` +
          `plage autorisée, sans devoir réactiver ses horaires.`
        : `Le conducteur sera impacté immédiatement et le véhicule deviendra inutilisable ` +
          `jusqu'à réactivation manuelle.`;
      return `Vous êtes sur le point d'immobiliser le véhicule <strong>${this.vehiclePlate()}</strong>.<br><br>` +
        duree + `<br><br><span class="text-fg-secondary text-xs">Cette action sera enregistrée dans l'audit trail.</span>` +
        this.dormantConfirmNotice();
    },
  );

  /**
   * Ce que la coupure coûte, en clair. La description dit le geste ; ceci dit le prix —
   * un véhicule immobilisé jusqu'à une action HUMAINE, pas jusqu'à la fin d'un délai.
   * Le kit exige que la conséquence soit nommée à part du reste : c'est elle qu'on lit
   * quand on hésite.
   *
   * Le niveau CRITIQUE de la modale (liseré rouge, état rappelé, glissement complet) est
   * spécifié pour cet écran par `B1-PAGES.md` § F « Coupure moteur ». Il se branche au
   * lot B-pages : ajouter un geste continu à une commande d'urgence est une décision d'écran, pas
   * une décision de kit.
   */
  protected readonly cutConsequences = computed(
    () => {
      if (this.scheduleEnabled() && !this.durableImmobilize()) {
        return `Les horaires de ${this.vehiclePlate()} restent activés. La coupure manuelle `
          + `ne supprime pas le planning : celui-ci reprendra automatiquement et enverra le `
          + `rallumage à la prochaine plage autorisée.`;
      }
      if (this.scheduleEnabled() && this.durableImmobilize()) {
        return `${this.vehiclePlate()} sortira du planning horaire. Un rallumage manuel le rendra `
          + `utilisable, mais ses horaires devront être réactivés séparément.`;
      }
      return `Le véhicule ${this.vehiclePlate()} ne redémarrera plus tant que personne ne l'aura `
        + 'réactivé depuis Tracky. Le conducteur en cours de trajet est concerné dès la '
        + 'prochaine coupure du contact.';
    },
  );

  protected readonly restoreDescription = computed(() => {
    const base = `Le véhicule <strong>${this.vehiclePlate()}</strong> sera à nouveau utilisable.`;
    if (this.scheduleEnabled()) {
      return (
        base +
        `<br><br><span class="text-fg-secondary text-xs">Le mode horaire reste actif : cette action ` +
        `tient jusqu'à la prochaine bascule, puis le planning reprend automatiquement.</span>` +
        this.dormantConfirmNotice()
      );
    }
    return base + this.dormantConfirmNotice();
  });

  /**
   * Dernier événement temps réel traité pour CE boîtier. La carte des événements est remplacée à
   * chaque événement de N'IMPORTE QUEL boîtier : sans ce repère, chaque bouton déjà concerné
   * relisait sa liste à chaque commande de la flotte — 30 boutons × 90 événements dans la vague de
   * 22:00, assez pour heurter la limite de 100 requêtes par minute et faire échouer la lecture
   * (l'écran retombe alors sur l'overlay, moins précis). Seul un événement NOUVEAU de ce boîtier
   * recharge la liste (08/10/2026).
   */
  private dernierEvenementTraite: unknown = undefined;

  // React to real-time engine command updates for this tracker (field initializer = injection context)
  private readonly engineUpdateEffect = effect(() => {
    const update = this.realtime.engineCommandUpdates().get(this.trackerId());
    if (update && update !== this.dernierEvenementTraite) {
      this.dernierEvenementTraite = update;
      this.loadRecentCommands();
    }
  });

  ngOnInit(): void {
    this.loadRecentCommands();
    this.loadScheduleStatus();
  }

  /**
   * ══ C5 — LA MODALE S'OUVRE D'ABORD, LE RÉSEAU ENSUITE (incident CDEF31 du 24/09/2026) ══════
   *
   * Ce clic ATTENDAIT un aller-retour HTTP avant de rien afficher : `loadScheduleStatus()` lit
   * `/api/vehicles/:id/schedule`, et la modale n'apparaissait qu'après sa réponse. Quand l'API est
   * lente — ou en cours de recréation, ce qui était le cas cette nuit-là — le bouton ne fait donc
   * RIEN de visible. Rien : pas de modale, pas d'indicateur, pas de message.
   *
   * C'est la mesure qui l'a montré : 23 clics sur « rallumer » en six secondes à 01h51:08, pour
   * UNE commande créée. On ne clique pas vingt-trois fois sur un bouton qui répond.
   *
   * Désormais l'ouverture est IMMÉDIATE et la lecture du planning se fait derrière : la case
   * « immobilisation durable » apparaît toute seule quand la réponse arrive. Un geste d'opérateur
   * ne doit jamais dépendre d'un réseau pour produire un retour visible.
   */
  protected async openAction(action: 'cut' | 'restore'): Promise<void> {
    this.durableImmobilize.set(false);
    this.isOpen.set(action);
    // Après l'ouverture, et volontairement non bloquant : `scheduleEnabled` est un signal, la
    // modale se met à jour d'elle-même. Un échec laisse la case masquée — l'état le plus sûr.
    await this.loadScheduleStatus();
  }

  protected async onConfirm(action: 'CUT' | 'RESTORE'): Promise<void> {
    const trackerId = this.trackerId();
    if (this.commandLocked() || !this.commandLocks.acquire(trackerId)) {
      // C5 — un clic avalé par le verrou se DIT. Le verrou est juste (il empêche deux intentions
      // concurrentes sur le même boîtier), mais il rendait la main en silence : depuis un autre
      // onglet ou une autre surface, l'opérateur voyait un bouton normal qui ne faisait rien.
      this.toast.info(
        'Commande déjà en cours',
        `Un envoi est en cours sur ${this.vehiclePlate()} — attendez sa réponse avant d’en lancer un autre.`,
      );
      return;
    }
    this.loading.set(true);
    // La fenêtre d'attente s'ouvre AVANT le réseau : dès le geste, l'écran dit « Envoi de l'ordre… »
    // et plus rien ne se clique. Elle tient le verrou jusqu'à l'issue de la commande.
    const jeton = this.ouvrirSuivi(action);
    const reasonText = action === 'CUT' ? this.reason() || undefined : undefined;
    // « Immobilisation durable » (case optionnelle, CUT uniquement) → désactive le planning (sortie
    // du mode horaire, cas anti-vol). Sinon l'action suspend juste le planning jusqu'à la prochaine
    // bascule côté backend (le mode reste actif).
    // Double garde UI : même si le DOM était manipulé, un utilisateur sans droit horaires
    // ne peut jamais fabriquer `disableSchedule:true` depuis ce composant.
    const durable = action === 'CUT' && this.durableImmobilize() && this.canDisableSchedule();
    // Fermer la modal DÈS la soumission (avant l'attente réseau), succès comme erreur/409 :
    // sinon elle reste ouverte par-dessus et masque le toast + la pastille. Cf smoke prod 2026-06-18.
    this.isOpen.set(null);
    this.reason.set('');
    this.durableImmobilize.set(false);
    try {
      const cmd = await firstValueFrom(
        this.engineControl.requestCommand(this.trackerId(), action, reasonText, durable || undefined),
      );
      // La fenêtre suit désormais CETTE commande (celle que le serveur rend : neuve, ou une intention
      // antérieure déjà en vol — cf. P0-1 ci-dessous).
      this.suivi.update((s) => (s && s.jeton === jeton ? { ...s, commandId: cmd.id } : s));
      if (durable) {
        this._scheduleEnabled.set(false);
        this.scheduleDisabled.emit();
      }
      // Sprint 2 — PAS de faux succes : on annonce "envoyee" ; la confirmation
      // (chute d'ignition) fera basculer l'etat coupe via le WS + commandState.
      // Boîtier muet : « en attente de confirmation » deviendrait mensonger — il n'y aura
      // PAS de confirmation. On le dit dans le toast, dernière chose lue avant de partir.
      const dormant = this.dormantWarning();
      // P0-1 (contre-expertise du 13/09) — le serveur peut rendre une intention ANTÉRIEURE au
      // clic : une RESTORE déjà en cours est réarmée (TCP puis SMS), une CUT en attente est
      // rendue telle quelle. Dire « enregistrée » avec un identifiant d'hier ferait croire à
      // une commande neuve. On nomme l'heure de l'intention et ce qui vient de lui arriver.
      const ageMs = Date.now() - new Date(cmd.createdAt).getTime();
      if (!this.demo.enabled() && Number.isFinite(ageMs) && ageMs > 60_000) {
        const depuis = new Date(cmd.createdAt).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        this.toast.show({
          kind: 'info',
          title: action === 'CUT' ? 'Coupure déjà en cours' : 'Rallumage déjà en cours',
          message:
            action === 'CUT'
              ? `Commande ${cmd.id.slice(0, 8)} créée à ${depuis} — toujours en attente de confirmation du boîtier.`
              : `Commande ${cmd.id.slice(0, 8)} créée à ${depuis} — réarmée à l’instant : envoi direct d’abord, puis secours, surveillée jusqu’à confirmation.`,
          duration: 9000,
        });
        await this.loadRecentCommands();
        return;
      }
      if (this.demo.enabled()) {
        // Démonstration : la dernière chose lue avant de partir doit redire qu'aucun véhicule
        // n'est concerné — et annoncer ce que l'écran va montrer, pour que ce soit compris
        // comme le comportement réel du produit, pas comme un effet de la démo.
        this.toast.show({
          kind: 'info',
          title: action === 'CUT' ? 'Coupure simulée envoyée' : 'Rallumage simulé envoyé',
          message:
            action === 'CUT'
              ? `Commande ${cmd.id.slice(0, 8)} — environnement de démonstration : aucun véhicule réel n'est concerné. Le boîtier simulé coupe le contact dans quelques secondes, et l'état passe à « confirmée » comme en réel.`
              : `Commande ${cmd.id.slice(0, 8)} — environnement de démonstration : le boîtier simulé reprend sa tournée.`,
          // Deux phrases à lire : le défaut de 4 s ne suffit pas.
          duration: 9000,
        });
      } else if (dormant) {
        // Le suivi est dans la fenêtre d'attente ; seul le boîtier MUET garde un toast : rien ne
        // reviendra confirmer son geste, et la fenêtre ne doit pas laisser croire le contraire.
        this.toast.show({
          kind: 'info',
          title: action === 'CUT' ? 'Coupure en cours' : 'Rallumage en cours',
          message: `Commande ${cmd.id.slice(0, 8)} — boîtier muet depuis ${dormant.silence} : vérification physique requise.`,
          duration: 8000,
        });
      }
      await this.loadRecentCommands();
    } catch (err) {
      swallow('engine-control-button:onConfirm', err);
      // Refusée ou en échec avant d'avoir une commande à suivre : la fenêtre s'efface, le toast parle.
      // Seulement SI elle est encore la nôtre : « Masquer » a pu la fermer, et une autre surface tenir le verrou.
      if (this.suivi()?.jeton === jeton) this.fermerSuivi();
      if (err instanceof HttpErrorResponse && err.status === 409) {
        this.toast.error(
          'Commande déjà en cours',
          'Une coupure est déjà en attente de confirmation sur ce véhicule.',
        );
      } else {
        this.toast.error(
          action === 'CUT' ? 'Coupure refusée' : 'Rallumage refusé',
          this.extractErrorMessage(err),
        );
      }
    } finally {
      this.loading.set(false);
      // Le verrou n'est JAMAIS relâché ici : la fenêtre d'attente le tient, et seul `fermerSuivi` le rend
      // (relecture du 29/10 : relâcher ici, après un « Masquer », libérait le verrou d'une autre surface).
    }
  }

  private async loadScheduleStatus(): Promise<void> {
    // Trouver le vehicleId depuis l'input ou le snapshot (fallback)
    let vid = this.vehicleId();
    if (!vid) {
      const snap = this.realtime.snapshot().find((v) => v.trackerId === this.trackerId());
      vid = snap?.vehicleId;
    }
    if (!vid) return;
    try {
      const schedule = await firstValueFrom(this.schedulesApi.get(vid));
      this._scheduleEnabled.set(!!schedule?.enabled);
    } catch (err) {
      swallow('engine-control-button:loadScheduleStatus', err);
      // Non critique
    }
  }

  private async loadRecentCommands(retries = 2): Promise<void> {
    try {
      const cmds = await firstValueFrom(
        this.engineControl.listCommands(this.trackerId(), PROFONDEUR_HISTORIQUE),
      );
      this.recentCommands.set(cmds);
    } catch (err) {
      swallow('engine-control-button:loadRecentCommands', err);
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 1000));
        return this.loadRecentCommands(retries - 1);
      }
      // Après retries épuisés, le bouton garde le dernier état connu
    }
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      // L'API enveloppe ses erreurs : `{ error: { code, message, requestId } }`.
      // On lit d'abord le message de l'enveloppe, puis les formes plates en repli —
      // sinon l'opérateur verrait « Http failure response … 403 » au lieu de la vraie
      // raison (ex. « Véhicule en mouvement (10 km/h) — coupure réservée à l'arrêt »).
      const body = err.error as { error?: { message?: string }; message?: string } | null;
      return body?.error?.message ?? body?.message ?? err.message ?? 'Erreur inconnue';
    }
    return String(err);
  }
}
