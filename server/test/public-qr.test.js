'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { batchFromQR } = require('../public/ayur-qr');
test('product QR codes resolve to a batch ID without navigating to the scanned host', () => {
  assert.equal(batchFromQR('https://old-computer.example/trace?batch=HC-tulsi_123'), 'HC-tulsi_123');
  assert.equal(batchFromQR('LOT-001'), 'LOT-001');
  assert.equal(batchFromQR('DEMO-TULSI-example'), 'DEMO-TULSI-example');
});
test('rejects executable links, ambiguous IDs, credentials, unrelated URLs and oversized input', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://a.test/trace?batch=HC-one&batch=HC-two', 'https://user:pass@a.test/trace?batch=HC-one', 'https://a.test/login?batch=HC-one', 'https://a.test/trace?batch=%3Cscript%3E', 'https://a.test/trace?batch=HC-one#access_token=test', 'https://a.test/trace?batch=' + 'a'.repeat(81), 'x'.repeat(2049), null]) assert.equal(batchFromQR(value), null);
});
