import { fakeAsync, TestBed, tick, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DemoModeService } from '../../core/services/demo-mode.service';
import { EngineControlService } from '../../core/services/engine-control.service';
import { EngineCommandLockService } from '../../core/services/engine-command-lock.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { VehicleSchedulesApiService } from '../../core/services/vehicle-schedules.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { EngineControlButtonComponent } from './engine-control-button.component';

/**
 * ══ C4 — LA BASCULE QUI A COÛTÉ UNE NUIT (incident CDEF31 du 24 septembre 2026) ══════════════
 *
 * Ce composant immobilise des véhicules, et n'avait aucun test.
 *
 * Il exposait UN bouton qui changeait de sens au même pixel : « Rallumer » quand le véhicule
 * était coupé, « Couper » sinon. Rallumer un véhicule ne le fait pas démarrer — le conducteur
 * doit encore tourner la clé. Le geste naturel, quand rien ne bouge, est donc de réappuyer :
 * et l'on recoupait. Trace mesurée en production sur GS-187-NY, par le même compte veilleur :
 * RESTORE 01:45:20 · CUT 01:47:31 · RESTORE 01:47:41 · CUT 01:48:40 · RESTORE 01:49:32 ·
 * RESTORE 01:49:36 · CUT 01:50:48 · RESTORE 01:51:10.
 *
 * Deux propriétés à tenir, et elles se testent séparément :
 *   1. L'ÉTAT est dit — plus jamais déduit du libellé de l'action.
 *   2. Un clic de trop ne peut plus DÉFAIRE le geste précédent : chaque bouton n'est actif que
 *      pour l'action qui a un sens dans l'état courant.
 *
 * Le rôle joué est le VEILLEUR dans la situation de CETTE NUIT-LÀ : sa liste `recentCommands`
 * est vide, et son état vient uniquement de l'overlay temps réel. C'était alors structurel — un
 * `403` sur `GET /engine-control/commands` — ; C7 a depuis ouvert la route.
 *
 * On continue de tester cette configuration, et ce n'est pas de la nostalgie : la liste est
 * TOUJOURS vide quand un boîtier n'a jamais reçu de commande, quand la lecture échoue, et au
 * premier rendu. Le repli sur l'overlay reste donc le chemin le plus fragile du composant.
 * Le dernier cas, lui, vérifie le chemin post-C7 : la liste servie.
 */
describe('C4 — engine-control-button : l’état est dit, et un clic de trop ne défait plus rien', () => {
  let fixture: ComponentFixture<EngineControlButtonComponent>;
  // Les assertions se lisent sur le DOM : ce que l’opérateur VOIT, pas ce que le composant pense.

  const TRACKER = 'tracker-1';
  const VEHICULE = 'vehicule-1';

  /** L'overlay temps réel : c'est LUI, et lui seul, qui porte l'état pour un veilleur. */
  let cutActifs: ReturnType<typeof signal<Set<string>>>;
  let cutEnAttente: ReturnType<typeof signal<Set<string>>>;
  let enMouvement: ReturnType<typeof signal<Set<string>>>;
  let droitMoteur: boolean;
  /** null = la liste échoue (repli sur l'overlay) ; sinon, la liste servie depuis C7. */
  let commandesServies: unknown[] | null;
  /** Profondeur demandée à l'API par le composant (08/10/2026 : 5 ne suffisait pas). */
  let profondeurDemandee: number | undefined;
  /** Nombre de lectures de la liste : un bouton ne la relit que pour un événement de SON boîtier. */
  let lecturesListe: number;
  /** Les événements ENGINE_COMMAND_UPDATED reçus par WebSocket, par boîtier. */
  let majCommandes: ReturnType<typeof signal<Map<string, unknown>>>;

  // Les réglages du CAS (droits, liste servie) se posent AVANT `creer()` et ne sont remis à
  // zéro qu'ici : les remettre dans `creer()` écraserait ce que le test vient d'écrire — piège
  // dans lequel ce fichier est tombé à sa première rédaction.
  beforeEach(() => {
    droitMoteur = true;
    commandesServies = null;
  });

  /**
   * Le rôle joué — le VEILLEUR par défaut (cf. en-tête). `isWatchman` et `user()` en dérivent
   * TOUS LES DEUX : le composant lit l'un pour la garde de coupe et l'autre pour le lien
   * « Voir l'historique » (voitHistorique). Un mock qui n'exposerait que le premier ferait
   * planter, sur « user is not a function », tout test qui affiche l'état « non confirmée ».
   */
  const creer = (options?: { role?: string }): void => {
    const role = options?.role ?? 'NIGHT_WATCHMAN';
    cutActifs = signal(new Set<string>());
    cutEnAttente = signal(new Set<string>());
    enMouvement = signal(new Set<string>());
    majCommandes = signal(new Map<string, unknown>());
    profondeurDemandee = undefined;
    lecturesListe = 0;

    TestBed.configureTestingModule({
      imports: [EngineControlButtonComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // « Voir l'historique » est un routerLink : sans routeur, pas de lien à rendre.
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { isWatchman: () => role === 'NIGHT_WATCHMAN', user: () => ({ role }) },
        },
        {
          provide: PermissionsService,
          useValue: { can: (perm: string) => (perm === 'engine_control' ? droitMoteur : false) },
        },
        {
          provide: RealtimeService,
          useValue: {
            snapshot: signal([{ trackerId: TRACKER, vehicleId: VEHICULE }]),
            cutActiveTrackerIds: cutActifs.asReadonly(),
            cutPendingTrackerIds: cutEnAttente.asReadonly(),
            movingTrackerIds: enMouvement.asReadonly(),
            engineCommandUpdates: majCommandes.asReadonly(),
          },
        },
        {
          provide: EngineControlService,
          useValue: {
            // Liste indisponible : le composant retombe sur l'overlay temps réel.
            listCommands: (_tracker: string, profondeur?: number) => {
              profondeurDemandee = profondeur;
              lecturesListe += 1;
              return commandesServies ? of(commandesServies) : throwError(() => new Error('403'));
            },
            requestCommand: () => of({}),
          },
        },
        { provide: EngineCommandLockService, useValue: { isLocked: () => false, acquire: () => true, release: () => undefined } },
        { provide: VehicleSchedulesApiService, useValue: { get: () => of({ enabled: false }) } },
        { provide: DemoModeService, useValue: { enabled: () => false } },
        { provide: ToastService, useValue: { error: () => undefined, success: () => undefined, info: () => undefined } },
      ],
    });

    fixture = TestBed.createComponent(EngineControlButtonComponent);
    fixture.componentRef.setInput('trackerId', TRACKER);
    fixture.componentRef.setInput('vehicleId', VEHICULE);
    fixture.componentRef.setInput('vehiclePlate', 'GS-187-NY');
    fixture.componentRef.setInput('trackLabel', 'Veilleur GS-187-NY');

    fixture.detectChanges();
  };

  /** Lecture du DOM : c'est ce que l'opérateur VOIT, pas ce que le composant pense. */
  const bouton = (sens: 'couper' | 'rallumer'): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`button[data-track="Veilleur GS-187-NY — ${sens}"]`);
  const texteEtat = (): string =>
    (fixture.nativeElement.querySelector('.ec-etat') as HTMLElement | null)?.textContent?.trim() ?? '';

  afterEach(() => TestBed.resetTestingModule());

  it('moteur actif : l’état est écrit, « Couper » est offert, « Rallumer » est refusé avec sa raison', () => {
    creer();
    expect(texteEtat()).toBe('Moteur actif');
    expect(bouton('couper')?.disabled).toBeFalse();
    expect(bouton('rallumer')?.disabled).toBeTrue();
    expect(bouton('rallumer')?.title).toContain('n’est pas coupé');
  });

  it('moteur coupé (confirmé) : l’état est écrit, « Rallumer » est offert, « Couper » est refusé', () => {
    creer();
    cutActifs.set(new Set([TRACKER]));
    fixture.detectChanges();

    expect(texteEtat()).toBe('Moteur coupé');
    expect(bouton('rallumer')?.disabled).toBeFalse();
    expect(bouton('couper')?.disabled).toBeTrue();
    expect(bouton('couper')?.title).toContain('déjà coupé');
  });

  it('coupure NON CONFIRMÉE : l’état le dit — « ne considérez pas ce véhicule comme immobilisé »', () => {
    creer();
    cutEnAttente.set(new Set([TRACKER]));
    fixture.detectChanges();

    expect(texteEtat()).toBe('Coupure non confirmée');
    // Le rallumage reste offert : c'est le seul levier si la coupe est partie pour de bon.
    expect(bouton('rallumer')?.disabled).toBeFalse();
  });

  it('🔴 LE TEST DE RÉGRESSION — les deux boutons existent TOUJOURS, à une place FIXE', () => {
    creer();
    // Moteur actif : les deux sont là.
    expect(bouton('couper')).withContext('« Couper » absent quand le moteur tourne').not.toBeNull();
    expect(bouton('rallumer')).withContext('« Rallumer » absent quand le moteur tourne').not.toBeNull();

    cutActifs.set(new Set([TRACKER]));
    fixture.detectChanges();

    // Moteur coupé : les deux sont TOUJOURS là, au même endroit.
    expect(bouton('couper')).withContext('« Couper » a disparu après la coupe').not.toBeNull();
    expect(bouton('rallumer')).withContext('« Rallumer » a disparu après la coupe').not.toBeNull();
  });

  it('🔴 LE TEST DE RÉGRESSION — un clic de trop ne peut PLUS défaire le geste précédent', () => {
    creer();
    // L'opérateur rallume : la commande part (état → moteur actif).
    cutActifs.set(new Set([TRACKER]));
    fixture.detectChanges();
    expect(bouton('rallumer')?.disabled).withContext('rallumage offert sur un véhicule coupé').toBeFalse();

    cutActifs.set(new Set());
    fixture.detectChanges();

    // Le véhicule ne démarre pas (il faut tourner la clé). Il réappuie AU MÊME ENDROIT.
    // Sous l'ancien code ce pixel portait désormais « Couper » : le véhicule était recoupé.
    expect(bouton('rallumer')?.disabled)
      .withContext('« Rallumer » doit être inerte, pas devenu « Couper »')
      .toBeTrue();
    // …et le bouton « Couper », lui, est ailleurs : le réappui ne peut pas l'atteindre.
    expect(bouton('couper')?.disabled).toBeFalse();
  });

  it('🔴 véhicule coupé mais SANS droit de rallumer : l’état reste visible, et la raison est ÉCRITE', () => {
    droitMoteur = false;
    creer();
    cutActifs.set(new Set([TRACKER]));
    fixture.detectChanges();

    // Le fait le plus important — « ce véhicule est immobilisé » — ne disparaît JAMAIS.
    // C'est ce qui manquait sur HD-443-QY : aucun bouton, aucune explication, et une page
    // parcourue de 0 à 100 % à la recherche d'une commande qui n'était nulle part.
    expect(texteEtat()).toBe('Moteur coupé');
    const refus = fixture.nativeElement.querySelector('.ec-refus') as HTMLElement | null;
    expect(refus?.textContent ?? '').toContain('droit de rallumer');
  });

  it('veilleur, véhicule en mouvement : « Couper » est refusé AVEC sa raison, en clair', () => {
    creer();
    enMouvement.set(new Set([TRACKER]));
    fixture.detectChanges();

    expect(bouton('couper')?.disabled).toBeTrue();
    const refus = fixture.nativeElement.querySelector('.ec-refus') as HTMLElement | null;
    expect(refus?.textContent ?? '').toContain('en mouvement');
  });

  it('🔴 C7 — quand la liste EST servie (veilleur admis), l’état vient d’elle et non de l’overlay', fakeAsync(() => {
    // Le chemin normal depuis C7 : plus besoin du WebSocket pour savoir qu'un véhicule est coupé.
    // C'est la réparation de fond — l'overlay n'est plus la seule source de vérité de ce rôle.
    //
    // `fakeAsync` et pas `async` : `loadRecentCommands` résout sa promesse dans une microtâche, et
    // hors `fakeAsync` cette continuation s'exécute HORS de la zone Angular — le signal est bien
    // mis à jour (on l'a vérifié) mais le gabarit ne se rafraîchit pas, et l'assertion lirait un
    // DOM périmé. Le test passerait ou échouerait pour une raison sans rapport avec le sujet.
    commandesServies = [
      { id: 'c1', trackerId: TRACKER, action: 'CUT', status: 'ACKNOWLEDGED', source: 'SCHEDULER',
        createdAt: new Date().toISOString(), sentAt: null, ackedAt: null, confirmationExpected: false,
        reason: null, lastError: null, requestedBy: '' },
    ];
    creer();
    tick();
    fixture.detectChanges();

    // L'overlay temps réel est resté VIDE — comme après une reconnexion qui a manqué des
    // événements. La liste servie suffit désormais.
    expect(texteEtat()).toBe('Moteur coupé');
    expect(bouton('rallumer')?.disabled).toBeFalse();
    expect(bouton('couper')?.disabled).toBeTrue();
  }));

  // ══ D1 — « VOIR L'HISTORIQUE » SEULEMENT POUR QUI PEUT L'OUVRIR (revue du 29/09) ═════════════
  //
  // /fleet-admin/activity n'admet que FLEET_ADMIN et SUPER_ADMIN (roleGuard, app.routes.ts). Le
  // veilleur et le gestionnaire à qui l'on a donné engine_control voyaient pourtant le lien, au
  // moment de savoir si le véhicule était immobilisé : un clic, et rien — le veilleur restait sur
  // /vehicles, le gestionnaire repartait au tableau de bord. `fakeAsync` pour la même raison que
  // le cas C7 ci-dessus : la liste servie arrive dans une microtâche.

  /** Une coupe partie il y a cinq minutes et jamais confirmée : l'état « non confirmée ». */
  const servirCoupeNonConfirmee = (): void => {
    commandesServies = [
      { id: 'c2', trackerId: TRACKER, action: 'CUT', status: 'SENT', source: 'MANUAL',
        createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        sentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        ackedAt: null, confirmationExpected: true, reason: null, lastError: null, requestedBy: '' },
    ];
  };
  const sorties = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.ec-nc .ec-sortie') as NodeListOf<HTMLElement>)
      .map((e) => e.textContent?.trim() ?? '');
  const lienHistorique = (): HTMLAnchorElement | null => fixture.nativeElement.querySelector('a.ec-sortie');

  for (const role of ['NIGHT_WATCHMAN', 'FLEET_MANAGER']) {
    it(`🔴 D1 — ${role}, coupe NON CONFIRMÉE : trois sorties (dont la synchronisation, 29/10), et aucun lien vers une page qui le refoule`, fakeAsync(() => {
      servirCoupeNonConfirmee();
      creer({ role });
      tick();
      fixture.detectChanges();

      // Le bandeau est bien là — sinon l'absence du lien ne prouverait rien.
      expect(fixture.nativeElement.querySelector('.ec-nc')).withContext('bandeau « non confirmée » absent').not.toBeNull();
      expect(lienHistorique()).withContext('lien mort offert à ' + role).toBeNull();
      expect(sorties()).toEqual(['Renvoyer la commande', 'Synchroniser le boîtier', "J'ai vérifié sur place"]);
    }));
  }

  it('D1 — FLEET_ADMIN, coupe NON CONFIRMÉE : « Voir l’historique » mène à l’onglet Moteurs, pas à Agenda', fakeAsync(() => {
    servirCoupeNonConfirmee();
    creer({ role: 'FLEET_ADMIN' });
    tick();
    fixture.detectChanges();

    const lien = lienHistorique();
    expect(lien).withContext('lien absent pour un rôle que la route admet').not.toBeNull();
    // L'onglet Agenda est devenu l'onglet par défaut de la page : sans `tab=engine`, le lien
    // ouvrirait l'agenda au moment où l'on cherche la trace d'une coupe.
    expect(lien?.getAttribute('href') ?? '').toContain('/fleet-admin/activity');
    expect(lien?.getAttribute('href') ?? '').toContain('tab=engine');
    expect(sorties().length).toBe(4); // renvoyer, historique, synchroniser, « vérifié sur place »
  }));

  // ══ 06 et 07/10/2026 — LA COUPURE EXÉCUTÉE MAIS NON ACQUITTÉE ═══════════════════════════════
  //
  // Deux soirs de suite, un véhicule de CDEF31 a été coupé (planning le 06/10, veilleur le 07/10)
  // sans que l'accusé arrive à temps : le boîtier avait différé la coupure, son écho est arrivé
  // après les 15 s du serveur. La commande est restée SENT. Avec la liste servie (veilleur depuis
  // C7), l'écran disait « Moteur actif », « Rallumer » grisé, « Couper » offert : le veilleur a
  // recoupé onze fois, puis appelé. Débloqué deux fois par SMS manuel.
  //
  // Les séquences ci-dessous sont celles de la base de production, du plus récent au plus ancien
  // (ordre de l'API), dates rapportées à « maintenant ».

  /** Une ligne de la liste servie. `ilYaMin` : âge de la commande. */
  const ligne = (
    action: 'CUT' | 'RESTORE',
    status: string,
    ilYaMin: number,
    autres: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const quand = new Date(Date.now() - ilYaMin * 60_000).toISOString();
    return {
      id: `${action}-${status}-${ilYaMin}`, trackerId: TRACKER, action, status, source: 'MANUAL',
      createdAt: quand, sentAt: status === 'REJECTED_SPEED' ? null : quand,
      ackedAt: status === 'ACKNOWLEDGED' ? quand : null, confirmationExpected: false,
      reason: null, lastError: null, requestedBy: '', ...autres,
    };
  };
  const aide = (): string =>
    (fixture.nativeElement.querySelector('.ec-aide') as HTMLElement | null)?.textContent?.trim() ?? '';

  it('🔴 07/10 23:06 — coupure partie mais NON ACQUITTÉE : « Rallumer » est OFFERT, « Couper » refusé avec sa raison', fakeAsync(() => {
    commandesServies = [
      ligne('CUT', 'REJECTED_SPEED', 0.5), // 23:08:35 — « arrêté depuis seulement 44 s »
      ligne('CUT', 'REJECTED_SPEED', 1), //   23:08:18 — « arrêté depuis seulement 27 s »
      ligne('CUT', 'SENT', 2), //             23:06:45 — TCP écrit, accusé hors délai : reste SENT
      ligne('RESTORE', 'ACKNOWLEDGED', 60 * 16), // 07:22 — rallumage du matin, acquitté
      ligne('CUT', 'ACKNOWLEDGED', 60 * 17), //     05:55 — coupure du matin, acquittée
    ];
    creer();
    tick();
    fixture.detectChanges();

    // Sous l'ancien code : « Moteur actif », « Rallumer » grisé, « Couper » offert.
    expect(texteEtat()).toBe('Coupure non confirmée');
    expect(bouton('rallumer')?.disabled).withContext('le seul geste utile cette nuit-là').toBeFalse();
    expect(bouton('couper')?.disabled).withContext('une coupure en vol suffit : pas de recoupe en rafale').toBeTrue();
    expect(bouton('couper')?.title).toContain('déjà partie');
    expect(aide()).toContain('« Rallumer »');
  }));

  it('🔴 06/10 22:40 — coupure ÉCHUE sans preuve (SENT_UNCONFIRMED) : nul ne sait, les DEUX gestes sont offerts', fakeAsync(() => {
    commandesServies = [
      ligne('CUT', 'SENT_UNCONFIRMED', 35, { source: 'SCHEDULER' }),
      ligne('RESTORE', 'ACKNOWLEDGED', 60 * 15, { source: 'SCHEDULER' }),
    ];
    creer();
    tick();
    fixture.detectChanges();

    expect(texteEtat()).toBe('Coupure non confirmée');
    expect(bouton('rallumer')?.disabled).toBeFalse();
    expect(bouton('couper')?.disabled).withContext('« nul ne sait » : renvoyer la coupure a un sens').toBeFalse();
    expect(aide()).toContain('inconnu');
  }));

  it('un rallumage ACQUITTÉ plus récent que la coupure non confirmée : moteur actif, rien d’autre à dire', fakeAsync(() => {
    commandesServies = [
      ligne('RESTORE', 'ACKNOWLEDGED', 1),
      ligne('CUT', 'SENT_UNCONFIRMED', 40),
    ];
    creer();
    tick();
    fixture.detectChanges();

    expect(texteEtat()).toBe('Moteur actif');
    expect(bouton('rallumer')?.disabled).toBeTrue();
    expect(bouton('couper')?.disabled).toBeFalse();
    expect(aide()).toBe('');
  }));

  // Ce que ce cas PROUVE : la profondeur demandée à l'API (20). Le faux service rend toujours ses
  // huit lignes, quelle que soit la profondeur ; l'affichage est vérifié, la fenêtre ne l'est pas.
  it('🔴 la liste lue passe à 20 lignes (avec 5, six refus sortaient la coupure de la fenêtre)', fakeAsync(() => {
    commandesServies = [
      ...[1, 2, 3, 4, 5, 6].map((n) => ligne('CUT', 'REJECTED_SPEED', n / 10)),
      ligne('CUT', 'SENT', 2),
      ligne('RESTORE', 'ACKNOWLEDGED', 60),
    ];
    creer();
    tick();
    fixture.detectChanges();

    // Avec 5 lignes, la coupure en vol tombait hors de la fenêtre dès le cinquième refus.
    expect(profondeurDemandee).toBe(20);
    expect(texteEtat()).toBe('Coupure non confirmée');
    expect(bouton('rallumer')?.disabled).toBeFalse();
  }));

  it('une observation de contact (DEVICE_OBSERVED) ne fait pas un véhicule coupé — même règle que le serveur', fakeAsync(() => {
    commandesServies = [ligne('CUT', 'ACKNOWLEDGED', 3, { source: 'DEVICE_OBSERVED' })];
    creer();
    tick();
    fixture.detectChanges();

    expect(texteEtat()).toBe('Moteur actif');
    expect(bouton('rallumer')?.disabled).toBeTrue();
  }));

  it('🔴 l’écho tardif rapproché par le serveur arrive par WebSocket : l’écran passe à « Moteur coupé » sans rechargement', fakeAsync(() => {
    commandesServies = [ligne('CUT', 'SENT', 1), ligne('RESTORE', 'ACKNOWLEDGED', 60)];
    creer();
    tick();
    fixture.detectChanges();
    expect(texteEtat()).toBe('Coupure non confirmée');

    // 69 s après l'ordre, le boîtier répond `jt` ; le serveur acquitte la commande et la diffuse.
    commandesServies = [ligne('CUT', 'ACKNOWLEDGED', 1), ligne('RESTORE', 'ACKNOWLEDGED', 60)];
    majCommandes.set(new Map([[TRACKER, { commandId: 'CUT-SENT-1', trackerId: TRACKER, action: 'CUT', status: 'ACKNOWLEDGED' }]]));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(texteEtat()).toBe('Moteur coupé');
    expect(bouton('rallumer')?.disabled).toBeFalse();
    expect(bouton('couper')?.title).toContain('déjà coupé');
    expect(aide()).toBe('');
  }));

  it('une coupure restée PENDING au-delà de 2 min est orpheline : « Couper » redevient offert (le serveur la renverra)', fakeAsync(() => {
    commandesServies = [ligne('CUT', 'PENDING', 5), ligne('RESTORE', 'ACKNOWLEDGED', 60)];
    creer();
    tick();
    fixture.detectChanges();

    expect(texteEtat()).toBe('Coupure non confirmée');
    expect(bouton('rallumer')?.disabled).toBeFalse();
    expect(bouton('couper')?.disabled).withContext('sinon grisé pour toujours').toBeFalse();
  }));

  it('une coupure PENDING récente est en vol : « Couper » reste refusé', fakeAsync(() => {
    commandesServies = [ligne('CUT', 'PENDING', 0.5), ligne('RESTORE', 'ACKNOWLEDGED', 60)];
    creer();
    tick();
    fixture.detectChanges();

    expect(bouton('couper')?.disabled).toBeTrue();
    expect(bouton('rallumer')?.disabled).toBeFalse();
  }));

  it('🔴 un événement d’un AUTRE boîtier ne relit pas la liste de celui-ci — un événement neuf du sien, une fois', fakeAsync(() => {
    // Avant : la carte des événements change à chaque commande de la flotte, et chaque bouton déjà
    // concerné relisait sa liste — 30 boutons × 90 événements dans la vague de 22:00.
    commandesServies = [ligne('CUT', 'SENT', 1), ligne('RESTORE', 'ACKNOWLEDGED', 60)];
    creer();
    tick();
    fixture.detectChanges();
    const evtSien = { commandId: 'x', trackerId: TRACKER, action: 'CUT', status: 'SENT' };
    majCommandes.set(new Map([[TRACKER, evtSien]]));
    fixture.detectChanges();
    tick();
    const apresSien = lecturesListe;

    // Trois événements d'autres boîtiers : la carte change, l'entrée de CE boîtier non.
    for (const autre of ['t-2', 't-3', 't-4']) {
      majCommandes.set(new Map([...majCommandes(), [autre, { trackerId: autre }]]));
      fixture.detectChanges();
      tick();
    }
    expect(lecturesListe).withContext('relu pour des commandes qui ne le concernent pas').toBe(apresSien);

    // Un nouvel événement de CE boîtier : une lecture, une seule.
    majCommandes.set(new Map([...majCommandes(), [TRACKER, { ...evtSien, status: 'ACKNOWLEDGED' }]]));
    fixture.detectChanges();
    tick();
    expect(lecturesListe).toBe(apresSien + 1);
  }));
});
