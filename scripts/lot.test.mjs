import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitMessage,
  completedPrompts,
  conductorGate,
  dateGate,
  dependenciesReady,
  dependencyStates,
  loadPlan,
  lotMap,
  parseDecoupage,
  statusGate,
  validatePlan,
} from './lot.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const plan = loadPlan();
const all = lotMap(plan);

test('le plan complet est valide', () => {
  assert.deepEqual(validatePlan(plan), []);
});
test('S2.2 reste bloqué tant que S2.1 n’est pas clos', () => {
  const states = dependencyStates(all.get('S2.2'), all);
  assert.equal(states[0].id, 'S2.1');
  assert.equal(dependenciesReady(states), false);
});

test('la date minimale de S2.1 est un verrou réel', () => {
  const lot = all.get('S2.1');
  assert.equal(dateGate(lot, new Date('2026-10-26T07:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-10-26T07:41:00Z')).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:41:00Z'))).ready, true);
});

test('un backlog ou un lot terminé ne peut pas partir par accident', () => {
  assert.equal(statusGate(all.get('B0.2'), { ready: true }).ready, false);
  assert.equal(statusGate(all.get('P6.5'), { ready: true }).ready, false);
  assert.equal(statusGate(all.get('S2.2'), { ready: true }).ready, true);
});

test('Conductor refuse les observations et les prompts non autorisés', () => {
  assert.equal(conductorGate(all.get('S2.1'), 'P1').ready, false);
  assert.equal(conductorGate(all.get('S2.2'), 'P1').ready, true);
  assert.equal(conductorGate(all.get('S2.2'), 'P99').ready, false);
  assert.equal(conductorGate(all.get('S2.2'), 'CLOTURE').ready, false);
});

test('le découpage S2.2 expose quatre prompts complets', () => {
  const path = join(process.cwd(), 'docs', 'pilotage', 'decoupe', 'S2.2.md');
  const parsed = parseDecoupage(readFileSync(path, 'utf8'));
  const prompts = parsed.steps.flatMap((step) => step.prompts);
  assert.deepEqual(prompts.map((prompt) => prompt.id), ['P1', 'P2', 'P3', 'P4']);
  assert.equal(commitMessage(all.get('S2.2'), parsed.steps[0], prompts[0]), '[S2.2] P1 — Retirer la promotion expirée sans inventer une nouvelle offre');
});

test('les commits exacts déterminent les prompts faits', () => {
  const done = completedPrompts(all.get('S2.2'), [
    '[S2.2] P1 — Retirer la promotion expirée sans inventer une nouvelle offre',
    'autre commit',
  ]);
  assert.deepEqual([...done], ['P1']);
});
