import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { lireEchoMoteur, TRACKER_ENGINE_ECHO_EVENT } from './echo-moteur';
import { TcpServerService } from './tcp-server.service';

/**
 * ══ L'ÉCHO MOTEUR QUE PERSONNE N'ATTENDAIT PLUS (incident CDEF31, 06 et 07/10/2026) ══════════
 *
 * Deux soirs de suite, un boîtier 403C a reçu sa coupure (`J`), l'a DIFFÉRÉE, puis a répondu `jt`
 * au moment où il coupait réellement — 157 s puis 69 s après l'ordre. Le guetteur d'accusé
 * n'attend que 15 s : l'écho a été ingéré comme une position ordinaire, la commande est restée
 * « envoyée », et l'écran du veilleur l'a prise pour « moteur actif ». Véhicule immobilisé, aucun
 * bouton « Rallumer » : deux appels de nuit, deux SMS manuels.
 *
 * Ces tests font passer les trames RÉELLES de ces soirs-là (IMEI remplacé) par le vrai décodeur
 * et le vrai `dispatchFrame` : un écho qu'aucun guetteur n'a pris doit être DIFFUSÉ, avec l'heure
 * GPS de la trame, pour que `EngineControlService.onEchoMoteur` le rapproche de la commande.
 */

// IMEI fictif (15 chiffres) : le dépôt est public, aucun identifiant réel de boîtier ici.
const IMEI = '860000000000733';
const AUTRE_IMEI = '860000000000999';

const TRAME_LOGIN = `##,imei:${IMEI},A;`;
/** 07/10 23:07:54 — l'écho de la coupure envoyée à 23:06:45. */
const TRAME_JT = `imei:${IMEI},jt,261007210752,100%,F,210752.000,A,4340.01278,N,00126.40002,E,3.52,113.70,,0,0,0.00%,,;`;
/** 07/10 07:22:54 — l'écho d'une remise en route. */
const TRAME_KT = `imei:${IMEI},kt,261007052253,100%,F,052253.000,A,4340.01436,N,00126.39339,E,0.00,0.00,,0,0,0.00%,,;`;
/** Une position ordinaire du même boîtier, juste avant. */
const TRAME_POSITION = `imei:${IMEI},tracker,261007210717,100%,F,210717.000,A,4340.01625,N,00126.39794,E,0.00,347.60,,1,0,0.00%,,;`;
/** « acc off » se décode comme `jt` (même alarme) : ce n'est PAS un écho de commande. */
const TRAME_ACC_OFF = `imei:${IMEI},acc off,261007210748,100%,F,210748.000,A,4340.01592,N,00126.39821,E,1.85,347.60,,0,0,0.00%,,;`;

class FauxSocket extends EventEmitter {
  readonly remoteAddress = '10.0.0.7';
  readonly remotePort = 51234;
  destroyed = false;
  writable = true;
  readonly setKeepAlive = jest.fn();
  readonly setTimeout = jest.fn();
  readonly end = jest.fn(() => {
    this.destroyed = true;
  });
  write(): boolean {
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  recevoir(texte: string): void {
    this.emit('data', Buffer.from(texte, 'latin1'));
  }
}

type Dependances = ConstructorParameters<typeof TcpServerService>;

interface SurfacePrivee {
  handleConnection(socket: Socket): void;
  pendingOffline: Map<string, ReturnType<typeof setTimeout>>;
}

/** La chaîne de traitement par socket traverse plusieurs `await` : on la laisse se vider. */
const laisserTraiter = async (tours = 12): Promise<void> => {
  for (let i = 0; i < tours; i += 1) {
    await new Promise<void>((resoudre) => setImmediate(resoudre));
  }
};

function monter(options: { avecEmetteur?: boolean } = {}) {
  /** Le registre réel garde la DERNIÈRE socket inscrite pour un IMEI. */
  let inscrite: unknown;
  const registry = {
    register: jest.fn((_imei: string, socket: unknown) => {
      inscrite = socket;
    }),
    touch: jest.fn(),
    unregister: jest.fn(),
    get: jest.fn(() => (inscrite ? { socket: inscrite } : undefined)),
    has: jest.fn(() => inscrite !== undefined),
  };
  const prisma = {
    tracker: {
      findUnique: jest.fn().mockResolvedValue({ id: 'tracker-1', imei: IMEI, vehicle: { id: 'veh-1', fleetId: 'fleet-1' } }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const positions = { ingest: jest.fn().mockResolvedValue(undefined) };
  const alerts = { createFromCobanFrame: jest.fn().mockResolvedValue(null) };
  const ackWaiter = { tryMatch: jest.fn().mockReturnValue(false), cancelAll: jest.fn() };
  const events = { emit: jest.fn() };

  const service = new TcpServerService(
    { get: jest.fn().mockReturnValue(0) } as unknown as Dependances[0],
    registry as unknown as Dependances[1],
    prisma as unknown as Dependances[2],
    positions as unknown as Dependances[3],
    alerts as unknown as Dependances[4],
    { emitTrackerStatus: jest.fn() } as unknown as Dependances[5],
    { in: jest.fn(), out: jest.fn(), ackMatch: jest.fn(), ackTimeout: jest.fn() } as unknown as Dependances[6],
    { record: jest.fn().mockResolvedValue('erreur-1') } as unknown as Dependances[7],
    ackWaiter as unknown as Dependances[8],
    { record: jest.fn(), forget: jest.fn() } as unknown as Dependances[9],
    undefined, // démonstration : absente
    (options.avecEmetteur === false ? undefined : events) as unknown as Dependances[11],
  );
  const prive = service as unknown as SurfacePrivee;
  const socket = new FauxSocket();
  prive.handleConnection(socket as unknown as Socket);
  return { prive, socket, registry, positions, ackWaiter, events, remplacer: (s: unknown) => (inscrite = s) };
}

type Contexte = ReturnType<typeof monter>;

describe('lireEchoMoteur — strict comme un accusé (C2)', () => {
  it('`jt` → CUT, `kt` → RESTORE, casse indifférente', () => {
    expect(lireEchoMoteur(IMEI, TRAME_JT.slice(0, -1))).toBe('CUT');
    expect(lireEchoMoteur(IMEI, TRAME_KT.slice(0, -1))).toBe('RESTORE');
    expect(lireEchoMoteur(IMEI, `imei:${IMEI},JT,261007210752,100%,F`)).toBe('CUT');
  });

  it('refuse tout ce qui n’est pas un écho de CE boîtier', () => {
    expect(lireEchoMoteur(IMEI, `imei:${AUTRE_IMEI},jt,261007210752,100%,F`)).toBeNull();
    expect(lireEchoMoteur(IMEI, TRAME_POSITION.slice(0, -1))).toBeNull();
    expect(lireEchoMoteur(IMEI, TRAME_ACC_OFF.slice(0, -1))).toBeNull();
    expect(lireEchoMoteur(IMEI, `xx imei:${IMEI},jt,261007210752`)).toBeNull();
    expect(lireEchoMoteur(IMEI, `imei:${IMEI},jtx,261007210752`)).toBeNull();
    expect(lireEchoMoteur(IMEI, `imei:${IMEI}`)).toBeNull();
    expect(lireEchoMoteur(IMEI, '')).toBeNull();
  });
});

describe('TcpServerService — écho moteur orphelin (06 et 07/10/2026)', () => {
  let c: Contexte;

  const connecter = async (ctx: Contexte): Promise<void> => {
    ctx.socket.recevoir(TRAME_LOGIN);
    await laisserTraiter();
  };

  afterEach(() => {
    for (const timer of c.prive.pendingOffline.values()) clearTimeout(timer);
    c.prive.pendingOffline.clear();
  });

  it('🔴 un `jt` qu’aucun guetteur n’a pris est DIFFUSÉ — l’écho du 07/10, arrivé 69 s après l’ordre', async () => {
    c = monter();
    await connecter(c);
    c.socket.recevoir(TRAME_JT);
    await laisserTraiter();

    // La position est ingérée comme avant : rien de ce qui marchait n'est retiré.
    expect(c.positions.ingest).toHaveBeenCalledTimes(1);
    expect(c.events.emit).toHaveBeenCalledTimes(1);
    expect(c.events.emit).toHaveBeenCalledWith(
      TRACKER_ENGINE_ECHO_EVENT,
      expect.objectContaining({ imei: IMEI, action: 'CUT', raw: TRAME_JT.slice(0, -1) }),
    );
  });

  it('🔴 l’écho porte l’heure GPS de la TRAME, pas celle de réception : c’est elle qui démasque une trame rejouée', async () => {
    c = monter();
    await connecter(c);
    c.socket.recevoir(TRAME_JT);
    await laisserTraiter();

    // `261007210752` / `210752.000` : 07/10/2026 21:07:52 UTC — 23:07:52 à Paris, l'instant de la coupure.
    expect(c.events.emit).toHaveBeenCalledWith(
      TRACKER_ENGINE_ECHO_EVENT,
      expect.objectContaining({ deviceTime: '2026-10-07T21:07:52.000Z' }),
    );
  });

  it('un `kt` orphelin est diffusé comme une remise en route', async () => {
    c = monter();
    await connecter(c);
    c.socket.recevoir(TRAME_KT);
    await laisserTraiter();

    expect(c.events.emit).toHaveBeenCalledWith(
      TRACKER_ENGINE_ECHO_EVENT,
      expect.objectContaining({ imei: IMEI, action: 'RESTORE' }),
    );
  });

  it('un écho pris par le guetteur (dans ses 15 s) n’est PAS rediffusé : un seul chemin l’acquitte', async () => {
    c = monter();
    c.ackWaiter.tryMatch.mockReturnValue(true);
    await connecter(c);
    c.socket.recevoir(TRAME_JT);
    await laisserTraiter();

    expect(c.ackWaiter.tryMatch).toHaveBeenCalledWith(IMEI, TRAME_JT.slice(0, -1));
    expect(c.events.emit).not.toHaveBeenCalled();
  });

  it('une position ordinaire ou un « acc off » ne diffuse rien', async () => {
    c = monter();
    await connecter(c);
    c.socket.recevoir(TRAME_POSITION + TRAME_ACC_OFF);
    await laisserTraiter();

    expect(c.positions.ingest).toHaveBeenCalledTimes(2);
    expect(c.events.emit).not.toHaveBeenCalled();
  });

  it('🔴 un écho reçu sur une session REMPLACÉE n’est pas diffusé — seule la session en cours compte (C2)', async () => {
    c = monter();
    await connecter(c);
    c.remplacer({ autre: 'socket' }); // le boîtier s'est reconnecté ailleurs entre-temps
    c.socket.recevoir(TRAME_JT);
    await laisserTraiter();

    expect(c.positions.ingest).toHaveBeenCalledTimes(1);
    expect(c.events.emit).not.toHaveBeenCalled();
  });

  it('sans émetteur d’événements (montages historiques), l’écho reste une position — jamais une panne', async () => {
    c = monter({ avecEmetteur: false });
    await connecter(c);
    c.socket.recevoir(TRAME_JT);
    await laisserTraiter();

    expect(c.positions.ingest).toHaveBeenCalledTimes(1);
    expect(c.events.emit).not.toHaveBeenCalled();
  });

  it('un émetteur qui lève ne casse pas l’ingestion des trames suivantes', async () => {
    c = monter();
    c.events.emit.mockImplementation(() => {
      throw new Error('abonné en panne');
    });
    await connecter(c);
    c.socket.recevoir(TRAME_JT + TRAME_POSITION);
    await laisserTraiter();

    expect(c.positions.ingest).toHaveBeenCalledTimes(2);
  });
});
