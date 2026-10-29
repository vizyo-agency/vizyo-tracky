import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { discardPeriodicTasks, fakeAsync, TestBed, tick, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DemoModeService } from '../../core/services/demo-mode.service';
import { EngineCommandLockService } from '../../core/services/engine-command-lock.service';
import { EngineControlService, type EngineControlCommandDto } from '../../core/services/engine-control.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { VehicleSchedulesApiService } from '../../core/services/vehicle-schedules.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { EngineControlButtonComponent } from './engine-control-button.component';

/**
 * ══ LA FENÊTRE D'ATTENTE DE COMMANDE (29/10/2026) ═══════════════════════════════════════════════
 *
 * Après le glissement de confirmation, la modale se fermait et il ne restait qu'un toast : rien ne
 * disait où en était l'ordre, et le bouton redevenait cliquable. Chez CDEF31, le 06/10, un veilleur a
 * recoupé onze fois de suite en attendant un signe. Ces tests tiennent les propriétés de la fenêtre
 * qui s'ouvre à l'instant du geste : elle est là AVANT la réponse du serveur, elle BLOQUE (le verrou
 * du boîtier est tenu), elle dit l'issue vraie — jamais un succès que le boîtier n'a pas donné — et
 * elle rend la main, verrou relâché, dans tous les cas.
 */
describe('engine-control-button — la fenêtre d’attente de commande', () => {
  const TRACKER = 'tracker-971';
  const VEHICULE = 'vehicule-971';
  let fixture: ComponentFixture<EngineControlButtonComponent>;
  let verrous: EngineCommandLockService;
  let reponseHttp: Subject<EngineControlCommandDto>;
  let commandesServies: EngineControlCommandDto[];
  let appels: number;
  let toastErreur: jasmine.Spy;
  let toastInfo: jasmine.Spy;
  let refus: unknown;
  let synchros: string[];
  let synchrosCommandes: string[];
  let syncErreur: unknown;

  const commande = (over: Partial<EngineControlCommandDto> = {}): EngineControlCommandDto => ({
    id: 'cmd-1',
    trackerId: TRACKER,
    action: 'CUT',
    status: 'SENT',
    reason: null,
    source: 'MANUAL',
    lastError: null,
    requestedBy: 'u1',
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    confirmationExpected: false,
    ackedAt: null,
    channel: 'TCP',
    attemptCount: 1,
    ...over,
  });

  const creer = (): void => {
    reponseHttp = new Subject<EngineControlCommandDto>();
    commandesServies = [];
    appels = 0;
    refus = null;
    synchros = [];
    synchrosCommandes = [];
    syncErreur = null;
    toastErreur = jasmine.createSpy('error');
    toastInfo = jasmine.createSpy('info');
    TestBed.configureTestingModule({
      imports: [EngineControlButtonComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { isWatchman: () => true, user: () => ({ role: 'NIGHT_WATCHMAN' }) } },
        { provide: PermissionsService, useValue: { can: () => true } },
        {
          provide: RealtimeService,
          useValue: {
            snapshot: signal([{ trackerId: TRACKER, vehicleId: VEHICULE }]),
            cutActiveTrackerIds: signal(new Set<string>()).asReadonly(),
            cutPendingTrackerIds: signal(new Set<string>()).asReadonly(),
            movingTrackerIds: signal(new Set<string>()).asReadonly(),
            engineCommandUpdates: signal(new Map<string, unknown>()).asReadonly(),
          },
        },
        {
          provide: EngineControlService,
          useValue: {
            listCommands: () => of(commandesServies),
            requestCommand: () => {
              appels += 1;
              return refus ? throwError(() => refus) : reponseHttp.asObservable();
            },
            synchroniser: (trackerId: string, commandId: string) => {
              synchros.push(trackerId);
              synchrosCommandes.push(commandId);
              return syncErreur ? throwError(() => syncErreur) : of(commande({ channel: 'SMS' }));
            },
          },
        },
        // Le VRAI verrou : c'est lui qui empêche le second ordre, pas un mock qui dit toujours oui.
        EngineCommandLockService,
        { provide: VehicleSchedulesApiService, useValue: { get: () => of({ enabled: false }) } },
        { provide: DemoModeService, useValue: { enabled: () => false } },
        { provide: ToastService, useValue: { error: toastErreur, success: () => undefined, info: toastInfo, show: () => undefined } },
      ],
    });
    verrous = TestBed.inject(EngineCommandLockService);
    fixture = TestBed.createComponent(EngineControlButtonComponent);
    fixture.componentRef.setInput('trackerId', TRACKER);
    fixture.componentRef.setInput('vehicleId', VEHICULE);
    fixture.componentRef.setInput('vehiclePlate', 'MH-971-TD');
    fixture.detectChanges();
  };

  const confirmer = (action: 'CUT' | 'RESTORE'): Promise<void> =>
    (fixture.componentInstance as unknown as { onConfirm: (a: string) => Promise<void> }).onConfirm(action);
  // Le voile vit à la RACINE du document (hors du bouton) : on le lit là, comme l'opérateur le voit.
  const voile = (): HTMLElement | null => document.body.querySelector('.ec-suivi-voile');
  const texte = (sel: string): string => (document.body.querySelector(sel) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const maj = (): void => fixture.detectChanges();
  const finir = (): void => {
    fixture.destroy();
    discardPeriodicTasks();
  };

  afterEach(() => TestBed.resetTestingModule());

  it('🔴 la fenêtre est là AVANT la réponse du serveur — dès le geste, l’écran dit « Envoi de l’ordre »', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    maj();

    expect(voile()).withContext('fenêtre absente avant la réponse HTTP').not.toBeNull();
    expect(texte('.ec-suivi-titre')).toBe('Coupure du moteur en cours');
    expect(texte('.ec-suivi-plaque')).toBe('MH-971-TD');
    expect(texte('.ec-suivi-msg')).toContain('Envoi de l’ordre');
    finir();
  }));

  it('🔴 elle BLOQUE : le boîtier reste verrouillé tant qu’elle est ouverte — un second ordre est refusé, aucune requête', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    reponseHttp.next(commande({ status: 'SENT' }));
    commandesServies = [commande({ status: 'SENT' })];
    tick(0);
    maj();

    expect(verrous.isLocked(TRACKER)).withContext('verrou relâché pendant l’attente').toBeTrue();
    void confirmer('CUT');
    tick(0);
    expect(appels).withContext('un second ordre est parti').toBe(1);
    expect(toastInfo).toHaveBeenCalled();
    finir();
  }));

  it('suit la commande : « Envoyé au boîtier » est fait, la confirmation est en cours', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(0);
    maj();

    expect(texte('.ec-suivi-msg')).toContain('répond en général en quelques secondes');
    const etapes = Array.from(document.body.querySelectorAll('.ec-suivi-etape') as NodeListOf<HTMLElement>);
    expect(etapes.map((e) => e.className)).toEqual([
      jasmine.stringContaining('--fait'),
      jasmine.stringContaining('--fait'),
      jasmine.stringContaining('--en-cours'),
    ]);
    finir();
  }));

  it('🔴 « Moteur coupé » seulement quand le boîtier a CONFIRMÉ — puis la fenêtre se referme seule, verrou relâché', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(0);
    maj();
    expect(texte('.ec-suivi-titre')).not.toBe('Moteur coupé');

    commandesServies = [commande({ status: 'ACKNOWLEDGED', ackedAt: new Date().toISOString() })];
    tick(2000); // relecture de la liste pendant le suivi
    maj();
    expect(texte('.ec-suivi-titre')).toBe('Moteur coupé');
    expect(texte('.ec-suivi-msg')).toBe('Le boîtier a confirmé.');

    tick(1800);
    maj();
    expect(voile()).withContext('la fenêtre devait se refermer après le succès').toBeNull();
    expect(verrous.isLocked(TRACKER)).toBeFalse();
    finir();
  }));

  it('le rallumage dit son propre verbe, jamais celui de la coupure', fakeAsync(() => {
    creer();
    void confirmer('RESTORE');
    tick(0);
    maj();
    expect(texte('.ec-suivi-titre')).toBe('Rallumage du moteur en cours');

    commandesServies = [commande({ action: 'RESTORE', status: 'ACKNOWLEDGED', ackedAt: new Date().toISOString() })];
    reponseHttp.next(commande({ action: 'RESTORE', status: 'SENT' }));
    tick(2000);
    maj();
    expect(texte('.ec-suivi-titre')).toBe('Moteur rallumé');
    tick(1800);
    finir();
  }));

  it('après 15 s sans réponse, la fenêtre explique le retard (souterrain, zone non couverte) — elle ne promet aucun envoi automatique', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(16_000);
    maj();

    expect(texte('.ec-suivi-msg')).toContain('tarde à répondre');
    expect(texte('.ec-suivi-msg')).toContain('souterrain');
    expect(texte('.ec-suivi-msg')).not.toMatch(/sms|automatique/i);
    finir();
  }));

  it('quand la synchronisation est partie, la fenêtre le dit — sans nommer le canal — et l’étape devient « synchronisation »', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT', channel: 'SMS' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(2000);
    maj();

    expect(texte('.ec-suivi-msg')).toContain('Synchronisation avec le boîtier en cours');
    expect(texte('.ec-suivi-etapes')).toContain('Confirmation du boîtier (synchronisation)');
    expect(document.body.querySelector('.ec-suivi')?.textContent).not.toMatch(/sms/i);
    finir();
  }));

  it('🔴 un échec est dit, avec son motif, et se ferme à la main — jamais seul (on le lit)', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'FAILED', lastError: 'Tracker hors ligne, repli SMS impossible' })];
    reponseHttp.next(commande({ status: 'PENDING' }));
    tick(2000);
    maj();

    expect(texte('.ec-suivi-titre')).toBe('Coupure échouée');
    // Le motif brut nomme le canal : la fenêtre n'affiche jamais ce texte-là.
    expect(texte('.ec-suivi-msg')).not.toMatch(/sms/i);
    expect(texte('.ec-suivi-msg')).toContain('Vérifiez le véhicule sur place');
    tick(10_000);
    maj();
    expect(voile()).withContext('un échec ne doit pas se refermer tout seul').not.toBeNull();

    (document.body.querySelector('.ec-suivi-btn') as HTMLButtonElement).click();
    maj();
    expect(voile()).toBeNull();
    expect(verrous.isLocked(TRACKER)).toBeFalse();
    finir();
  }));

  it('🔴 sans preuve après 150 s : « non confirmée », et la consigne est de vérifier SUR PLACE', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(151_000);
    maj();

    expect(texte('.ec-suivi-titre')).toBe('Coupure non confirmée');
    expect(texte('.ec-suivi-msg')).toContain('vérifiez sur place');
    expect(document.body.querySelector('.ec-suivi-btn')).not.toBeNull();
    finir();
  }));

  it('une coupure échue par le serveur (SENT_UNCONFIRMED) est « non confirmée » tout de suite', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT_UNCONFIRMED' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(2000);
    maj();
    expect(texte('.ec-suivi-titre')).toBe('Coupure non confirmée');
    finir();
  }));

  it('« Masquer » n’apparaît qu’après 10 s d’attente — pas de fuite à la première seconde — et rend la main', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(3000);
    maj();
    expect(document.body.querySelector('.ec-suivi-lien')).toBeNull();

    tick(8000);
    maj();
    const lien = document.body.querySelector('.ec-suivi-lien') as HTMLButtonElement | null;
    expect(lien).not.toBeNull();
    lien!.click();
    maj();
    expect(voile()).toBeNull();
    expect(verrous.isLocked(TRACKER)).toBeFalse();
    finir();
  }));

  it('🔴 un refus du serveur (vitesse, droits…) efface la fenêtre, affiche le motif, relâche le verrou', fakeAsync(() => {
    creer();
    refus = new HttpErrorResponse({
      status: 403,
      error: { error: { message: 'Véhicule en mouvement (10 km/h) — coupure réservée à l’arrêt' } },
    });
    void confirmer('CUT');
    tick(0);
    maj();

    expect(voile()).withContext('une fenêtre d’attente resterait sur un ordre refusé').toBeNull();
    expect(toastErreur).toHaveBeenCalledWith('Coupure refusée', jasmine.stringContaining('en mouvement'));
    expect(verrous.isLocked(TRACKER)).toBeFalse();
    finir();
  }));

  describe('synchronisation manuelle du boîtier — à la demande, jamais automatique', () => {
    const attendreSansPreuve = (action: 'CUT' | 'RESTORE' = 'CUT', ms = 16_000): void => {
      void confirmer(action);
      tick(0);
      commandesServies = [commande({ action, status: 'SENT' })];
      reponseHttp.next(commande({ action, status: 'SENT' }));
      tick(ms);
      maj();
    };
    const boutonSync = (): HTMLButtonElement | null => document.body.querySelector('.ec-suivi-sync');

    it('🔴 AUCUNE synchronisation automatique : après 150 s sans preuve, l’API n’a reçu aucune demande', fakeAsync(() => {
      creer();
      attendreSansPreuve('CUT', 151_000);
      expect(synchros).toEqual([]);
      finir();
    }));

    it('absente pendant les 15 premières secondes : le boîtier a le temps de répondre', fakeAsync(() => {
      creer();
      attendreSansPreuve('CUT', 5_000);
      expect(boutonSync()).toBeNull();
      finir();
    }));

    it('🔴 offerte après 15 s sans réponse, pour une COUPURE', fakeAsync(() => {
      creer();
      attendreSansPreuve('CUT');
      expect(boutonSync()?.textContent?.trim()).toBe('Synchroniser le boîtier');
      finir();
    }));

    it('jamais offerte pour un rallumage (il a son propre secours, sans condition)', fakeAsync(() => {
      creer();
      attendreSansPreuve('RESTORE');
      expect(boutonSync()).toBeNull();
      finir();
    }));

    it('🔴 la question dit POURQUOI (souterrain, zone non couverte par le GPS) et ne nomme JAMAIS le canal', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      boutonSync()!.click();
      maj();

      expect(texte('.ec-suivi-titre')).toBe('Synchroniser le boîtier ?');
      const dit = texte('.ec-suivi-msg');
      expect(dit).toContain('souterrain');
      expect(dit).toContain('zone non couverte par le GPS');
      expect(dit).toContain('synchronisation manuelle');
      expect(document.body.querySelector('.ec-suivi')?.textContent).not.toMatch(/sms/i);
      expect(synchros).withContext('rien ne part avant la confirmation').toEqual([]);
      finir();
    }));

    it('« Annuler » revient au suivi, sans rien envoyer', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      boutonSync()!.click();
      maj();
      (Array.from(document.body.querySelectorAll('.ec-suivi-lien')).find((b) => b.textContent?.trim() === 'Annuler') as HTMLButtonElement).click();
      maj();

      expect(texte('.ec-suivi-titre')).toBe('Coupure du moteur en cours');
      expect(synchros).toEqual([]);
      finir();
    }));

    it('🔴 confirmée : la demande part pour CE boîtier, la fenêtre reprend le suivi et ne propose plus la synchronisation', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      boutonSync()!.click();
      maj();
      (document.body.querySelector('.ec-suivi-btn') as HTMLButtonElement).click();
      tick(0);
      maj();

      expect(synchros).toEqual([TRACKER]);
      expect(synchrosCommandes).withContext('la requête désigne la coupure montrée à l’utilisateur').toEqual(['cmd-1']);
      expect(texte('.ec-suivi-titre')).toBe('Coupure du moteur en cours');
      expect(texte('.ec-suivi-msg')).toContain('Synchronisation avec le boîtier en cours');
      expect(boutonSync()).withContext('une seule synchronisation par commande').toBeNull();
      finir();
    }));

    it('une réponse du boîtier après la synchronisation donne « Moteur coupé » comme d’habitude', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      boutonSync()!.click();
      maj();
      (document.body.querySelector('.ec-suivi-btn') as HTMLButtonElement).click();
      tick(0);
      commandesServies = [commande({ status: 'ACKNOWLEDGED', ackedAt: new Date().toISOString(), channel: 'SMS' })];
      tick(2000);
      maj();

      expect(texte('.ec-suivi-titre')).toBe('Moteur coupé');
      finir();
    }));

    it('🔴 un refus du serveur est DIT dans la question (neutre), la fenêtre reste ouverte et on peut annuler', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      syncErreur = new HttpErrorResponse({
        status: 503,
        error: { error: { message: 'Synchronisation impossible pour le moment : aucun canal de secours n’est disponible pour ce boîtier.' } },
      });
      boutonSync()!.click();
      maj();
      (document.body.querySelector('.ec-suivi-btn') as HTMLButtonElement).click();
      tick(0);
      maj();

      expect(texte('.ec-suivi-titre')).toBe('Synchroniser le boîtier ?');
      expect(document.body.querySelector('.ec-suivi-erreur')?.textContent).toContain('Synchronisation impossible');
      expect(voile()).not.toBeNull();
      finir();
    }));

    it('🔴 une coupure ÉCHUE (SENT_UNCONFIRMED) tout juste synchronisée affiche « en cours », pas « non confirmée — vérifiez sur place »', fakeAsync(() => {
      creer();
      void confirmer('CUT');
      tick(0);
      commandesServies = [commande({ status: 'SENT_UNCONFIRMED' })];
      reponseHttp.next(commande({ status: 'SENT' }));
      tick(2000);
      maj();
      expect(texte('.ec-suivi-titre')).toBe('Coupure non confirmée');

      boutonSync()!.click();
      maj();
      (document.body.querySelector('.ec-suivi-btn') as HTMLButtonElement).click();
      tick(0);
      maj();

      expect(texte('.ec-suivi-titre')).toBe('Coupure du moteur en cours');
      expect(texte('.ec-suivi-msg')).toContain('Synchronisation avec le boîtier en cours');
      finir();
    }));

    it('🔴 la situation change entre la question et la confirmation (le boîtier a répondu) : aucune requête, la fenêtre le dit', fakeAsync(() => {
      creer();
      attendreSansPreuve();
      boutonSync()!.click();
      maj();
      commandesServies = [commande({ status: 'ACKNOWLEDGED', ackedAt: new Date().toISOString() })];
      tick(2000);
      maj();
      // L'écho est arrivé : la fenêtre a basculé sur « Moteur coupé » ; aucune synchronisation n'est partie.
      expect(synchros).toEqual([]);
      finir();
    }));

    it('depuis l’écran du véhicule, « Annuler » referme la fenêtre (il n’y a pas de suivi à montrer) et rend le verrou', fakeAsync(() => {
      creer();
      commandesServies = [commande({ status: 'SENT_UNCONFIRMED', createdAt: new Date(Date.now() - 3600_000).toISOString(), sentAt: new Date(Date.now() - 3600_000).toISOString() })];
      void (fixture.componentInstance as unknown as { loadRecentCommands: () => Promise<void> }).loadRecentCommands();
      tick(0);
      maj();
      (Array.from(fixture.nativeElement.querySelectorAll('button.ec-sortie') as NodeListOf<HTMLButtonElement>).find((b) => b.textContent?.trim() === 'Synchroniser le boîtier'))!.click();
      maj();
      expect(voile()).not.toBeNull();

      (Array.from(document.body.querySelectorAll('.ec-suivi-lien')).find((b) => b.textContent?.trim() === 'Annuler') as HTMLButtonElement).click();
      maj();
      expect(voile()).toBeNull();
      expect(verrous.isLocked(TRACKER)).toBeFalse();
      finir();
    }));

    it('🔴 sur l’écran du véhicule : une coupure « non confirmée » de la liste propose la synchronisation — même à l’arrêt (MH-971-TD)', fakeAsync(() => {
      creer();
      commandesServies = [commande({ status: 'SENT_UNCONFIRMED', confirmationExpected: false, createdAt: new Date(Date.now() - 3600_000).toISOString() })];
      void (fixture.componentInstance as unknown as { loadRecentCommands: () => Promise<void> }).loadRecentCommands();
      tick(0);
      maj();

      const bouton = Array.from(fixture.nativeElement.querySelectorAll('button.ec-sortie') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.trim() === 'Synchroniser le boîtier',
      );
      expect(bouton).withContext('offre absente sur l’écran du véhicule').toBeDefined();
      bouton!.click();
      maj();
      expect(texte('.ec-suivi-titre')).toBe('Synchroniser le boîtier ?');
      expect(verrous.isLocked(TRACKER)).toBeTrue();
      finir();
    }));

    it('pas d’offre sur l’écran pour une coupure acquittée, ni pour une coupure remplacée', fakeAsync(() => {
      creer();
      for (const c of [
        commande({ status: 'ACKNOWLEDGED', ackedAt: new Date().toISOString() }),
        commande({ status: 'SENT_UNCONFIRMED', lastError: 'CUT supplantée par une intention RESTORE plus récente' }),
      ]) {
        commandesServies = [c];
        void (fixture.componentInstance as unknown as { loadRecentCommands: () => Promise<void> }).loadRecentCommands();
        tick(0);
        maj();
        const offres = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(
          (b) => b.textContent?.trim() === 'Synchroniser le boîtier',
        );
        expect(offres.length).toBe(0);
      }
      finir();
    }));
  });

  it('🔴 relecture du 29/10 — le voile est rendu à la RACINE du document : sur la carte, un parent à « backdrop-filter » le confinerait', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    maj();
    tick(0);

    const v = voile();
    expect(v).not.toBeNull();
    expect(v!.parentElement).toBe(document.body);
    expect(fixture.nativeElement.querySelector('.ec-suivi-voile')).withContext('le voile est resté dans le bouton').toBeNull();
    finir();
  }));

  it('🔴 relecture du 29/10 — après « Masquer », la fin tardive de la requête ne relâche PAS le verrou qu’une autre surface vient de prendre', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    maj();
    tick(11_000);
    maj();
    (document.body.querySelector('.ec-suivi-lien') as HTMLButtonElement).click();
    maj();
    expect(verrous.isLocked(TRACKER)).toBeFalse();

    // Une autre surface (la fiche du véhicule) prend le verrou pour son propre ordre…
    expect(verrous.acquire(TRACKER)).toBeTrue();
    // … puis la requête du premier geste échoue enfin.
    reponseHttp.error(new HttpErrorResponse({ status: 503, error: { message: 'API indisponible' } }));
    tick(0);

    expect(verrous.isLocked(TRACKER)).withContext('le verrou d’une autre surface a été relâché').toBeTrue();
    verrous.release(TRACKER);
    finir();
  }));

  it('un boîtier muet : la fenêtre ne promet pas « une réponse en quelques secondes »', fakeAsync(() => {
    creer();
    fixture.componentRef.setInput('trackerLastSeenAt', new Date(Date.now() - 100 * 3600_000));
    fixture.detectChanges();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(2000);
    maj();

    expect(texte('.ec-suivi-msg')).toContain('Boîtier muet depuis');
    expect(texte('.ec-suivi-msg')).toContain('aucune confirmation n’est attendue');
    finir();
  }));

  it('une commande remplacée par une demande plus récente ne dit pas « peut-être déjà coupé »', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    commandesServies = [commande({ status: 'SENT_UNCONFIRMED', lastError: 'CUT supplantée par une intention RESTORE plus récente' })];
    reponseHttp.next(commande({ status: 'SENT' }));
    tick(2000);
    maj();

    expect(texte('.ec-suivi-titre')).toBe('Commande remplacée');
    expect(texte('.ec-suivi-msg')).not.toContain('peut-être déjà');
    finir();
  }));

  it('un bouton détruit pendant l’attente relâche le boîtier et ses minuteurs', fakeAsync(() => {
    creer();
    void confirmer('CUT');
    tick(0);
    expect(verrous.isLocked(TRACKER)).toBeTrue();

    fixture.destroy();
    expect(verrous.isLocked(TRACKER)).toBeFalse();
    discardPeriodicTasks();
  }));
});
