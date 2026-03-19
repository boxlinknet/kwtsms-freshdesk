/**
 * logger.js - SMS log writer (Entity Store) and stats updater (KV Store)
 * Related: server/lib/constants.js, entities/entities.json
 *
 * Logs every SMS send attempt to Entity Store (sms_log entity).
 * Updates aggregate counters in KV Store (kwtsms_stats).
 * All failures are non-fatal: SMS delivery is never blocked by logging errors.
 */

const { DS_KEYS, ENTITY } = require('./constants');

/**
 * Log an SMS send result to Entity Store.
 * Non-fatal: catches and console.error on failure.
 * @param {Object} $db - FDK Data Storage instance
 * @param {Object} entry - Log entry data
 * @param {string} entry.event_type - SMS_EVENT constant
 * @param {string} entry.recipient_phone - Normalized phone
 * @param {string} entry.message_preview - First 80 chars of message
 * @param {string} entry.status - "sent" or "failed"
 * @param {string} [entry.api_response_code] - kwtSMS response code
 * @param {number} [entry.ticket_id] - Freshdesk ticket ID
 * @param {string} [entry.msg_id] - kwtSMS message ID
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
 * @param {Object} $db - FDK Data Storage instance
 * @param {boolean} success - Whether the send succeeded
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
 * @param {Object} $db - FDK Data Storage instance
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

module.exports = { logSmsResult, updateStats, resetCounters, debugLog, log };
