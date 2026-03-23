/**
 * template-engine.test.js - Tests for SMS template placeholder replacement
 * Run: node --test test/template-engine.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { replacePlaceholders, resolveTemplate, buildPlaceholderData } = require('../server/lib/template-engine');

describe('replacePlaceholders', () => {
  it('replaces single placeholder', () => {
    assert.equal(
      replacePlaceholders('Ticket #{{ticket_id}}', { ticket_id: '1042' }),
      'Ticket #1042'
    );
  });
  it('replaces multiple placeholders', () => {
    assert.equal(
      replacePlaceholders('{{requester_name}}: {{ticket_subject}}', {
        requester_name: 'Ahmed',
        ticket_subject: 'Login issue'
      }),
      'Ahmed: Login issue'
    );
  });
  it('leaves unknown placeholders empty', () => {
    assert.equal(
      replacePlaceholders('Hi {{unknown_field}}!', {}),
      'Hi !'
    );
  });
  it('handles empty data', () => {
    assert.equal(replacePlaceholders('No placeholders here', {}), 'No placeholders here');
  });
  it('handles null/undefined values as empty string', () => {
    assert.equal(
      replacePlaceholders('Hi {{name}}', { name: null }),
      'Hi '
    );
  });
});

describe('resolveTemplate', () => {
  const templates = {
    ticket_created: {
      en: 'Ticket #{{ticket_id}} created. Subject: {{ticket_subject}}. - {{company_name}}',
      ar: 'تذكرة #{{ticket_id}} تم إنشاؤها. الموضوع: {{ticket_subject}}. - {{company_name}}'
    }
  };

  it('resolves English template with placeholders', () => {
    const result = resolveTemplate(templates, 'ticket_created', 'en', {
      ticket_id: '1042',
      ticket_subject: 'Login issue',
      company_name: 'Acme'
    });
    assert.equal(result, 'Ticket #1042 created. Subject: Login issue. - Acme');
  });
  it('resolves Arabic template', () => {
    const result = resolveTemplate(templates, 'ticket_created', 'ar', {
      ticket_id: '1042',
      ticket_subject: 'مشكلة',
      company_name: 'شركة'
    });
    assert.ok(result.includes('1042'));
    assert.ok(result.includes('مشكلة'));
  });
  it('falls back to English if requested language missing', () => {
    const result = resolveTemplate(templates, 'ticket_created', 'fr', {
      ticket_id: '1042',
      ticket_subject: 'Test',
      company_name: 'Co'
    });
    assert.ok(result.includes('Ticket #1042'));
  });
  it('returns empty string for unknown event type', () => {
    assert.equal(resolveTemplate(templates, 'unknown_event', 'en', {}), '');
  });
});

describe('buildPlaceholderData', () => {
  it('extracts ticket fields from payload', () => {
    const payload = {
      data: {
        ticket: { id: 1042, subject: 'Login issue', status: 2, priority: 3, responder_name: 'Agent A', group_name: 'Support' },
        requester: { name: 'Ahmed', phone: '96598765432', email: 'ahmed@test.com' }
      }
    };
    const result = buildPlaceholderData(payload, 'Acme', 'en');
    assert.equal(result.ticket_id, 1042);
    assert.equal(result.ticket_subject, 'Login issue');
    assert.equal(result.agent_name, 'Agent A');
    assert.equal(result.group_name, 'Support');
    assert.equal(result.company_name, 'Acme');
  });

  it('extracts requester fields from payload', () => {
    const payload = {
      data: {
        ticket: {},
        requester: { name: 'Ahmed', phone: '96598765432', email: 'ahmed@test.com' }
      }
    };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.requester_name, 'Ahmed');
    assert.equal(result.requester_phone, '96598765432');
    assert.equal(result.requester_email, 'ahmed@test.com');
  });

  it('resolves status label to English', () => {
    const payload = { data: { ticket: { status: 2 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.ticket_status, 'Open');
  });

  it('resolves status label to Arabic', () => {
    const payload = { data: { ticket: { status: 4 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'ar');
    assert.ok(result.ticket_status.length > 0);
  });

  it('resolves priority label to English', () => {
    const payload = { data: { ticket: { priority: 3 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.ticket_priority, 'High');
  });

  it('resolves priority label to Arabic', () => {
    const payload = { data: { ticket: { priority: 1 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'ar');
    assert.ok(result.ticket_priority.length > 0);
  });

  it('defaults missing ticket fields to empty string', () => {
    const payload = { data: { ticket: {}, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.ticket_id, '');
    assert.equal(result.ticket_subject, '');
    assert.equal(result.agent_name, '');
  });

  it('defaults missing requester fields to empty string', () => {
    const payload = { data: { ticket: {}, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.requester_name, '');
    assert.equal(result.requester_phone, '');
    assert.equal(result.requester_email, '');
  });

  it('handles missing data object gracefully', () => {
    const result = buildPlaceholderData({}, 'Acme', 'en');
    assert.equal(result.company_name, 'Acme');
    assert.equal(result.ticket_id, '');
    assert.equal(result.requester_name, '');
  });

  it('falls back to English for unknown language in status/priority', () => {
    const payload = { data: { ticket: { status: 3, priority: 2 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'fr');
    assert.equal(result.ticket_status, 'Pending');
    assert.equal(result.ticket_priority, 'Medium');
  });

  it('returns empty string for unknown status/priority codes', () => {
    const payload = { data: { ticket: { status: 99, priority: 99 }, requester: {} } };
    const result = buildPlaceholderData(payload, '', 'en');
    assert.equal(result.ticket_status, '');
    assert.equal(result.ticket_priority, '');
  });
});
