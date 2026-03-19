/**
 * template-engine.test.js - Tests for SMS template placeholder replacement
 * Run: node --test test/template-engine.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { replacePlaceholders, resolveTemplate } = require('../server/lib/template-engine');

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
