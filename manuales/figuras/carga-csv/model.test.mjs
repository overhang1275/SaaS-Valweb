import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, transition, describe, EXAMPLES } from './model.mjs';

const ready = (example = 'valid') => ['load', 'map', 'process'].reduce(transition, initialState(example));

test('cargar y procesar no publica; publicar exige revisión sin errores', () => {
  let state = initialState();
  for (const action of ['map', 'process', 'publish']) assert.deepEqual(transition(state, action), state);
  state = transition(state, 'load');
  assert.equal(describe(state).canPublish, false);
  assert.deepEqual(transition(state, 'publish'), state);
  state = transition(state, 'map');
  assert.deepEqual(transition(state, 'publish'), state);
  state = transition(state, 'process');
  assert.equal(state.stage, 'review');
  assert.equal(state.published, 0);
  assert.equal(describe(state).canPublish, true);
  state = transition(state, 'publish');
  assert.equal(state.published, 3);
  assert.equal(state.active, false);
  assert.deepEqual(transition(state, 'publish'), state);
});

test('un mapeo incorrecto bloquea el procesamiento hasta corregirlo', () => {
  let state = transition(initialState(), 'load');
  state = transition(state, 'wrong-map');
  assert.equal(describe(state).canProcess, false);
  assert.deepEqual(transition(state, 'process'), state);
  state = transition(state, 'map');
  assert.equal(transition(state, 'process').stage, 'review');
});

test('cambiar la selección obliga a asignar las columnas de nuevo', () => {
  let state = transition(transition(initialState(), 'load'), 'map');
  state = transition(state, 'clear-map');
  assert.equal(describe(state).canProcess, false);
  assert.equal(state.wrongMapping, false);
  assert.equal(transition(transition(state, 'map'), 'process').stage, 'review');
});

test('duplicados normalizados bloquean publicación; corregir requiere nueva carga', () => {
  const state = ready('errors');
  assert.equal(state.stage, 'errors');
  assert.equal(describe(state).canPublish, false);
  assert.deepEqual(transition(state, 'publish'), state);
  assert.match(describe(state).detail, /ABC102/);
  assert.equal(ready().stage, 'review');
});

test('folios conservan ceros iniciales y códigos son ejemplos sintéticos', () => {
  assert.equal(EXAMPLES.valid[0].folio, '0001');
  assert.equal(EXAMPLES.valid[0].alfanum, 'ABC101');
  assert.equal(EXAMPLES.errors[1].alfanum.toUpperCase(), EXAMPLES.errors[2].alfanum.toUpperCase());
  assert.equal(describe(ready()).position, 0);
  assert.equal(describe(transition(ready(), 'publish')).position, 100);
});

test('reiniciar el recorrido conserva la base publicada del ejemplo', () => {
  const published = transition(ready(), 'publish');
  const state = transition(published, 'load');
  assert.equal(state.published, 3);
  assert.equal(state.stage, 'mapping');
  assert.equal(state.active, false);
});
