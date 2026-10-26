import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  HUMAN_ACTION_TYPES,
  LOT_ID,
  acceptedBranches,
  actionPayload,
  classifyBranch,
  classifySubject,
  clotureAfterWork,
  commitMessage,
  completedPrompts,
  conductorBranch,
  conductorGate,
  dateGate,
  dependenciesReady,
  dependencyStates,
  formatDate,
  inspectEvidence,
  loadPlan,
  lotMap,
  parseDecoupage,
  parseNotBefore,
  promptsBefore,
  run,
  scrubLocalPaths,
  statusGate,
  validatePlan,
  validateRelativePath,
} from './lot.mjs';

// ── Fixtures : aucun test de ce bloc ne lit le plan réel du dépôt ─────────────────────────────
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const STATUSES = ['done', 'partial', 'ready', 'waiting', 'decision', 'backlog'];
const NOW = new Date('2026-06-01T10:00:00Z');
const FIRST_SUBJECT = '[T1.1] P1 — Premier prompt';
const SECOND_SUBJECT = '[T1.1] P2 — Deuxième prompt';
const THIRD_SUBJECT = '[T1.1] P3 — Troisième prompt';

function lotFixture(overrides = {}) {
  return {
    id: 'T1.1',
    title: 'Lot de test',
    stream: 'Test',
    status: 'ready',
    asana_task_id: 'asana-t11',
    responsible: 'Alice',
    reviewer: 'Bob',
    track: 'Essai',
    estimate_hours: 2,
    depends: [],
    branch: 'lot/T1.1-essai',
    execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'P2', 'P3'] },
    done_when: ['critère vérifiable'],
    sources: ['source.md'],
    ...overrides,
  };
}

function promptBlock(number, title) {
  return [
    `### P${number} · ${title}`,
    'Durée : 20 min',
    'Fichiers : a.txt · b.txt',
    'Sources : doc § 1',
    '',
    'Faire :',
    `- geste ${number}`,
    '',
    'Test : `node -v`',
    `Fini quand : critère ${number}`,
    'Hors périmètre : le reste',
    '',
  ].join('\n');
}

/** Un découpage à deux étapes (P1-P2 puis P3) sur la même branche. */
function decoupageText({ lotId = 'T1.1', branch = 'lot/T1.1-essai', eol = '\n' } = {}) {
  return [
    '---',
    `lot: ${lotId}`,
    'etat_au: 2026-06-01',
    '---',
    '',
    `# ${lotId} — Lot de test`,
    '',
    '## État',
    '',
    'Un état vérifiable.',
    '',
    '## Étape 1 · Début',
    'Responsable : Alice',
    `Branche : ${branch}`,
    '',
    promptBlock(1, 'Premier prompt'),
    promptBlock(2, 'Deuxième prompt'),
    '## Étape 2 · Fin',
    'Responsable : Alice',
    `Branche : ${branch}`,
    '',
    promptBlock(3, 'Troisième prompt'),
  ]
    .join('\n')
    .replace(/\n/g, eol);
}

/** Écrit un plan et ses découpages dans un dossier jetable, rend l'environnement injectable de `run()`. */
function fixtureEnv({ lots = [lotFixture()], decoupes = { 'T1.1': decoupageText() }, branch = 'lot/T1.1-essai', subjects = [], now = NOW, checkEvidence, gitError = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lot-test-'));
  tempDirs.push(dir);
  const decoupeDir = join(dir, 'decoupe');
  mkdirSync(decoupeDir, { recursive: true });
  const planPath = join(dir, 'plan.json');
  writeFileSync(planPath, JSON.stringify({ version: 2, statuses: STATUSES, lots }));
  for (const [id, text] of Object.entries(decoupes)) writeFileSync(join(decoupeDir, `${id}.md`), text);
  const failure = () => {
    throw new Error(gitError);
  };
  const git = gitError ? { branch: failure, subjects: failure } : { branch: () => branch, subjects: () => subjects };
  return { repo: dir, planPath, decoupeDir, now, git, ...(checkEvidence ? { checkEvidence } : {}) };
}

/** `run()` en mode Conductor : rend le résultat brut et la dernière ligne de stdout décodée. */
function conductor(args, options) {
  const result = run([...args, '--conductor'], fixtureEnv(options));
  const last = result.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), `dernière ligne inattendue : ${last}`);
  return { ...result, json: JSON.parse(last.slice('CONDUCTOR_RESULT '.length)) };
}

function plain(args, options) {
  return run(args, fixtureEnv(options));
}

// ── Contrat CONDUCTOR_RESULT v1 ───────────────────────────────────────────────────────────────
test('contrat : la ligne finale a exactement les clés et l’ordre du contrat v1', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1']);
  assert.equal(exitCode, EXIT.READY);
  assert.deepEqual(Object.keys(json), ['version', 'status', 'exit_code', 'lot', 'prompt', 'reason', 'branch', 'action', 'commit_message']);
  assert.deepEqual(Object.keys(json.branch), ['current', 'accepted']);
  assert.deepEqual(json.branch.accepted, ['conductor/agent-lot/T1.1', 'lot/T1.1-<slug>']);
  assert.deepEqual(json.branch.accepted, acceptedBranches('T1.1'));
  assert.equal(conductorBranch('T1.1'), 'conductor/agent-lot/T1.1');
  assert.equal(json.version, 1);
});

test('contrat ready : exit_code 0, commit_message exact, aucune action ni raison', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1']);
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.exit_code, 0);
  assert.equal(json.lot, 'T1.1');
  assert.equal(json.prompt, 'P1');
  assert.equal(json.reason, null);
  assert.equal(json.action, null);
  assert.equal(json.commit_message, '[T1.1] P1 — Premier prompt');
  assert.match(stdout, /## Commit\n\[T1\.1\] P1 — Premier prompt\n/);
});

test('contrat : lot et prompt en minuscules sont normalisés', () => {
  const { json } = conductor(['t1.1', 'p1']);
  assert.equal(json.status, 'ready');
  assert.equal(json.lot, 'T1.1');
  assert.equal(json.prompt, 'P1');
});

test('contrat : la ligne CONDUCTOR_RESULT est la DERNIÈRE ligne de stdout pour chaque statut', () => {
  const cases = [
    conductor(['T1.1', 'P1']), // ready
    conductor(['T1.1', 'P1'], { now: NOW, lots: [lotFixture({ not_before: '2999-01-01T00:00:00+01:00', status: 'waiting' })] }), // too_early
    conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'backlog' })] }), // blocked
    conductor(['T9.9', 'P1']), // error
  ];
  assert.deepEqual(cases.map(({ json }) => json.status), ['ready', 'too_early', 'blocked', 'error']);
  for (const { stdout } of cases) {
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines.filter((line) => line.startsWith('CONDUCTOR_RESULT ')).length, 1);
    assert.ok(lines.at(-1).startsWith('CONDUCTOR_RESULT '));
    assert.ok(!lines.at(-1).includes('\n'));
  }
});

test('contrat : exit_code du JSON = code de sortie du processus, pour tous les statuts', () => {
  const expected = [
    [conductor(['T1.1', 'P1']), 0, 'ready'],
    [conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] }), 3, 'too_early'],
    [conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'decision' })] }), 3, 'blocked'],
    [conductor(['T9.9', 'P1']), 2, 'error'],
  ];
  for (const [result, code, status] of expected) {
    assert.equal(result.exitCode, code);
    assert.equal(result.json.exit_code, code);
    assert.equal(result.json.status, status);
  }
});

test('contrat : too_early et dépendance ouverte sont deux statuts distincts, tous deux en code 3', () => {
  const early = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] });
  assert.equal(early.json.status, 'too_early');
  assert.match(early.json.reason, /TROP TÔT/);
  const blocked = conductor(['T1.1', 'P1'], { lots: [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'waiting', branch: undefined, execution: undefined, asana_task_id: 'a0' })] });
  assert.equal(blocked.json.status, 'blocked');
  assert.match(blocked.json.reason, /T0\.1/);
  assert.equal(blocked.exitCode, 3);
});

test('contrat : usage (sans prompt, prompt invalide, lot inconnu, option inconnue) = error, code 2', () => {
  for (const args of [['T1.1'], ['T1.1', 'banane'], ['T9.9', 'P1'], ['pas-un-lot', 'P1'], ['T1.1', 'P1', '--nimporte']]) {
    const result = run([...args, '--conductor'], fixtureEnv());
    assert.equal(result.exitCode, 2, args.join(' '));
    const last = result.stdout.trimEnd().split('\n').at(-1);
    assert.equal(JSON.parse(last.slice('CONDUCTOR_RESULT '.length)).status, 'error', args.join(' '));
  }
  const noArgs = run(['--conductor'], fixtureEnv());
  assert.equal(JSON.parse(noArgs.stdout.trimEnd().split('\n').at(-1).slice(17)).lot, null);
});

test('contrat : un prompt absent du découpage = error 2 ; un lot sans découpage = blocked 3', () => {
  const unknown = conductor(['T1.1', 'P9']);
  assert.equal(unknown.exitCode, 2);
  assert.equal(unknown.json.status, 'error');
  const none = conductor(['T1.1', 'P1'], { decoupes: {}, lots: [lotFixture({ execution: undefined })] });
  assert.equal(none.exitCode, 3);
  assert.equal(none.json.status, 'blocked');
  assert.match(none.json.reason, /découpé/);
});

test('contrat : un plan invalide ou illisible = error 2 avec la ligne finale', () => {
  const env = fixtureEnv({ lots: [lotFixture({ done_when: [] })] });
  const invalid = run(['T1.1', 'P1', '--conductor'], env);
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.stdout.trimEnd().split('\n').at(-1), /^CONDUCTOR_RESULT .*"status":"error"/);
  const missing = run(['T1.1', 'P1', '--conductor'], { ...env, planPath: join(env.repo, 'absent.json') });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stdout.trimEnd().split('\n').at(-1), /"status":"error"/);
});

test('contrat : une panne de git est une erreur (2), jamais « aucun commit »', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1'], { gitError: 'safe.directory' });
  assert.equal(exitCode, 2);
  assert.equal(json.status, 'error');
  assert.match(json.reason, /git indisponible/);
});

test('contrat : la clôture est refusée en mode Conductor (blocked, 3), sans toucher au code de la branche', () => {
  for (const word of ['cloture', 'clôture', 'CLOTURE']) {
    const { json, exitCode } = conductor(['T1.1', word], { subjects: [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT] });
    assert.equal(exitCode, 3, word);
    assert.equal(json.status, 'blocked');
    assert.equal(json.prompt, 'cloture');
    assert.match(json.reason, /clôture/);
  }
});

test('contrat : hors --conductor, aucune ligne CONDUCTOR_RESULT et les codes historiques', () => {
  const ready = plain(['T1.1', 'P1']);
  assert.equal(ready.exitCode, 0);
  assert.ok(!ready.stdout.includes('CONDUCTOR_RESULT'));
  const wrongBranch = plain(['T1.1', 'P1'], { branch: 'autre' });
  assert.equal(wrongBranch.exitCode, 3);
  assert.match(wrongBranch.stdout, /MAUVAISE BRANCHE/);
  assert.ok(!wrongBranch.stdout.includes('CONDUCTOR_RESULT'));
  assert.equal(plain(['T1.1', 'P9']).exitCode, 2);
  assert.equal(plain(['pas-un-lot']).exitCode, 2);
  assert.equal(plain(['T1.1']).exitCode, 0);
  const check = plain(['--check']);
  assert.equal(check.exitCode, 0);
  assert.match(check.stdout, /^OK — 1 lots valides\./);
});

// Un faux secret « canari » : sa VALEUR ne doit apparaître ni dans stdout, ni dans stderr, ni dans la ligne finale.
// (Le NOM d'une variable peut apparaître, par exemple dans les interdits d'une action ; jamais sa valeur.)
const CANARY_NAME = 'LOT_TEST_SECRET_CANARY';
const canaryValue = () => `canari-${randomUUID()}`;

function withCanaryEnv(value, body) {
  const previous = process.env[CANARY_NAME];
  process.env[CANARY_NAME] = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env[CANARY_NAME];
    else process.env[CANARY_NAME] = previous;
  }
}

function assertNoCanary(result, canary, label) {
  assert.ok(!result.stdout.includes(canary), `${label} : le canari fuit dans stdout`);
  assert.ok(!result.stderr.includes(canary), `${label} : le canari fuit dans stderr`);
  assert.ok(!(result.json?.reason ?? '').includes(canary), `${label} : le canari fuit dans reason`);
}

test('secrets : la valeur d’un canari (environnement, dépôt, preuve, historique) n’apparaît dans aucune sortie ni ligne finale', () => {
  const canary = canaryValue();
  const guarded = { ...ACTION, forbidden: [`Copier la valeur de ${CANARY_NAME}`], instructions: [`Ne pas lire ${CANARY_NAME}`] };
  const lots = [actionLot({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [guarded] } })];
  const poisoned = [`chore: ${canary}`, `fix(secret): ${canary}`];
  withCanaryEnv(canary, () => {
    const scenarios = {};
    // action_required : le brief imprime les interdits (le NOM de la variable y figure, pas sa valeur).
    const actionEnv = fixtureEnv({ lots, branch: 'conductor/agent-lot/T1.1', subjects: poisoned });
    writeFileSync(join(actionEnv.repo, '.env'), `${CANARY_NAME}=${canary}\n`);
    scenarios.action_required = conductorWith(['T1.1', 'P1'], actionEnv);
    // ready : la preuve elle-même contient le canari (contenu jamais recopié).
    const readyEnv = fixtureEnv({ lots, branch: 'conductor/agent-lot/T1.1', subjects: poisoned });
    writeFileSync(join(readyEnv.repo, '.env'), `${CANARY_NAME}=${canary}\n`);
    writeEvidence(readyEnv, `relevé : ${canary}\n`);
    scenarios.ready = conductorWith(['T1.1', 'P1'], readyEnv);
    scenarios.blocked_branch = conductorWith(['T1.1', 'P1'], fixtureEnv({ lots, branch: 'main', subjects: poisoned }));
    scenarios.blocked_order = conductorWith(['T1.1', 'P3'], fixtureEnv({ lots, branch: 'conductor/agent-lot/T1.1', subjects: poisoned }));
    scenarios.too_early = conductorWith(['T1.1', 'P1'], fixtureEnv({ lots: [actionLot({ not_before: '2999-01-01T00:00:00+01:00' })], branch: 'conductor/agent-lot/T1.1' }));
    scenarios.error_usage = conductorWith(['T9.9', 'P1'], fixtureEnv({ lots }));
    const failing = fixtureEnv({ lots, branch: 'conductor/agent-lot/T1.1' });
    scenarios.error_internal = conductorWith(['T1.1', 'P1'], { ...failing, checkEvidence: () => { throw new Error('échec de lecture'); } });
    assert.deepEqual(Object.values(scenarios).map(({ json }) => json.status), ['action_required', 'ready', 'blocked', 'blocked', 'too_early', 'error', 'error']);
    for (const [label, result] of Object.entries(scenarios)) {
      assertNoCanary(result, canary, label);
      const last = result.stdout.trimEnd().split('\n').at(-1);
      assert.ok(last.startsWith('CONDUCTOR_RESULT ') && !last.includes(canary), label);
    }
    assert.ok(scenarios.action_required.stdout.includes(CANARY_NAME), 'le NOM de la variable peut figurer dans les interdits');
    assert.ok(scenarios.action_required.json.action.forbidden[0].includes(CANARY_NAME));
  });
});

test('secrets (processus réel) : le canari de l’environnement et du dépôt ne sort pas, ni en ready ni en action_required', () => {
  const canary = canaryValue();
  const lots = [actionLot()];
  const dir = makeRepo({ lots });
  writeFileSync(join(dir, '.env'), `${CANARY_NAME}=${canary}\n`);
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir), [CANARY_NAME]: canary, GITHUB_TOKEN: canary, ANTHROPIC_API_KEY: canary };
  const launch = () => spawnSync(process.execPath, [join(dir, 'scripts', 'lot.mjs'), 'T1.1', 'P1', '--conductor'], { cwd: tmpdir(), encoding: 'utf8', env });
  const pending = launch();
  assert.equal(pending.status, 4, pending.stdout);
  writeEvidence({ repo: dir }, `preuve : ${canary}\n`);
  const ready = launch();
  assert.equal(ready.status, 0, ready.stdout + ready.stderr);
  for (const result of [pending, ready]) {
    assert.ok(!result.stdout.includes(canary) && !result.stderr.includes(canary), 'le canari sort du processus');
    assert.ok(!/ghp_|sk-ant-|BEGIN [A-Z ]*PRIVATE KEY/.test(result.stdout + result.stderr));
  }
});

test('secrets : le payload de l’action réelle S2.1-A1 n’a que les dix clés du contrat, sans donnée de compte', () => {
  const plan = loadPlan();
  const lot = lotMap(plan).get('S2.1');
  const action = lot.execution.actions.find((candidate) => candidate.id === 'S2.1-A1');
  const payload = actionPayload(lot, action);
  assert.deepEqual(Object.keys(payload), ['id', 'type', 'responsible', 'url', 'instructions', 'forbidden', 'evidence_path', 'evidence_rule', 'resume_command', 'not_before']);
  const text = JSON.stringify(payload);
  // Les mots « cookie » ou « jeton » figurent légitimement dans les INTERDITS ; jamais une valeur.
  assert.ok(payload.forbidden.some((item) => /cookie/i.test(item)), 'les interdits nomment bien ce qu’il ne faut pas copier');
  for (const pattern of [/ghp_[A-Za-z0-9]/, /gho_[A-Za-z0-9]/, /github_pat_/, /sk-[A-Za-z0-9]{10}/, /AKIA[0-9A-Z]{12}/, /-----BEGIN/, /eyJ[A-Za-z0-9_-]{20}/, /[\w.+-]+@[\w-]+\.[\w.]+/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /(?:password|mot de passe)\s*[:=]\s*\S/i]) {
    assert.ok(!pattern.test(text), `${pattern} dans le payload de S2.1-A1`);
  }
  assert.ok(payload.url.startsWith('https://'));
  assert.equal(validateRelativePath(payload.evidence_path), null);
});

test('CRLF : aucune fin de ligne Windows dans la sortie ni la ligne finale, même avec un plan et un découpage CRLF', () => {
  const eolPlan = (lots) => JSON.stringify({ version: 2, statuses: STATUSES, lots }, null, 2).replaceAll('\n', '\r\n');
  const lots = [actionLot({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [{ ...ACTION, instructions: ['ligne un\r\nligne deux', 'ligne trois\r'] }] } })];
  const env = fixtureEnv({ lots, decoupes: { 'T1.1': decoupageText({ eol: '\r\n' }) }, branch: 'conductor/agent-lot/T1.1' });
  writeFileSync(env.planPath, eolPlan(lots));
  const scenarios = {
    action_required: conductorWith(['T1.1', 'P1'], env),
    blocked_order: conductorWith(['T1.1', 'P3'], env),
  };
  writeEvidence(env, 'preuve\r\n');
  scenarios.ready = conductorWith(['T1.1', 'P1'], env);
  assert.deepEqual(Object.values(scenarios).map(({ json }) => json.status), ['action_required', 'blocked', 'ready']);
  for (const [label, result] of Object.entries(scenarios)) {
    assert.ok(!result.stdout.includes('\r'), `${label} : « \\r » dans stdout`);
    assert.ok(!result.stderr.includes('\r'), `${label} : « \\r » dans stderr`);
    const lines = result.stdout.trimEnd().split('\n');
    assert.equal(lines.filter((line) => line.startsWith('CONDUCTOR_RESULT ')).length, 1, label);
    assert.ok(lines.at(-1).startsWith('CONDUCTOR_RESULT '), label);
    assert.equal(result.json.commit_message.includes('\r'), false, label);
  }
  assert.equal(scenarios.ready.json.commit_message, FIRST_SUBJECT);
  assert.deepEqual(scenarios.action_required.json.action.instructions, ['ligne un\r\nligne deux', 'ligne trois\r'], 'le JSON garde la donnée, échappée');
  assert.ok(!scenarios.action_required.stdout.split('\n').at(-1).includes('\r'));
  assert.ok(scenarios.action_required.stdout.includes('- ligne un\nligne deux'), 'l’affichage humain normalise les fins de ligne');
});

test('CRLF (processus réel) : aucun octet 0x0D sur stdout avec des fichiers CRLF', () => {
  const dir = makeRepo({ lots: [actionLot()], eol: '\r\n' });
  writeEvidence({ repo: dir }, 'preuve\r\n');
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) };
  for (const args of [['T1.1', 'P1'], ['T1.1', 'P3'], ['T1.1', 'P9']]) {
    const result = spawnSync(process.execPath, [join(dir, 'scripts', 'lot.mjs'), ...args, '--conductor'], { cwd: tmpdir(), env });
    assert.ok(!result.stdout.includes(0x0d), `${args.join(' ')} : octet CR dans stdout`);
    assert.ok(!result.stderr.includes(0x0d), `${args.join(' ')} : octet CR dans stderr`);
    const last = result.stdout.toString('utf8').trimEnd().split('\n').at(-1);
    assert.ok(last.startsWith('CONDUCTOR_RESULT '), args.join(' '));
    assert.equal(JSON.parse(last.slice('CONDUCTOR_RESULT '.length)).exit_code, result.status);
  }
});

// ── Branche d'exécution (mode Conductor) ──────────────────────────────────────────────────────
test('branche : conductor/agent-lot/<ID> du lot demandé est acceptée', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.branch.current, 'conductor/agent-lot/T1.1');
  assert.ok(stdout.includes('· branche `conductor/agent-lot/T1.1`'), 'le brief annonce la branche unique du contrat');
});

test('branche : branch.accepted porte l’ID du lot rempli, et <ID> tant que le lot est inconnu', () => {
  assert.deepEqual(conductor(['T1.1', 'P1'], { branch: 'main' }).json.branch.accepted, ['conductor/agent-lot/T1.1', 'lot/T1.1-<slug>']);
  assert.deepEqual(conductor(['T9.9', 'P1']).json.branch.accepted, ['conductor/agent-lot/T9.9', 'lot/T9.9-<slug>']);
  const noLot = run(['--conductor'], fixtureEnv()).stdout.trimEnd().split('\n').at(-1);
  assert.deepEqual(JSON.parse(noLot.slice('CONDUCTOR_RESULT '.length)).branch.accepted, ['conductor/agent-lot/<ID>', 'lot/<ID>-<slug>']);
});

test('branche : tout autre conductor/* est refusé (autre lot, autre agent, ancien format <agent>/<exec>)', () => {
  const generic = 'seule conductor/agent-lot/T1.1 est acceptée';
  const refused = {
    'conductor/agent-lot/T9.9': 'appartient au lot T9.9, pas à T1.1',
    'conductor/agent-lot/T1.11': 'appartient au lot T1.11, pas à T1.1',
    'conductor/agent-lot/t1.1': generic,
    'conductor/agent-lot/T1.1-bis': generic,
    'conductor/agent-lot/T1.1/x': generic,
    'conductor/agent-lot/abc123': generic,
    'conductor/autre-agent/T1.1': generic,
    'conductor/agent-lot/exec-42': generic,
    'conductor/agent-lot': generic,
  };
  for (const [branch, expected] of Object.entries(refused)) {
    const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked', branch);
    assert.equal(json.branch.current, branch);
    assert.ok(json.reason.startsWith('MAUVAISE BRANCHE'), json.reason);
    assert.ok(json.reason.includes(expected), `${branch} : ${json.reason}`);
    assert.ok(!stdout.includes('## Fichiers'), 'aucune consigne de code sur une branche refusée');
  }
});

test('branche : la branche d’un AUTRE lot ne sert jamais, même au bon format', () => {
  const other = lotFixture({ id: 'T2.1', asana_task_id: 'a2', branch: 'lot/T2.1-autre' });
  const decoupes = { 'T1.1': decoupageText(), 'T2.1': decoupageText({ lotId: 'T2.1', branch: 'lot/T2.1-autre' }) };
  const wrong = conductor(['T1.1', 'P1'], { lots: [lotFixture(), other], decoupes, branch: 'conductor/agent-lot/T2.1' });
  assert.equal(wrong.json.status, 'blocked');
  assert.ok(wrong.json.reason.includes('appartient au lot T2.1, pas à T1.1'));
  assert.equal(conductor(['T2.1', 'P1'], { lots: [other], decoupes, branch: 'conductor/agent-lot/T2.1' }).json.status, 'ready');
});

test('branche : lot/<ID>-<slug> du MÊME lot est acceptée', () => {
  const { json } = conductor(['T1.1', 'P1'], { branch: 'lot/T1.1-essai' });
  assert.equal(json.status, 'ready');
  assert.equal(json.branch.current, 'lot/T1.1-essai');
});

test('branche : HEAD détaché = blocked, branch.current null, raison explicite, aucune consigne de code', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch: '' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.equal(json.branch.current, null);
  assert.match(json.reason, /HEAD détaché/);
  assert.match(json.reason, /branche/);
  assert.ok(!stdout.includes('## Fichiers'));
  assert.equal(json.action, null);
});

test('branche : main (et les branches d’intégration) ne sont jamais acceptées', () => {
  for (const branch of ['main', 'master', 'develop', 'dev', 'prd', 'production', 'staging']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked');
    assert.equal(json.branch.current, branch);
    assert.match(json.reason, /protégée/);
  }
});

test('branche : une branche non conforme, d’un autre lot ou différente de celle du lot est refusée', () => {
  for (const branch of ['chore/lot-correctifs', 'fix/quelque-chose', 'feat/x', 'conductor/seul', 'conductor/a/b/c', 'lot/T9.9-autre', 'lot/T1.1-', 'lot/T1.1-Autre-Slug', 'lot/T1.1-autre']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked', branch);
    assert.match(json.reason, /MAUVAISE BRANCHE/);
  }
});

test('branche : classifyBranch est pur et rend le type accepté', () => {
  const lot = lotFixture();
  assert.deepEqual(classifyBranch('conductor/agent-lot/T1.1', lot), { ok: true, kind: 'conductor' });
  assert.equal(classifyBranch('conductor/agent-lot/x1', lot).ok, false);
  assert.equal(classifyBranch('conductor/agent-lot/T9.9', lot).ok, false);
  assert.equal(classifyBranch('conductor/agent/T1.1', lot).ok, false);
  assert.ok(classifyBranch('', lot).reason.includes('HEAD détaché') && classifyBranch('', lot).reason.includes('conductor/agent-lot/T1.1'));
  assert.deepEqual(classifyBranch('lot/T1.1-essai', lot), { ok: true, kind: 'lot' });
  assert.equal(classifyBranch('', lot).ok, false);
  assert.equal(classifyBranch('main', lot).ok, false);
  assert.equal(classifyBranch('conductor/../x', lot).ok, false);
  assert.equal(classifyBranch('lot/T1.1-essai', lot, 'lot/T1.1-autre').ok, false);
  assert.equal(classifyBranch('conductor/agent-lot/T1.1', lot, 'lot/T1.1-autre').ok, true, 'la branche Conductor ne dépend pas du slug du plan');
});

test('branche : hors Conductor, la branche du lot reste exigée à l’identique', () => {
  assert.equal(plain(['T1.1', 'P1'], { branch: 'conductor/agent-lot/T1.1' }).exitCode, 3);
  assert.equal(plain(['T1.1', 'P1'], { branch: 'lot/T1.1-essai' }).exitCode, 0);
});

test('compat : --depuis <ref> (Conductor antérieur au contrat) est accepté et sans effet', () => {
  const { json } = conductor(['T1.1', 'P1', '--depuis', 'origin/main'], { branch: 'conductor/agent-lot/T1.1' });
  assert.equal(json.status, 'ready');
});

// Un chemin absolu local (Windows, UNC ou POSIX usuel) ne doit jamais apparaître dans une raison ni dans stderr.
const ABSOLUTE_LOCAL_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private|root|mnt|opt|etc|usr|srv|Volumes)\/)/;

function assertNoLocalPath(text, label) {
  assert.ok(!ABSOLUTE_LOCAL_PATH.test(text), `${label} : chemin absolu local dans « ${text} »`);
}

test('reason : un plan absent ou illisible ne révèle que son chemin relatif au dépôt', () => {
  const env = fixtureEnv();
  const missing = conductorWith(['T1.1', 'P1'], { ...env, planPath: join(env.repo, 'docs', 'pilotage', 'absent.json') });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.json.reason, 'Plan illisible : docs/pilotage/absent.json (ENOENT)');
  assertNoLocalPath(missing.json.reason, 'plan absent');
  assertNoLocalPath(missing.stderr, 'stderr, plan absent');
  assert.ok(!missing.json.reason.includes(env.repo) && !missing.stdout.includes(env.repo));

  const broken = join(env.repo, 'plan-casse.json');
  writeFileSync(broken, '{ "lots": [');
  const invalid = conductorWith(['T1.1', 'P1'], { ...env, planPath: broken });
  assert.equal(invalid.exitCode, 2);
  assert.ok(invalid.json.reason.startsWith('Plan illisible : plan-casse.json (JSON invalide'), invalid.json.reason);
  assertNoLocalPath(invalid.json.reason, 'plan cassé');

  const outside = conductorWith(['T1.1', 'P1'], { ...env, planPath: join(tmpdir(), 'lot-inexistant-hors-depot', 'plan.json') });
  assert.equal(outside.json.reason, 'Plan illisible : plan.json (ENOENT)', 'hors dépôt : le nom du fichier seulement');
  assertNoLocalPath(outside.stderr, 'plan hors dépôt');
});

test('reason : une erreur interne ou git qui cite un chemin absolu est assainie (racine du dépôt, lecteur, POSIX, UNC)', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const thrown = (message) => ({ ...env, checkEvidence: () => { throw new Error(message); } });
  const inRepo = conductorWith(['T1.1', 'P1'], thrown(`EACCES: permission denied, open '${join(env.repo, 'docs', 'preuve', 'releve.md')}'`));
  assert.equal(inRepo.exitCode, 2);
  assert.equal(inRepo.json.status, 'error');
  assert.ok(inRepo.json.reason.includes(`open 'docs`), inRepo.json.reason);
  assert.ok(inRepo.json.reason.includes('preuve'), 'la partie relative au dépôt reste lisible');
  assertNoLocalPath(inRepo.json.reason, 'dans le dépôt');
  assert.ok(!inRepo.json.reason.includes(env.repo));
  for (const absolute of ['C:\\Users\\alice\\AppData\\x.json', 'D:/www/projet/x.json', '\\\\serveur\\partage\\x', '/Users/alice/x', '/home/alice/.ssh/x', '/tmp/lot-abc/x']) {
    const result = conductorWith(['T1.1', 'P1'], thrown(`ENOENT: no such file or directory, open '${absolute}'`));
    assert.equal(result.exitCode, 2, absolute);
    assert.ok(result.json.reason.includes('<chemin local>'), `${absolute} → ${result.json.reason}`);
    assertNoLocalPath(result.json.reason, absolute);
    assertNoLocalPath(result.stderr, `stderr ${absolute}`);
  }
  const git = conductor(['T1.1', 'P1'], { gitError: `fatal: detected dubious ownership in repository at '${env.repo}'` });
  assert.equal(git.exitCode, 2);
  assertNoLocalPath(git.json.reason, 'git');
});

test('reason : scrubLocalPaths ne touche ni les chemins relatifs ni les URL', () => {
  const repo = join(tmpdir(), 'lot-scrub-depot');
  assert.equal(scrubLocalPaths('docs/pilotage/plan.json absent', repo), 'docs/pilotage/plan.json absent');
  assert.equal(scrubLocalPaths('https://example.test/tmp/x et /lot S2.1 P1', repo), 'https://example.test/tmp/x et /lot S2.1 P1');
  assert.equal(scrubLocalPaths(`${repo}/scripts/lot.mjs`, repo), 'scripts/lot.mjs');
  assert.equal(scrubLocalPaths(`${repo.replaceAll('\\', '/')}/docs/a.md`, repo), 'docs/a.md');
  assert.equal(scrubLocalPaths(`erreur dans ${repo}`, repo), 'erreur dans .');
  assert.equal(scrubLocalPaths(null, repo), '');
});

test('reason : aucun statut du contrat ne laisse passer un chemin absolu local', () => {
  const absoluteBranch = 'conductor/agent-lot/T9.9';
  const cases = [
    conductor(['T1.1', 'P1']),
    conductor(['T1.1', 'P1'], { branch: absoluteBranch }),
    conductor(['T1.1', 'P1'], { branch: '' }),
    conductor(['T1.1', 'P3']),
    conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] }),
    conductor(['T9.9', 'P1']),
    conductor(['T1.1', 'banane']),
  ];
  for (const { json, stdout, stderr } of cases) {
    assertNoLocalPath(json.reason ?? '', json.status);
    assertNoLocalPath(stdout, `stdout ${json.status}`);
    assertNoLocalPath(stderr, `stderr ${json.status}`);
  }
  const real = run(['S2.1', 'P1', '--conductor'], { git: { branch: () => 'main', subjects: () => [] }, now: new Date('2026-10-26T05:00:00Z') });
  assertNoLocalPath(real.stdout, 'plan réel');
});

test('arguments : --depuis n’avale jamais l’option suivante, sa valeur est obligatoire', () => {
  // `--depuis --conductor` : erreur d'usage, ET --conductor est bien lu (la ligne finale est émise).
  const swallowed = run(['T1.1', 'P1', '--depuis', '--conductor'], fixtureEnv());
  assert.equal(swallowed.exitCode, 2);
  const last = swallowed.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), 'le mode Conductor survit à l’erreur');
  const json = JSON.parse(last.slice('CONDUCTOR_RESULT '.length));
  assert.equal(json.status, 'error');
  assert.ok(json.reason.includes('--depuis attend une référence git'));
  for (const args of [['T1.1', 'P1', '--depuis'], ['T1.1', 'P1', '--depuis', ''], ['T1.1', 'P1', '--depuis', '-x'], ['T1.1', 'P1', '--depuis', '--rejouer'], ['--depuis', 'T1.1', '--check']]) {
    for (const mode of [[], ['--conductor']]) {
      const result = run([...args, ...mode], fixtureEnv());
      assert.equal(result.exitCode, 2, [...args, ...mode].join(' '));
      assert.ok(!result.stdout.includes('## Fichiers'), 'rien n’est exécuté');
    }
  }
  assert.equal(run(['T1.1', 'P1', '--depuis', 'origin/main'], fixtureEnv()).exitCode, 0);
  assert.equal(run(['T1.1', 'P1', '--depuis', 'origin/main', '--rejouer'], fixtureEnv()).exitCode, 0);
  assert.equal(run(['--depuis', 'origin/main', 'T1.1', 'P1'], fixtureEnv()).exitCode, 0);
});

test('arguments : option inconnue, forme --depuis=<ref>, option courte et arguments en trop = exit 2 propre', () => {
  for (const args of [['T1.1', 'P1', '--nimporte'], ['T1.1', 'P1', '--depuis=origin/main'], ['T1.1', 'P1', '-x'], ['T1.1', 'P1', '-'], ['T1.1', 'P1', 'P2'], ['T1.1', 'P1', 'cloture'], ['T1.1', 'P1', 'x', 'y'], ['T1.1', '--check'], ['--check', 'T1.1'], ['--check', '--check']]) {
    const result = run(args, fixtureEnv());
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.ok(result.stderr.length > 0, args.join(' '));
    assert.ok(!/at .*lot\.mjs/.test(result.stderr), 'pas de pile d’appels');
    assert.ok(!result.stdout.includes('CONDUCTOR_RESULT'), 'hors --conductor, jamais de ligne finale');
  }
  const unknown = run(['T1.1', 'P1', '--conductor', '--nimporte'], fixtureEnv());
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.stderr, /Option inconnue : --nimporte/);
  const extra = run(['T1.1', 'P1', 'P2', '--conductor'], fixtureEnv());
  assert.equal(extra.exitCode, 2);
  assert.match(extra.stderr, /Arguments en trop : P2/);
  assert.equal(JSON.parse(extra.stdout.trimEnd().split('\n').at(-1).slice('CONDUCTOR_RESULT '.length)).status, 'error');
});

test('commit_message est fourni dès que le prompt est connu, même bloqué', () => {
  const { json } = conductor(['T1.1', 'P2'], { branch: 'main' });
  assert.equal(json.status, 'blocked');
  assert.equal(json.commit_message, '[T1.1] P2 — Deuxième prompt');
});

// ── Clôture : débloquée après le dernier prompt, jamais pour un lot déjà fini avant les travaux ──
const ALL_THREE = [THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT];

test('clôture : un lot passé à done par ses propres commits peut se clôturer', () => {
  const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE });
  assert.equal(done.exitCode, 0);
  assert.match(done.stdout, /PRÊTE/);
  assert.match(done.stdout, /vient des commits de cette branche/);
  assert.ok(!done.stdout.includes('TERMINÉ'));
});

test('clôture : même résultat que pour un lot encore ready (le statut done ne change rien à l’éligibilité)', () => {
  const ready = plain(['T1.1', 'cloture'], { subjects: ALL_THREE });
  assert.equal(ready.exitCode, 0);
  assert.match(ready.stdout, /PRÊTE/);
});

test('clôture : un lot done AVANT le début des travaux (aucun commit de prompt) reste TERMINÉ', () => {
  const finished = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ['autre commit', 'docs: quelque chose'] });
  assert.equal(finished.exitCode, 3);
  assert.match(finished.stdout, /TERMINÉ/);
});

test('clôture : un lot done avec seulement une partie des prompts committés reste TERMINÉ', () => {
  const partial = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: [FIRST_SUBJECT, SECOND_SUBJECT] });
  assert.equal(partial.exitCode, 3);
  assert.match(partial.stdout, /TERMINÉ/);
});

test('clôture : done + tous les commits, mais mauvaise branche (main ou autre lot) = refusée', () => {
  for (const branch of ['main', 'lot/T9.9-autre', '']) {
    const wrong = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
    assert.equal(wrong.exitCode, 3, branch);
    assert.match(wrong.stdout, /TERMINÉ/);
  }
});

test('clôture : un lot done sans découpage ne se clôture pas (aucun commit pour prouver le travail)', () => {
  const none = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done', execution: undefined })], decoupes: {}, subjects: ALL_THREE });
  assert.equal(none.exitCode, 3);
  assert.match(none.stdout, /TERMINÉ/);
});

test('clôture : un lot done reste non relançable pour un prompt, même avec des commits', () => {
  const relance = plain(['T1.1', 'P1'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE });
  assert.equal(relance.exitCode, 3);
  assert.match(relance.stdout, /TERMINÉ/);
});

test('clôture : un lot ready à qui il reste des prompts est « PAS PRÊTE » (3)', () => {
  const missing = plain(['T1.1', 'cloture'], { subjects: [SECOND_SUBJECT, FIRST_SUBJECT] });
  assert.equal(missing.exitCode, 3);
  assert.match(missing.stdout, /PAS PRÊTE — prompts sans commit : P3/);
});

test('clôture : refusée en mode Conductor même quand elle serait autorisée hors Conductor', () => {
  const { json, exitCode } = conductor(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch: 'lot/T1.1-essai' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
});

test('clôture : hors Conductor, la branche unique conductor/agent-lot/<ID> est acceptée (contrat v1.1 § 2)', () => {
  const branch = 'conductor/agent-lot/T1.1';
  const ready = plain(['T1.1', 'cloture'], { subjects: ALL_THREE, branch });
  assert.equal(ready.exitCode, 0);
  assert.match(ready.stdout, /PRÊTE/);
  const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
  assert.equal(done.exitCode, 0);
  assert.match(done.stdout, /vient des commits de cette branche/);
  const partial = plain(['T1.1', 'cloture'], { subjects: [FIRST_SUBJECT, SECOND_SUBJECT], branch });
  assert.equal(partial.exitCode, 3);
  assert.match(partial.stdout, /PAS PRÊTE — prompts sans commit : P3/);
  const unfinished = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: [FIRST_SUBJECT], branch });
  assert.equal(unfinished.exitCode, 3);
  assert.match(unfinished.stdout, /TERMINÉ/);
});

test('clôture : la branche Conductor d’un AUTRE lot, ou un autre conductor/*, ne clôture pas', () => {
  for (const branch of ['conductor/agent-lot/T9.9', 'conductor/agent-lot/exec-1', 'conductor/agent/T1.1', 'conductor/agent-lot/t1.1']) {
    const wrong = plain(['T1.1', 'cloture'], { subjects: ALL_THREE, branch });
    assert.equal(wrong.exitCode, 3, branch);
    assert.match(wrong.stdout, /MAUVAISE BRANCHE/);
    const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
    assert.equal(done.exitCode, 3, branch);
    assert.match(done.stdout, /TERMINÉ/);
  }
});

test('clôture : sur la branche unique, les prompts de TOUTES les étapes comptent, même déclarées sur d’autres branches', () => {
  const split = decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite');
  const branch = 'conductor/agent-lot/T1.1';
  const lot = lotFixture({ status: 'done' });
  const withP3Only = plain(['T1.1', 'cloture'], { lots: [lot], decoupes: { 'T1.1': split }, subjects: [THIRD_SUBJECT], branch });
  assert.equal(withP3Only.exitCode, 3, 'P1 et P2 manquent : la branche unique porte tout le lot');
  const parsed = parseDecoupage(split);
  assert.equal(clotureAfterWork(lot, parsed, branch, new Set(['P1', 'P2', 'P3'])), true);
  assert.equal(clotureAfterWork(lot, parsed, branch, new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, parsed, 'lot/T1.1-essai', new Set(['P1', 'P2'])), true, 'branche manuelle : seulement ses étapes');
});

test('ordre : sur la branche unique conductor/agent-lot/<ID>, tout prompt précédent est exigé, quelle que soit l’étape', () => {
  const split = decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite');
  const branch = 'conductor/agent-lot/T1.1';
  const noHistory = conductor(['T1.1', 'P3'], { decoupes: { 'T1.1': split }, branch });
  assert.equal(noHistory.json.status, 'blocked');
  assert.ok(noHistory.json.reason.includes('P3 exige d’abord P1, P2'), noHistory.json.reason);
  const ok = conductor(['T1.1', 'P3'], { decoupes: { 'T1.1': split }, branch, subjects: [SECOND_SUBJECT, FIRST_SUBJECT] });
  assert.equal(ok.json.status, 'ready');
  assert.deepEqual(promptsBefore(parseDecoupage(split), lotFixture(), 'P3', true), ['P1', 'P2']);
});

test('clôture : clotureAfterWork ne regarde que les prompts de la branche courante', () => {
  const twoBranches = parseDecoupage(
    decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite'),
  );
  const lot = lotFixture({ status: 'done' });
  assert.equal(clotureAfterWork(lot, twoBranches, 'lot/T1.1-essai', new Set(['P1', 'P2'])), true);
  assert.equal(clotureAfterWork({ ...lot, branch: 'lot/T1.1-suite' }, twoBranches, 'lot/T1.1-suite', new Set(['P3'])), true);
  assert.equal(clotureAfterWork(lot, twoBranches, 'lot/T1.1-essai', new Set(['P1'])), false);
  assert.equal(clotureAfterWork({ ...lot, status: 'ready' }, twoBranches, 'lot/T1.1-essai', new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, twoBranches, '', new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, null, 'lot/T1.1-essai', new Set()), false);
});

// ── Ordre et reprise des prompts ──────────────────────────────────────────────────────────────
test('ordre : un prompt exige que tous les précédents soient committés sur la branche', () => {
  const noHistory = plain(['T1.1', 'P2']);
  assert.equal(noHistory.exitCode, 3);
  assert.match(noHistory.stdout, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
  const skipped = plain(['T1.1', 'P3'], { subjects: [FIRST_SUBJECT] });
  assert.equal(skipped.exitCode, 3);
  assert.match(skipped.stdout, /P3 exige d’abord P2/);
  const both = plain(['T1.1', 'P3']);
  assert.match(both.stdout, /P3 exige d’abord P1, P2/);
  assert.equal(plain(['T1.1', 'P2'], { subjects: [FIRST_SUBJECT] }).exitCode, 0);
  assert.equal(plain(['T1.1', 'P3'], { subjects: [SECOND_SUBJECT, FIRST_SUBJECT] }).exitCode, 0);
  assert.equal(plain(['T1.1', 'P1']).exitCode, 0);
});

test('ordre : en mode Conductor, blocked (3) avec la raison et le commit_message du prompt demandé', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P3'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /ORDRE DES PROMPTS/);
  assert.equal(json.commit_message, THIRD_SUBJECT);
  assert.ok(!stdout.includes('## Fichiers'));
});

test('reprise : un prompt déjà committé est REFUSÉ (3), il ne part pas avec un simple avertissement', () => {
  const again = plain(['T1.1', 'P1'], { subjects: [FIRST_SUBJECT] });
  assert.equal(again.exitCode, 3);
  assert.match(again.stdout, /DÉJÀ FAIT/);
  assert.ok(!again.stdout.includes('## Fichiers'));
  const viaConductor = conductor(['T1.1', 'P1'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(viaConductor.exitCode, 3);
  assert.equal(viaConductor.json.status, 'blocked');
  assert.match(viaConductor.json.reason, /déjà committé/);
  assert.equal(viaConductor.json.commit_message, FIRST_SUBJECT);
});

test('reprise : --rejouer reprend volontairement un prompt committé, avec avertissement', () => {
  const replay = plain(['T1.1', 'P1', '--rejouer'], { subjects: [FIRST_SUBJECT] });
  assert.equal(replay.exitCode, 0);
  assert.match(replay.stdout, /a déjà un commit \(--rejouer\)/);
  assert.match(replay.stdout, /## Commit\n\[T1\.1\] P1/);
});

test('reprise : --rejouer ne lève pas l’ordre des prompts', () => {
  const stillBlocked = plain(['T1.1', 'P3', '--rejouer'], { subjects: [THIRD_SUBJECT] });
  assert.equal(stillBlocked.exitCode, 3);
  assert.match(stillBlocked.stdout, /ORDRE DES PROMPTS/);
});

test('reprise : --rejouer est interdit en mode Conductor (error, 2)', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1', '--rejouer'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 2);
  assert.equal(json.status, 'error');
});

test('historique : completedPrompts ne reconnaît que le sujet ancré, jamais un autre lot ni un identifiant voisin', () => {
  const lot = lotFixture();
  const done = completedPrompts(lot, [
    '[T1.1] P1 — exact',
    'contrat: [T1.1] P2 — préfixe : plus reconnu (détecteur unique ancré)',
    '[T1.1] P3 - tiret simple',
    '[T1.11] P4 — autre lot',
    '[T1x1] P5 — pas le même identifiant',
    '[T1.1] P6 sans tiret',
    'Revert "[T1.1] P7" sans séparateur',
    'autre commit',
  ]);
  assert.deepEqual([...done].sort(), ['P1']);
});

test('ordre : promptsBefore ignore les prompts d’une autre branche et suit l’ordre du découpage', () => {
  const split = parseDecoupage(decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite'));
  const lot = lotFixture();
  assert.deepEqual(promptsBefore(split, lot, 'P1'), []);
  assert.deepEqual(promptsBefore(split, lot, 'P2'), ['P1']);
  assert.deepEqual(promptsBefore(split, lot, 'P3'), []);
  assert.deepEqual(promptsBefore(parseDecoupage(decoupageText()), lot, 'P3'), ['P1', 'P2']);
  assert.deepEqual(promptsBefore(parseDecoupage(decoupageText()), lot, 'P9'), []);
});

// ── Preuve d'action humaine, chemins et dates ─────────────────────────────────────────────────
const EVIDENCE = 'docs/preuve/releve.md';
const ACTION = {
  id: 'T1.1-A1',
  before_prompt: 'P1',
  type: 'authenticated-browser',
  title: 'Relever les chiffres dans un outil connecté',
  owner: 'Alice',
  url: 'https://example.test/outil',
  output: EVIDENCE,
  resume_prompt: 'P1',
  instructions: ['Relever les chiffres', 'Déposer le fichier'],
  forbidden: ['Copier un cookie'],
};

function actionLot(overrides = {}) {
  return lotFixture({
    status: 'waiting',
    not_before: '2026-05-01T09:00:00+02:00',
    execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION] },
    ...overrides,
  });
}

function conductorWith(args, env) {
  const result = run([...args, '--conductor'], env);
  const last = result.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), `dernière ligne inattendue : ${last}`);
  return { ...result, json: JSON.parse(last.slice('CONDUCTOR_RESULT '.length)) };
}

function writeEvidence(env, content, path = EVIDENCE) {
  const full = join(env.repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return full;
}

test('action humaine : preuve absente = action_required (4), payload complet, rien de secret', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const { json, exitCode, stdout } = conductorWith(['T1.1', 'P1'], env);
  assert.equal(exitCode, 4);
  assert.equal(json.status, 'action_required');
  assert.equal(json.exit_code, 4);
  assert.match(json.reason, /T1\.1-A1 doit être réalisée avant P1/);
  assert.deepEqual(json.action, {
    id: 'T1.1-A1',
    type: 'authenticated-browser',
    responsible: 'Alice',
    url: 'https://example.test/outil',
    instructions: ['Relever les chiffres', 'Déposer le fichier'],
    forbidden: ['Copier un cookie'],
    evidence_path: EVIDENCE,
    evidence_rule: 'file_exists_nonempty',
    resume_command: '/lot T1.1 P1',
    not_before: '2026-05-01T09:00:00+02:00',
  });
  assert.equal(json.commit_message, FIRST_SUBJECT);
  assert.match(stdout, /## ACTION HUMAINE REQUISE — T1\.1-A1/);
  assert.ok(!/\*\*PRÊT\*\*/.test(stdout), 'le brief ne doit pas dire PRÊT quand une action est requise');
});

test('action humaine : le code 4 vaut aussi hors --conductor ? non — la porte ne s’applique qu’en mode Conductor', () => {
  const env = fixtureEnv({ lots: [actionLot()] });
  assert.equal(run(['T1.1', 'P1'], env).exitCode, 0);
});

test('action humaine : preuve non vide dans le dépôt = ready', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  writeEvidence(env, '| Pages indexées | 0 |\n');
  const { json, exitCode } = conductorWith(['T1.1', 'P1'], env);
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.action, null);
});

test('action humaine : un fichier de preuve VIDE ou fait de blancs ne passe pas', () => {
  for (const content of ['', '   \n\t\n']) {
    const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
    writeEvidence(env, content);
    const { json, exitCode } = conductorWith(['T1.1', 'P1'], env);
    assert.equal(exitCode, 4, JSON.stringify(content));
    assert.equal(json.status, 'action_required');
    assert.match(json.reason, /vide/);
  }
});

test('action humaine : un dossier à la place du fichier ne passe pas', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  mkdirSync(join(env.repo, EVIDENCE), { recursive: true });
  assert.equal(conductorWith(['T1.1', 'P1'], env).exitCode, 4);
});

test('action humaine : un lien symbolique qui sort du dépôt ne passe pas, un lien interne oui', (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'lot-outside-'));
  tempDirs.push(outside);
  writeFileSync(join(outside, 'secret.md'), 'contenu hors dépôt');
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const full = join(env.repo, EVIDENCE);
  mkdirSync(join(full, '..'), { recursive: true });
  try {
    symlinkSync(join(outside, 'secret.md'), full);
  } catch {
    t.skip('création de lien symbolique non permise sur ce poste');
    return;
  }
  const refused = conductorWith(['T1.1', 'P1'], env);
  assert.equal(refused.exitCode, 4);
  assert.match(refused.json.reason, /sort du dépôt/);
  rmSync(full);
  writeFileSync(join(env.repo, 'reel.md'), 'preuve réelle');
  symlinkSync(join(env.repo, 'reel.md'), full);
  assert.equal(conductorWith(['T1.1', 'P1'], env).exitCode, 0);
});

test('action humaine : l’ordre des portes — dépendance et date avant l’action, branche avant la preuve', () => {
  const early = conductor(['T1.1', 'P1'], { lots: [actionLot({ not_before: '2999-01-01T00:00:00+01:00' })], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(early.json.status, 'too_early');
  const detached = conductor(['T1.1', 'P1'], { lots: [actionLot()], branch: '' });
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.action, null);
});

test('action humaine : le prompt suivant sans action déclarée n’est pas arrêté', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1', subjects: [FIRST_SUBJECT] });
  assert.equal(conductorWith(['T1.1', 'P2'], env).json.status, 'ready');
});

test('action humaine : conductorGate accepte un verdict booléen ou détaillé (tests et appelants historiques)', () => {
  const lot = actionLot();
  const decoupage = parseDecoupage(decoupageText());
  assert.equal(conductorGate(lot, 'P1', decoupage, () => false).actionRequired, true);
  assert.equal(conductorGate(lot, 'P1', decoupage, () => true).ready, true);
  assert.equal(conductorGate(lot, 'P1', decoupage, () => ({ ok: false, reason: 'vide' })).reason.includes('vide'), true);
  assert.equal(conductorGate(lot, 'P1', decoupage, (path) => ({ ok: path === EVIDENCE })).ready, true);
});

test('chemins : validateRelativePath rejette absolu, .., antislash, lecteur, flux NTFS, segments vides', () => {
  assert.equal(validateRelativePath('docs/a/preuve.md'), null);
  assert.equal(validateRelativePath('a.md'), null);
  for (const bad of ['', '  ', '/etc/hosts', '../x', 'a/../../x', 'a/..', 'C:\\x', 'C:/x', '\\\\serveur\\partage', 'a\\b', 'a//b', './a', 'a/./b', 'a/', 'fichier.md:flux', 'a\0b', ' a.md', 'a?.md']) {
    assert.notEqual(validateRelativePath(bad), null, JSON.stringify(bad));
  }
  assert.notEqual(validateRelativePath(undefined), null);
  assert.notEqual(validateRelativePath(42), null);
});

test('chemins : inspectEvidence rejette un chemin invalide avant tout accès disque', () => {
  const repo = mkdtempSync(join(tmpdir(), 'lot-repo-'));
  tempDirs.push(repo);
  for (const bad of ['../hors.md', '/tmp/x', 'a/../../b']) {
    const verdict = inspectEvidence(repo, bad);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /chemin de preuve invalide/);
  }
  assert.equal(inspectEvidence(repo, 'absent.md').reason, 'fichier de preuve absent');
});

test('validation (--check) : un champ output avec .. ou absolu est rejeté', () => {
  for (const output of ['../../../etc/hosts', '/etc/hosts', 'C:\\Windows\\x', 'a\\b.md', 'docs/../../x']) {
    const lot = lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [{ ...ACTION, output }] } });
    const errors = validatePlan({ statuses: STATUSES, lots: [lot] }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
    assert.ok(errors.some((message) => /preuve de sortie invalide/.test(message)), output);
    const check = run(['--check'], fixtureEnv({ lots: [lot] }));
    assert.equal(check.exitCode, 2, output);
    assert.match(check.stderr, /preuve de sortie invalide/);
  }
});

test('validation : action de type inconnu, prompt hors liste, doublon d’identifiant, url non https, not_before invalide', () => {
  const decoupeDir = join(fixtureEnv().repo, 'decoupe');
  const check = (action) => validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [action] } })] }, { decoupeDir });
  assert.ok(check({ ...ACTION, type: 'magie' }).some((message) => /type inconnu/.test(message)));
  assert.ok(check({ ...ACTION, before_prompt: 'P7' }).some((message) => /absent des prompts Conductor/.test(message)));
  assert.ok(check({ ...ACTION, url: 'javascript:alert(1)' }).some((message) => /url non https/.test(message)));
  assert.ok(check({ ...ACTION, not_before: 'bientôt' }).some((message) => /not_before invalide/.test(message)));
  assert.ok(check({ ...ACTION, resume_prompt: 'reprendre' }).some((message) => /prompt de reprise invalide/.test(message)));
  const twice = validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION, { ...ACTION, before_prompt: 'P2' }] } })] }, { decoupeDir });
  assert.ok(twice.some((message) => /dupliquée/.test(message)));
  assert.deepEqual(check(ACTION), []);
});

test('validation : deux actions avant le même prompt sont interdites — --check exit 2 avec un message clair (contrat v1.1 § 6)', () => {
  const second = { ...ACTION, id: 'T1.1-A2', title: 'Une seconde action', output: 'docs/preuve/autre.md' };
  const lot = lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION, second] } });
  const check = run(['--check'], fixtureEnv({ lots: [lot] }));
  assert.equal(check.exitCode, 2);
  assert.ok(check.stderr.includes('T1.1: actions T1.1-A1 et T1.1-A2 déclarées avant le même prompt P1 : une seule action humaine par prompt'), check.stderr);
  // Le plan invalide ferme aussi le lanceur de prompt (rien ne part avec une action ignorée).
  const prompt = conductor(['T1.1', 'P1'], { lots: [lot], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(prompt.exitCode, 2);
  assert.equal(prompt.json.status, 'error');
  assert.ok(prompt.json.reason.includes('une seule action humaine par prompt'), prompt.json.reason);
  // Deux actions devant deux prompts différents, ou une seule par prompt, restent valides.
  const apart = lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION, { ...second, before_prompt: 'P2', resume_prompt: 'P2' }] } });
  assert.equal(run(['--check'], fixtureEnv({ lots: [apart] })).exitCode, 0);
  // Même before_prompt dans deux lots différents : sans objet.
  const other = lotFixture({ id: 'T2.1', asana_task_id: 'a2', branch: 'lot/T2.1-autre', execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [{ ...ACTION, id: 'T2.1-A1' }] } });
  const decoupes = { 'T1.1': decoupageText(), 'T2.1': decoupageText({ lotId: 'T2.1', branch: 'lot/T2.1-autre' }) };
  assert.equal(run(['--check'], fixtureEnv({ lots: [lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION] } }), other], decoupes })).exitCode, 0);
});

test('validation : un cycle de dépendances est détecté', () => {
  const lots = [
    lotFixture({ id: 'T2.1', depends: ['T2.2'], asana_task_id: 'a1', execution: undefined, branch: undefined }),
    lotFixture({ id: 'T2.2', depends: ['T2.1'], asana_task_id: 'a2', execution: undefined, branch: undefined }),
  ];
  const errors = validatePlan({ statuses: STATUSES, lots }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
  assert.ok(errors.some((message) => /cycle de dépendances T2\.1 → T2\.2 → T2\.1/.test(message)), errors.join(' | '));
});

test('dates : parseNotBefore exige ISO 8601 avec fuseau et une date réelle', () => {
  assert.equal(parseNotBefore('2026-10-26T08:41:00+01:00').toISOString(), '2026-10-26T07:41:00.000Z');
  assert.equal(parseNotBefore('2026-10-26T07:41Z').toISOString(), '2026-10-26T07:41:00.000Z');
  assert.equal(parseNotBefore('2026-10-26T07:41:00.500Z').getUTCMilliseconds(), 500);
  for (const bad of ['demain', '2026-10-26', '2026-10-26 08:41:00+01:00', '2026-10-26T08:41:00', '2026-02-30T10:00:00+01:00', '2026-13-01T10:00:00Z', '2026-10-26T25:00:00+01:00', '2026-10-26T10:61:00Z', '', null, undefined, 42]) {
    assert.throws(() => parseNotBefore(bad), /not_before invalide/, String(bad));
  }
});

test('dates : un not_before invalide donne une erreur propre (2), jamais une trace ni un crash', () => {
  const lots = [lotFixture({ status: 'waiting', not_before: 'demain' })];
  const check = run(['--check'], fixtureEnv({ lots }));
  assert.equal(check.exitCode, 2);
  assert.match(check.stderr, /not_before invalide « demain »/);
  const plainRun = run(['T1.1', 'P1'], fixtureEnv({ lots }));
  assert.equal(plainRun.exitCode, 2);
  assert.ok(!/at .*lot\.mjs/.test(plainRun.stderr), 'pas de pile d’appels');
  const viaConductor = conductor(['T1.1', 'P1'], { lots });
  assert.equal(viaConductor.exitCode, 2);
  assert.equal(viaConductor.json.status, 'error');
  const gate = dateGate(lots[0], NOW);
  assert.equal(gate.ready, false);
  assert.match(gate.invalid, /not_before invalide/);
});

// ── Statuts, dépendances ──────────────────────────────────────────────────────────────────────
test('statuts : seul ready (ou waiting daté et échu) laisse partir un lot', () => {
  const open = { ready: true, date: null };
  assert.equal(statusGate(lotFixture({ status: 'ready' }), open).ready, true);
  assert.equal(statusGate(lotFixture({ status: 'waiting', not_before: '2026-05-01T09:00:00+02:00' }), open).ready, true);
  assert.equal(statusGate(lotFixture({ status: 'waiting', not_before: '2026-05-01T09:00:00+02:00' }), { ready: false }).ready, false);
  const expected = { done: /TERMINÉ/, partial: /PARTIEL/, decision: /DÉCISION REQUISE/, backlog: /BACKLOG/, waiting: /EN ATTENTE/ };
  for (const [status, pattern] of Object.entries(expected)) {
    const verdict = statusGate(lotFixture({ status }), open);
    assert.equal(verdict.ready, false, status);
    assert.match(verdict.reason, pattern);
  }
  assert.match(statusGate(lotFixture({ status: 'inconnu' }), open).reason, /STATUT BLOQUANT/);
});

test('statuts : chaque statut bloquant donne blocked (3) en mode Conductor, avec la raison', () => {
  for (const status of ['done', 'partial', 'decision', 'backlog', 'waiting']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status })], branch: 'conductor/agent-lot/T1.1' });
    assert.equal(exitCode, 3, status);
    assert.equal(json.status, 'blocked', status);
    assert.ok(json.reason.length > 5);
  }
});

test('dépendances : tous les états sont rapportés, seul done lève le verrou, une inconnue bloque', () => {
  const all = lotMap({
    lots: [
      lotFixture({ id: 'T0.1', status: 'done' }),
      lotFixture({ id: 'T0.2', status: 'ready' }),
      lotFixture({ id: 'T0.3', status: 'partial' }),
      lotFixture({ id: 'T1.1', depends: ['T0.1', 'T0.2', 'T0.9'] }),
    ],
  });
  const states = dependencyStates(all.get('T1.1'), all);
  assert.deepEqual(states.map(({ id, status }) => [id, status]), [['T0.1', 'done'], ['T0.2', 'ready'], ['T0.9', 'unknown']]);
  assert.equal(dependenciesReady(states), false);
  assert.equal(dependenciesReady(states.filter(({ id }) => id === 'T0.1')), true);
  assert.equal(dependenciesReady([]), true);
  assert.equal(dependenciesReady([{ id: 'x', status: 'partial' }]), false);
});

test('dépendances : une dépendance ouverte bloque même un lot ready, et la raison la nomme', () => {
  const lots = [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'ready', asana_task_id: 'a0', execution: undefined, branch: undefined })];
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { lots, branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /T0\.1 \(ready\)/);
  assert.match(stdout, /PAS PRÊT/);
  const closed = [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'done', asana_task_id: 'a0', execution: undefined, branch: undefined })];
  assert.equal(conductor(['T1.1', 'P1'], { lots: closed, branch: 'conductor/agent-lot/T1.1' }).json.status, 'ready');
});

// ── Dates : fuseau Europe/Paris, heure d'été et d'hiver ───────────────────────────────────────
test('dates : le verrou 26/10 08:41 Paris (heure d’hiver, +01:00) s’ouvre à 07:41:00Z exactement', () => {
  const lot = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' });
  assert.equal(dateGate(lot, new Date('2026-10-26T07:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-10-26T07:41:00Z')).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:41:00Z'))).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:40:59Z'))).ready, false);
});

test('dates : le même 08:41 Paris en heure d’été (+02:00) s’ouvre à 06:41:00Z', () => {
  const lot = lotFixture({ status: 'waiting', not_before: '2026-07-01T08:41:00+02:00' });
  assert.equal(dateGate(lot, new Date('2026-07-01T06:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-07-01T06:41:00Z')).ready, true);
});

test('dates : changement d’heure — 29/03 (été) et 25/10 (hiver) se lisent par leur décalage explicite', () => {
  const spring = parseNotBefore('2026-03-29T03:00:00+02:00');
  assert.equal(spring.toISOString(), '2026-03-29T01:00:00.000Z');
  assert.equal(parseNotBefore('2026-03-29T01:59:00+01:00').getTime() + 60_000, spring.getTime());
  const autumnFirst = parseNotBefore('2026-10-25T02:30:00+02:00');
  const autumnSecond = parseNotBefore('2026-10-25T02:30:00+01:00');
  assert.equal(autumnSecond.getTime() - autumnFirst.getTime(), 3_600_000);
});

test('dates : le décalage du not_before décale le verrou (un fuseau d’écart = une heure)', () => {
  const now = new Date('2026-10-26T07:41:00Z');
  const paris = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' });
  const sameInstant = lotFixture({ status: 'waiting', not_before: '2026-10-26T07:41:00Z' });
  const oneHourLater = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00Z' });
  const summerOffset = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+02:00' });
  assert.equal(dateGate(paris, now).ready, true);
  assert.equal(dateGate(sameInstant, now).ready, true);
  assert.equal(dateGate(oneHourLater, now).ready, false);
  assert.equal(dateGate(oneHourLater, new Date('2026-10-26T08:41:00Z')).ready, true);
  // +02:00 au lieu de +01:00 : le même « 08:41 » s'ouvre une heure plus tôt (06:41Z).
  assert.equal(dateGate(summerOffset, new Date('2026-10-26T06:40:59Z')).ready, false);
  assert.equal(dateGate(summerOffset, new Date('2026-10-26T06:41:00Z')).ready, true);
  assert.equal(dateGate(summerOffset, now).ready, true);
  assert.equal(dateGate(lotFixture(), now).ready, true);
  assert.equal(dateGate(lotFixture(), now).date, null);
});

test('dates : TROP TÔT est affiché à l’heure de Paris, en été comme en hiver', () => {
  assert.match(formatDate(new Date('2026-10-26T07:41:00Z')), /08:41/);
  assert.match(formatDate(new Date('2026-07-01T06:41:00Z')), /08:41/);
  assert.match(formatDate(new Date('2026-10-26T07:41:00Z')), /lundi 26 octobre 2026/);
  const early = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' })], now: new Date('2026-10-26T07:40:59Z') });
  assert.equal(early.json.status, 'too_early');
  assert.match(early.json.reason, /lundi 26 octobre 2026 à 08:41/);
  const open = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' })], now: new Date('2026-10-26T07:41:00Z'), branch: 'conductor/agent-lot/T1.1' });
  assert.equal(open.json.status, 'ready');
});

// ── parseDecoupage ────────────────────────────────────────────────────────────────────────────
test('découpage : la structure est la même en LF et en CRLF', () => {
  const lf = parseDecoupage(decoupageText());
  const crlf = parseDecoupage(decoupageText({ eol: '\r\n' }));
  assert.deepEqual(crlf, lf);
  assert.deepEqual(lf.steps.flatMap((step) => step.prompts.map((prompt) => prompt.id)), ['P1', 'P2', 'P3']);
  assert.equal(lf.steps[0].branch, 'lot/T1.1-essai');
  assert.equal(lf.steps[0].responsible, 'Alice');
  assert.deepEqual(lf.steps[0].prompts[0].files, ['a.txt', 'b.txt']);
  assert.deepEqual(lf.steps[0].prompts[0].actions, ['geste 1']);
  assert.equal(lf.steps[0].prompts[0].duration, 20);
  assert.equal(lf.steps[0].prompts[0].test, '`node -v`');
  assert.equal(lf.etat_au, '2026-06-01');
});

test('découpage : accents, ligatures et saisie décomposée (NFD) donnent le même résultat', () => {
  const text = decoupageText().replace('Premier prompt', 'Été à l’œuvre — déjà prêt');
  const composed = parseDecoupage(text.normalize('NFC'));
  const decomposed = parseDecoupage(text.normalize('NFD'));
  assert.equal(composed.steps[0].prompts[0].title, 'Été à l’œuvre — déjà prêt');
  assert.deepEqual(decomposed, composed);
  assert.equal(commitMessage(lotFixture(), composed.steps[0], composed.steps[0].prompts[0]), '[T1.1] P1 — Été à l’œuvre — déjà prêt');
});

test('découpage : « Branche Conductor » est lue à part de « Branche » et doit valoir conductor/agent-lot/<ID>', () => {
  const withLine = decoupageText().replaceAll('Branche : lot/T1.1-essai', 'Branche : lot/T1.1-essai\nBranche Conductor : conductor/agent-lot/T1.1');
  const parsed = parseDecoupage(withLine);
  assert.deepEqual(parsed.steps.map((step) => [step.branch, step.conductorBranch]), [
    ['lot/T1.1-essai', 'conductor/agent-lot/T1.1'],
    ['lot/T1.1-essai', 'conductor/agent-lot/T1.1'],
  ]);
  assert.equal(parseDecoupage(decoupageText()).steps[0].conductorBranch, null);
  const decoupeDir = join(fixtureEnv({ decoupes: { 'T1.1': withLine } }).repo, 'decoupe');
  assert.deepEqual(validatePlan({ statuses: STATUSES, lots: [lotFixture()] }, { decoupeDir }), []);
  const wrong = withLine.replace('conductor/agent-lot/T1.1', 'conductor/agent-lot/T9.9');
  const wrongDir = join(fixtureEnv({ decoupes: { 'T1.1': wrong } }).repo, 'decoupe');
  const errors = validatePlan({ statuses: STATUSES, lots: [lotFixture()] }, { decoupeDir: wrongDir });
  assert.ok(errors.some((message) => message.includes('« Branche Conductor » de l\'étape 1 = conductor/agent-lot/T9.9')), errors.join(' | '));
});

test('plan réel : S2.1 et S2.2 annoncent la branche Conductor unique et gardent la branche manuelle', () => {
  const plan = loadPlan();
  const all = lotMap(plan);
  for (const id of ['S2.1', 'S2.2']) {
    const parsed = parseDecoupage(readFileSync(new URL(`../docs/pilotage/decoupe/${id}.md`, import.meta.url), 'utf8'));
    assert.ok(parsed.steps.length > 0);
    for (const step of parsed.steps) {
      assert.equal(step.conductorBranch, conductorBranch(id), `${id} étape ${step.number}`);
      assert.equal(step.branch, all.get(id).branch, `${id} étape ${step.number}`);
      assert.ok(step.branch.startsWith(`lot/${id}-`));
    }
  }
});

test('découpage : en-tête manquant, ligne d’en-tête invalide et lot sans étape', () => {
  assert.throws(() => parseDecoupage('# sans en-tête\n'), /en-tête YAML manquant/);
  assert.throws(() => parseDecoupage('---\nlot T1.1\n---\n'), /ligne d'en-tête invalide/);
  assert.deepEqual(parseDecoupage('---\nlot: T1.1\n---\n\n# vide\n').steps, []);
});

test('découpage : un prompt absent est inconnu (2) ; un lot sans prompt connu ne part pas', () => {
  assert.equal(plain(['T1.1', 'P4']).exitCode, 2);
  assert.match(plain(['T1.1', 'P4']).stderr, /Prompt inconnu : T1\.1 P4/);
  assert.equal(conductor(['T1.1', 'P4'], { branch: 'conductor/agent-lot/T1.1' }).json.status, 'error');
  const sansPrompt = decoupageText().replace(/### P3[\s\S]*$/, '');
  assert.deepEqual(parseDecoupage(sansPrompt).steps.at(-1).prompts, []);
  assert.equal(plain(['T1.1', 'P3'], { decoupes: { 'T1.1': sansPrompt } }).exitCode, 2);
});

test('découpage : la validation signale durée hors bornes, champs vides, prompt dupliqué, en-tête de lot faux', () => {
  const check = (text) => validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: undefined })] }, { decoupeDir: join(fixtureEnv({ decoupes: { 'T1.1': text } }).repo, 'decoupe') });
  assert.deepEqual(check(decoupageText()), []);
  assert.ok(check(decoupageText().replace('Durée : 20 min', 'Durée : 45 min')).some((message) => /durée hors 15–30 min/.test(message)));
  assert.ok(check(decoupageText().replace('Fichiers : a.txt · b.txt', 'Fichiers : ')).some((message) => /files vide/.test(message)));
  assert.ok(check(decoupageText().replace('Hors périmètre : le reste', 'Hors périmètre : ')).some((message) => /out vide/.test(message)));
  assert.ok(check(decoupageText().replace('### P2', '### P1')).some((message) => /prompt dupliqué P1/.test(message)));
  assert.ok(check(decoupageText({ lotId: 'T9.9' })).some((message) => /en-tête du découpage = T9\.9/.test(message)));
  assert.ok(check(decoupageText().replace('Responsable : Alice', 'Branche-seule : x')).some((message) => /responsable manquant/.test(message)));
});

// ── Validation du plan ────────────────────────────────────────────────────────────────────────
test('plan : doublons, statut inconnu, done_when vide, dépendance inconnue ou circulaire sur soi-même', () => {
  const decoupeDir = join(fixtureEnv().repo, 'decoupe');
  const errors = validatePlan(
    {
      statuses: STATUSES,
      lots: [
        lotFixture({ id: 'T3.1', execution: undefined, branch: undefined, asana_task_id: 'x' }),
        lotFixture({ id: 'T3.1', execution: undefined, branch: undefined, asana_task_id: 'x', status: 'zzz', done_when: [], depends: ['T3.1', 'T3.9'] }),
        lotFixture({ id: 'mauvais', execution: undefined, branch: undefined, asana_task_id: 'y' }),
      ],
    },
    { decoupeDir },
  );
  for (const pattern of [/T3\.1: doublon/, /statut zzz inconnu/, /done_when vide/, /dépendance inconnue T3\.9/, /dépend de lui-même/, /tâche Asana dupliquée/, /mauvais: identifiant invalide/]) {
    assert.ok(errors.some((message) => pattern.test(message)), `${pattern} dans ${errors.join(' | ')}`);
  }
});

test('plan : un lot Conductor exige branche, prompts valides et découpage', () => {
  const decoupeDir = join(fixtureEnv({ decoupes: {} }).repo, 'decoupe');
  const errors = validatePlan({ statuses: STATUSES, lots: [lotFixture({ branch: undefined, execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'Px'] } })] }, { decoupeDir });
  for (const pattern of [/branche requise pour Conductor/, /prompt Conductor invalide Px/, /découpage requis pour Conductor/]) {
    assert.ok(errors.some((message) => pattern.test(message)), String(pattern));
  }
  const missingPrompt = validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'P8'] } })] }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
  assert.ok(missingPrompt.some((message) => /prompt Conductor absent du découpage P8/.test(message)));
});

test('plan : un lot Conductor non listé dans execution.prompts est refusé (blocked)', () => {
  const lots = [lotFixture({ execution: { mode: 'conductor-agent-lot', prompts: ['P1'] } })];
  const { json } = conductor(['T1.1', 'P2'], { lots, branch: 'conductor/agent-lot/T1.1', subjects: [FIRST_SUBJECT] });
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /n’est pas autorisé dans Conductor/);
});

test('CI : les actions tierces du workflow du pilotage sont épinglées par SHA de commit, avec le tag en commentaire', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pilotage.yml', import.meta.url), 'utf8');
  const uses = workflow.split('\n').filter((line) => /^\s*uses:/.test(line));
  assert.ok(uses.length >= 2);
  for (const line of uses) assert.match(line, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(?:\.\d+){0,2}\s*$/, line);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(!/pull_request_target/.test(workflow));
});

test('plan réel : valide, et chaque découpage du dépôt se lit sans erreur', () => {
  const plan = loadPlan();
  assert.deepEqual(validatePlan(plan), []);
  assert.ok(plan.lots.length > 0);
  for (const lot of plan.lots) {
    for (const action of lot.execution?.actions ?? []) {
      assert.equal(validateRelativePath(action.output), null, `${lot.id} ${action.id}`);
      assert.ok(HUMAN_ACTION_TYPES.includes(action.type), `${lot.id} ${action.id}`);
    }
  }
});

// ── Commandes complètes sur un vrai dépôt git jetable (git réel, processus réel, cwd ≠ racine) ──
function gitIn(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo({ lots = [lotFixture()], branch = 'conductor/agent-lot/T1.1', origin = true, eol = '\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lot-repo-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'pilotage', 'decoupe'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./lot.mjs', import.meta.url)), join(dir, 'scripts', 'lot.mjs'));
  writeFileSync(join(dir, 'docs', 'pilotage', 'plan.json'), JSON.stringify({ version: 2, statuses: STATUSES, lots }, null, eol === '\n' ? 0 : 2).replaceAll('\n', eol));
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText({ eol }));
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  gitIn(dir, 'add', 'scripts/lot.mjs', 'docs/pilotage/plan.json', 'docs/pilotage/decoupe/T1.1.md');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  // `origin/main` = l'état de la base : les prompts « faits » sont les commits de HEAD qui n'y sont pas.
  if (origin) gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (branch === 'detached') gitIn(dir, 'checkout', '-q', '--detach');
  else if (branch !== 'main') gitIn(dir, 'checkout', '-q', '-b', branch);
  return dir;
}

function cli(dir, args) {
  // cwd volontairement différent de la racine du dépôt jetable ; git ne remonte pas au-dessus du dossier jetable.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) };
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'lot.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8', env });
  const last = result.stdout.trimEnd().split('\n').at(-1);
  return { ...result, json: last.startsWith('CONDUCTOR_RESULT ') ? JSON.parse(last.slice(17)) : null };
}

test('CLI réelle : branche conductor/*, prompt prêt, puis P1 refusé une fois committé et P2 autorisé', () => {
  const dir = makeRepo();
  const first = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.status, 'ready');
  assert.equal(first.json.branch.current, 'conductor/agent-lot/T1.1');
  writeFileSync(join(dir, 'a.txt'), 'travail');
  gitIn(dir, 'add', 'a.txt');
  gitIn(dir, 'commit', '-q', '-m', first.json.commit_message);
  const again = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(again.status, 3);
  assert.match(again.json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P3', '--conductor']).status, 3);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready');
  assert.equal(cli(dir, ['T1.1', 'P2']).status, 3, 'hors Conductor, la branche du lot reste exigée');
});

test('CLI réelle : HEAD détaché et main sont refusés, avec la ligne finale', () => {
  const detached = cli(makeRepo({ branch: 'detached' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(detached.status, 3);
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.branch.current, null);
  assert.match(detached.json.reason, /HEAD détaché/);
  const onMain = cli(makeRepo({ branch: 'main' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(onMain.status, 3);
  assert.equal(onMain.json.branch.current, 'main');
});

test('CLI réelle : clôture sur la branche du lot après les trois prompts, lot passé à done par le dernier', () => {
  const dir = makeRepo({ branch: 'lot/T1.1-essai' });
  for (const [index, subject] of [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT].entries()) {
    writeFileSync(join(dir, `f${index}.txt`), String(index));
    gitIn(dir, 'add', `f${index}.txt`);
    gitIn(dir, 'commit', '-q', '-m', subject);
  }
  const planFile = join(dir, 'docs', 'pilotage', 'plan.json');
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  plan.lots[0].status = 'done';
  writeFileSync(planFile, JSON.stringify(plan));
  gitIn(dir, 'add', 'docs/pilotage/plan.json');
  gitIn(dir, 'commit', '-q', '-m', 'unrelated: plan');
  const closing = cli(dir, ['T1.1', 'cloture']);
  assert.equal(closing.status, 0, closing.stdout);
  assert.match(closing.stdout, /PRÊTE/);
  assert.equal(cli(dir, ['T1.1', 'cloture', '--conductor']).status, 3);
});

test('CLI réelle : un lot done sans aucun commit de prompt reste TERMINÉ à la clôture', () => {
  const dir = makeRepo({ lots: [lotFixture({ status: 'done' })], branch: 'lot/T1.1-essai' });
  const finished = cli(dir, ['T1.1', 'cloture']);
  assert.equal(finished.status, 3);
  assert.match(finished.stdout, /TERMINÉ/);
});

test('CLI réelle : sans git (pas un dépôt) = erreur 2 et ligne finale, pas « aucun commit »', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lot-nogit-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'pilotage', 'decoupe'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./lot.mjs', import.meta.url)), join(dir, 'scripts', 'lot.mjs'));
  writeFileSync(join(dir, 'docs', 'pilotage', 'plan.json'), JSON.stringify({ version: 2, statuses: STATUSES, lots: [lotFixture()] }));
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText());
  const result = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 2);
  assert.equal(result.json.status, 'error');
  assert.match(result.json.reason, /git indisponible/);
});

// ── Historique : origin/main..HEAD, sans fenêtre, sans « Revert » (contrat v1.1 § 3) ────────────
function commitFile(dir, name, subject) {
  writeFileSync(join(dir, name), subject);
  gitIn(dir, 'add', name);
  gitIn(dir, 'commit', '-q', '-m', subject);
}

/** Des commits sans fichier, en un seul processus (git fast-import) : de quoi dépasser 2000 commits en une seconde. */
function fastImport(dir, ref, from, subjects) {
  const lines = [];
  subjects.forEach((subject, index) => {
    lines.push(`commit ${ref}`, `committer Test <test@example.test> ${1_700_000_000 + index} +0000`, `data ${Buffer.byteLength(subject)}`, subject);
    if (index === 0) lines.push(`from ${from}`);
    lines.push('');
  });
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: `${lines.join('\n')}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
}

test('historique : « Revert … » ne compte jamais comme prompt fait (unitaire et run)', () => {
  const lot = lotFixture();
  assert.deepEqual([...completedPrompts(lot, ['Revert "[T1.1] P1 — Premier prompt"'])], []);
  assert.deepEqual([...completedPrompts(lot, ['Revert [T1.1] P2 — x', FIRST_SUBJECT])], ['P1']);
  assert.deepEqual([...completedPrompts(lot, ['revert: [T1.1] P3 — convention « revert: »'])], [], 'ni fait (non ancré), ni annulation');
  const reverted = ['Revert "[T1.1] P1 — Premier prompt"'];
  assert.equal(plain(['T1.1', 'P1'], { subjects: reverted }).exitCode, 0, 'P1 reste à faire');
  const second = plain(['T1.1', 'P2'], { subjects: reverted });
  assert.equal(second.exitCode, 3);
  assert.match(second.stdout, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
});

test('historique (git réel) : seuls les commits absents de origin/main comptent, et un Revert ne compte pas', () => {
  const dir = makeRepo({ branch: 'main' });
  commitFile(dir, 'a.txt', FIRST_SUBJECT);
  gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); // P1 est déjà dans la base
  gitIn(dir, 'checkout', '-q', '-b', 'conductor/agent-lot/T1.1');
  assert.equal(cli(dir, ['T1.1', 'P1', '--conductor']).json.status, 'ready', 'P1 est dans origin/main : pas un prompt de cette branche');
  assert.match(cli(dir, ['T1.1', 'P2', '--conductor']).json.reason, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
  commitFile(dir, 'b.txt', FIRST_SUBJECT);
  assert.match(cli(dir, ['T1.1', 'P1', '--conductor']).json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready');
  commitFile(dir, 'c.txt', `Revert "${FIRST_SUBJECT}"`);
  assert.equal(cli(dir, ['T1.1', 'P1', '--conductor']).json.status, 'ready', 'le Revert APRÈS le commit d’origine annule P1 (v1.2 § 2)');
  assert.match(cli(dir, ['T1.1', 'P2', '--conductor']).json.reason, /ORDRE DES PROMPTS — P2 exige d’abord P1/, 'P1 annulé : P2 attend de nouveau');
  const onlyRevert = makeRepo();
  commitFile(onlyRevert, 'a.txt', `Revert "${FIRST_SUBJECT}"`);
  assert.equal(cli(onlyRevert, ['T1.1', 'P1', '--conductor']).json.status, 'ready');
});

test('historique (git réel) : aucune fenêtre — un prompt committé il y a plus de 2000 commits est toujours vu', () => {
  const dir = makeRepo({ branch: 'main' });
  const base = gitIn(dir, 'rev-parse', 'HEAD');
  const filler = Array.from({ length: 2100 }, (_, index) => `chore: remplissage ${index}`);
  fastImport(dir, 'refs/heads/conductor/agent-lot/T1.1', base, [FIRST_SUBJECT, ...filler]);
  gitIn(dir, 'checkout', '-q', 'conductor/agent-lot/T1.1');
  assert.equal(Number(gitIn(dir, 'rev-list', '--count', 'origin/main..HEAD')), 2101);
  const again = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(again.status, 3, again.stdout);
  assert.match(again.json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready', 'P1 est vu : P2 est autorisé');
});

test('historique (git réel) : sans origin/main, erreur (2) qui dit quoi faire — jamais un historique deviné', () => {
  const dir = makeRepo({ origin: false });
  const result = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 2);
  assert.equal(result.json.status, 'error');
  assert.ok(result.json.reason.includes('origin/main..HEAD'), result.json.reason);
  assert.ok(result.json.reason.includes('git fetch origin'), result.json.reason);
});

test('CLI réelle : la clôture se lance sur conductor/agent-lot/<ID> une fois les trois prompts committés', () => {
  const dir = makeRepo({ lots: [lotFixture({ status: 'done' })], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(cli(dir, ['T1.1', 'cloture']).status, 3, 'rien de committé : TERMINÉ');
  for (const [index, subject] of [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT].entries()) commitFile(dir, `f${index}.txt`, subject);
  const closing = cli(dir, ['T1.1', 'cloture']);
  assert.equal(closing.status, 0, closing.stdout);
  assert.match(closing.stdout, /PRÊTE/);
  assert.equal(cli(dir, ['T1.1', 'cloture', '--conductor']).status, 3, 'jamais depuis Conductor');
});


// ── --racine <chemin> : le dépôt lu n'est pas celui du script (contrat v1.2 § 1, M-C) ───────────
/** Une copie de `lot.mjs` HORS de tout dépôt (dossier jetable sans git) : c'est la « copie de confiance » de Conductor. */
let trustedCopyPath = null;
function trustedCopy() {
  if (trustedCopyPath) return trustedCopyPath;
  const dir = mkdtempSync(join(tmpdir(), 'lot-trusted-'));
  tempDirs.push(dir);
  trustedCopyPath = join(dir, 'lot.mjs');
  copyFileSync(fileURLToPath(new URL('./lot.mjs', import.meta.url)), trustedCopyPath);
  return trustedCopyPath;
}

/** Lance la copie de confiance avec `--racine <racine>` depuis un cwd sans rapport (le dossier temporaire). */
function cliRoot(root, args, { env = {}, rootArgument = true } = {}) {
  const result = spawnSync(process.execPath, [trustedCopy(), ...args, ...(rootArgument ? ['--racine', root] : [])], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root), ...env },
  });
  const last = result.stdout.trimEnd().split('\n').at(-1);
  return { ...result, json: last.startsWith('CONDUCTOR_RESULT ') ? JSON.parse(last.slice(17)) : null };
}

test('--racine : la copie hors dépôt lit le plan, le découpage, la branche et l’historique de la racine donnée', () => {
  const dir = makeRepo({ lots: [lotFixture({ title: 'Titre propre à la racine cible' })], branch: 'conductor/agent-lot/T1.1' });
  const ready = cliRoot(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(ready.status, 0, ready.stdout + ready.stderr);
  assert.equal(ready.json.status, 'ready');
  assert.equal(ready.json.branch.current, 'conductor/agent-lot/T1.1');
  assert.equal(ready.json.commit_message, '[T1.1] P1 — Premier prompt');
  assert.match(cliRoot(dir, ['T1.1']).stdout, /^# \[T1\.1\] Titre propre à la racine cible$/m, 'le plan lu est celui de la racine');
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText().replace('- geste 1', '- geste propre à la racine cible'));
  assert.match(cliRoot(dir, ['T1.1', 'P1', '--conductor']).stdout, /- geste propre à la racine cible/, 'le découpage lu est celui de la racine');
  commitFile(dir, 'p1.txt', FIRST_SUBJECT);
  const again = cliRoot(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(again.status, 3);
  assert.match(again.json.reason, /déjà committé/, 'l’historique git est celui de la racine');
  assert.equal(cliRoot(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready');
  const wrongBranch = makeRepo({ branch: 'conductor/agent-lot/T9.9' });
  assert.equal(cliRoot(wrongBranch, ['T1.1', 'P1', '--conductor']).json.status, 'blocked', 'la branche lue est celle de la racine');
  const detached = cliRoot(makeRepo({ branch: 'detached' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.branch.current, null);
});

test('--racine : sortie identique à celle du script lancé dans le dépôt (même contrat, mêmes octets)', () => {
  const scenarios = [
    ['conductor/agent-lot/T1.1', ['T1.1', 'P1', '--conductor']],
    ['conductor/agent-lot/T1.1', ['T1.1', 'P2', '--conductor']],
    ['main', ['T1.1', 'P1', '--conductor']],
    ['conductor/agent-lot/T1.1', ['T1.1']],
    ['lot/T1.1-essai', ['T1.1', 'cloture']],
  ];
  for (const [branch, args] of scenarios) {
    const dir = makeRepo({ branch });
    const inside = cli(dir, args);
    const outside = cliRoot(dir, args);
    assert.equal(outside.status, inside.status, args.join(' '));
    assert.equal(outside.stdout, inside.stdout, args.join(' '));
    assert.equal(outside.stderr, inside.stderr, args.join(' '));
  }
});

test('--racine : la preuve d’une action humaine se cherche dans la racine donnée (action_required puis ready)', () => {
  const dir = makeRepo({ lots: [actionLot({ not_before: '2026-05-01T09:00:00+02:00' })], branch: 'conductor/agent-lot/T1.1' });
  const waiting = cliRoot(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(waiting.status, 4, waiting.stdout);
  assert.equal(waiting.json.status, 'action_required');
  assert.equal(waiting.json.action.evidence_path, EVIDENCE);
  mkdirSync(join(dir, 'docs', 'preuve'), { recursive: true });
  writeFileSync(join(dir, EVIDENCE), 'chiffres relevés\n');
  assert.equal(cliRoot(dir, ['T1.1', 'P1', '--conductor']).json.status, 'ready');
});

test('--racine : --check valide le plan et les découpages de la racine donnée', () => {
  const dir = makeRepo();
  const good = cliRoot(dir, ['--check']);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /OK — 1 lots valides/);
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText().replace('Durée : 20 min', 'Durée : 99 min'));
  const bad = cliRoot(dir, ['--check']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /durée hors 15–30 min/);
  assert.ok(!bad.stderr.includes(dir), 'aucun chemin local dans les messages');
});

test('--racine : le scripts/lot.mjs de la racine cible n’est JAMAIS exécuté ni importé', () => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const marker = join(dir, 'EXECUTE.txt');
  // Un lot.mjs hostile, commité dans la racine cible : s'il tournait ou s'il était importé, il laisserait un témoin.
  writeFileSync(join(dir, 'scripts', 'lot.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'exécuté');\nprocess.stdout.write('CONDUCTOR_RESULT {"version":1,"status":"ready"}\\n');\n`);
  gitIn(dir, 'add', 'scripts/lot.mjs');
  gitIn(dir, 'commit', '-q', '-m', 'chore: lot.mjs hostile');
  const result = cliRoot(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.json.status, 'ready');
  assert.equal(result.json.commit_message, '[T1.1] P1 — Premier prompt', 'la sortie vient de la copie de confiance, pas de la racine cible');
  assert.equal(readdirSync(dir).includes('EXECUTE.txt'), false, 'le lot.mjs de la racine cible a tourné');
  // Même chose avec `--check` (qui lit tout le dépôt).
  assert.equal(cliRoot(dir, ['--check']).status, 0);
  assert.equal(readdirSync(dir).includes('EXECUTE.txt'), false);
  // Garde de source : lot.mjs n'importe ni n'exécute rien venant du dépôt lu, et ne lance que git.
  const source = readFileSync(new URL('./lot.mjs', import.meta.url), 'utf8');
  assert.ok(!/\bimport\s*\(/.test(source) && !/\brequire\s*\(/.test(source), 'aucun import dynamique');
  assert.match(source, /^import \{ execFileSync \} from 'node:child_process';$/m, 'seul execFileSync est importé de child_process');
  const launched = [...source.matchAll(/\bexecFileSync\(\s*([^,)\s]+)/g)].map((match) => match[1]);
  assert.ok(launched.length >= 2);
  assert.deepEqual([...new Set(launched)], ["'git'"], 'seul git est lancé');
});

test('--racine : une variable GIT_DIR héritée ne détourne pas la lecture vers un autre dépôt', () => {
  const target = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const decoy = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  commitFile(decoy, 'p1.txt', FIRST_SUBJECT); // dans le leurre, P1 est déjà fait
  const result = cliRoot(target, ['T1.1', 'P1', '--conductor'], { env: { GIT_DIR: join(decoy, '.git'), GIT_WORK_TREE: decoy } });
  assert.equal(result.json.status, 'ready', result.stdout);
  assert.equal(cliRoot(decoy, ['T1.1', 'P1', '--conductor'], { env: { GIT_DIR: join(target, '.git') } }).json.status, 'blocked');
});

test('--racine : un worktree lié (.git est un fichier) est une racine valide', () => {
  const dir = makeRepo({ branch: 'main' });
  const parent = mkdtempSync(join(tmpdir(), 'lot-wt-'));
  tempDirs.push(parent);
  const linked = join(parent, 'wt');
  gitIn(dir, 'worktree', 'add', '-q', '-b', 'conductor/agent-lot/T1.1', linked);
  const result = cliRoot(linked, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.json.status, 'ready', result.stdout + result.stderr);
  assert.equal(result.json.branch.current, 'conductor/agent-lot/T1.1');
});

test('--racine : refus propres (exit 2, ligne finale error, jamais de chemin local dans reason ni stderr)', () => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const notGit = mkdtempSync(join(tmpdir(), 'lot-plain-'));
  tempDirs.push(notGit);
  const cases = {
    'chemin relatif': 'docs/pilotage',
    'chemin relatif ./': './',
    inexistant: join(notGit, 'absent'),
    'un fichier': join(dir, 'docs', 'pilotage', 'plan.json'),
    'un sous-dossier du dépôt': join(dir, 'docs'),
    'un dossier hors dépôt git': notGit,
  };
  for (const [label, value] of Object.entries(cases)) {
    const result = cliRoot(value, ['T1.1', 'P1', '--conductor']);
    assert.equal(result.status, 2, `${label} : ${result.stdout}${result.stderr}`);
    assert.equal(result.json.status, 'error', label);
    assert.equal(result.json.exit_code, 2, label);
    assert.match(result.json.reason, /^--racine refusée : /, label);
    const publicText = `${result.json.reason}\n${result.stderr}\n${result.stdout}`;
    for (const secret of [dir, notGit, tmpdir()]) assert.ok(!publicText.includes(secret), `${label} : chemin local dans la sortie`);
    assert.equal(result.json.branch.current, null, 'racine refusée : branche inconnue');
  }
  // Valeur absente, option répétée, forme --racine=, valeur qui est une option.
  const malformed = [
    ['T1.1', 'P1', '--conductor', '--racine'],
    ['T1.1', 'P1', '--conductor', '--racine', '--rejouer'],
    ['T1.1', 'P1', '--conductor', '--racine', dir, '--racine', dir],
    ['T1.1', 'P1', '--conductor', `--racine=${dir}`],
  ];
  for (const args of malformed) {
    const result = cliRoot(dir, args, { rootArgument: false });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.json.status, 'error');
    assert.ok(!`${result.stdout}${result.stderr}`.includes(dir), 'aucun chemin local');
  }
});

test('--racine : un lien symbolique (ou une jonction) vers un dépôt n’est pas une racine', (t) => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const parent = mkdtempSync(join(tmpdir(), 'lot-link-'));
  tempDirs.push(parent);
  const link = join(parent, 'lien');
  try {
    symlinkSync(dir, link, 'junction');
  } catch (error) {
    t.skip(`lien non créable ici (${error.code})`);
    return;
  }
  const result = cliRoot(link, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.json.reason, /lien symbolique/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(link));
});

test('--racine : sans l’option, le comportement est inchangé (racine = parent du dossier du script)', () => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const result = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.branch.current, 'conductor/agent-lot/T1.1');
});

test('--racine : en-process, la racine donnée remplace celle du script mais pas les injections des tests', () => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  const result = run(['T1.1', 'P1', '--conductor', '--racine', dir], { now: NOW });
  assert.equal(result.exitCode, 0, result.stdout);
  const injected = run(['T1.1', 'P1', '--conductor', '--racine', dir], { now: NOW, git: { branch: () => 'conductor/agent-lot/T9.9', subjects: () => [] } });
  assert.equal(injected.exitCode, 3, 'une injection explicite garde la priorité');
});

// ── Détecteur « prompt fait » unique (contrat v1.2 § 2) ─────────────────────────────────────────
test('détecteur : classifySubject — seuls les sujets ancrés `[ID] Pn — ` comptent, sans aucune tolérance', () => {
  const made = (id, subject) => classifySubject(id, subject);
  assert.deepEqual(made('S2.1', '[S2.1] P1 — Titre'), { kind: 'prompt', prompt: 'P1' });
  assert.deepEqual(made('S2.1', '[S2.1] P10 — dix'), { kind: 'prompt', prompt: 'P10' });
  assert.deepEqual(made('S2.1', '[S2.1] P999 — max'), { kind: 'prompt', prompt: 'P999' });
  assert.deepEqual(made('S2.10', '[S2.10] P1 — autre lot'), { kind: 'prompt', prompt: 'P1' });
  assert.deepEqual(made('S12.34', '[S12.34] P2 — deux chiffres'), { kind: 'prompt', prompt: 'P2' });
  const rejected = [
    '[S2.1] P1 - tiret simple',
    '[S2.1] P1 – demi-cadratin U+2013',
    '[S2.1] P1 ― barre horizontale U+2015',
    '[S2.1] P1—collé',
    '[S2.1] P1 —collé',
    '[S2.1] P1— collé',
    '[S2.1] P1 —',
    '[S2.1]  P1 — double espace avant P',
    '[S2.1] P1  — double espace avant le tiret',
    '[S2.1]P1 — sans espace',
    ' [S2.1] P1 — espace en tête',
    '\t[S2.1] P1 — tabulation en tête',
    `[S2.1] P1${String.fromCharCode(0xa0)}— espace insécable avant le tiret`,
    '[S2.10] P1 — autre lot (S2.10 ≠ S2.1)',
    '[S2.1] P01 — zéro initial',
    '[S2.1] P0 — zéro',
    '[S2.1] P — sans numéro',
    '[S2.1] Px — lettre',
    '[S2.1] p1 — minuscule',
    '[s2.1] P1 — id en minuscule',
    '[S2.1] P１ — chiffre pleine chasse',
    '[Ｓ2.1] P1 — lettre pleine chasse',
    '[S2x1] P1 — le point n’est pas un joker',
    '[S2.1.1] P1 — id à trois niveaux',
    'S2.1 P1 — sans crochets',
    '(S2.1) P1 — parenthèses',
    'fixup! [S2.1] P1 — préfixe fixup',
    'squash! [S2.1] P1 — préfixe squash',
    'amend! [S2.1] P1 — préfixe amend',
    'contrat: [S2.1] P1 — préfixe libre',
    'Merge pull request #1 de [S2.1] P1 — x',
    'Reapply "[S2.1] P1 — x"',
    'wip [S2.1] P1 — x',
    '',
  ];
  for (const subject of rejected) assert.equal(made('S2.1', subject), null, JSON.stringify(subject));
  // P10 n'est pas P1, et P1 n'est pas P10.
  assert.deepEqual([...completedPrompts({ id: 'S2.1' }, ['[S2.1] P10 — dix'])], ['P10']);
  assert.deepEqual([...completedPrompts({ id: 'S2.1' }, ['[S2.1] P1 — un'])], ['P1']);
  // Un lot ne voit jamais les prompts d'un autre lot dont l'identifiant le préfixe.
  assert.deepEqual([...completedPrompts({ id: 'S2.1' }, ['[S2.10] P1 — x', '[S2.11] P2 — y', '[S2.1] P3 — z'])], ['P3']);
  assert.deepEqual([...completedPrompts({ id: 'S2.10' }, ['[S2.10] P1 — x', '[S2.1] P2 — y'])], ['P1']);
});

test('détecteur : un sujet Revert (casse libre, guillemets facultatifs) ne compte jamais comme fait et annule le prompt visé', () => {
  const revertForms = ['Revert "[S2.1] P1 — T"', 'Revert [S2.1] P1 — T', 'revert "[S2.1] P1 — T"', 'REVERT "[S2.1] P1 — T"', 'rEvErT [S2.1] P1 — T', 'Revert "[S2.1] P1 — T" sans guillemet fermant'];
  for (const subject of revertForms) {
    assert.deepEqual(classifySubject('S2.1', subject), { kind: 'revert', prompt: 'P1' }, subject);
    assert.deepEqual([...completedPrompts({ id: 'S2.1' }, [subject])], [], `${subject} seul : jamais fait`);
    // git log : du plus récent au plus ancien — le Revert est APRÈS le commit d'origine.
    assert.deepEqual([...completedPrompts({ id: 'S2.1' }, [subject, '[S2.1] P1 — T'])], [], `${subject} après le commit : annulé`);
  }
  // Pas des reverts de ce prompt : colon, double espace, autre lot, autre prompt, sans crochets.
  for (const subject of ['revert: [S2.1] P1 — T', 'Revert  "[S2.1] P1 — T"', 'Revert "[S2.10] P1 — T"', 'Revert "[S2.1] P1 - T"', 'Revert "S2.1 P1 — T"', 'Revert']) {
    assert.deepEqual([...completedPrompts({ id: 'S2.1' }, [subject, '[S2.1] P1 — T'])], ['P1'], subject);
  }
});

test('détecteur : l’ordre compte — le Revert annule seulement le commit d’origine qui le PRÉCÈDE', () => {
  const lot = { id: 'S2.1' };
  const commit = '[S2.1] P1 — T';
  const revert = 'Revert "[S2.1] P1 — T"';
  // `subjects` est dans l'ordre de git log : le plus récent d'abord.
  assert.deepEqual([...completedPrompts(lot, [revert, commit])], [], 'commit puis revert : à faire');
  assert.deepEqual([...completedPrompts(lot, [commit, revert])], ['P1'], 'revert puis commit : fait');
  assert.deepEqual([...completedPrompts(lot, [commit, revert, commit])], ['P1'], 'commit, revert, nouveau commit : fait');
  assert.deepEqual([...completedPrompts(lot, [revert, commit, revert, commit])], [], 'commit, revert, commit, revert : à faire');
  assert.deepEqual([...completedPrompts(lot, [revert])], [], 'revert d’un commit absent de la plage : sans effet');
  // Le revert d'un prompt ne touche pas les autres.
  assert.deepEqual([...completedPrompts(lot, ['[S2.1] P3 — c', revert, '[S2.1] P2 — b', commit])].sort(), ['P2', 'P3']);
  // Revert d'un revert : non reconnu (le contrat ne le définit pas) — le prompt reste annulé jusqu'à un nouveau commit de prompt.
  assert.deepEqual([...completedPrompts(lot, ['Revert "Revert "[S2.1] P1 — T""', revert, commit])], []);
  assert.deepEqual([...completedPrompts(lot, ['Reapply "[S2.1] P1 — T"', revert, commit])], []);
  assert.deepEqual([...completedPrompts(lot, ['[S2.1] P1 — T (rejoué)', 'Revert "Revert "[S2.1] P1 — T""', revert, commit])], ['P1']);
});

test('détecteur (run) : un prompt annulé est de nouveau à faire, l’ordre des prompts et la clôture en tiennent compte', () => {
  const revert = 'Revert "[T1.1] P1 — Premier prompt"';
  // plain() : branche du lot, ordre de git log = du plus récent au plus ancien.
  assert.equal(plain(['T1.1', 'P1'], { subjects: [FIRST_SUBJECT] }).exitCode, 3, 'fait');
  assert.equal(plain(['T1.1', 'P1'], { subjects: [revert, FIRST_SUBJECT] }).exitCode, 0, 'annulé : à faire');
  const order = plain(['T1.1', 'P2'], { subjects: [revert, FIRST_SUBJECT] });
  assert.equal(order.exitCode, 3);
  assert.match(order.stdout, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
  // Clôture : lot `done` (le dernier prompt l'a passé à done), trois prompts committés, puis P2 annulé.
  const closing = (subjects) => plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects });
  assert.equal(closing([THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT]).exitCode, 0, 'tous les prompts committés');
  const cancelledSubjects = ['Revert "[T1.1] P2 — Deuxième prompt"', THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT];
  const cancelled = closing(cancelledSubjects);
  assert.equal(cancelled.exitCode, 3, cancelled.stdout);
  assert.match(cancelled.stdout, /TERMINÉ/, 'lot done sans tous ses prompts non annulés : la clôture n’est plus autorisée');
  const stillOpen = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'ready' })], subjects: cancelledSubjects });
  assert.equal(stillOpen.exitCode, 3);
  assert.match(stillOpen.stdout, /PAS PRÊTE — prompts sans commit : P2/);
  assert.equal(closing(['[T1.1] P2 — Deuxième prompt', 'Revert "[T1.1] P2 — Deuxième prompt"', THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT]).exitCode, 0, 'recommité après le revert : prête');
  // Sur la branche unique d'une exécution Conductor aussi.
  const unified = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'ready' })], branch: 'conductor/agent-lot/T1.1', subjects: ['Revert "[T1.1] P3 — Troisième prompt"', THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT] });
  assert.equal(unified.exitCode, 3);
  assert.match(unified.stdout, /prompts sans commit : P3/);
});

test('détecteur (git réel) : git revert produit un sujet reconnu ; l’ordre tient même avec des commits de la même seconde', () => {
  const dir = makeRepo({ branch: 'conductor/agent-lot/T1.1' });
  commitFile(dir, 'a.txt', FIRST_SUBJECT);
  commitFile(dir, 'b.txt', SECOND_SUBJECT);
  assert.equal(cli(dir, ['T1.1', 'P3', '--conductor']).json.status, 'ready');
  gitIn(dir, 'revert', '--no-edit', 'HEAD~1'); // annule P1 : `Revert "[T1.1] P1 — Premier prompt"`
  assert.equal(gitIn(dir, 'log', '-1', '--format=%s'), `Revert "${FIRST_SUBJECT}"`);
  const afterRevert = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(afterRevert.json.status, 'ready', 'P1 annulé : à faire');
  assert.match(cli(dir, ['T1.1', 'P3', '--conductor']).json.reason, /ORDRE DES PROMPTS — P3 exige d’abord P1/);
  assert.match(cli(dir, ['T1.1', 'P2', '--conductor']).json.reason, /déjà committé/, 'P2 n’est pas touché');
  // Revert du revert (git écrit `Revert "Revert …"` ou `Reapply "…"` selon sa version) : jamais compté comme fait, quelle que soit la forme.
  gitIn(dir, 'revert', '--no-edit', 'HEAD');
  assert.equal(cli(dir, ['T1.1', 'P1', '--conductor']).json.status, 'ready', gitIn(dir, 'log', '-1', '--format=%s'));
  // Un nouveau commit de prompt le remet à fait.
  commitFile(dir, 'c.txt', FIRST_SUBJECT);
  assert.match(cli(dir, ['T1.1', 'P1', '--conductor']).json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P3', '--conductor']).json.status, 'ready');
});

// ── Format d'identifiant de lot unique ^[A-Z]\d+\.\d+$ (contrat v1.2 § 3) ──────────────────────
const wide = (overrides = {}) => lotFixture({ id: 'S12.34', branch: 'lot/S12.34-essai', asana_task_id: 'asana-s1234', ...overrides });
const wideDecoupage = () => decoupageText({ lotId: 'S12.34', branch: 'lot/S12.34-essai' });
const WIDE_FIRST = '[S12.34] P1 — Premier prompt';

test('identifiant : LOT_ID = ^[A-Z]\\d+\\.\\d+$ — valides à plusieurs chiffres, invalides sans exception', () => {
  for (const valid of ['S2.1', 'S12.34', 'A0.0', 'Z99.100', 'C8.2', 'S2.10']) assert.ok(LOT_ID.test(valid), valid);
  const invalid = [
    'S2', 's2.1', 'S2.1.1', 'S2.1/../x', '-S2.1', ' S2.1', 'S2.1 ', 'S 2.1', 'S2. 1', 'SS2.1', 'S.1', 'S2.', '.1', '2.1', 'S2,1', 'S2-1',
    'S2.1\n', 'S2.1\0', '', 'S2.1x', 'S2.x', 'S2.1/', 'lot/S2.1',
    'Ｓ2.1', // S pleine chasse
    'S２.1', // chiffre pleine chasse
    'Š2.1', 'ſ2.1', 'ß2.1', 'S٢.1', // lettres et chiffres non ASCII
    `S2.1${String.fromCharCode(0x200b)}`, // espace de largeur nulle
  ];
  for (const value of invalid) assert.equal(LOT_ID.test(value), false, JSON.stringify(value));
  assert.deepEqual(acceptedBranches('S12.34'), ['conductor/agent-lot/S12.34', 'lot/S12.34-<slug>']);
  assert.deepEqual(acceptedBranches('S2'), ['conductor/agent-lot/<ID>', 'lot/<ID>-<slug>']);
});

test('identifiant : un lot à plusieurs chiffres (S12.34) va de bout en bout — plan, découpage, branches, historique', () => {
  const options = (extra = {}) => ({ lots: [wide()], decoupes: { 'S12.34': wideDecoupage() }, branch: 'conductor/agent-lot/S12.34', ...extra });
  const ready = conductor(['S12.34', 'P1'], options());
  assert.equal(ready.exitCode, 0, ready.stdout);
  assert.equal(ready.json.lot, 'S12.34');
  assert.equal(ready.json.commit_message, '[S12.34] P1 — Premier prompt');
  assert.deepEqual(ready.json.branch.accepted, ['conductor/agent-lot/S12.34', 'lot/S12.34-<slug>']);
  assert.equal(conductor(['S12.34', 'P1'], options({ branch: 'lot/S12.34-essai' })).json.status, 'ready', 'branche manuelle du lot');
  // Une branche d'un lot voisin ne sert jamais : S12.3 ≠ S12.34 ≠ S2.34 ≠ S1.234.
  for (const other of ['conductor/agent-lot/S12.3', 'conductor/agent-lot/S2.34', 'conductor/agent-lot/S1.234', 'conductor/agent-lot/S12.34/x', 'conductor/agent-lot/s12.34', 'lot/S12.3-essai', 'lot/S12.340-essai']) {
    const result = conductor(['S12.34', 'P1'], options({ branch: other }));
    assert.equal(result.json.status, 'blocked', other);
    assert.equal(result.exitCode, 3, other);
  }
  const wrongLot = conductor(['S12.34', 'P1'], options({ branch: 'conductor/agent-lot/S2.34' }));
  assert.match(wrongLot.json.reason, /appartient au lot S2\.34, pas à S12\.34/);
  // L'historique : le détecteur ancré distingue S12.34 de S2.34 et de S12.3.
  assert.equal(conductor(['S12.34', 'P1'], options({ subjects: [WIDE_FIRST] })).json.status, 'blocked');
  assert.equal(conductor(['S12.34', 'P1'], options({ subjects: ['[S2.34] P1 — x', '[S12.3] P1 — x', '[S12.340] P1 — x'] })).json.status, 'ready');
  assert.equal(conductor(['S12.34', 'P2'], options({ subjects: [WIDE_FIRST] })).json.status, 'ready');
  // La clôture accepte conductor/agent-lot/S12.34 comme conductor/agent-lot/T1.1 (v1.1 § 2).
  const closing = plain(['S12.34', 'cloture'], options({ lots: [wide({ status: 'done' })], subjects: ['[S12.34] P3 — c', '[S12.34] P2 — b', WIDE_FIRST] }));
  assert.equal(closing.exitCode, 0, closing.stdout);
  // Le plan accepte l'identifiant (et --check le valide avec son découpage).
  assert.deepEqual(validatePlan({ statuses: STATUSES, lots: [wide()] }, { decoupeDir: join(fixtureEnv({ lots: [wide()], decoupes: { 'S12.34': wideDecoupage() } }).repo, 'decoupe') }), []);
});

test('identifiant : un identifiant invalide donne error (2) avec la ligne finale — jamais de trace ni de chemin', () => {
  for (const id of ['S2', 'S2.1.1', 'S2.1/../x', '-S2.1', ' S2.1', 'S2.1 ', 'S 2.1', 'Ｓ2.1', 'S２.1', 'ſ2.1', 'ß2.1', 'Š2.1', '', 'S2.1\n']) {
    const result = run([id, 'P1', '--conductor'], fixtureEnv());
    const last = result.stdout.trimEnd().split('\n').at(-1);
    assert.equal(result.exitCode, 2, JSON.stringify(id));
    assert.ok(last.startsWith('CONDUCTOR_RESULT '), JSON.stringify(id));
    const json = JSON.parse(last.slice('CONDUCTOR_RESULT '.length));
    assert.equal(json.status, 'error', JSON.stringify(id));
    assert.equal(json.exit_code, 2);
    assert.equal(json.action, null);
    assert.equal(json.commit_message, null, 'aucun message de commit pour un lot inconnu');
  }
  // Hors Conductor aussi.
  for (const id of ['S2', 'S2.1.1', 'S2.1/../x', 'ſ2.1']) assert.equal(plain([id, 'P1']).exitCode, 2, id);
  // Saisie humaine : les lettres ASCII minuscules sont mises en majuscules, rien d'autre (s2.1 → S2.1, ſ2.1 reste invalide).
  assert.equal(plain(['t1.1', 'p1']).exitCode, 0);
  assert.equal(plain(['t1.1', 'P1']).exitCode, 0);
});

test('identifiant : un plan à identifiant invalide est refusé par --check, sans jamais lire un fichier hors du dossier des découpages', () => {
  const env = fixtureEnv({ decoupes: { 'T1.1': decoupageText() } });
  const decoupeDir = join(env.repo, 'decoupe');
  // Un fichier « piège » à l'emplacement que viserait `../piege` : s'il était lu, son contenu produirait une erreur de découpage.
  writeFileSync(join(env.repo, 'piege.md'), 'pas un découpage');
  const invalidIds = ['S2', 's2.1', 'S2.1.1', '../piege', 'S2.1/../x', 'S2.1 ', '2.1'];
  const lots = invalidIds.map((id, index) => lotFixture({ id, asana_task_id: `x${index}`, execution: undefined, branch: undefined }));
  const errors = validatePlan({ statuses: STATUSES, lots }, { decoupeDir });
  for (const id of invalidIds) assert.ok(errors.some((message) => message === `${id}: identifiant invalide`), `${id} : ${errors.join(' | ')}`);
  assert.ok(!errors.some((message) => /en-tête|découpage/.test(message)), `un fichier a été lu pour un identifiant invalide : ${errors.join(' | ')}`);
  // Via le script : `--check` sur un plan invalide = exit 2.
  const bad = run(['--check'], fixtureEnv({ lots: [lotFixture({ id: 'S2' })], decoupes: {} }));
  assert.equal(bad.exitCode, 2);
  assert.match(bad.stderr, /S2: identifiant invalide/);
});

// ── branch.current === null si et seulement si HEAD est détaché (contrat v1.2 § 4, m2) ──────────
const EXIT_OF_STATUS = { ready: 0, error: 2, blocked: 3, too_early: 3, action_required: 4 };

test('m2 : branch.current, status et exit_code sont cohérents dans TOUS les états (git réel)', () => {
  const dependent = [lotFixture({ depends: ['T2.1'] }), lotFixture({ id: 'T2.1', asana_task_id: 'asana-t21', status: 'ready', execution: undefined, branch: undefined })];
  const states = [
    { name: 'ready, branche Conductor', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'ready' },
    { name: 'ready, branche manuelle', lots: [lotFixture()], branch: 'lot/T1.1-essai', args: ['T1.1', 'P2'], commits: [FIRST_SUBJECT], expect: 'ready' },
    { name: 'action_required', lots: [actionLot()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'action_required' },
    { name: 'blocked, HEAD détaché', lots: [lotFixture()], branch: 'detached', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, branche main', lots: [lotFixture()], branch: 'main', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, branche d’un autre lot', lots: [lotFixture()], branch: 'conductor/agent-lot/T9.9', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, ancien format conductor/<agent>/<exec>', lots: [lotFixture()], branch: 'conductor/agent/abc123', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, ordre des prompts', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P2'], expect: 'blocked' },
    { name: 'blocked, déjà fait', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], commits: [FIRST_SUBJECT], expect: 'blocked' },
    { name: 'blocked, dépendance ouverte (HEAD sur branche)', lots: dependent, branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, dépendance ouverte (HEAD détaché)', lots: dependent, branch: 'detached', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, statut backlog', lots: [lotFixture({ status: 'backlog' })], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'blocked' },
    { name: 'blocked, clôture refusée', lots: [lotFixture()], branch: 'detached', args: ['T1.1', 'cloture'], expect: 'blocked' },
    { name: 'too_early, sur branche', lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'too_early' },
    { name: 'too_early, HEAD détaché', lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })], branch: 'detached', args: ['T1.1', 'P1'], expect: 'too_early' },
    { name: 'error, lot inconnu', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T9.9', 'P1'], expect: 'error' },
    { name: 'error, lot inconnu (HEAD détaché)', lots: [lotFixture()], branch: 'detached', args: ['T9.9', 'P1'], expect: 'error' },
    { name: 'error, identifiant invalide', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['S2', 'P1'], expect: 'error' },
    { name: 'error, prompt inconnu', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P9'], expect: 'error' },
    { name: 'error, prompt absent', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1'], expect: 'error' },
    { name: 'error, --rejouer', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1', '--rejouer'], expect: 'error' },
    { name: 'error, option inconnue', lots: [lotFixture()], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1', '--zzz'], expect: 'error' },
    { name: 'error, option inconnue (HEAD détaché)', lots: [lotFixture()], branch: 'detached', args: ['T1.1', 'P1', '--zzz'], expect: 'error' },
    { name: 'error, plan invalide', lots: [lotFixture({ done_when: [] })], branch: 'conductor/agent-lot/T1.1', args: ['T1.1', 'P1'], expect: 'error' },
  ];
  const seen = new Set();
  for (const state of states) {
    const dir = makeRepo({ lots: state.lots, branch: state.branch });
    for (const subject of state.commits ?? []) commitFile(dir, `f-${Math.abs(subject.length)}.txt`, subject);
    const head = gitIn(dir, 'branch', '--show-current'); // '' = HEAD détaché
    const detached = head === '';
    const result = cli(dir, [...state.args, '--conductor']);
    const { json } = result;
    assert.ok(json, `${state.name} : pas de ligne finale\n${result.stdout}${result.stderr}`);
    assert.equal(json.status, state.expect, `${state.name} : ${json.reason}`);
    seen.add(json.status);
    // exit_code ↔ status ↔ code du processus.
    assert.equal(json.exit_code, EXIT_OF_STATUS[json.status], state.name);
    assert.equal(result.status, json.exit_code, state.name);
    // LE contrat : current === null si et seulement si HEAD est détaché — quel que soit le statut.
    assert.equal(json.branch.current === null, detached, `${state.name} : current=${JSON.stringify(json.branch.current)} détaché=${detached}`);
    if (!detached) assert.equal(json.branch.current, head, state.name);
    // ready et action_required n'existent que sur une branche conforme.
    if (json.status === 'ready' || json.status === 'action_required') {
      assert.ok(json.branch.current === 'conductor/agent-lot/T1.1' || /^lot\/T1\.1-/.test(json.branch.current), state.name);
    }
    // blocked/too_early sont les seuls statuts qui peuvent porter current = null (v1.1.1) ; error aussi quand git répond « détaché ».
    if (json.branch.current === null) assert.ok(['blocked', 'too_early', 'error'].includes(json.status), state.name);
    // La raison est informative : le test ne s'appuie pas dessus (m2), mais elle reste là pour l'humain.
    if (json.status !== 'ready' && json.status !== 'action_required') assert.equal(typeof json.reason, 'string', state.name);
  }
  assert.deepEqual([...seen].sort(), ['action_required', 'blocked', 'error', 'ready', 'too_early']);
});

test('m2 : too_early depuis un HEAD détaché répond branch.current = null (et exit 3), avec une branche il répond la branche', () => {
  const lots = [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })];
  const detached = cli(makeRepo({ lots, branch: 'detached' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(detached.status, 3);
  assert.equal(detached.json.status, 'too_early');
  assert.equal(detached.json.branch.current, null);
  const attached = cli(makeRepo({ lots, branch: 'conductor/agent-lot/T1.1' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(attached.json.status, 'too_early');
  assert.equal(attached.json.branch.current, 'conductor/agent-lot/T1.1');
  // En-process, avec un git injecté qui répond « détaché » (chaîne vide).
  const injected = conductor(['T1.1', 'P1'], { lots, branch: '' });
  assert.equal(injected.json.status, 'too_early');
  assert.equal(injected.json.branch.current, null);
});

test('m2 : le contrat ne dépend pas du texte de reason — un HEAD détaché garde current = null quel que soit le libellé', () => {
  const detached = conductor(['T1.1', 'P1'], { branch: '' });
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.branch.current, null);
  // Le libellé est informatif seulement ; on le remplace et on vérifie que les champs structurés ne bougent pas.
  const { json } = detached;
  const reworded = { ...json, reason: 'texte quelconque' };
  assert.equal(reworded.branch.current, null);
  assert.equal(reworded.status, 'blocked');
  assert.equal(reworded.exit_code, 3);
  // Une branche nommée comme le libellé n'est pas un HEAD détaché.
  const odd = conductor(['T1.1', 'P1'], { branch: 'HEAD-détaché' });
  assert.equal(odd.json.branch.current, 'HEAD-détaché');
  assert.equal(odd.json.status, 'blocked');
});

test('m2 : git indisponible ou --racine refusée = error, branch.current null signifie alors « inconnue » (jamais lue par Conductor)', () => {
  const noGit = conductor(['T1.1', 'P1'], { gitError: 'git cassé' });
  assert.equal(noGit.json.status, 'error');
  assert.equal(noGit.json.branch.current, null);
  const refused = run(['T1.1', 'P1', '--conductor', '--racine', 'relatif'], fixtureEnv());
  const json = JSON.parse(refused.stdout.trimEnd().split('\n').at(-1).slice('CONDUCTOR_RESULT '.length));
  assert.equal(json.status, 'error');
  assert.equal(json.branch.current, null);
});
