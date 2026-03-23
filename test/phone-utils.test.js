/**
 * phone-utils.test.js - Tests for phone normalization and validation
 * Run: node --test test/phone-utils.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, validate, deduplicate } = require('../server/lib/phone-utils');

describe('normalize', () => {
  it('keeps valid international format digits only', () => {
    assert.equal(normalize('96598765432'), '96598765432');
  });
  it('strips + prefix', () => {
    assert.equal(normalize('+96598765432'), '96598765432');
  });
  it('strips 00 prefix', () => {
    assert.equal(normalize('0096598765432'), '96598765432');
  });
  it('strips spaces', () => {
    assert.equal(normalize('965 9876 5432'), '96598765432');
  });
  it('strips dashes', () => {
    assert.equal(normalize('965-9876-5432'), '96598765432');
  });
  it('strips parentheses and dots', () => {
    assert.equal(normalize('(965) 9876.5432'), '96598765432');
  });
  it('converts Arabic-Indic digits', () => {
    assert.equal(normalize('٩٦٥٩٨٧٦٥٤٣٢'), '96598765432');
  });
  it('converts Extended Arabic-Indic digits', () => {
    assert.equal(normalize('۹۶۵۹۸۷۶۵۴۳۲'), '96598765432');
  });
  it('handles leading zeros stripped', () => {
    assert.equal(normalize('098765432'), '98765432');
  });
  it('returns empty string for null/undefined', () => {
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
    assert.equal(normalize(''), '');
  });
});

describe('validate', () => {
  it('accepts valid Kuwait mobile (965 + 8 digits)', () => {
    assert.equal(validate('96598765432'), true);
  });
  it('accepts valid international number (7-15 digits)', () => {
    assert.equal(validate('971501234567'), true);
  });
  it('rejects too short', () => {
    assert.equal(validate('12345'), false);
  });
  it('rejects too long', () => {
    assert.equal(validate('1234567890123456'), false);
  });
  it('rejects empty', () => {
    assert.equal(validate(''), false);
  });
  it('rejects non-digits', () => {
    assert.equal(validate('abc123'), false);
  });
});

describe('deduplicate', () => {
  it('removes duplicate numbers', () => {
    assert.deepEqual(
      deduplicate(['96598765432', '96512345678', '96598765432']),
      ['96598765432', '96512345678']
    );
  });
  it('returns empty array for empty input', () => {
    assert.deepEqual(deduplicate([]), []);
  });
});
