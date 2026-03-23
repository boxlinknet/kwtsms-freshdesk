/**
 * sms-sender.js - Core SMS sending with guard chain, batching, and logging
 * Related: server/server.js, server/lib/phone-utils.js, server/lib/message-utils.js,
 *          server/lib/template-engine.js, server/lib/logger.js, server/lib/constants.js
 *
 * Every send (automatic or manual) goes through the full guard chain:
 * enabled -> configured -> balance > 0 -> prepare message -> prepare recipients -> send -> log
 */

const { normalize, validate, deduplicate } = require('./phone-utils');
const { cleanMessage } = require('./message-utils');
const { logSmsResult, updateStats, debugLog, log } = require('./logger');
const { DS_KEYS, KWTSMS, DEFAULT_SETTINGS, SMS_EVENT } = require('./constants');

/**
 * Returns true if the last sync timestamp is older than 24 hours (or absent).
 */
function isCacheStale(lastSync) {
  if (!lastSync) return true;
  const age = Date.now() - new Date(lastSync).getTime();
  return age > 24 * 60 * 60 * 1000;
}

/**
 * Returns 'admin' for admin/test event types, 'customer' otherwise.
 */
function getRecipientType(eventType) {
  if (
    eventType === SMS_EVENT.ADMIN_NEW_TICKET ||
    eventType === SMS_EVENT.ADMIN_HIGH_PRIORITY ||
    eventType === SMS_EVENT.ADMIN_ESCALATION ||
    eventType === SMS_EVENT.GATEWAY_TEST
  ) {
    return 'admin';
  }
  return 'customer';
}

/**
 * Guard: check plugin is enabled and return settings, or return an error result.
 * Merges stored settings with DEFAULT_SETTINGS so all keys are always present.
 */
async function guardSettings($db) {
  let settings;
  try {
    const { data } = await $db.get(DS_KEYS.SETTINGS);
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
  } catch {
    log('Settings not found, plugin may not be initialized');
    return { error: { success: false, message: 'Plugin not configured' } };
  }
  if (!settings.enabled) {
    debugLog('Send skipped: plugin disabled', settings.debug);
    return { error: { success: false, message: 'SMS gateway is disabled' } };
  }
  return { settings };
}

/**
 * Guard: check gateway exists and has positive balance, or return an error result.
 * Refreshes balance from the API when the cached value is older than 24 hours.
 */
async function guardGateway($db, $request, credentials) {
  let gateway;
  try {
    const { data } = await $db.get(DS_KEYS.GATEWAY);
    gateway = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    log('Gateway data not found');
    return { error: { success: false, message: 'Gateway not configured. Click Sync Now in Settings.' } };
  }

  // Refresh balance from API if cache is stale (>24h)
  if (isCacheStale(gateway.last_sync) && credentials) {
    try {
      const credBody = JSON.stringify(credentials);
      const balanceResp = await $request.invokeTemplate('checkBalance', { body: credBody });
      const balance = JSON.parse(balanceResp.response);
      gateway.balance = balance.available || 0;
      gateway.last_sync = new Date().toISOString();
      await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });
      log('Balance refreshed from API: ' + gateway.balance);
    } catch (err) {
      debugLog('Balance refresh failed, using cached value: ' + (err.message || ''), true);
    }
  }

  if (!gateway.balance || gateway.balance <= 0) {
    log('Send skipped: zero balance');
    return { error: { success: false, message: 'Insufficient balance. Recharge at kwtsms.com' } };
  }
  return { gateway };
}

/**
 * Prepare recipients: normalize, optionally prepend country code, validate,
 * filter by coverage, deduplicate.
 */
function prepareRecipients(phones, coverage, debug, defaultCountryCode) {
  const normalized = phones.map(normalize).map(function(phone) {
    // Prepend default country code to short local numbers (less than 10 digits)
    if (phone && phone.length > 0 && phone.length < 10 && defaultCountryCode) {
      return String(defaultCountryCode) + phone;
    }
    return phone;
  }).filter(validate);

  const covered = normalized.filter((phone) => {
    if (coverage.length === 0) return true;
    const isCovered = coverage.some((c) => phone.startsWith(String(c)));
    if (!isCovered) {
      debugLog(`Phone ${phone.substring(0, 6)}*** skipped: country not in coverage`, debug);
    }
    return isCovered;
  });

  return deduplicate(covered);
}

/**
 * Update the cached gateway balance after a successful send.
 */
async function updateCachedBalance($db, result, gateway, debug) {
  if (result['balance-after'] === undefined) return;
  try {
    gateway.balance = result['balance-after'];
    await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });
  } catch (err) {
    debugLog('Failed to update cached balance: ' + err.message, debug);
  }
}

/**
 * Build a log entry object from send result details.
 */
function buildLogEntry(eventType, recipients, cleanedMessage, success, result, ticketId) {
  return {
    event_type: eventType,
    recipient_type: getRecipientType(eventType),
    recipient_phone: recipients.join(','),
    message_preview: cleanedMessage,
    status: success ? 'sent' : 'failed',
    api_response_code: result.code || result.result || '',
    error_message: success ? '' : (result.description || result.message || result.code || ''),
    ticket_id: ticketId || 0,
    msg_id: result['msg-id'] || ''
  };
}

/**
 * Build the failure message string from an API result.
 */
function buildFailureMessage(result) {
  return `Send failed: ${result.description || result.code || 'Unknown error'}`;
}

/**
 * Format a success or failure response from a send result.
 */
function formatSendResponse(success, result, recipients, eventType) {
  if (success) {
    log(`SMS sent: ${recipients.length} recipient(s), event=${eventType}, msg-id=${result['msg-id'] || 'n/a'}`);
    return { success: true, message: 'Sent successfully' };
  }
  log(`SMS failed: ${result.code || 'unknown'} - ${result.description || result.message || ''}`);
  return { success: false, message: buildFailureMessage(result) };
}

/**
 * Handle post-send: update balance cache, log result, update stats.
 */
async function handleSendResult($db, result, gateway, settings, recipients, eventType, ticketId, cleanedMessage) {
  const success = result.result === 'OK';

  if (success) {
    await updateCachedBalance($db, result, gateway, settings.debug);
  }

  await logSmsResult($db, buildLogEntry(eventType, recipients, cleanedMessage, success, result, ticketId));
  await updateStats($db, success);

  return formatSendResponse(success, result, recipients, eventType);
}

/**
 * Dispatch the actual send call (single batch or bulk).
 */
function _dispatch($request, credentials, recipients, cleanedMessage, settings) {
  const testFlag = settings.test_mode ? '1' : '0';
  const sender = settings.active_sender_id || 'KWT-SMS';
  debugLog(`Sending to ${recipients.length} recipient(s), test=${testFlag}`, settings.debug);

  if (recipients.length <= KWTSMS.MAX_BATCH_SIZE) {
    return _sendBatch($request, credentials, recipients.join(','), cleanedMessage, sender, testFlag);
  }
  return _sendBulk($request, credentials, recipients, cleanedMessage, sender, testFlag, settings.debug);
}

/**
 * Send SMS through the full guard chain.
 *
 * @param {Object} params
 * @param {Object} params.$request - FDK request API
 * @param {Object} params.$db - FDK data storage
 * @param {string[]} params.phones - Raw phone numbers (will be normalized)
 * @param {string} params.message - Raw message text (will be cleaned)
 * @param {Object} params.credentials - kwtSMS API credentials
 * @param {string} params.eventType - SMS_EVENT constant for logging
 * @param {number} [params.ticketId] - Ticket ID for logging
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function send(params) {
  const { $request, $db, credentials, message, eventType, ticketId } = params;

  // 0. Flatten phones: split any comma-separated strings, trim, filter empty
  const phones = [].concat(params.phones || []).reduce(function(acc, p) {
    String(p).split(',').forEach(function(s) { const t = s.trim(); if (t) acc.push(t); });
    return acc;
  }, []);

  if (phones.length === 0) {
    return { success: false, message: 'No phone numbers provided' };
  }

  // 1. Check SMS is enabled
  const settingsGuard = await guardSettings($db);
  if (settingsGuard.error) return settingsGuard.error;
  const settings = settingsGuard.settings;

  // 2. Check gateway + balance (refreshes from API if cache >24h)
  const gatewayGuard = await guardGateway($db, $request, credentials);
  if (gatewayGuard.error) return gatewayGuard.error;
  const gateway = gatewayGuard.gateway;

  // 3. Clean message
  const cleanedMessage = cleanMessage(message);
  if (!cleanedMessage) {
    log('Send skipped: empty message after cleaning');
    return { success: false, message: 'Message is empty after cleaning' };
  }

  // 4. Normalize, validate, deduplicate, filter by coverage
  const inputCount = phones.length;
  const recipients = prepareRecipients(phones, gateway.coverage || [], settings.debug, settings.default_country_code);
  if (recipients.length === 0) {
    const dropped = inputCount - recipients.length;
    log('Send skipped: no valid recipients (' + dropped + ' number(s) failed validation or coverage)');
    return { success: false, message: 'No valid recipients. Check phone format and country coverage.' };
  }

  // 5. Send (auto-chunks at 200)
  const result = await _dispatch($request, credentials, recipients, cleanedMessage, settings);

  // 6. Log, update balance, return result
  return handleSendResult($db, result, gateway, settings, recipients, eventType, ticketId, cleanedMessage);
}

/**
 * Send a single batch (up to 200 numbers).
 * @returns {Promise<Object>} kwtSMS API response
 */
async function _sendBatch($request, credentials, mobile, message, sender, test) {
  try {
    const response = await $request.invokeTemplate('sendSms', {
      body: JSON.stringify({
        ...credentials,
        sender: sender,
        mobile: mobile,
        message: message,
        test: test
      })
    });
    return JSON.parse(response.response);
  } catch (err) {
    // FDK may throw with the response body inside the error
    if (err && err.response) {
      try { return JSON.parse(err.response); } catch { /* fall through */ }
    }
    if (err && err.message) {
      try { const parsed = JSON.parse(err.message); if (parsed.result) return parsed; } catch { /* fall through */ }
    }
    return { result: 'ERROR', code: 'ERR', description: (err && err.message) || String(err) };
  }
}

/**
 * Send to >200 numbers by chunking with delays and ERR013 backoff.
 */
async function _sendBulk($request, credentials, recipients, message, sender, test, debug) {
  let lastResult = { result: 'ERROR', description: 'No batches sent' };

  for (let i = 0; i < recipients.length; i += KWTSMS.MAX_BATCH_SIZE) {
    const batch = recipients.slice(i, i + KWTSMS.MAX_BATCH_SIZE);

    if (i > 0) {
      await sleep(KWTSMS.BATCH_DELAY_MS);
    }

    let attempt = 0;
    while (attempt <= KWTSMS.MAX_RETRIES) {
      const result = await _sendBatch($request, credentials, batch.join(','), message, sender, test);

      if (result.code === 'ERR013' && attempt < KWTSMS.MAX_RETRIES) {
        debugLog(`ERR013 queue full, backing off ${KWTSMS.ERR013_BACKOFF_MS[attempt]}ms`, debug);
        await sleep(KWTSMS.ERR013_BACKOFF_MS[attempt]);
        attempt++;
      } else {
        lastResult = result;
        break;
      }
    }
  }

  return lastResult;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  send,
  getRecipientType,
  isCacheStale,
  guardSettings,
  guardGateway,
  prepareRecipients,
  buildLogEntry
};
