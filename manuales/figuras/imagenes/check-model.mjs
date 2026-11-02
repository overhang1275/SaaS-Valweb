import test from 'node:test';
import assert from 'node:assert/strict';
import { imageInitial, imageTransition as step, imageView } from './model.mjs';

test('FTP leaves the original waiting for explicit processing', () => {
  const state = imageInitial();
  assert.equal(state.phase, 'original');
  assert.equal(imageView(state).position, -100);
  assert.equal(imageView(state).published, false);
  assert.deepEqual(step(state, { type: 'ftp' }), state);
  assert.equal(step(state, { type: 'confirm' }), state);
  assert.equal(step(state, { type: 'cleanup' }), state);
});

test('new images publish and clean originals automatically', () => {
  const original = imageInitial();
  const published = step(original, { type: 'process' });
  assert.equal(published.phase, 'published');
  assert.equal(imageView(published).position, 100);
  assert.equal(imageView(published).originalPresent, false);
  assert.equal(imageView(step(published, { type: 'cleanup' })).originalPresent, false);
  assert.equal(original.phase, 'original');
});

test('replacement must be confirmed and errors never publish', () => {
  const replacement = step(imageInitial(), { type: 'scenario', value: 'replacement' });
  const review = step(replacement, { type: 'process' });
  assert.equal(review.phase, 'review');
  assert.equal(imageView(review).position, 0);
  assert.equal(imageView(review).originalPresent, true);
  assert.equal(step(review, { type: 'cleanup' }), review);
  assert.equal(step(review, { type: 'confirm' }).phase, 'published');
  const failed = step(step(imageInitial(), { type: 'scenario', value: 'error' }), { type: 'process' });
  assert.equal(failed.phase, 'failed');
  assert.equal(step(failed, { type: 'confirm' }), failed);
  assert.equal(imageView(failed).originalPresent, true);
});

test('unavailable NFS remains NFS and never falls back to Local', () => {
  const nfs = step(imageInitial(), { type: 'storage', value: 'NFS' });
  const unavailable = step(nfs, { type: 'availability', value: false });
  const blocked = step(unavailable, { type: 'process' });
  assert.equal(blocked.phase, 'blocked');
  assert.equal(blocked.storage, 'NFS');
  assert.equal(imageView(blocked).originalPresent, true);
  assert.equal(imageView(blocked).published, false);
  assert.equal(step(step(blocked, { type: 'availability', value: true }), { type: 'process' }).phase, 'published');
});

test('unsupported configuration values do not corrupt the model', () => {
  const initial = imageInitial();
  for (const action of [{ type: 'scenario', value: 'unknown' }, { type: 'storage', value: 'FTP' }, { type: 'availability', value: 'yes' }]) {
    assert.equal(step(initial, action), initial);
  }
});

test('cleanup failure leaves publication complete and originals pending', () => {
  const state = step(step(imageInitial(), { type: 'scenario', value: 'cleanup-failure' }), { type: 'process' });
  assert.equal(state.phase, 'published');
  assert.equal(imageView(state).originalPresent, true);
  assert.equal(imageView(state).canCleanup, true);
  assert.equal(imageView(step(state, { type: 'cleanup' })).originalPresent, false);
});
