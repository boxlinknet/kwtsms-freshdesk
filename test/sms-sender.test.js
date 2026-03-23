/**
 * sms-sender.test.js - Tests for the SMS guard chain, send, and batching
 * Run: node --test test/sms-sender.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  send,
  getRecipientType,
  isCacheStale,
  guardSettings,
  guardGateway,
  prepareRecipients,
  buildLogEntry
} = require('../server/lib/sms-sender');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock $db with configurable KV store data.
 * All values are stored and retrieved as { data: JSON.stringify(value) }
 * to match the real FDK Data Storage format.
 */
function createMockDb(kvData = {}) {
  const setCalls = [];

  return {
    _kvData: kvData,
    _setCalls: setCalls,
    get: async function (key) {
      if (!(key in this._kvData)) {
        throw new Error(`Key not found: ${key}`);
      }
      return { data: JSON.stringify(this._kvData[key]) };
    },
    set: async function (key, value) {
      this._kvData[key] = JSON.parse(value.data);
      setCalls.push({ key, value: this._kvData[key] });
    }
  };
}

/**
 * Create a mock $request that returns a given API response for any template.
 * Can also be configured with per-template responses.
 */
function createMockRequest(defaultResponse, perTemplate = {}) {
  const calls = [];
  return {
    _calls: calls,
    invokeTemplate: async function (templateName, options) {
      calls.push({ templateName, options });
      const resp = perTemplate[templateName] !== undefined
        ? perTemplate[templateName]
        : defaultResponse;
      if (resp instanceof Error) {
        throw resp;
      }
      return { response: JSON.stringify(resp) };
    }
  };
}

/** Default valid settings stored in the KV store */
function defaultSettings(overrides = {}) {
  return Object.assign({
    enabled: true,
    test_mode: true,
    debug: false,
    language: 'en',
    active_sender_id: 'KWT-SMS',
    company_name: '',
    schema_version: 1,
    default_country_code: '965'
  }, overrides);
}

/**
 * Default valid gateway stored in the KV store.
 * last_sync is set to now so the balance-refresh path is NOT triggered
 * by default, keeping tests focused on the primary code paths.
 */
function defaultGateway(overrides = {}) {
  return Object.assign({
    balance: 100,
    coverage: [],
    last_sync: new Date().toISOString()
  }, overrides);
}

/** Default stats in the KV store */
function defaultStats() {
  return {
    total_sent: 0, total_failed: 0,
    today_sent: 0, today_failed: 0,
    month_sent: 0, month_failed: 0,
    last_reset_date: '', last_reset_month: ''
  };
}

/** Build a full KV data object for createMockDb */
function fullKvData(settingsOvr = {}, gatewayOvr = {}) {
  return {
    kwtsms_settings: defaultSettings(settingsOvr),
    kwtsms_gateway: defaultGateway(gatewayOvr),
    kwtsms_stats: defaultStats(),
    kwtsms_logs: []
  };
}

/** Standard successful kwtSMS API response */
const API_SUCCESS = {
  result: 'OK',
  'msg-id': 'MSG-12345',
  'balance-after': 99,
  description: 'Message sent'
};

/** Standard failed kwtSMS API response */
const API_FAILURE = {
  result: 'ERROR',
  code: 'ERR005',
  description: 'Invalid credentials'
};

// ---------------------------------------------------------------------------
// Helper: retrieve SMS log entries written by logger.js
// ---------------------------------------------------------------------------
function getLogs(db) {
  return db._kvData.kwtsms_logs || [];
}

// ---------------------------------------------------------------------------
// Unit tests: getRecipientType
// ---------------------------------------------------------------------------

describe('getRecipientType', () => {
  it('returns "admin" for admin_new_ticket', () => {
    assert.equal(getRecipientType('admin_new_ticket'), 'admin');
  });

  it('returns "admin" for admin_high_priority', () => {
    assert.equal(getRecipientType('admin_high_priority'), 'admin');
  });

  it('returns "admin" for admin_escalation', () => {
    assert.equal(getRecipientType('admin_escalation'), 'admin');
  });

  it('returns "admin" for gateway_test', () => {
    assert.equal(getRecipientType('gateway_test'), 'admin');
  });

  it('returns "customer" for ticket_created', () => {
    assert.equal(getRecipientType('ticket_created'), 'customer');
  });

  it('returns "customer" for status_changed', () => {
    assert.equal(getRecipientType('status_changed'), 'customer');
  });

  it('returns "customer" for agent_reply', () => {
    assert.equal(getRecipientType('agent_reply'), 'customer');
  });

  it('returns "customer" for manual_send', () => {
    assert.equal(getRecipientType('manual_send'), 'customer');
  });

  it('returns "customer" for unknown event types', () => {
    assert.equal(getRecipientType('unknown_event'), 'customer');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: isCacheStale
// ---------------------------------------------------------------------------

describe('isCacheStale', () => {
  it('returns true when lastSync is null', () => {
    assert.equal(isCacheStale(null), true);
  });

  it('returns true when lastSync is undefined', () => {
    assert.equal(isCacheStale(undefined), true);
  });

  it('returns true when lastSync is an empty string', () => {
    assert.equal(isCacheStale(''), true);
  });

  it('returns true when lastSync is older than 24 hours', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    assert.equal(isCacheStale(twoDaysAgo), true);
  });

  it('returns false when lastSync is less than 24 hours ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(isCacheStale(oneHourAgo), false);
  });

  it('returns false when lastSync is just now', () => {
    assert.equal(isCacheStale(new Date().toISOString()), false);
  });

  it('returns true when lastSync is exactly 24 hours ago (boundary)', () => {
    const exactlyOneDay = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
    assert.equal(isCacheStale(exactlyOneDay), true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: prepareRecipients
// ---------------------------------------------------------------------------

describe('prepareRecipients', () => {
  it('normalizes and validates phone numbers', () => {
    const result = prepareRecipients(['+965 9876 5432'], [], false, null);
    assert.deepEqual(result, ['96598765432']);
  });

  it('filters out invalid phone numbers', () => {
    const result = prepareRecipients(['abc', '12', '96598765432'], [], false, null);
    assert.deepEqual(result, ['96598765432']);
  });

  it('deduplicates phone numbers', () => {
    const result = prepareRecipients(
      ['96598765432', '+96598765432', '0096598765432'],
      [], false, null
    );
    assert.deepEqual(result, ['96598765432']);
  });

  it('filters by coverage when coverage list is non-empty', () => {
    const result = prepareRecipients(
      ['96598765432', '971501234567'],
      [965], false, null
    );
    assert.deepEqual(result, ['96598765432']);
  });

  it('allows all numbers when coverage is empty', () => {
    const result = prepareRecipients(
      ['96598765432', '971501234567'],
      [], false, null
    );
    assert.deepEqual(result, ['96598765432', '971501234567']);
  });

  it('prepends defaultCountryCode to short local numbers (< 10 digits)', () => {
    const result = prepareRecipients(['98765432'], [], false, '965');
    assert.deepEqual(result, ['96598765432']);
  });

  it('does not prepend defaultCountryCode to numbers >= 10 digits', () => {
    const result = prepareRecipients(['96598765432'], [], false, '965');
    assert.deepEqual(result, ['96598765432']);
  });

  it('ignores defaultCountryCode when it is null', () => {
    const result = prepareRecipients(['96598765432'], [], false, null);
    assert.deepEqual(result, ['96598765432']);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: guardSettings
// ---------------------------------------------------------------------------

describe('guardSettings', () => {
  it('returns error when settings key is missing', async () => {
    const db = createMockDb({});
    const result = await guardSettings(db);
    assert.ok(result.error);
    assert.equal(result.error.success, false);
    assert.ok(result.error.message.includes('not configured'));
  });

  it('returns error when plugin is disabled', async () => {
    const db = createMockDb({ kwtsms_settings: defaultSettings({ enabled: false }) });
    const result = await guardSettings(db);
    assert.ok(result.error);
    assert.ok(result.error.message.toLowerCase().includes('disabled'));
  });

  it('returns settings when plugin is enabled', async () => {
    const db = createMockDb({ kwtsms_settings: defaultSettings() });
    const result = await guardSettings(db);
    assert.ok(result.settings);
    assert.equal(result.settings.enabled, true);
  });

  it('merges DEFAULT_SETTINGS so all keys are present even with minimal stored data', async () => {
    // Store only "enabled: true", expect full settings back
    const db = createMockDb({ kwtsms_settings: { enabled: true } });
    const result = await guardSettings(db);
    assert.ok(result.settings);
    assert.equal(result.settings.test_mode, true);
    assert.equal(result.settings.active_sender_id, 'KWT-SMS');
    assert.equal(result.settings.default_country_code, '965');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: guardGateway
// ---------------------------------------------------------------------------

describe('guardGateway', () => {
  it('returns error when gateway key is missing', async () => {
    const db = createMockDb({});
    const req = createMockRequest(API_SUCCESS);
    const result = await guardGateway(db, req, null);
    assert.ok(result.error);
    assert.equal(result.error.success, false);
    assert.ok(result.error.message.toLowerCase().includes('not configured'));
  });

  it('returns error when balance is zero', async () => {
    const db = createMockDb({ kwtsms_gateway: defaultGateway({ balance: 0 }) });
    const req = createMockRequest(API_SUCCESS);
    const result = await guardGateway(db, req, null);
    assert.ok(result.error);
    assert.ok(result.error.message.toLowerCase().includes('balance'));
  });

  it('returns error when balance is negative', async () => {
    const db = createMockDb({ kwtsms_gateway: defaultGateway({ balance: -5 }) });
    const req = createMockRequest(API_SUCCESS);
    const result = await guardGateway(db, req, null);
    assert.ok(result.error);
    assert.ok(result.error.message.toLowerCase().includes('balance'));
  });

  it('returns gateway when balance is positive and cache is fresh', async () => {
    const db = createMockDb({ kwtsms_gateway: defaultGateway({ balance: 50 }) });
    const req = createMockRequest(API_SUCCESS);
    const result = await guardGateway(db, req, null);
    assert.ok(result.gateway);
    assert.equal(result.gateway.balance, 50);
  });

  it('refreshes balance from API when cache is stale and credentials are provided', async () => {
    const staleGateway = defaultGateway({
      balance: 10,
      last_sync: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    });
    const db = createMockDb({ kwtsms_gateway: staleGateway });
    const balanceResp = { available: 75 };
    const req = createMockRequest(null, { checkBalance: balanceResp });
    const result = await guardGateway(db, req, { username: 'u', password: 'p' });
    assert.ok(result.gateway);
    assert.equal(result.gateway.balance, 75);
    assert.equal(req._calls.length, 1);
    assert.equal(req._calls[0].templateName, 'checkBalance');
  });

  it('does NOT refresh balance when cache is stale but credentials are falsy', async () => {
    const staleGateway = defaultGateway({
      balance: 10,
      last_sync: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    });
    const db = createMockDb({ kwtsms_gateway: staleGateway });
    const req = createMockRequest(API_SUCCESS);
    const result = await guardGateway(db, req, null);
    assert.ok(result.gateway);
    assert.equal(req._calls.length, 0);
  });

  it('uses cached balance when balance refresh API call fails', async () => {
    const staleGateway = defaultGateway({
      balance: 10,
      last_sync: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    });
    const db = createMockDb({ kwtsms_gateway: staleGateway });
    const req = createMockRequest(null, { checkBalance: new Error('timeout') });
    const result = await guardGateway(db, req, { username: 'u', password: 'p' });
    assert.ok(result.gateway);
    assert.equal(result.gateway.balance, 10);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: buildLogEntry
// ---------------------------------------------------------------------------

describe('buildLogEntry', () => {
  it('builds a correct log entry for a successful send', () => {
    const entry = buildLogEntry('ticket_created', ['96598765432'], 'Hello', true, API_SUCCESS, 42);
    assert.equal(entry.event_type, 'ticket_created');
    assert.equal(entry.recipient_type, 'customer');
    assert.equal(entry.recipient_phone, '96598765432');
    assert.equal(entry.message_preview, 'Hello');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.ticket_id, 42);
    assert.equal(entry.msg_id, 'MSG-12345');
    assert.equal(entry.error_message, '');
  });

  it('builds a correct log entry for a failed send', () => {
    const entry = buildLogEntry('manual_send', ['96598765432'], 'Hello', false, API_FAILURE, 0);
    assert.equal(entry.status, 'failed');
    assert.equal(entry.recipient_type, 'customer');
    assert.equal(entry.api_response_code, 'ERR005');
    assert.equal(entry.error_message, 'Invalid credentials');
  });

  it('sets recipient_type to "admin" for admin events', () => {
    const entry = buildLogEntry('admin_new_ticket', ['96598765432'], 'Alert', true, API_SUCCESS, 0);
    assert.equal(entry.recipient_type, 'admin');
  });

  it('defaults ticket_id to 0 when not provided', () => {
    const entry = buildLogEntry('manual_send', ['96598765432'], 'Hello', true, API_SUCCESS);
    assert.equal(entry.ticket_id, 0);
  });
});

// ---------------------------------------------------------------------------
// Integration: send() - guard chain
// ---------------------------------------------------------------------------

describe('send - guard: settings', () => {
  it('returns error when settings key is missing (plugin not initialized)', async () => {
    const db = createMockDb({ kwtsms_gateway: defaultGateway(), kwtsms_stats: defaultStats() });
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('not configured'));
  });

  it('returns error when plugin is disabled', async () => {
    const db = createMockDb(fullKvData({ enabled: false }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('disabled'));
  });
});

describe('send - guard: gateway', () => {
  it('returns error when gateway key is missing', async () => {
    const db = createMockDb({
      kwtsms_settings: defaultSettings(),
      kwtsms_stats: defaultStats()
    });
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('not configured'));
  });

  it('returns error when balance is zero', async () => {
    const db = createMockDb(fullKvData({}, { balance: 0 }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('balance'));
  });

  it('returns error when balance is negative', async () => {
    const db = createMockDb(fullKvData({}, { balance: -5 }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('balance'));
  });
});

describe('send - guard: message', () => {
  it('returns error when message is empty', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: '', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('empty'));
  });

  it('returns error when message is only HTML tags (empty after cleaning)', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: '<p><br></p>', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('empty'));
  });

  it('returns error when message is only whitespace', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: '   \n  ', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('empty'));
  });
});

describe('send - guard: recipients', () => {
  it('returns error when phone list is empty', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: [], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no phone numbers'));
  });

  it('returns error when all phones are invalid', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['abc', '12', ''], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no valid recipients'));
  });

  it('returns error when all phones are filtered by coverage', async () => {
    const db = createMockDb(fullKvData({}, { coverage: [966] }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no valid recipients'));
  });
});

// ---------------------------------------------------------------------------
// Integration: send() - comma-separated phone flattening (step 0)
// ---------------------------------------------------------------------------

describe('send - phone flattening', () => {
  it('flattens a single comma-separated phone string into individual numbers', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432,96541234567'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
    const body = JSON.parse(req._calls[0].options.body);
    assert.ok(body.mobile.includes('96598765432'));
    assert.ok(body.mobile.includes('96541234567'));
  });

  it('flattens a mix of string entries and comma-separated entries', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432', '96541234567,971501234567'],
      message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
    const body = JSON.parse(req._calls[0].options.body);
    assert.ok(body.mobile.includes('96598765432'));
    assert.ok(body.mobile.includes('96541234567'));
    assert.ok(body.mobile.includes('971501234567'));
  });

  it('returns "no phone numbers" error when phones array is empty after flattening', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['  ,  , '], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no phone numbers'));
  });

  it('trims whitespace from phone entries after splitting', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: [' 96598765432 , 96541234567 '],
      message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
    const body = JSON.parse(req._calls[0].options.body);
    assert.ok(body.mobile.includes('96598765432'));
    assert.ok(body.mobile.includes('96541234567'));
  });
});

// ---------------------------------------------------------------------------
// Integration: send() - successful send
// ---------------------------------------------------------------------------

describe('send - successful send', () => {
  it('returns success for a valid single-recipient send', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: { username: 'test', password: 'test' },
      phones: ['96598765432'], message: 'Hello World', eventType: 'manual_send', ticketId: 100
    });
    assert.equal(result.success, true);
    assert.ok(result.message.toLowerCase().includes('sent'));
  });

  it('calls $request.invokeTemplate with sendSms and correct body', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: { username: 'test', password: 'test' },
      phones: ['96598765432'], message: 'Hello World', eventType: 'manual_send'
    });
    assert.equal(req._calls.length, 1);
    assert.equal(req._calls[0].templateName, 'sendSms');
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
    assert.equal(body.message, 'Hello World');
    assert.equal(body.sender, 'KWT-SMS');
    assert.equal(body.test, '1'); // test_mode is true by default
    assert.equal(body.username, 'test');
    assert.equal(body.password, 'test');
  });

  it('sends with test=0 when test_mode is false', async () => {
    const db = createMockDb(fullKvData({ test_mode: false }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.test, '0');
  });

  it('uses custom active_sender_id from settings', async () => {
    const db = createMockDb(fullKvData({ active_sender_id: 'MYBRAND' }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.sender, 'MYBRAND');
  });

  it('normalizes phone numbers before sending', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['+965 9876 5432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
  });

  it('deduplicates phone numbers', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432', '+96598765432', '0096598765432'],
      message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
  });

  it('joins multiple valid recipients with comma', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432', '96541234567'],
      message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432,96541234567');
  });

  it('filters phones by coverage when coverage is set', async () => {
    const db = createMockDb(fullKvData({}, { coverage: [965] }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432', '971501234567'],
      message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
  });

  it('allows all phones when coverage is empty', async () => {
    const db = createMockDb(fullKvData({}, { coverage: [] }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432', '971501234567'],
      message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.ok(body.mobile.includes('96598765432'));
    assert.ok(body.mobile.includes('971501234567'));
  });

  it('updates cached balance after successful send', async () => {
    const db = createMockDb(fullKvData({}, { balance: 100 }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_gateway.balance, 99);
  });

  it('updates stats counters after successful send', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_stats.total_sent, 1);
    assert.equal(db._kvData.kwtsms_stats.today_sent, 1);
    assert.equal(db._kvData.kwtsms_stats.month_sent, 1);
  });

  it('writes a log entry to kwtsms_logs after successful send', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello World', eventType: 'ticket_created', ticketId: 42
    });
    const logs = getLogs(db);
    assert.equal(logs.length, 1);
    const entry = logs[0];
    assert.equal(entry.event_type, 'ticket_created');
    assert.equal(entry.recipient_type, 'customer');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.ticket_id, 42);
    assert.equal(entry.msg_id, 'MSG-12345');
  });

  it('cleans HTML from message before sending', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: '<p>Hello <b>World</b></p>', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.message, 'Hello World');
  });

  it('applies defaultCountryCode from settings to short local numbers', async () => {
    const db = createMockDb(fullKvData({ default_country_code: '965' }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['98765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
  });
});

// ---------------------------------------------------------------------------
// Integration: send() - failed send
// ---------------------------------------------------------------------------

describe('send - failed send', () => {
  it('returns failure when API returns an error code', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Invalid credentials'));
  });

  it('updates failed stats counters on API error', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_stats.total_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.today_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.month_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.total_sent, 0);
  });

  it('writes a failed log entry with error_message to kwtsms_logs', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const logs = getLogs(db);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'failed');
    assert.equal(logs[0].api_response_code, 'ERR005');
    assert.equal(logs[0].error_message, 'Invalid credentials');
  });

  it('does not update cached balance on API error', async () => {
    const db = createMockDb(fullKvData({}, { balance: 100 }));
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_gateway.balance, 100);
  });

  it('handles network errors from $request gracefully', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(new Error('Network timeout'));
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Network timeout'));
  });

  it('returns failure message with description when available', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest({ result: 'ERROR', code: 'ERR027', description: 'Message contains HTML' });
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Message contains HTML'));
  });

  it('returns failure with code when no description is provided', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest({ result: 'ERROR', code: 'ERR999' });
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('ERR999'));
  });
});

// ---------------------------------------------------------------------------
// Integration: send() - edge cases
// ---------------------------------------------------------------------------

describe('send - edge cases', () => {
  it('skips invalid phones mixed with valid ones and sends to valid only', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['invalid', '96598765432', 'abc', '96541234567'],
      message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432,96541234567');
  });

  it('defaults sender to KWT-SMS when active_sender_id is empty string', async () => {
    const db = createMockDb(fullKvData({ active_sender_id: '' }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.sender, 'KWT-SMS');
  });

  it('handles missing coverage field in gateway gracefully (treats as empty)', async () => {
    const db = createMockDb({
      kwtsms_settings: defaultSettings(),
      kwtsms_gateway: { balance: 100, last_sync: new Date().toISOString() },
      kwtsms_stats: defaultStats(),
      kwtsms_logs: []
    });
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
  });

  it('defaults ticketId to 0 in log entry when not provided', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const logs = getLogs(db);
    assert.equal(logs[0].ticket_id, 0);
  });

  it('log entry for admin event has recipient_type "admin"', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: null,
      phones: ['96598765432'], message: 'New ticket alert', eventType: 'admin_new_ticket'
    });
    const logs = getLogs(db);
    assert.equal(logs[0].recipient_type, 'admin');
  });

  it('accepts phones as undefined and returns no phone numbers error', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: null,
      phones: undefined, message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no phone numbers'));
  });
});
