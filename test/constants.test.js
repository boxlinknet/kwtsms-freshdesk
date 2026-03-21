/**
 * constants.test.js - Tests for shared constants exports
 * Run: node --test test/constants.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const constants = require('../server/lib/constants');

describe('constants exports', () => {
  it('exports TICKET_STATUS with correct codes', () => {
    assert.equal(constants.TICKET_STATUS.OPEN, 2);
    assert.equal(constants.TICKET_STATUS.PENDING, 3);
    assert.equal(constants.TICKET_STATUS.RESOLVED, 4);
    assert.equal(constants.TICKET_STATUS.CLOSED, 5);
  });

  it('exports TICKET_PRIORITY with correct codes', () => {
    assert.equal(constants.TICKET_PRIORITY.LOW, 1);
    assert.equal(constants.TICKET_PRIORITY.MEDIUM, 2);
    assert.equal(constants.TICKET_PRIORITY.HIGH, 3);
    assert.equal(constants.TICKET_PRIORITY.URGENT, 4);
  });

  it('exports DS_KEYS with all required store keys', () => {
    assert.equal(constants.DS_KEYS.SETTINGS, 'kwtsms_settings');
    assert.equal(constants.DS_KEYS.GATEWAY, 'kwtsms_gateway');
    assert.equal(constants.DS_KEYS.TEMPLATES, 'kwtsms_templates');
    assert.equal(constants.DS_KEYS.ADMIN_ALERTS, 'kwtsms_admin_alerts');
    assert.equal(constants.DS_KEYS.STATS, 'kwtsms_stats');
  });

  it('exports ENTITY with sms_log name', () => {
    assert.equal(constants.ENTITY.SMS_LOG, 'sms_log');
  });

  it('exports SMS_EVENT with all event types', () => {
    assert.equal(constants.SMS_EVENT.TICKET_CREATED, 'ticket_created');
    assert.equal(constants.SMS_EVENT.STATUS_CHANGED, 'status_changed');
    assert.equal(constants.SMS_EVENT.AGENT_REPLY, 'agent_reply');
    assert.equal(constants.SMS_EVENT.ADMIN_NEW_TICKET, 'admin_new_ticket');
    assert.equal(constants.SMS_EVENT.ADMIN_HIGH_PRIORITY, 'admin_high_priority');
    assert.equal(constants.SMS_EVENT.ADMIN_ESCALATION, 'admin_escalation');
    assert.equal(constants.SMS_EVENT.MANUAL_SEND, 'manual_send');
  });

  it('exports DEFAULT_SETTINGS with correct defaults', () => {
    const ds = constants.DEFAULT_SETTINGS;
    assert.equal(ds.enabled, false);
    assert.equal(ds.test_mode, true);
    assert.equal(ds.debug, false);
    assert.equal(ds.language, 'en');
    assert.equal(ds.active_sender_id, 'KWT-SMS');
    assert.equal(ds.company_name, '');
    assert.equal(ds.schema_version, 1);
  });

  it('exports DEFAULT_ADMIN_ALERTS with empty phones and default events', () => {
    const da = constants.DEFAULT_ADMIN_ALERTS;
    assert.deepEqual(da.phones, []);
    assert.equal(da.events.new_ticket, true);
    assert.equal(da.events.high_priority, true);
    assert.equal(da.events.escalation, true);
  });

  it('exports DEFAULT_STATS with all zero counters', () => {
    const ds = constants.DEFAULT_STATS;
    assert.equal(ds.total_sent, 0);
    assert.equal(ds.total_failed, 0);
    assert.equal(ds.today_sent, 0);
    assert.equal(ds.today_failed, 0);
    assert.equal(ds.month_sent, 0);
    assert.equal(ds.month_failed, 0);
    assert.equal(ds.last_reset_date, '');
    assert.equal(ds.last_reset_month, '');
  });

  it('exports KWTSMS with API constants', () => {
    const k = constants.KWTSMS;
    assert.equal(k.MAX_BATCH_SIZE, 200);
    assert.equal(k.BATCH_DELAY_MS, 500);
    assert.deepEqual(k.ERR013_BACKOFF_MS, [30000, 60000, 120000]);
    assert.equal(k.MAX_RETRIES, 3);
    assert.equal(k.GSM7_PAGE_SIZE, 160);
    assert.equal(k.GSM7_MULTIPAGE_SIZE, 153);
    assert.equal(k.UNICODE_PAGE_SIZE, 70);
    assert.equal(k.UNICODE_MULTIPAGE_SIZE, 67);
    assert.equal(k.MAX_PAGES, 7);
  });

  it('exports NON_RETRYABLE_ERRORS as an array of error codes', () => {
    assert.ok(Array.isArray(constants.NON_RETRYABLE_ERRORS));
    assert.ok(constants.NON_RETRYABLE_ERRORS.length > 0);
    assert.ok(constants.NON_RETRYABLE_ERRORS.includes('ERR001'));
    assert.ok(constants.NON_RETRYABLE_ERRORS.includes('ERR012'));
    assert.ok(!constants.NON_RETRYABLE_ERRORS.includes('ERR013'));
  });

  it('exports STATUS_LABELS for en and ar', () => {
    assert.equal(constants.STATUS_LABELS.en[2], 'Open');
    assert.equal(constants.STATUS_LABELS.en[5], 'Closed');
    assert.equal(constants.STATUS_LABELS.ar[2], '\u0645\u0641\u062A\u0648\u062D\u0629');
    assert.equal(constants.STATUS_LABELS.ar[5], '\u0645\u063A\u0644\u0642\u0629');
  });

  it('exports PRIORITY_LABELS for en and ar', () => {
    assert.equal(constants.PRIORITY_LABELS.en[1], 'Low');
    assert.equal(constants.PRIORITY_LABELS.en[4], 'Urgent');
    assert.equal(constants.PRIORITY_LABELS.ar[4], '\u0639\u0627\u062C\u0644\u0629');
  });

  it('exports all 12 named exports', () => {
    const expectedKeys = [
      'TICKET_STATUS', 'TICKET_PRIORITY', 'DS_KEYS', 'ENTITY', 'SMS_EVENT',
      'DEFAULT_SETTINGS', 'DEFAULT_ADMIN_ALERTS', 'DEFAULT_STATS',
      'KWTSMS', 'NON_RETRYABLE_ERRORS', 'STATUS_LABELS', 'PRIORITY_LABELS'
    ];
    for (const key of expectedKeys) {
      assert.ok(key in constants, `Missing export: ${key}`);
    }
  });
});
