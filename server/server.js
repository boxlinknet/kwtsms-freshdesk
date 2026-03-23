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
  STATS: 'kwtsms_stats',
  LOGS: 'kwtsms_logs'
};

// SMS event types (used in templates and logs)
const SMS_EVENT = {
  TICKET_CREATED: 'ticket_created',
  STATUS_CHANGED: 'status_changed',
  AGENT_REPLY: 'agent_reply',
  ADMIN_NEW_TICKET: 'admin_new_ticket',
  ADMIN_HIGH_PRIORITY: 'admin_high_priority',
  ADMIN_ESCALATION: 'admin_escalation',
  MANUAL_SEND: 'manual_send',
  GATEWAY_TEST: 'gateway_test'
};

// Default settings (written on app install)
const DEFAULT_SETTINGS = {
  enabled: false,
  test_mode: true,
  debug: false,
  language: 'en',
  active_sender_id: 'KWT-SMS',
  default_country_code: '965',
  company_name: '',
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

// Country-specific phone validation rules (from kwtsms-js)
const PHONE_RULES = {
  '965':{l:[8],s:['4','5','6','9']},'966':{l:[9],s:['5']},'971':{l:[9],s:['5']},
  '973':{l:[8],s:['3','6']},'974':{l:[8],s:['3','5','6','7']},'968':{l:[8],s:['7','9']},
  '962':{l:[9],s:['7']},'961':{l:[7,8],s:['3','7','8']},'970':{l:[9],s:['5']},
  '964':{l:[10],s:['7']},'963':{l:[9],s:['9']},'967':{l:[9],s:['7']},
  '20':{l:[10],s:['1']},'218':{l:[9],s:['9']},'216':{l:[8],s:['2','4','5','9']},
  '212':{l:[9],s:['6','7']},'213':{l:[9],s:['5','6','7']},'249':{l:[9],s:['9']},
  '98':{l:[10],s:['9']},'90':{l:[10],s:['5']},'972':{l:[9],s:['5']},
  '91':{l:[10],s:['6','7','8','9']},'92':{l:[10],s:['3']},'880':{l:[10],s:['1']},
  '94':{l:[9],s:['7']},'960':{l:[7],s:['7','9']},
  '86':{l:[11],s:['1']},'81':{l:[10],s:['7','8','9']},'82':{l:[10],s:['1']},'886':{l:[9],s:['9']},
  '65':{l:[8],s:['8','9']},'60':{l:[9,10],s:['1']},'62':{l:[9,10,11,12],s:['8']},
  '63':{l:[10],s:['9']},'66':{l:[9],s:['6','8','9']},'84':{l:[9],s:['3','5','7','8','9']},
  '95':{l:[9],s:['9']},'855':{l:[8,9],s:['1','6','7','8','9']},'976':{l:[8],s:['6','8','9']},
  '44':{l:[10],s:['7']},'33':{l:[9],s:['6','7']},'49':{l:[10,11],s:['1']},
  '39':{l:[10],s:['3']},'34':{l:[9],s:['6','7']},'31':{l:[9],s:['6']},
  '32':{l:[9]},'41':{l:[9],s:['7']},'43':{l:[10],s:['6']},'47':{l:[8],s:['4','9']},
  '48':{l:[9]},'30':{l:[10],s:['6']},'420':{l:[9],s:['6','7']},'46':{l:[9],s:['7']},
  '45':{l:[8]},'40':{l:[9],s:['7']},'36':{l:[9]},'380':{l:[9]},
  '1':{l:[10]},'52':{l:[10]},'55':{l:[11]},'57':{l:[10],s:['3']},
  '54':{l:[10],s:['9']},'56':{l:[9],s:['9']},'58':{l:[10],s:['4']},
  '51':{l:[9],s:['9']},'593':{l:[9],s:['9']},'53':{l:[8],s:['5','6']},
  '27':{l:[9],s:['6','7','8']},'234':{l:[10],s:['7','8','9']},'254':{l:[9],s:['1','7']},
  '233':{l:[9],s:['2','5']},'251':{l:[9],s:['7','9']},'255':{l:[9],s:['6','7']},
  '256':{l:[9],s:['7']},'237':{l:[9],s:['6']},'225':{l:[10]},'221':{l:[9],s:['7']},
  '252':{l:[9],s:['6','7']},'250':{l:[9],s:['7']},
  '61':{l:[9],s:['4']},'64':{l:[8,9,10],s:['2']}
};

function findCC(n) {
  if (n.length >= 3 && PHONE_RULES[n.slice(0,3)]) return n.slice(0,3);
  if (n.length >= 2 && PHONE_RULES[n.slice(0,2)]) return n.slice(0,2);
  if (n.length >= 1 && PHONE_RULES[n.slice(0,1)]) return n.slice(0,1);
  return null;
}

/**
 * Validate a normalized phone number.
 * Checks E.164 range (7-15 digits) and country-specific rules.
 */
function validate(phone) {
  if (!phone) return false;
  if (!/^\d{7,15}$/.test(phone)) return false;
  const cc = findCC(phone);
  if (!cc) return true;
  const rule = PHONE_RULES[cc];
  const local = phone.slice(cc.length);
  if (rule.l.indexOf(local.length) === -1) {
    // Try stripping local leading zero
    if (local.charAt(0) === '0') {
      const stripped = local.slice(1);
      if (rule.l.indexOf(stripped.length) !== -1) return true;
    }
    return false;
  }
  if (rule.s && rule.s.length > 0) {
    return rule.s.some(function(p) { return local.indexOf(p) === 0; });
  }
  return true;
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
 * Extract ticket-related placeholder fields.
 */
function extractTicketFields(ticket, language) {
  return {
    ticket_id: ticket.id || '',
    ticket_subject: ticket.subject || '',
    ticket_status: resolveStatusLabel(ticket.status, language),
    ticket_priority: resolvePriorityLabel(ticket.priority, language),
    agent_name: ticket.responder_name || '',
    group_name: ticket.group_name || ''
  };
}

/**
 * Extract requester-related placeholder fields.
 */
function extractRequesterFields(requester) {
  return {
    requester_name: requester.name || '',
    requester_phone: requester.phone || '',
    requester_email: requester.email || ''
  };
}

/**
 * Build placeholder data object from a Freshdesk event payload.
 */
function buildPlaceholderData(payload, companyName, language) {
  const ticket = payload.data?.ticket || {};
  const requester = payload.data?.requester || {};

  return Object.assign(
    {},
    extractTicketFields(ticket, language),
    extractRequesterFields(requester),
    { company_name: companyName || '' }
  );
}

// ======================================================================
// LOGGER
// ======================================================================

/**
 * Log an SMS send result to Data Storage (array, max 200 entries).
 * Non-fatal: catches and console.error on failure.
 */
async function logSmsResult(entry) {
  try {
    let logs = [];
    try {
      const { data } = await $db.get(DS_KEYS.LOGS);
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (Array.isArray(parsed)) logs = parsed;
    } catch (e) { /* key doesn't exist yet */ }

    logs.unshift({
      timestamp: new Date().toISOString(),
      event_type: entry.event_type,
      recipient_phone: entry.recipient_phone,
      message_preview: (entry.message_preview || '').substring(0, 80),
      status: entry.status,
      api_response_code: entry.api_response_code || '',
      ticket_id: entry.ticket_id || 0,
      msg_id: entry.msg_id || ''
    });

    if (logs.length > 200) logs = logs.slice(0, 200);
    await $db.set(DS_KEYS.LOGS, { data: JSON.stringify(logs) });
  } catch (err) {
    console.error('[kwtsms] Failed to write log entry:', err.message);
  }
}

/**
 * Increment stats counters after a send attempt.
 * Non-fatal: catches errors silently.
 */
async function updateStats(success) {
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
async function resetCounters() {
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
async function guardSettings() {
  let settings;
  try {
    const { data } = await $db.get(DS_KEYS.SETTINGS);
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
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
function isCacheStale(lastSync) {
  if (!lastSync) return true;
  const age = Date.now() - new Date(lastSync).getTime();
  return age > 24 * 60 * 60 * 1000;
}

async function guardGateway(credentials) {
  let gateway;
  try {
    const { data } = await $db.get(DS_KEYS.GATEWAY);
    gateway = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
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
 * Prepare recipients: normalize, validate, filter by coverage, deduplicate.
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
async function updateCachedBalance(result, gateway, debug) {
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
function getRecipientType(eventType) {
  if (eventType === SMS_EVENT.ADMIN_NEW_TICKET || eventType === SMS_EVENT.ADMIN_HIGH_PRIORITY || eventType === SMS_EVENT.ADMIN_ESCALATION || eventType === SMS_EVENT.GATEWAY_TEST) return 'admin';
  return 'customer';
}

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
async function handleSendResult(result, gateway, settings, recipients, eventType, ticketId, cleanedMessage) {
  const success = result.result === 'OK';

  if (success) {
    await updateCachedBalance(result, gateway, settings.debug);
  }

  await logSmsResult(buildLogEntry(eventType, recipients, cleanedMessage, success, result, ticketId));
  await updateStats(success);

  return formatSendResponse(success, result, recipients, eventType);
}

/**
 * Dispatch the actual send call (single batch or bulk).
 */
function _dispatch(credentials, recipients, cleanedMessage, settings) {
  const testFlag = settings.test_mode ? '1' : '0';
  const sender = settings.active_sender_id || 'KWT-SMS';
  debugLog(`Sending to ${recipients.length} recipient(s), test=${testFlag}`, settings.debug);

  if (recipients.length <= KWTSMS.MAX_BATCH_SIZE) {
    return _sendBatch(credentials, recipients.join(','), cleanedMessage, sender, testFlag);
  }
  return _sendBulk(credentials, recipients, cleanedMessage, sender, testFlag, settings.debug);
}

/**
 * Send SMS through the full guard chain.
 */
async function send(params) {
  const { credentials, message, eventType, ticketId } = params;

  // 0. Flatten phones: split any comma-separated strings, trim, filter empty
  const phones = [].concat(params.phones || []).reduce(function(acc, p) {
    String(p).split(',').forEach(function(s) { const t = s.trim(); if (t) acc.push(t); });
    return acc;
  }, []);

  if (phones.length === 0) {
    return { success: false, message: 'No phone numbers provided' };
  }

  // 1. Check SMS is enabled
  const settingsGuard = await guardSettings();
  if (settingsGuard.error) return settingsGuard.error;
  const settings = settingsGuard.settings;

  // 2. Check gateway + balance (refreshes from API if cache >24h)
  const gatewayGuard = await guardGateway(credentials);
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
  const result = await _dispatch(credentials, recipients, cleanedMessage, settings);

  // 6. Log, update balance, return result
  return handleSendResult(result, gateway, settings, recipients, eventType, ticketId, cleanedMessage);
}

/**
 * Send a single batch (up to 200 numbers).
 */
async function _sendBatch(credentials, mobile, message, sender, test) {
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
      try { return JSON.parse(err.response); } catch (e) { /* fall through */ }
    }
    if (err && err.message) {
      try { const parsed = JSON.parse(err.message); if (parsed.result) return parsed; } catch (e) { /* fall through */ }
    }
    return { result: 'ERROR', code: 'ERR', description: (err && err.message) || String(err) };
  }
}

/**
 * Send to >200 numbers by chunking with delays and ERR013 backoff.
 */
async function _sendBulk(credentials, recipients, message, sender, test, debug) {
  let lastResult = { result: 'ERROR', description: 'No batches sent' };

  for (let i = 0; i < recipients.length; i += KWTSMS.MAX_BATCH_SIZE) {
    const batch = recipients.slice(i, i + KWTSMS.MAX_BATCH_SIZE);

    if (i > 0) {
      await sleep(KWTSMS.BATCH_DELAY_MS);
    }

    let attempt = 0;
    while (attempt <= KWTSMS.MAX_RETRIES) {
      const result = await _sendBatch(credentials, batch.join(','), message, sender, test);

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
// HELPERS: Credentials, Settings, Templates, Admin Alerts
// ======================================================================

function getCredentials(args) {
  return { username: args.iparams.kwtsms_username, password: args.iparams.kwtsms_password };
}

async function loadSettings() {
  try {
    const { data } = await $db.get(DS_KEYS.SETTINGS);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return null; }
}

async function loadTemplates() {
  try {
    const { data } = await $db.get(DS_KEYS.TEMPLATES);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return {}; }
}

async function loadAdminAlerts() {
  try {
    const { data } = await $db.get(DS_KEYS.ADMIN_ALERTS);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { return DEFAULT_ADMIN_ALERTS; }
}


// ======================================================================
// HANDLER HELPERS (reduce cyclomatic complexity of exports)
// ======================================================================

function getCustomerPhone(payload) {
  // Freshdesk payloads vary by event type. Check all known locations.
  return payload.requester?.phone
    || payload.requester?.mobile
    || payload.ticket?.phone
    || payload.ticket?.requester_phone
    || payload.contact?.phone
    || payload.contact?.mobile
    || null;
}

async function cacheTicketPhone(ticketId, phone) {
  if (!ticketId || !phone) return;
  try {
    const key = 'tphone_' + ticketId;
    await $db.set(key, { data: phone });
  } catch (e) { /* ignore */ }
}

async function getCachedPhone(ticketId) {
  if (!ticketId) return null;
  try {
    const key = 'tphone_' + ticketId;
    const result = await $db.get(key);
    return (result && result.data) || null;
  } catch (e) { return null; }
}

async function sendCustomerTicketCreated(ctx, payload, templates, settings, placeholders, ticketId) {
  if (settings.notify_ticket_created === false) return;
  const customerPhone = getCustomerPhone(payload);
  if (!customerPhone) {
    log('Customer SMS skipped (ticket_created): no phone found for requester');
    return;
  }
  const message = resolveTemplate(templates, SMS_EVENT.TICKET_CREATED, settings.language, placeholders);
  if (!message) return;
  await send({ ...ctx, phones: [customerPhone], message, eventType: SMS_EVENT.TICKET_CREATED, ticketId });
}

async function sendAdminNewTicket(ctx, templates, settings, placeholders, ticketId) {
  const adminAlerts = await loadAdminAlerts();
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.new_ticket) return;
  const adminMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_NEW_TICKET, settings.language, placeholders);
  if (!adminMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: adminMsg, eventType: SMS_EVENT.ADMIN_NEW_TICKET, ticketId });
}

async function sendAdminHighPriority(ctx, payload, templates, settings, placeholders, ticketId) {
  const priority = payload.ticket?.priority;
  if (!priority || priority < TICKET_PRIORITY.HIGH) return;
  const adminAlerts = await loadAdminAlerts();
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.high_priority) return;
  const highMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_HIGH_PRIORITY, settings.language, placeholders);
  if (!highMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: highMsg, eventType: SMS_EVENT.ADMIN_HIGH_PRIORITY, ticketId });
}

async function sendStatusChanged(ctx, payload, changes, templates, settings, placeholders, ticketId) {
  if (settings.notify_status_changed === false) return;
  if (!changes.status) return;
  const customerPhone = getCustomerPhone(payload);
  if (!customerPhone) {
    log('Customer SMS skipped (status_changed): no phone found for requester');
    return;
  }
  const message = resolveTemplate(templates, SMS_EVENT.STATUS_CHANGED, settings.language, placeholders);
  if (!message) return;
  await send({ ...ctx, phones: [customerPhone], message, eventType: SMS_EVENT.STATUS_CHANGED, ticketId });
}

/**
 * Determine whether a priority change represents an escalation.
 * Escalation: old priority was MEDIUM or lower (numerically <=2) and new is HIGH or above (>=3).
 * @returns {boolean}
 */
function isEscalation(changes) {
  if (!changes.priority) return false;
  const oldPriority = Array.isArray(changes.priority) ? changes.priority[0] : null;
  const newPriority = Array.isArray(changes.priority) ? changes.priority[1] : changes.priority;
  if (!oldPriority) return false;
  return oldPriority <= TICKET_PRIORITY.MEDIUM && newPriority >= TICKET_PRIORITY.HIGH;
}

async function sendEscalationAlert(ctx, changes, templates, settings, placeholders, ticketId) {
  if (!isEscalation(changes)) return;
  const adminAlerts = await loadAdminAlerts();
  if (adminAlerts.phones.length === 0 || !adminAlerts.events.escalation) return;
  const escalMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_ESCALATION, settings.language, placeholders);
  if (!escalMsg) return;
  await send({ ...ctx, phones: adminAlerts.phones, message: escalMsg, eventType: SMS_EVENT.ADMIN_ESCALATION, ticketId });
}

// ======================================================================
// APP INSTALL HELPERS (reduce complexity of onAppInstallHandler)
// ======================================================================

/**
 * Fetch balance, sender IDs, and coverage from the kwtSMS API.
 * Returns a gateway data object ready for storage.
 */
async function fetchGatewayData(creds) {
  const credBody = JSON.stringify(creds);

  const balanceResp = await $request.invokeTemplate('checkBalance', { body: credBody });
  const balance = JSON.parse(balanceResp.response);

  const senderResp = await $request.invokeTemplate('getSenderIds', { body: credBody });
  const senders = JSON.parse(senderResp.response);

  const coverageResp = await $request.invokeTemplate('getCoverage', { body: credBody });
  const coverage = JSON.parse(coverageResp.response);

  return {
    balance: balance.available || 0,
    senderids: senders.senderid || [],
    coverage: coverage.prefixes || coverage.coverage || [],
    last_sync: new Date().toISOString()
  };
}

/**
 * Perform the daily sync: fetch gateway data, persist it, and reset counters.
 */
async function runDailySync(args) {
  log('Running daily sync...');
  try {
    const creds = getCredentials(args);
    const gateway = await fetchGatewayData(creds);
    await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });
    await resetCounters();
    log('Daily sync complete. Balance: ' + gateway.balance +
        ', SenderIDs: ' + gateway.senderids.length +
        ', Coverage: ' + gateway.coverage.length + ' countries');
  } catch (err) {
    console.error('[kwtsms] Daily sync failed:', err.message);
  }
}

/** Default SMS templates written on first install. */
const INSTALL_DEFAULT_TEMPLATES = {
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

/**
 * Initialize default data storage entries on install.
 */
async function initializeDefaultData() {
  await $db.set(DS_KEYS.SETTINGS, { data: JSON.stringify(DEFAULT_SETTINGS) });
  await $db.set(DS_KEYS.TEMPLATES, { data: JSON.stringify(INSTALL_DEFAULT_TEMPLATES) });
  await $db.set(DS_KEYS.ADMIN_ALERTS, { data: JSON.stringify(DEFAULT_ADMIN_ALERTS) });
  await $db.set(DS_KEYS.STATS, { data: JSON.stringify(DEFAULT_STATS) });
}

/**
 * Register the daily sync cron job. Silently ignores if already exists.
 */
async function registerDailySync() {
  try {
    await $schedule.create({
      name: 'kwtsms_daily_sync',
      data: { type: 'daily_sync' },
      schedule_at: new Date(Date.now() + 3600000).toISOString(),
      repeat: { time_unit: 'days', frequency: 1 }
    });
  } catch (schedErr) {
    log('Schedule already exists or failed: ' + (schedErr.message || 'ignored'));
  }
}

/**
 * Check whether a conversation is a public agent reply (not a private note,
 * customer message, or forward).
 * @param {Object} conversation - Freshdesk conversation object
 * @returns {boolean}
 */
function isPublicAgentReply(conversation) {
  return conversation.incoming === false && conversation.private === false;
}

async function sendAgentReply(args, payload, settings) {
  if (settings.notify_agent_reply === false) return;
  const customerPhone = getCustomerPhone(payload);
  if (!customerPhone) {
    log('Customer SMS skipped (agent_reply): no phone in sendAgentReply');
    return;
  }
  const credentials = getCredentials(args);
  const templates = await loadTemplates();
  const placeholders = buildPlaceholderData({ data: payload }, settings.company_name || '', settings.language);
  const message = resolveTemplate(templates, SMS_EVENT.AGENT_REPLY, settings.language, placeholders);
  if (!message) return;
  await send({
    credentials: credentials,
    phones: [customerPhone],
    message: message,
    eventType: SMS_EVENT.AGENT_REPLY,
    ticketId: payload.ticket?.id
  });
}

function buildInstallSettings(gateway, domain) {
  const companyName = domain ? domain.split('.')[0] : '';
  const activeSenderId = (gateway.senderids && gateway.senderids.length > 0)
    ? gateway.senderids[0]
    : 'KWT-SMS';
  return Object.assign({}, DEFAULT_SETTINGS, {
    company_name: companyName,
    active_sender_id: activeSenderId
  });
}

async function getExistingGateway() {
  try {
    const { data } = await $db.get(DS_KEYS.GATEWAY);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return { balance: 0, senderids: [], coverage: [], last_sync: '' };
  }
}

function formatError(err) {
  return err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
}

// ======================================================================
// EXPORTS (FDK serverless pattern - inline function syntax)
// ======================================================================

exports = {
  onTicketCreateHandler: async function(args) {
    const { data: payload } = args;
    const phone = getCustomerPhone(payload);

    // Cache phone for later events (update, conversation)
    const ticketIdVal = payload.ticket?.id;
    if (phone && ticketIdVal) await cacheTicketPhone(ticketIdVal, phone);

    const settings = await loadSettings();
    if (!settings || !settings.enabled) return;

    const credentials = getCredentials(args);
    const templates = await loadTemplates();
    const companyName = settings.company_name || '';
    const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);
    const sendCtx = { credentials };

    await sendCustomerTicketCreated(sendCtx, payload, templates, settings, placeholders, ticketIdVal);
    await sendAdminNewTicket(sendCtx, templates, settings, placeholders, ticketIdVal);
    await sendAdminHighPriority(sendCtx, payload, templates, settings, placeholders, ticketIdVal);
  },

  onTicketUpdateHandler: async function(args) {
    const { data: payload } = args;
    const changes = payload.changes || payload.ticket?.changes || {};
    const ticketIdVal = payload.ticket?.id;

    // Ensure phone is available (fall back to cache)
    let phone = getCustomerPhone(payload);
    if (!phone && ticketIdVal) phone = await getCachedPhone(ticketIdVal);
    if (phone && !payload.requester) payload.requester = { phone: phone };
    // Cache phone for future events (e.g. conversation on older tickets)
    if (phone && ticketIdVal) await cacheTicketPhone(ticketIdVal, phone);


    const settings = await loadSettings();
    if (!settings || !settings.enabled) return;

    const credentials = getCredentials(args);
    const templates = await loadTemplates();
    const companyName = settings.company_name || '';
    const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);
    const sendCtx = { credentials };

    // Send on any status change
    if (changes.status) {
      await sendStatusChanged(sendCtx, payload, changes, templates, settings, placeholders, ticketIdVal);
    }
    // Send on escalation (priority increase)
    await sendEscalationAlert(sendCtx, changes, templates, settings, placeholders, ticketIdVal);
  },

  onConversationCreateHandler: async function(args) {
    const payload = args.data;
    const conv = payload.conversation || {};
    const ticketId = conv.ticket_id || payload.ticket?.id;

    if (!isPublicAgentReply(conv)) {
      return;
    }

    // Conversation payload has no requester. Fall back to cached phone.
    let customerPhone = getCustomerPhone(payload);
    if (!customerPhone && ticketId) customerPhone = await getCachedPhone(ticketId);


    if (!customerPhone) {
      log('Customer SMS skipped (agent_reply): no phone found. Ticket: ' + ticketId);
      return;
    }

    const settings = await loadSettings();
    if (!settings || !settings.enabled) return;

    // Enrich payload with phone for sendAgentReply
    const enrichedPayload = Object.assign({}, payload, {
      requester: { phone: customerPhone },
      ticket: payload.ticket || { id: ticketId }
    });
    await sendAgentReply(args, enrichedPayload, settings);
  },

  onScheduledEventHandler: async function(args) {
    // Future-proofing: check event type
    const eventType = args.data?.type || 'daily_sync';
    if (eventType !== 'daily_sync') {
      log('Unknown scheduled event type: ' + eventType);
      return;
    }
    await runDailySync(args);
  },



  onAppInstallHandler: async function(args) {
    log('App installed. Initializing...');

    try {
      const creds = getCredentials(args);
      const gateway = await fetchGatewayData(creds);
      await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });

      const domain = (args.data && args.data.domain) || '';
      const installSettings = buildInstallSettings(gateway, domain);
      await $db.set(DS_KEYS.SETTINGS, { data: JSON.stringify(installSettings) });
      await $db.set(DS_KEYS.TEMPLATES, { data: JSON.stringify(INSTALL_DEFAULT_TEMPLATES) });
      await $db.set(DS_KEYS.ADMIN_ALERTS, { data: JSON.stringify(DEFAULT_ADMIN_ALERTS) });
      await $db.set(DS_KEYS.STATS, { data: JSON.stringify(DEFAULT_STATS) });

      await registerDailySync();
      log('App initialization complete.');
    } catch (err) {
      console.error('[kwtsms] App install initialization failed:', err.message || JSON.stringify(err));
    }

    renderData();
  },

  onAppUninstallHandler: async function() {
    
    

    log('App uninstalling. Cleaning up...');

    try {
      const keys = [DS_KEYS.SETTINGS, DS_KEYS.GATEWAY, DS_KEYS.TEMPLATES, DS_KEYS.ADMIN_ALERTS, DS_KEYS.STATS, DS_KEYS.LOGS];
      for (let i = 0; i < keys.length; i++) {
        try { await $db.delete(keys[i]); } catch (e) { /* ignore */ }
      }
      try { await $schedule.delete({ name: 'kwtsms_daily_sync' }); } catch (e) { /* ignore */ }
      log('Cleanup complete.');
    } catch (err) {
      console.error('[kwtsms] Cleanup failed:', err.message);
    }

    renderData();
  },

  syncGateway: async function(args) {
    try {
      const creds = getCredentials(args);
      const gateway = await fetchGatewayData(creds);
      await $db.set(DS_KEYS.GATEWAY, { data: JSON.stringify(gateway) });

      // Read back to verify it was saved
      const verify = await $db.get(DS_KEYS.GATEWAY);
      renderData(null, { success: true, balance: gateway.balance, saved: JSON.stringify(verify).substring(0, 200) });
    } catch (err) {
      renderData(null, { success: false, message: formatError(err) });
    }
  },

  manualSendSms: async function(args) {
    const smiData = args.data || {};
    const phone = smiData.phone;
    const message = smiData.message;
    const ticket_id = smiData.ticket_id;
    const eventType = smiData.event_type || SMS_EVENT.MANUAL_SEND;

    if (!phone || !message) {
      renderData(null, { success: false, message: 'Phone and message are required' });
      return;
    }

    const credentials = getCredentials(args);

    const result = await send({
      credentials: credentials,
      phones: [phone],
      message: message,
      eventType: eventType,
      ticketId: ticket_id
    });
    renderData(null, result);
  }
};
