const test = require('node:test');
const assert = require('node:assert/strict');
const { discloseIntegrityAfterCompletion } = require('../utils/interviewDisclosure');

test('withholds integrity events until interview completion without mutating source', () => {
  const interview = {
    status: 'in_progress',
    integrityLog: [{ event: 'tab_switch' }],
  };

  const response = discloseIntegrityAfterCompletion(interview);

  assert.deepEqual(response.integrityLog, []);
  assert.deepEqual(interview.integrityLog, [{ event: 'tab_switch' }]);
});

test('discloses recorded events after completion', () => {
  const events = [{ event: 'tab_switch' }];
  const response = discloseIntegrityAfterCompletion({ status: 'completed', integrityLog: events });

  assert.deepEqual(response.integrityLog, events);
});

test('supports Mongoose documents by serializing before filtering', () => {
  const response = discloseIntegrityAfterCompletion({
    toObject: () => ({ status: 'scheduled', integrityLog: [{ event: 'phone_detected' }] }),
  });

  assert.deepEqual(response.integrityLog, []);
});
