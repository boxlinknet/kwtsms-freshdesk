/**
 * logger.test.js - Tests for SMS log writer and stats updater
 * Run: node --test test/logger.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { logSmsResult, updateStats, resetCounters, debugLog, log } = require('../server/lib/logger');

/**
 * Create a mock $db with KV store and entity store.
 * @param {Object} kvData - Initial KV store data (keys map to objects)
 */
function createMockDb(kvData = {}) {
  const entityRecords = [];

  return {
    _kvData: kvData,
    _entityRecords: entityRecords,
    get: async function (key) {
      if (!(key in this._kvData)) {
        throw new Error(`Key not found: ${key}`);
      }
      return { data: JSON.stringify(this._kvData[key]) };
    },
    set: async function (key, value) {
      this._kvData[key] = JSON.parse(value.data);
    },
    entity: {
      create: async function (_entityName, record) {
        entityRecords.push(record);
      }
    }
  };
}

describe('logSmsResult', () => {
  it('writes a log entry to entity store', async () => {
    const db = createMockDb();
    await logSmsResult(db, {
      event_type: 'ticket_created',
      recipient_phone: '96598765432',
      message_preview: 'Ticket #100 created',
      status: 'sent',
      api_response_code: 'OK',
      ticket_id: 100,
      msg_id: 'abc123'
    });
    assert.equal(db._entityRecords.length, 1);
    const entry = db._entityRecords[0];
    assert.equal(entry.event_type, 'ticket_created');
    assert.equal(entry.recipient_phone, '96598765432');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.api_response_code, 'OK');
    assert.equal(entry.ticket_id, 100);
    assert.equal(entry.msg_id, 'abc123');
    assert.ok(entry.timestamp); // ISO string
  });

  it('truncates message_preview to 80 chars', async () => {
    const db = createMockDb();
    const longMessage = 'A'.repeat(200);
    await logSmsResult(db, {
      event_type: 'manual_send',
      recipient_phone: '96598765432',
      message_preview: longMessage,
      status: 'sent'
    });
    assert.equal(db._entityRecords[0].message_preview.length, 80);
  });

  it('defaults optional fields to empty/zero', async () => {
    const db = createMockDb();
    await logSmsResult(db, {
      event_type: 'manual_send',
      recipient_phone: '96598765432',
      status: 'failed'
    });
    const entry = db._entityRecords[0];
    assert.equal(entry.message_preview, '');
    assert.equal(entry.api_response_code, '');
    assert.equal(entry.ticket_id, 0);
    assert.equal(entry.msg_id, '');
  });

  it('does not throw when entity.create fails', async () => {
    const db = createMockDb();
    db.entity.create = async () => { throw new Error('DB full'); };
    // Should not throw, failure is non-fatal
    await logSmsResult(db, {
      event_type: 'manual_send',
      recipient_phone: '96598765432',
      status: 'failed'
    });
  });
});

describe('updateStats', () => {
  it('increments success counters on success=true', async () => {
    const db = createMockDb({
      kwtsms_stats: {
        total_sent: 5, total_failed: 1,
        today_sent: 2, today_failed: 0,
        month_sent: 10, month_failed: 3,
        last_reset_date: '', last_reset_month: ''
      }
    });
    await updateStats(db, true);
    const stats = db._kvData.kwtsms_stats;
    assert.equal(stats.total_sent, 6);
    assert.equal(stats.today_sent, 3);
    assert.equal(stats.month_sent, 11);
    // Failed counters unchanged
    assert.equal(stats.total_failed, 1);
    assert.equal(stats.today_failed, 0);
    assert.equal(stats.month_failed, 3);
  });

  it('increments failure counters on success=false', async () => {
    const db = createMockDb({
      kwtsms_stats: {
        total_sent: 5, total_failed: 1,
        today_sent: 2, today_failed: 0,
        month_sent: 10, month_failed: 3,
        last_reset_date: '', last_reset_month: ''
      }
    });
    await updateStats(db, false);
    const stats = db._kvData.kwtsms_stats;
    assert.equal(stats.total_failed, 2);
    assert.equal(stats.today_failed, 1);
    assert.equal(stats.month_failed, 4);
    // Sent counters unchanged
    assert.equal(stats.total_sent, 5);
    assert.equal(stats.today_sent, 2);
    assert.equal(stats.month_sent, 10);
  });

  it('does not throw when $db.get fails', async () => {
    const db = createMockDb({}); // no stats key
    await updateStats(db, true); // should not throw
  });
});

describe('resetCounters', () => {
  it('resets daily counters when date changes', async () => {
    const db = createMockDb({
      kwtsms_stats: {
        total_sent: 100, total_failed: 5,
        today_sent: 12, today_failed: 2,
        month_sent: 50, month_failed: 3,
        last_reset_date: '2025-01-01',
        last_reset_month: new Date().toISOString().substring(0, 7)
      }
    });
    await resetCounters(db);
    const stats = db._kvData.kwtsms_stats;
    // Daily counters should be reset
    assert.equal(stats.today_sent, 0);
    assert.equal(stats.today_failed, 0);
    // Monthly counters should NOT be reset (same month)
    assert.equal(stats.month_sent, 50);
    assert.equal(stats.month_failed, 3);
    // Totals should be unchanged
    assert.equal(stats.total_sent, 100);
    assert.equal(stats.total_failed, 5);
    // Last reset date should be today
    const today = new Date().toISOString().split('T')[0];
    assert.equal(stats.last_reset_date, today);
  });

  it('resets monthly counters when month changes', async () => {
    const db = createMockDb({
      kwtsms_stats: {
        total_sent: 100, total_failed: 5,
        today_sent: 12, today_failed: 2,
        month_sent: 50, month_failed: 3,
        last_reset_date: '2024-01-01',
        last_reset_month: '2024-01'
      }
    });
    await resetCounters(db);
    const stats = db._kvData.kwtsms_stats;
    assert.equal(stats.today_sent, 0);
    assert.equal(stats.today_failed, 0);
    assert.equal(stats.month_sent, 0);
    assert.equal(stats.month_failed, 0);
  });

  it('does not reset if already reset today', async () => {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);
    const db = createMockDb({
      kwtsms_stats: {
        total_sent: 100, total_failed: 5,
        today_sent: 12, today_failed: 2,
        month_sent: 50, month_failed: 3,
        last_reset_date: today,
        last_reset_month: month
      }
    });
    await resetCounters(db);
    const stats = db._kvData.kwtsms_stats;
    // Nothing should change
    assert.equal(stats.today_sent, 12);
    assert.equal(stats.today_failed, 2);
    assert.equal(stats.month_sent, 50);
    assert.equal(stats.month_failed, 3);
  });

  it('does not throw when $db.get fails', async () => {
    const db = createMockDb({}); // no stats key
    await resetCounters(db); // should not throw
  });
});

describe('debugLog', () => {
  it('calls console.log when debugEnabled is true', (t) => {
    const calls = [];
    t.mock.method(console, 'log', (...args) => { calls.push(args); });
    debugLog('test message', true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '[kwtsms:debug]');
    assert.equal(calls[0][1], 'test message');
  });

  it('does not call console.log when debugEnabled is false', (t) => {
    const calls = [];
    t.mock.method(console, 'log', (...args) => { calls.push(args); });
    debugLog('test message', false);
    assert.equal(calls.length, 0);
  });

  it('does not call console.log when debugEnabled is undefined', (t) => {
    const calls = [];
    t.mock.method(console, 'log', (...args) => { calls.push(args); });
    debugLog('test message', undefined);
    assert.equal(calls.length, 0);
  });
});

describe('log', () => {
  it('calls console.log with kwtsms prefix', (t) => {
    const calls = [];
    t.mock.method(console, 'log', (...args) => { calls.push(args); });
    log('Something happened');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '[kwtsms]');
    assert.equal(calls[0][1], 'Something happened');
  });
});
