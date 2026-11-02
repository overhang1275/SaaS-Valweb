import test from 'node:test';
import assert from 'node:assert/strict';
import { publicInitial, publicTransition as step, publicView as view } from './model.mjs';

test('open links deliver selected fields without a client account', () => {
  const initial = publicInitial();
  assert.equal(initial.access, false);
  const result = view(step(initial, { type: 'consult' }));
  assert.equal(result.position, 100);
  assert.deepEqual(result.fields.map(field => field.value), ['0001', 'ABC101', 'Constancia']);
  assert.equal(result.image, true);
});

test('availability, access and code are independent gates', () => {
  for (const [key, value] of [['active', false], ['published', false], ['protected', true], ['knownCode', false]]) {
    const state = step(publicInitial(), { type: 'set', key, value });
    const result = view(step(state, { type: 'consult' }));
    assert.equal(result.position, -100, key);
    assert.deepEqual(result.fields, []);
  }
  let state = step(publicInitial(), { type: 'set', key: 'protected', value: true });
  state = step(state, { type: 'set', key: 'access', value: true });
  assert.equal(view(step(state, { type: 'consult' })).position, 100);
});

test('field selection and image availability do not change a found record', () => {
  let state = step(publicInitial(), { type: 'set', key: 'selectedFields', value: ['folio', 'folio', 'invalid'] });
  state = step(state, { type: 'set', key: 'imageAvailable', value: false });
  const result = view(step(state, { type: 'consult' }));
  assert.equal(result.found, true);
  assert.deepEqual(result.fields, [{ label: 'Folio', value: '0001' }]);
  assert.equal(result.image, false);
  assert.equal(result.imageUnavailable, true);
  state = step(state, { type: 'set', key: 'showImage', value: false });
  assert.equal(view(step(state, { type: 'consult' })).imageUnavailable, false);
});

test('revocation prevents new deliveries and preserves the received snapshot', () => {
  let state = step(publicInitial(), { type: 'consult' });
  const received = view(state);
  state = step(state, { type: 'revoke' });
  state = step(state, { type: 'set', key: 'imageAvailable', value: false });
  state = step(state, { type: 'set', key: 'selectedFields', value: [] });
  state = step(state, { type: 'consult' });
  assert.equal(view(state).canConsult, false);
  assert.equal(view(state).position, 100);
  assert.deepEqual(view(state).fields, received.fields);
  assert.equal(view(state).image, true);
  assert.match(view(state).readout, /bloqueada/);
  assert.equal(view(step(state, { type: 'reset' })).position, -100);
});
