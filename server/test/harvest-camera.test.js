const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../src/services/harvestCamera.js'), 'utf8');
const load = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('camera capture opens without a location provider and records the returned camera photo', async () => {
  const { captureHerbPhoto } = await load;
  const calls = [];
  const result = await captureHerbPhoto({
    requestCameraPermissionsAsync: async () => { calls.push('permission'); return { granted: true }; },
    launchCameraAsync: async options => { calls.push('camera'); assert.equal(options.allowsEditing, false); return { canceled: false, assets: [{ uri: 'file:///camera.jpg' }] }; },
    launchImageLibraryAsync: () => { throw Error('Gallery must never open'); },
  }, () => '2026-10-08T10:00:00.000Z');
  assert.deepEqual(calls, ['permission', 'camera']);
  assert.deepEqual(result, { uri: 'file:///camera.jpg', capture: { source: 'camera', capturedAt: '2026-10-08T10:00:00.000Z' } });
});

test('denied camera permission never opens the camera', async () => {
  const { captureHerbPhoto } = await load;
  await assert.rejects(captureHerbPhoto({
    requestCameraPermissionsAsync: async () => ({ granted: false, status: 'denied' }),
    launchCameraAsync: () => { assert.fail('Camera opened without permission'); },
  }), error => error.uiKey === 'cameraPermissionRequired');
});

test('canceling camera produces no harvest photo or capture metadata', async () => {
  const { captureHerbPhoto } = await load;
  assert.equal(await captureHerbPhoto({
    requestCameraPermissionsAsync: async () => ({ granted: true }),
    launchCameraAsync: async () => ({ canceled: true }),
  }, () => { assert.fail('Canceled photo was timestamped'); }), null);
});

test('native camera failures and missing photos have a camera-specific error', async () => {
  const { captureHerbPhoto } = await load;
  for (const launchCameraAsync of [async () => { throw Error('Native activity unavailable'); }, async () => ({ canceled: false, assets: [] })]) {
    await assert.rejects(captureHerbPhoto({ requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync }), error => error.uiKey === 'cameraUnavailable');
  }
});
