/**
 * server.js - Freshdesk serverless event handlers and SMI functions
 * Related: server/lib/*.js, config/requests.json, entities/entities.json
 *
 * Exports event handlers for: ticket create, ticket update, conversation create,
 * app install/uninstall, scheduled events. Also exports manualSendSms (SMI).
 */

const { send } = require('./lib/sms-sender');
const { resolveTemplate, buildPlaceholderData } = require('./lib/template-engine');
const { cleanMessage } = require('./lib/message-utils');
const { normalize, validate } = require('./lib/phone-utils');
const { logSmsResult, updateStats, resetCounters, log, debugLog } = require('./lib/logger');
const {
  DS_KEYS, ENTITY, SMS_EVENT, TICKET_STATUS, TICKET_PRIORITY,
  DEFAULT_SETTINGS, DEFAULT_ADMIN_ALERTS, DEFAULT_STATS
} = require('./lib/constants');

// ──────────────────────────────────────────────
// Helper: Load settings, templates, admin alerts
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Event: Ticket Created
// ──────────────────────────────────────────────

async function onTicketCreateHandler(args) {
  const { data: payload } = args;
  const $db = args.$db;
  const $request = args.$request;

  const settings = await loadSettings($db);
  if (!settings || !settings.enabled) return;

  const templates = await loadTemplates($db);
  const companyName = await getCompanyName(args);
  const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);

  // Customer SMS
  const customerPhone = payload.requester?.phone;
  if (customerPhone) {
    const message = resolveTemplate(templates, SMS_EVENT.TICKET_CREATED, settings.language, placeholders);
    if (message) {
      await send({
        $request, $db,
        phones: [customerPhone],
        message,
        eventType: SMS_EVENT.TICKET_CREATED,
        ticketId: payload.ticket?.id
      });
    }
  }

  // Admin SMS
  const adminAlerts = await loadAdminAlerts($db);
  if (adminAlerts.phones.length > 0 && adminAlerts.events.new_ticket) {
    const adminMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_NEW_TICKET, settings.language, placeholders);
    if (adminMsg) {
      await send({
        $request, $db,
        phones: adminAlerts.phones,
        message: adminMsg,
        eventType: SMS_EVENT.ADMIN_NEW_TICKET,
        ticketId: payload.ticket?.id
      });
    }
  }

  // High priority admin alert (ticket CREATED at high priority, distinct from escalation)
  const priority = payload.ticket?.priority;
  if (priority >= TICKET_PRIORITY.HIGH && adminAlerts.phones.length > 0 && adminAlerts.events.high_priority) {
    const highMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_HIGH_PRIORITY, settings.language, placeholders);
    if (highMsg) {
      await send({
        $request, $db,
        phones: adminAlerts.phones,
        message: highMsg,
        eventType: SMS_EVENT.ADMIN_HIGH_PRIORITY,
        ticketId: payload.ticket?.id
      });
    }
  }
}

// ──────────────────────────────────────────────
// Event: Ticket Updated
// ──────────────────────────────────────────────

async function onTicketUpdateHandler(args) {
  const { data: payload } = args;
  const $db = args.$db;
  const $request = args.$request;
  const changes = payload.changes || {};

  const settings = await loadSettings($db);
  if (!settings || !settings.enabled) return;

  const templates = await loadTemplates($db);
  const companyName = await getCompanyName(args);
  const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);

  // Case 1: Status changed to Resolved or Closed
  if (changes.status) {
    const newStatus = Array.isArray(changes.status) ? changes.status[1] : changes.status;
    if (newStatus === TICKET_STATUS.RESOLVED || newStatus === TICKET_STATUS.CLOSED) {
      const customerPhone = payload.requester?.phone;
      if (customerPhone) {
        const message = resolveTemplate(templates, SMS_EVENT.STATUS_CHANGED, settings.language, placeholders);
        if (message) {
          await send({
            $request, $db,
            phones: [customerPhone],
            message,
            eventType: SMS_EVENT.STATUS_CHANGED,
            ticketId: payload.ticket?.id
          });
        }
      }
    }
  }

  // Case 2: Priority escalation (Low/Medium -> High/Urgent)
  if (changes.priority) {
    const oldPriority = Array.isArray(changes.priority) ? changes.priority[0] : null;
    const newPriority = Array.isArray(changes.priority) ? changes.priority[1] : changes.priority;

    if (oldPriority && oldPriority <= TICKET_PRIORITY.MEDIUM && newPriority >= TICKET_PRIORITY.HIGH) {
      const adminAlerts = await loadAdminAlerts($db);
      if (adminAlerts.phones.length > 0 && adminAlerts.events.escalation) {
        const escalMsg = resolveTemplate(templates, SMS_EVENT.ADMIN_ESCALATION, settings.language, placeholders);
        if (escalMsg) {
          await send({
            $request, $db,
            phones: adminAlerts.phones,
            message: escalMsg,
            eventType: SMS_EVENT.ADMIN_ESCALATION,
            ticketId: payload.ticket?.id
          });
        }
      }
    }
  }
}

// ──────────────────────────────────────────────
// Event: Conversation Created (agent reply)
// ──────────────────────────────────────────────

async function onConversationCreateHandler(args) {
  const { data: payload } = args;
  const $db = args.$db;
  const $request = args.$request;
  const conversation = payload.conversation || {};

  // Only send on public agent replies (not private notes, not customer messages, not forwards)
  if (conversation.incoming !== false) return;
  if (conversation.private !== false) return;

  const settings = await loadSettings($db);
  if (!settings || !settings.enabled) return;

  const customerPhone = payload.requester?.phone;
  if (!customerPhone) return;

  const templates = await loadTemplates($db);
  const companyName = await getCompanyName(args);
  const placeholders = buildPlaceholderData({ data: payload }, companyName, settings.language);

  const message = resolveTemplate(templates, SMS_EVENT.AGENT_REPLY, settings.language, placeholders);
  if (message) {
    await send({
      $request, $db,
      phones: [customerPhone],
      message,
      eventType: SMS_EVENT.AGENT_REPLY,
      ticketId: payload.ticket?.id
    });
  }
}

// ──────────────────────────────────────────────
// Event: Scheduled (daily cron sync)
// ──────────────────────────────────────────────

async function onScheduledEventHandler(args) {
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
    const balanceResp = await $request.invokeTemplate('checkBalance', {});
    const balance = JSON.parse(balanceResp.response);

    const senderResp = await $request.invokeTemplate('getSenderIds', {});
    const senders = JSON.parse(senderResp.response);

    const coverageResp = await $request.invokeTemplate('getCoverage', {});
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
}

// ──────────────────────────────────────────────
// Event: App Installed
// ──────────────────────────────────────────────

async function onAppInstallHandler(args) {
  const $db = args.$db;
  const $request = args.$request;
  const $schedule = args.$schedule;

  log('App installed. Initializing...');

  try {
    // Initial sync
    const balanceResp = await $request.invokeTemplate('checkBalance', {});
    const balance = JSON.parse(balanceResp.response);

    const senderResp = await $request.invokeTemplate('getSenderIds', {});
    const senders = JSON.parse(senderResp.response);

    const coverageResp = await $request.invokeTemplate('getCoverage', {});
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
}

// ──────────────────────────────────────────────
// Event: App Uninstalled
// ──────────────────────────────────────────────

async function onAppUninstallHandler(args) {
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
}

// ──────────────────────────────────────────────
// SMI: Manual Send SMS (called from ticket sidebar)
// ──────────────────────────────────────────────

async function manualSendSms(args) {
  const smiData = args.data || {};
  const phone = smiData.phone;
  const message = smiData.message;
  const ticket_id = smiData.ticket_id;
  const $db = args.$db;
  const $request = args.$request;

  if (!phone || !message) {
    return { success: false, message: 'Phone and message are required' };
  }

  return await send({
    $request: $request,
    $db: $db,
    phones: [phone],
    message: message,
    eventType: SMS_EVENT.MANUAL_SEND,
    ticketId: ticket_id
  });
}

// ──────────────────────────────────────────────
// Exports (FDK pattern: exports = {})
// ──────────────────────────────────────────────

exports = {
  onTicketCreateHandler: onTicketCreateHandler,
  onTicketUpdateHandler: onTicketUpdateHandler,
  onConversationCreateHandler: onConversationCreateHandler,
  onScheduledEventHandler: onScheduledEventHandler,
  onAppInstallHandler: onAppInstallHandler,
  onAppUninstallHandler: onAppUninstallHandler,
  manualSendSms: manualSendSms
};
