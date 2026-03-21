/**
 * constants.js - Shared constants for kwtSMS Freshdesk app
 * Related: server/server.js, server/lib/*.js
 */

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
  ar: { 2: 'مفتوحة', 3: 'معلقة', 4: 'تم الحل', 5: 'مغلقة' }
};

// Priority labels
const PRIORITY_LABELS = {
  en: { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' },
  ar: { 1: 'منخفضة', 2: 'متوسطة', 3: 'عالية', 4: 'عاجلة' }
};

module.exports = {
  TICKET_STATUS, TICKET_PRIORITY, DS_KEYS, ENTITY, SMS_EVENT,
  DEFAULT_SETTINGS, DEFAULT_ADMIN_ALERTS, DEFAULT_STATS,
  KWTSMS, NON_RETRYABLE_ERRORS, STATUS_LABELS, PRIORITY_LABELS
};
