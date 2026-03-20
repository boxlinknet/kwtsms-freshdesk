/**
 * template-engine.js - SMS template placeholder replacement and language selection
 * Related: server/lib/sms-sender.js, i18n/en.json, i18n/ar.json
 *
 * Templates use {{placeholder}} syntax. Data comes from Freshdesk event payloads
 * and installation parameters (company_name).
 */

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
  const { STATUS_LABELS } = require('./constants');
  return (STATUS_LABELS[language] || STATUS_LABELS.en)[statusCode] || '';
}

/**
 * Resolve a priority code to a localized label.
 */
function resolvePriorityLabel(priorityCode, language) {
  const { PRIORITY_LABELS } = require('./constants');
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

module.exports = { replacePlaceholders, resolveTemplate, buildPlaceholderData };
