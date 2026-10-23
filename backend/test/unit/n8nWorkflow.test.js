import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = JSON.parse(fs.readFileSync(new URL('../../../automation/n8n/whatsapp-lifecycle.json', import.meta.url), 'utf8'));
const node = (name) => workflow.nodes.find((n) => n.name === name);
const next = (name, output = 0) => (workflow.connections[name]?.main?.[output] ?? []).map((c) => c.node);

test('every connection points at a node that exists', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, { main }] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const output of main) for (const c of output) assert.ok(names.has(c.node), c.node);
  }
});

// Meta's delivery webhooks match rows by meta_message_id, which only exists
// once /result is reported. Sending a whole batch before reporting any of it
// would leave the first messages' "delivered" events with nothing to match.
test('each message is reported before the next one is sent', () => {
  assert.equal(node('Loop Items')?.type, 'n8n-nodes-base.splitInBatches');
  assert.deepEqual(next('Message'), ['Loop Items']);
  assert.deepEqual(next('Loop Items', 1), ['Send Template'], 'the loop output sends one message');
  assert.deepEqual(next('Send Template'), ['Build Result']);
  assert.deepEqual(next('Build Result'), ['Report Result']);
  assert.deepEqual(next('Report Result'), ['Loop Items'], 'reporting hands control back to the loop');
  assert.equal(node('Send Template').parameters.options.batching, undefined, 'no batch-wide send');
  assert.match(node('Build Result').parameters.jsCode, /\$\('Loop Items'\)\.item\.json\.messageId/);
});

// The Phone Number ID lives in backend/.env (WHATSAPP_PHONE_NUMBER_ID) and
// arrives with every item, so the workflow never hard-codes it.
test('the Graph API URLs take the phone number id from the backend', () => {
  assert.doesNotMatch(JSON.stringify(workflow), /REPLACE_PHONE_NUMBER_ID/);
  assert.match(node('Send Template').parameters.url, /\{\{ \$json\.phoneNumberId \}\}/);
  assert.match(node('Send Reply').parameters.url, /\{\{ \$json\.reply\.phoneNumberId \}\}/);
  const kept = node('Message').parameters.assignments.assignments.map((a) => a.name);
  assert.ok(kept.includes('phoneNumberId'), 'the Message node keeps phoneNumberId for Send Template');
});
