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
 * Build placeholder data object from a Freshdesk event payload.
 */
function buildPlaceholderData(payload, companyName, language) {
  const { STATUS_LABELS, PRIORITY_LABELS } = require('./constants');
  const ticket = payload.data?.ticket || {};
  const requester = payload.data?.requester || {};
  const statusCode = ticket.status;
  const priorityCode = ticket.priority;

  return {
    ticket_id: ticket.id || '',
    ticket_subject: ticket.subject || '',
    ticket_status: (STATUS_LABELS[language] || STATUS_LABELS.en)[statusCode] || '',
    ticket_priority: (PRIORITY_LABELS[language] || PRIORITY_LABELS.en)[priorityCode] || '',
    requester_name: requester.name || '',
    requester_phone: requester.phone || '',
    requester_email: requester.email || '',
    agent_name: ticket.responder_name || '',
    group_name: ticket.group_name || '',
    company_name: companyName || ''
  };
}

module.exports = { replacePlaceholders, resolveTemplate, buildPlaceholderData };
