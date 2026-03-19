/**
 * server.js - kwtSMS Freshdesk serverless app (consolidated single file)
 *
 * All code is inlined here for FDK sandbox compatibility.
 * The lib/ files remain for unit testing but are NOT imported here.
 * ZERO require() statements. Uses exports = {} pattern for FDK.
 *
 * CRITICAL: All handlers are defined INLINE in the exports object using
 * handlerName: async function(args) { ... } syntax. This is the only
 * pattern the FDK validator recognizes.
 */

// ======================================================================
// CONSTANTS
// ======================================================================

// Freshdesk ticket status codes
const TICKET_STATUS = {
  OPEN: 2,
  PENDING: 3,
  RESOLVED: 4,
  CLOSED: 5
};

// Freshdesk ticket priority codes
const TICKET_PRIORITY = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4
};

// Data Storage key names (KV Store)
const DS_KEYS = {
  SETTINGS: 'kwtsms_settings',
  GATEWAY: 'kwtsms_gateway',
  TEMPLATES: 'kwtsms_templates',
  ADMIN_ALERTS: 'kwtsms_admin_alerts',
  STATS: 'kwtsms_stats'
};

// Entity Store entity name
const ENTITY = {
  SMS_LOG: 'sms_log'
};

// SMS event types (used in templates and logs)
const SMS_EVENT = {
  TICKET_CREATED: 'ticket_created',
  STATUS_CHANGED: 'status_changed',
  AGENT_REPLY: 'agent_reply',
  ADMIN_NEW_TICKET: 'admin_new_ticket',
  ADMIN_HIGH_PRIORITY: 'admin_high_priority',
  ADMIN_ESCALATION: 'admin_escalation',
  MANUAL_SEND: 'manual_send'
};

// Default settings (written on app install)
const DEFAULT_SETTINGS = {
  enabled: false,
  test_mode: true,
  debug: false,
  language: 'en',
  active_sender_id: 'KWT-SMS',
  schema_version: 1
};

// Default admin alerts config
const DEFAULT_ADMIN_ALERTS = {
  phones: [],
  events: {
    new_ticket: true,
    high_priority: true,
    escalation: true
  }
};

// Default stats
const DEFAULT_STATS = {
  total_sent: 0,
  total_failed: 0,
  today_sent: 0,
  today_failed: 0,
  month_sent: 0,
  month_failed: 0,
  last_reset_date: '',
  last_reset_month: ''
};

// kwtSMS API constants
const KWTSMS = {
  MAX_BATCH_SIZE: 200,
  BATCH_DELAY_MS: 500,
  ERR013_BACKOFF_MS: [30000, 60000, 120000],
  MAX_RETRIES: 3,
  GSM7_PAGE_SIZE: 160,
  GSM7_MULTIPAGE_SIZE: 153,
  UNICODE_PAGE_SIZE: 70,
  UNICODE_MULTIPAGE_SIZE: 67,
  MAX_PAGES: 7
};

// kwtSMS error codes that should not be retried
const NON_RETRYABLE_ERRORS = [
  'ERR001', 'ERR002', 'ERR003', 'ERR004', 'ERR005',
  'ERR006', 'ERR007', 'ERR008', 'ERR009', 'ERR010',
  'ERR011', 'ERR012', 'ERR024', 'ERR025', 'ERR026',
  'ERR027', 'ERR028', 'ERR031', 'ERR032'
];

// Status labels for Freshdesk statuses (used in template replacement)
const STATUS_LABELS = {
  en: { 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' },
  ar: { 2: '\u0645\u0641\u062a\u0648\u062d\u0629', 3: '\u0645\u0639\u0644\u0642\u0629', 4: '\u062a\u0645 \u0627\u0644\u062d\u0644', 5: '\u0645\u063a\u0644\u0642\u0629' }
};

// Priority labels
const PRIORITY_LABELS = {
  en: { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' },
  ar: { 1: '\u0645\u0646\u062e\u0641\u0636\u0629', 2: '\u0645\u062a\u0648\u0633\u0637\u0629', 3: '\u0639\u0627\u0644\u064a\u0629', 4: '\u0639\u0627\u062c\u0644\u0629' }
};

// ======================================================================
// PHONE UTILS
// ======================================================================

// Arabic-Indic and Extended Arabic-Indic digit mapping
const ARABIC_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
const EXTENDED_DIGITS = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';

/**
 * Normalize a phone number to kwtSMS-accepted format (digits only).
 * Strips all non-digit chars, converts Arabic digits, strips leading zeros.
 */
function normalize(phone) {
  if (!phone) return '';
  let result = String(phone);

  // Convert Arabic-Indic digits to Latin
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(ARABIC_DIGITS[i], 'g'), String(i));
    result = result.replace(new RegExp(EXTENDED_DIGITS[i], 'g'), String(i));
  }

  // Strip all non-digit characters
  result = result.replace(/\D/g, '');

  // Strip leading zeros (handles 00 prefix like 0096598765432)
  result = result.replace(/^0+/, '');

  return result;
}

/**
 * Validate a normalized phone number.
 * Must be 7-15 digits (ITU-T E.164 range).
 */
function validate(phone) {
  if (!phone) return false;
  return /^\d{7,15}$/.test(phone);
}

/**
 * Remove duplicate phone numbers from an array.
 * Preserves order (first occurrence kept).
 */
function deduplicate(phones) {
  return [...new Set(phones)];
}

// ======================================================================
// MESSAGE UTILS
// ======================================================================

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&#39;': "'", '&nbsp;': ' '
};

/**
 * Clean a message for SMS sending.
 * 1. Strip HTML tags
 * 2. Decode HTML entities
 * 3. Convert Arabic/Hindi digits to Latin
 * 4. Strip emoji
 * 5. Strip zero-width and hidden Unicode characters
 * 6. Trim whitespace
 */
function cleanMessage(message) {
  if (!message) return '';
  let text = String(message);

  // 1. Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // 2. Decode named HTML entities
  text = text.replace(/&[a-zA-Z]+;/g, (match) => HTML_ENTITIES[match] || match);
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // 3. Convert Arabic-Indic digits to Latin
  for (let i = 0; i < 10; i++) {
    text = text.replace(new RegExp(ARABIC_DIGITS[i], 'g'), String(i));
    text = text.replace(new RegExp(EXTENDED_DIGITS[i], 'g'), String(i));
  }

  // 4. Strip emoji
  text = text.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
  text = text.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
  text = text.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
  text = text.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
  text = text.replace(/[\u{2600}-\u{26FF}]/gu, '');
  text = text.replace(/[\u{2700}-\u{27BF}]/gu, '');
  text = text.replace(/[\u{FE00}-\u{FE0F}]/gu, '');
  text = text.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
  text = text.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '');
  text = text.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '');
  text = text.replace(/[\u{200D}]/gu, '');

  // 5. Strip zero-width and hidden Unicode characters
  text = text.replace(/[\u200B\u200C\u200E\u200F]/g, '');
  text = text.replace(/[\uFEFF]/g, '');
  text = text.replace(/[\u00AD]/g, '');
  text = text.replace(/[\u2028\u2029]/g, '');
  text = text.replace(/[\u202A-\u202E]/g, '');

  // 6. Trim whitespace
  text = text.trim();

  return text;
}

/**
 * GSM-7 basic charset + extended charset as a string for indexOf lookup.
 * Avoids regex with unnecessary escapes that trigger linter warnings.
 */
const GSM7_ALL = '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E'
  + ' \u00C6\u00E6\u00DF\u00C9!"#\u00A4%&\'()*+,-./0123456789:;<=>?'
  + '\u00A1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00C4\u00D6\u00D1\u00DC\u00A7\u00BFabcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0'
  + '\f^{}[]~|\\' + '\u20AC';

/**
 * Detect if text contains non-GSM7 characters (requires Unicode encoding).
 */
function isUnicode(text) {
  for (let i = 0; i < text.length; i++) {
    if (GSM7_ALL.indexOf(text[i]) === -1) return true;
  }
  return false;
}

/**
 * Calculate how many SMS parts a message will use.
 */
function calculateSmsParts(text) {
  if (!text) return { chars: 0, parts: 0, isUnicode: false };

  const unicode = isUnicode(text);
  const chars = text.length;

  let parts;
  if (unicode) {
    if (chars <= 70) parts = 1;
    else parts = Math.ceil(chars / 67);
  } else {
    if (chars <= 160) parts = 1;
    else parts = Math.ceil(chars / 153);
  }

  return { chars, parts, isUnicode: unicode };
}

// ======================================================================
// TEMPLATE ENGINE
// ======================================================================

/**
 * Replace {{placeholder}} tokens in a template string.
 * Unknown placeholders are replaced with empty string.
 */
function replacePlaceholders(template, data) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key];
    return (value !== null && value !== undefined) ? String(value) : '';
  });
}

/**
 * Resolve a template for a given event type, language, and data.
 * Falls back to English if the requested language is unavailable.
 */
function resolveTemplate(templates, eventType, language, data) {
  const eventTemplates = templates[eventType];
  if (!eventTemplates) return '';
  const template = eventTemplates[language] || eventTemplates['en'] || '';
  return replacePlaceholders(template, data);
}

/**
 * Resolve a status code to a localized label.
 */
function resolveStatusLabel(statusCode, language) {
  return (STATUS_LABELS[language] || STATUS_LABELS.en)[statusCode] || '';
}

/**
 * Resolve a priority code to a localized label.
 */
function resolvePriorityLabel(priorityCode, language) {
  return (PRIORITY_LABELS[language] || PRIORITY_LABELS.en)[priorityCode] || '';
}

/**
 * Build placeholder data object from a Freshdesk event payload.
 */
function buildPlaceholderData(payload, companyName, language) {
  const ticket = payload.data?.ticket || {};
  const requester = payload.data?.requester || {};

  return {
    ticket_id: ticket.id || '',
    ticket_subject: ticket.subject || '',
    ticket_status: resolveStatusLabel(ticket.status, language),
    ticket_priority: resolvePriorityLabel(ticket.priority, language),
    requester_name: requester.name || '',
    requester_phone: requester.phone || '',
    requester_email: requester.email || '',
    agent_name: ticket.responder_name || '',
    group_name: ticket.group_name || '',
    company_name: companyName || ''
  };
}

// ======================================================================
// LOGGER
// ======================================================================

/**
 * Log an SMS send result to Entity Store.
 * Non-fatal: catches and console.error on failure.
 */
async function logSmsResult($db, entry) {
  try {
    await $db.entity.create(ENTITY.SMS_LOG, {
      timestamp: new Date().toISOString(),
      event_type: entry.event_type,
      recipient_phone: entry.recipient_phone,
      message_preview: (entry.message_preview || '').substring(0, 80),
      status: entry.status,
      api_response_code: entry.api_response_code || '',
      ticket_id: entry.ticket_id || 0,
      msg_id: entry.msg_id || ''
    });
  } catch (err) {
    console.error('[kwtsms] Failed to write log entry:', err.message);
  }
}

/**
 * Increment stats counters after a send attempt.
 * Non-fatal: catches errors silently.
 */
async function updateStats($db, success) {
  try {
    const { data: stats } = await $db.get(DS_KEYS.STATS);
    const parsed = typeof stats === 'string' ? JSON.parse(stats) : stats;

    if (success) {
      parsed.total_sent++;
      parsed.today_sent++;
      parsed.month_sent++;
    } else {
      parsed.total_failed++;
      parsed.today_failed++;
      parsed.month_failed++;
    }

    await $db.set(DS_KEYS.STATS, { data: JSON.stringify(parsed) });
  } catch (err) {
    console.error('[kwtsms] Failed to update stats:', err.message);
  }
}

/**
 * Reset daily and monthly counters. Called by the scheduled cron handler.
 */
async function resetCounters($db) {
  try {
    const { data: stats } = await $db.get(DS_KEYS.STATS);
    const parsed = typeof stats === 'string' ? JSON.parse(stats) : stats;
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);

    if (parsed.last_reset_date !== today) {
      parsed.today_sent = 0;
      parsed.today_failed = 0;
      parsed.last_reset_date = today;
    }

    if (parsed.last_reset_month !== month) {
      parsed.month_sent = 0;
      parsed.month_failed = 0;
      parsed.last_reset_month = month;
    }

    await $db.set(DS_KEYS.STATS, { data: JSON.stringify(parsed) });
  } catch (err) {
    console.error('[kwtsms] Failed to reset counters:', err.message);
  }
}

/**
 * Log a debug message (only if debug mode is enabled).
 */
function debugLog(message, debugEnabled) {
  if (debugEnabled) {
    console.log('[kwtsms:debug]', message);
  }
}

/**
 * Standard operational message (always logged).
 */
function log(message) {
  console.log('[kwtsms]', message);
}

// ======================================================================
// SMS SENDER
// ======================================================================

/**
 * Guard: check plugin is enabled and return settings, or return an error result.
 */
async function guardSettings($db) {
  let settings;
  try {
    const { data } = await $db.get(DS_KEYS.SETTINGS);
    settings = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
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
 */
async function guardGateway($db) {
  let gateway;
  try {
    const { data } = await $db.get(DS_KEYS.GATEWAY);
    gateway = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
    log('Gateway data not found');
    return { error: { success: false, message: 'Gateway not configured' } };
  }
  if (!gateway.balance || gateway.balance <= 0) {
    log('Send skipped: zero balance');
    return { error: { success: false, message: 'Insufficient balance' } };
  }
  return { gateway };
}

/**
 * Prepare recipients: normalize, validate, filter by coverage, deduplicate.
 */
function prepareRecipients(phones, coverage, debug) {
  const normalized = phones.map(normalize).filter(validate);
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
 * Handle post-send: update balance cache, log result, update stats.
 */
async function handleSendResult($db, result, gateway, settings, recipients, eventType, ticketId, cleanedMessage) {
  const success = result.result === 'OK';

  if (success && result['balance-after'] !== undefined) {
    try {
      gateway.balance = result['balance-after'];
      await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });
    } catch (err) {
      debugLog('Failed to update cached balance: ' + err.message, settings.debug);
    }
  }

  await logSmsResult($db, {
    event_type: eventType,
    recipient_phone: recipients.join(','),
    message_preview: cleanedMessage,
    status: success ? 'sent' : 'failed',
    api_response_code: result.code || result.result || '',
    ticket_id: ticketId || 0,
    msg_id: result['msg-id'] || ''
  });

  await updateStats($db, success);

  if (success) {
    log(`SMS sent: ${recipients.length} recipient(s), event=${eventType}, msg-id=${result['msg-id'] || 'n/a'}`);
    return { success: true, message: 'Sent successfully' };
  }
  log(`SMS failed: ${result.code || 'unknown'} - ${result.description || result.message || ''}`);
  return { success: false, message: `Send failed: ${result.description || result.code || 'Unknown error'}` };
}

/**
 * Send SMS through the full guard chain.
 */
async function send(params) {
  const { $request, $db, credentials, phones, message, eventType, ticketId } = params;

  const settingsGuard = await guardSettings($db);
  if (settingsGuard.error) return settingsGuard.error;
  const settings = settingsGuard.settings;

  const gatewayGuard = await guardGateway($db);
  if (gatewayGuard.error) return gatewayGuard.error;
  const gateway = gatewayGuard.gateway;

  const cleanedMessage = cleanMessage(message);
  if (!cleanedMessage) {
    log('Send skipped: empty message after cleaning');
    return { success: false, message: 'Message is empty after cleaning' };
  }

  const recipients = prepareRecipients(phones, gateway.coverage || [], settings.debug);
  if (recipients.length === 0) {
    log('Send skipped: no valid recipients after filtering');
    return { success: false, message: 'No valid recipients' };
  }

  const testFlag = settings.test_mode ? '1' : '0';
  const sender = settings.active_sender_id || 'KWT-SMS';
  debugLog(`Sending to ${recipients.length} recipient(s), test=${testFlag}`, settings.debug);

  let result;
  if (recipients.length <= KWTSMS.MAX_BATCH_SIZE) {
    result = await sendBatch($request, credentials, recipients.join(','), cleanedMessage, sender, testFlag);
  } else {
    result = await bulkSend($request, credentials, recipients, cleanedMessage, sender, testFlag, settings.debug);
  }

  return handleSendResult($db, result, gateway, settings, recipients, eventType, ticketId, cleanedMessage);
}

/**
 * Send a single batch (up to 200 numbers).
 */
async function sendBatch($request, credentials, mobile, message, sender, test) {
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
    console.error('[kwtsms] API call failed:', err.message);
    return { result: 'ERROR', code: 'NETWORK', description: err.message };
  }
}

/**
 * Send to >200 numbers by chunking with delays and ERR013 backoff.
 */
async function bulkSend($request, credentials, recipients, message, sender, test, debug) {
  let lastResult = { result: 'ERROR', description: 'No batches sent' };

  for (let i = 0; i < recipients.length; i += KWTSMS.MAX_BATCH_SIZE) {
    const batch = recipients.slice(i, i + KWTSMS.MAX_BATCH_SIZE);

    if (i > 0) {
      await sleep(KWTSMS.BATCH_DELAY_MS);
    }

    let attempt = 0;
    while (attempt <= KWTSMS.MAX_RETRIES) {
      const result = await sendBatch($request, credentials, batch.join(','), message, sender, test);

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

// ======================================================================
// HELPERS: Credentials, Settings, Templates, Admin Alerts, Company Name
// ======================================================================

async function getCredentials(args) {
  const iparams = await args.iparams.get('kwtsms_username', 'kwtsms_password');
  return { username: iparams.kwtsms_username, password: iparams.kwtsms_password };
}

async function loadSettings($db) {
  try {
    const { data } = await $db.get(DS_KEYS.SETTINGS);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return null; }
}

async function loadTemplates($db) {
  try {
    const { data } = await $db.get(DS_KEYS.TEMPLATES);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return {}; }
}

async function loadAdminAlerts($db) {
  try {
    const { data } = await $db.get(DS_KEYS.ADMIN_ALERTS);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return DEFAULT_ADMIN_ALERTS; }
}

async function getCompanyName(args) {
  try {
    const iparams = await args.iparams.get('kwtsms_company_name');
    return iparams.kwtsms_company_name || '';
  } catch (e) { return ''; }
}

// ======================================================================
// HANDLER HELPERS (reduce cyclomatic complexity of exports)
// ======================================================================

async function sendCustomerTicketCreated(ctx, payload, templates, settings, placeholders, ticketId) {
  const customerPhone = payload.requester?.phone;
  if (!customerPhone) return;
  const message = resolveTemplate(templates, SMS_EVENT.TICKET_CREATED, settings.language, placeholders);
  if (!message) return;
  await send({ ...ctx, phones: [customerPhone], message, eventType: SMS_EVENT.TICKET_CREATED, ticketId });
}

async function sendAdminNewTicket(ctx, $db, templates, settings, placeholders, ticketId) {
  const adminAlerts = await loadAdminAlerts($db);
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.new_ticket) return;
  const adminMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_NEW_TICKET, settings.language, placeholders);
  if (!adminMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: adminMsg, eventType: SMS_EVENT.ADMIN_NEW_TICKET, ticketId });
}

async function sendAdminHighPriority(ctx, $db, payload, templates, settings, placeholders, ticketId) {
  const priority = payload.ticket?.priority;
  if (!priority || priority < TICKET_PRIORITY.HIGH) return;
  const adminAlerts = await loadAdminAlerts($db);
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.high_priority) return;
  const highMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_HIGH_PRIORITY, settings.language, placeholders);
  if (!highMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: highMsg, eventType: SMS_EVENT.ADMIN_HIGH_PRIORITY, ticketId });
}

async function sendStatusChanged(ctx, payload, changes, templates, settings, placeholders, ticketId) {
  if (!changes.status) return;
  const newStatus = Array.isArray(changes.status) ? changes.status[1] : changes.status;
  if (newStatus !== TICKET_STATUS.RESOLVED && newStatus !== TICKET_STATUS.CLOSED) return;
  const customerPhone = payload.requester?.phone;
  if (!customerPhone) return;
  const message = resolveTemplate(templates, SMS_EVENT.STATUS_CHANGED, settings.language, placeholders);
  if (!message) return;
  await send({ ...ctx, phones: [customerPhone], message, eventType: SMS_EVENT.STATUS_CHANGED, ticketId });
}

async function sendEscalationAlert(ctx, $db, changes, templates, settings, placeholders, ticketId) {
  if (!changes.priority) return;
  const oldPriority = Array.isArray(changes.priority) ? changes.priority[0] : null;
  const newPriority = Array.isArray(changes.priority) ? changes.priority[1] : changes.priority;
  if (!oldPriority || oldPriority > TICKET_PRIORITY.MEDIUM || newPriority < TICKET_PRIORITY.HIGH) return;
  const adminAlerts = await loadAdminAlerts($db);
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.escalation) return;
  const escalMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_ESCALATION, settings.language, placeholders);
  if (!escalMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: escalMsg, eventType: SMS_EVENT.ADMIN_ESCALATION, ticketId });
}

// ======================================================================
// EXPORTS (FDK serverless pattern - inline function syntax)
// ======================================================================

exports = {
  onTicketCreateHandler: async function(args) {
    const { data: payload } = args;
    const $db = args.$db;
    const $request = args.$request;

    const settings = await loadSettings($db);
    if (!settings || !settings.enabled) return;

    const credentials = await getCredentials(args);
    const templates = await loadTemplates($db);
    const companyName = await getCompanyName(args);
    const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);
    const ticketIdVal = payload.ticket?.id;
    const sendCtx = { $request, $db, credentials };

    await sendCustomerTicketCreated(sendCtx, payload, templates, settings, placeholders, ticketIdVal);
    await sendAdminNewTicket(sendCtx, $db, templates, settings, placeholders, ticketIdVal);
    await sendAdminHighPriority(sendCtx, $db, payload, templates, settings, placeholders, ticketIdVal);
  },

  onTicketUpdateHandler: async function(args) {
    const { data: payload } = args;
    const $db = args.$db;
    const $request = args.$request;
    const changes = payload.changes || {};

    const settings = await loadSettings($db);
    if (!settings || !settings.enabled) return;

    const credentials = await getCredentials(args);
    const templates = await loadTemplates($db);
    const companyName = await getCompanyName(args);
    const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);
    const ticketIdVal = payload.ticket?.id;
    const sendCtx = { $request, $db, credentials };

    await sendStatusChanged(sendCtx, payload, changes, templates, settings, placeholders, ticketIdVal);
    await sendEscalationAlert(sendCtx, $db, changes, templates, settings, placeholders, ticketIdVal);
  },

  onConversationCreateHandler: async function(args) {
    const { data: payload } = args;
    const conversation = payload.conversation || {};

    // Only send on public agent replies (not private notes, not customer messages, not forwards)
    if (conversation.incoming !== false) return;
    if (conversation.private !== false) return;

    const $db = args.$db;
    const settings = await loadSettings($db);
    if (!settings || !settings.enabled) return;

    const customerPhone = payload.requester?.phone;
    if (!customerPhone) return;

    const credentials = await getCredentials(args);
    const templates = await loadTemplates($db);
    const companyName = await getCompanyName(args);
    const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);
    const message = resolveTemplate(templates, SMS_EVENT.AGENT_REPLY, settings.language, placeholders);
    if (!message) return;

    await send({
      $request: args.$request, $db, credentials,
      phones: [customerPhone],
      message,
      eventType: SMS_EVENT.AGENT_REPLY,
      ticketId: payload.ticket?.id
    });
  },

  onScheduledEventHandler: async function(args) {
    const $db = args.$db;
    const $request = args.$request;

    // Future-proofing: check event type
    const eventType = args.data?.type || 'daily_sync';
    if (eventType !== 'daily_sync') {
      log('Unknown scheduled event type: ' + eventType);
      return;
    }

    log('Running daily sync...');

    try {
      const creds = await getCredentials(args);
      const credBody = JSON.stringify(creds);

      const balanceResp = await $request.invokeTemplate('checkBalance', { body: credBody });
      const balance = JSON.parse(balanceResp.response);

      const senderResp = await $request.invokeTemplate('getSenderIds', { body: credBody });
      const senders = JSON.parse(senderResp.response);

      const coverageResp = await $request.invokeTemplate('getCoverage', { body: credBody });
      const coverage = JSON.parse(coverageResp.response);

      const gateway = {
        balance: balance.available || 0,
        senderids: senders.senderid || [],
        coverage: coverage.coverage || [],
        last_sync: new Date().toISOString()
      };
      await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });

      // Reset daily/monthly stats counters
      await resetCounters($db);

      log('Daily sync complete. Balance: ' + gateway.balance +
          ', SenderIDs: ' + gateway.senderids.length +
          ', Coverage: ' + gateway.coverage.length + ' countries');
    } catch (err) {
      console.error('[kwtsms] Daily sync failed:', err.message);
    }
  },

  onAppInstallHandler: async function(args) {
    const $db = args.$db;
    const $request = args.$request;
    const $schedule = args.$schedule;

    log('App installed. Initializing...');

    try {
      // Initial sync
      const creds = await getCredentials(args);
      const credBody = JSON.stringify(creds);

      const balanceResp = await $request.invokeTemplate('checkBalance', { body: credBody });
      const balance = JSON.parse(balanceResp.response);

      const senderResp = await $request.invokeTemplate('getSenderIds', { body: credBody });
      const senders = JSON.parse(senderResp.response);

      const coverageResp = await $request.invokeTemplate('getCoverage', { body: credBody });
      const coverage = JSON.parse(coverageResp.response);

      await $db.set(DS_KEYS.GATEWAY, {
        data: JSON.stringify({
          balance: balance.available || 0,
          senderids: senders.senderid || [],
          coverage: coverage.coverage || [],
          last_sync: new Date().toISOString()
        })
      });

      // Initialize settings (enabled=false for safety)
      await $db.set(DS_KEYS.SETTINGS, { data: JSON.stringify(DEFAULT_SETTINGS) });

      // Initialize default templates
      const defaultTemplates = {
        ticket_created: {
          en: "Your support ticket #{{ticket_id}} has been created. Subject: {{ticket_subject}}. We'll get back to you soon. - {{company_name}}",
          ar: "\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u062f\u0639\u0645 \u0631\u0642\u0645 #{{ticket_id}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0633\u0646\u0639\u0648\u062f \u0625\u0644\u064a\u0643 \u0642\u0631\u064a\u0628\u0627. - {{company_name}}"
        },
        status_changed: {
          en: "Your ticket #{{ticket_id}} status has been updated to: {{ticket_status}}. Subject: {{ticket_subject}}. - {{company_name}}",
          ar: "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u062d\u0627\u0644\u0629 \u062a\u0630\u0643\u0631\u062a\u0643 \u0631\u0642\u0645 #{{ticket_id}} \u0625\u0644\u0649: {{ticket_status}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. - {{company_name}}"
        },
        agent_reply: {
          en: "New reply on your ticket #{{ticket_id}} from {{agent_name}}. Subject: {{ticket_subject}}. Please check your email for details. - {{company_name}}",
          ar: "\u0631\u062f \u062c\u062f\u064a\u062f \u0639\u0644\u0649 \u062a\u0630\u0643\u0631\u062a\u0643 \u0631\u0642\u0645 #{{ticket_id}} \u0645\u0646 {{agent_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0628\u0631\u064a\u062f\u0643 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a. - {{company_name}}"
        },
        admin_new_ticket: {
          en: "New ticket #{{ticket_id}} from {{requester_name}}. Subject: {{ticket_subject}}. Priority: {{ticket_priority}}.",
          ar: "\u062a\u0630\u0643\u0631\u0629 \u062c\u062f\u064a\u062f\u0629 #{{ticket_id}} \u0645\u0646 {{requester_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629: {{ticket_priority}}."
        },
        admin_high_priority: {
          en: "New HIGH PRIORITY ticket #{{ticket_id}} from {{requester_name}}. Subject: {{ticket_subject}}. Priority: {{ticket_priority}}.",
          ar: "\u062a\u0630\u0643\u0631\u0629 \u062c\u062f\u064a\u062f\u0629 \u0639\u0627\u0644\u064a\u0629 \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629 #{{ticket_id}} \u0645\u0646 {{requester_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629: {{ticket_priority}}."
        },
        admin_escalation: {
          en: "ALERT: Ticket #{{ticket_id}} escalated to {{ticket_priority}}. Subject: {{ticket_subject}}. Assigned to: {{agent_name}}.",
          ar: "\u062a\u0646\u0628\u064a\u0647: \u062a\u0645 \u062a\u0635\u0639\u064a\u062f \u0627\u0644\u062a\u0630\u0643\u0631\u0629 #{{ticket_id}} \u0625\u0644\u0649 {{ticket_priority}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0645\u0633\u0646\u062f\u0629 \u0625\u0644\u0649: {{agent_name}}."
        }
      };
      await $db.set(DS_KEYS.TEMPLATES, { data: JSON.stringify(defaultTemplates) });

      // Initialize admin alerts and stats
      await $db.set(DS_KEYS.ADMIN_ALERTS, { data: JSON.stringify(DEFAULT_ADMIN_ALERTS) });
      await $db.set(DS_KEYS.STATS, { data: JSON.stringify(DEFAULT_STATS) });

      // Register daily cron sync
      await $schedule.create({
        name: 'kwtsms_daily_sync',
        data: { type: 'daily_sync' },
        schedule_at: new Date(Date.now() + 3600000).toISOString(),
        repeat: { time_unit: 'days', frequency: 1 }
      });

      log('App initialization complete.');
    } catch (err) {
      console.error('[kwtsms] App install initialization failed:', err.message);
    }

    return { status: 200 };
  },

  onAppUninstallHandler: async function(args) {
    const $db = args.$db;
    const $schedule = args.$schedule;

    log('App uninstalling. Cleaning up...');

    try {
      const keys = [DS_KEYS.SETTINGS, DS_KEYS.GATEWAY, DS_KEYS.TEMPLATES, DS_KEYS.ADMIN_ALERTS, DS_KEYS.STATS];
      for (let i = 0; i < keys.length; i++) {
        try { await $db.delete(keys[i]); } catch (e) { /* ignore */ }
      }
      try { await $db.entity.deleteAll(ENTITY.SMS_LOG); } catch (e) { /* ignore */ }
      try { await $schedule.delete({ name: 'kwtsms_daily_sync' }); } catch (e) { /* ignore */ }
      log('Cleanup complete.');
    } catch (err) {
      console.error('[kwtsms] Cleanup failed:', err.message);
    }

    return { status: 200 };
  },

  manualSendSms: async function(args) {
    const smiData = args.data || {};
    const phone = smiData.phone;
    const message = smiData.message;
    const ticket_id = smiData.ticket_id;
    const $db = args.$db;
    const $request = args.$request;

    if (!phone || !message) {
      return { success: false, message: 'Phone and message are required' };
    }

    const credentials = await getCredentials(args);

    return await send({
      $request: $request,
      $db: $db,
      credentials: credentials,
      phones: [phone],
      message: message,
      eventType: SMS_EVENT.MANUAL_SEND,
      ticketId: ticket_id
    });
  }
};
