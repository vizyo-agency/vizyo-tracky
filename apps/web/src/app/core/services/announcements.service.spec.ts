import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AnnouncementsService } from './announcements.service';
import { AuthService } from './auth.service';

const ID = 'gel-veilleur-2026-10';
const URL = '/api/announcements/active';

function ouverte(over: Partial<{ id: string; startsAt: string; endsAt: string }> = {}) {
  const maintenant = Date.now();
  return {
    id: ID,
    startsAt: new Date(maintenant - 3_600_000).toISOString(),
    endsAt: new Date(maintenant + 86_400_000).toISOString(),
    ...over,
  };
}

describe('AnnouncementsService', () => {
  let sub = 'compte-1';

  /** Une nouvelle « session » : service neuf, même navigateur (donc même mémoire locale). */
  async function demarrer(reponse: unknown[]): Promise<AnnouncementsService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: () => ({ sub }) } },
      ],
    });
    const service = TestBed.inject(AnnouncementsService);
    const charge = service.load();
    TestBed.inject(HttpTestingController).expectOne(URL).flush(reponse);
    await charge;
    return service;
  }

  beforeEach(() => {
    sub = 'compte-1';
    localStorage.clear();
  });

  it("n'affiche rien quand l'API ne renvoie aucune annonce", async () => {
    expect((await demarrer([])).courante()).toBeNull();
  });

  it("affiche l'annonce que l'API ouvre", async () => {
    expect((await demarrer([ouverte()])).courante()?.id).toBe(ID);
  });

  it("ignore une annonce que le registre ne connaît pas", async () => {
    expect((await demarrer([ouverte({ id: 'inconnue' })])).courante()).toBeNull();
  });

  it("ne l'affiche plus une fois la période passée, même si l'onglet est resté ouvert", async () => {
    const hier = new Date(Date.now() - 1000).toISOString();
    expect((await demarrer([ouverte({ endsAt: hier })])).courante()).toBeNull();
  });

  it("« Fermer » la masque aujourd'hui, y compris après un rechargement", async () => {
    const s = await demarrer([ouverte()]);
    s.fermer(ID);
    expect(s.courante()).toBeNull();
    expect((await demarrer([ouverte()])).courante()).toBeNull();
  });

  it("« Fermer » ne la masque que pour le jour courant : elle revient le lendemain", async () => {
    const s = await demarrer([ouverte()]);
    s.fermer(ID);
    const cle = `vizyo-tracky-annonce:${sub}:${ID}`;
    localStorage.setItem(cle, JSON.stringify({ vu: '2000-01-01' }));
    expect((await demarrer([ouverte()])).courante()?.id).toBe(ID);
  });

  it("« J'ai compris » la masque pour de bon", async () => {
    const s = await demarrer([ouverte()]);
    s.terminer(ID);
    localStorage.setItem(`vizyo-tracky-annonce:${sub}:${ID}`, JSON.stringify({ fini: true, vu: '2000-01-01' }));
    expect((await demarrer([ouverte()])).courante()).toBeNull();
  });

  it('la mémoire est par compte : un autre compte du même poste la voit', async () => {
    const s = await demarrer([ouverte()]);
    s.terminer(ID);
    sub = 'compte-2';
    expect((await demarrer([ouverte()])).courante()?.id).toBe(ID);
  });

  it("reste utilisable si l'API échoue", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: () => ({ sub }) } },
      ],
    });
    const service = TestBed.inject(AnnouncementsService);
    const charge = service.load();
    TestBed.inject(HttpTestingController).expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    await charge;
    expect(service.courante()).toBeNull();
  });
});
