/**
 * sms-sender.test.js - Tests for the SMS guard chain, send, and batching
 * Run: node --test test/sms-sender.test.js
 *
 * sms-sender.js only exports send(). All guards and helpers are internal,
 * so we test them through the public send() entry point by mocking $db and $request.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { send } = require('../server/lib/sms-sender');

/**
 * Create a mock $db with configurable KV store data.
 * Tracks entity.create calls and $db.set calls.
 */
function createMockDb(kvData = {}) {
  const entityRecords = [];
  const setCalls = [];

  return {
    _kvData: kvData,
    _entityRecords: entityRecords,
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
    },
    entity: {
      create: async function (_entityName, record) {
        entityRecords.push(record);
      }
    }
  };
}

/**
 * Create a mock $request that returns a given API response.
 */
function createMockRequest(apiResponse) {
  const calls = [];
  return {
    _calls: calls,
    invokeTemplate: async function (templateName, options) {
      calls.push({ templateName, options });
      if (apiResponse instanceof Error) {
        throw apiResponse;
      }
      return { response: JSON.stringify(apiResponse) };
    }
  };
}

/** Default valid settings in the KV store */
function defaultSettings(overrides = {}) {
  return Object.assign({
    enabled: true,
    test_mode: true,
    debug: false,
    language: 'en',
    active_sender_id: 'KWT-SMS',
    schema_version: 1
  }, overrides);
}

/** Default valid gateway in the KV store */
function defaultGateway(overrides = {}) {
  return Object.assign({
    balance: 100,
    coverage: []
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
function fullKvData(settingsOvr, gatewayOvr) {
  return {
    kwtsms_settings: defaultSettings(settingsOvr),
    kwtsms_gateway: defaultGateway(gatewayOvr),
    kwtsms_stats: defaultStats()
  };
}

/** A standard successful kwtSMS API response */
const API_SUCCESS = {
  result: 'OK',
  'msg-id': 'MSG-12345',
  'balance-after': 99,
  description: 'Message sent'
};

/** A standard failed kwtSMS API response */
const API_FAILURE = {
  result: 'ERROR',
  code: 'ERR005',
  description: 'Invalid credentials'
};

// ---------------------------------------------------------------------------
// Guard chain tests
// ---------------------------------------------------------------------------

describe('send - guard: settings', () => {
  it('returns error when settings key is missing (plugin not initialized)', async () => {
    const db = createMockDb({ kwtsms_gateway: defaultGateway(), kwtsms_stats: defaultStats() });
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('not configured'));
  });

  it('returns error when plugin is disabled', async () => {
    const db = createMockDb(fullKvData({ enabled: false }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('not configured'));
  });

  it('returns error when balance is zero', async () => {
    const db = createMockDb(fullKvData({}, { balance: 0 }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('balance'));
  });

  it('returns error when balance is negative', async () => {
    const db = createMockDb(fullKvData({}, { balance: -5 }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: '', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('empty'));
  });

  it('returns error when message is only HTML tags (empty after cleaning)', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: '<p><br></p>', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('empty'));
  });

  it('returns error when message is only whitespace', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
      phones: [], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no valid recipients'));
  });

  it('returns error when all phones are invalid', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['abc', '12', ''], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no valid recipients'));
  });

  it('returns error when all phones are filtered by coverage', async () => {
    const db = createMockDb(fullKvData({}, { coverage: [966] }));
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('no valid recipients'));
  });
});

// ---------------------------------------------------------------------------
// Successful send tests
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

  it('calls $request.invokeTemplate with correct parameters', async () => {
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
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.test, '0');
  });

  it('uses custom sender_id from settings', async () => {
    const db = createMockDb(fullKvData({ active_sender_id: 'MYBRAND' }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.sender, 'MYBRAND');
  });

  it('normalizes phone numbers before sending', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['+965 9876 5432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432');
  });

  it('deduplicates phone numbers', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
      phones: ['96598765432', '96512345678'],
      message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432,96512345678');
  });

  it('filters phones by coverage when coverage is set', async () => {
    const db = createMockDb(fullKvData({}, { coverage: [965] }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
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
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_gateway.balance, 99);
  });

  it('updates stats counters after successful send', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_stats.total_sent, 1);
    assert.equal(db._kvData.kwtsms_stats.today_sent, 1);
    assert.equal(db._kvData.kwtsms_stats.month_sent, 1);
  });

  it('writes a log entry to entity store after successful send', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello World', eventType: 'ticket_created', ticketId: 42
    });
    assert.equal(db._entityRecords.length, 1);
    const entry = db._entityRecords[0];
    assert.equal(entry.event_type, 'ticket_created');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.ticket_id, 42);
    assert.equal(entry.msg_id, 'MSG-12345');
  });

  it('cleans HTML from message before sending', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: '<p>Hello <b>World</b></p>', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.message, 'Hello World');
  });
});

// ---------------------------------------------------------------------------
// Failed send tests
// ---------------------------------------------------------------------------

describe('send - failed send', () => {
  it('returns failure when API returns an error code', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Invalid credentials'));
  });

  it('updates failed stats counters on API error', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_stats.total_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.today_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.month_failed, 1);
    assert.equal(db._kvData.kwtsms_stats.total_sent, 0);
  });

  it('writes a failed log entry on API error', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._entityRecords.length, 1);
    assert.equal(db._entityRecords[0].status, 'failed');
    assert.equal(db._entityRecords[0].api_response_code, 'ERR005');
  });

  it('does not update cached balance on API error', async () => {
    const db = createMockDb(fullKvData({}, { balance: 100 }));
    const req = createMockRequest(API_FAILURE);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._kvData.kwtsms_gateway.balance, 100);
  });

  it('handles network errors from $request gracefully', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(new Error('Network timeout'));
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Network timeout'));
  });

  it('returns failure message with description when available', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest({ result: 'ERROR', code: 'ERR027', description: 'Message contains HTML' });
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Message contains HTML'));
  });

  it('returns failure with code when no description', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest({ result: 'ERROR', code: 'ERR999' });
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('ERR999'));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('send - edge cases', () => {
  it('skips invalid phones mixed with valid ones', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['invalid', '96598765432', 'abc', '96512345678'],
      message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.mobile, '96598765432,96512345678');
  });

  it('defaults sender to KWT-SMS when active_sender_id is empty', async () => {
    const db = createMockDb(fullKvData({ active_sender_id: '' }));
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    const body = JSON.parse(req._calls[0].options.body);
    assert.equal(body.sender, 'KWT-SMS');
  });

  it('handles missing coverage field in gateway gracefully', async () => {
    const db = createMockDb({
      kwtsms_settings: defaultSettings(),
      kwtsms_gateway: { balance: 100 },
      kwtsms_stats: defaultStats()
    });
    const req = createMockRequest(API_SUCCESS);
    const result = await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(result.success, true);
  });

  it('defaults ticketId to 0 in log entry when not provided', async () => {
    const db = createMockDb(fullKvData());
    const req = createMockRequest(API_SUCCESS);
    await send({
      $request: req, $db: db, credentials: {},
      phones: ['96598765432'], message: 'Hello', eventType: 'manual_send'
    });
    assert.equal(db._entityRecords[0].ticket_id, 0);
  });
});
