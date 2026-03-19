/**
 * message-utils.test.js - Tests for message cleaning and SMS calculation
 * Run: node --test test/message-utils.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cleanMessage, calculateSmsParts } = require('../server/lib/message-utils');

describe('cleanMessage', () => {
  it('strips HTML tags', () => {
    assert.equal(cleanMessage('<p>Hello <b>World</b></p>'), 'Hello World');
  });
  it('strips nested/complex HTML', () => {
    assert.equal(
      cleanMessage('<div class="test"><span>Text</span></div>'),
      'Text'
    );
  });
  it('decodes HTML entities', () => {
    assert.equal(cleanMessage('Tom &amp; Jerry &lt;3'), 'Tom & Jerry <3');
  });
  it('decodes numeric HTML entities', () => {
    assert.equal(cleanMessage('&#39;hello&#39;'), "'hello'");
  });
  it('strips emoji', () => {
    // After stripping emoji, internal spaces are not collapsed, only leading/trailing trimmed
    assert.equal(cleanMessage('Hello 😀 World 🌍'), 'Hello  World');
  });
  it('strips zero-width spaces', () => {
    assert.equal(cleanMessage('Hello\u200BWorld'), 'HelloWorld');
  });
  it('strips BOM', () => {
    assert.equal(cleanMessage('\uFEFFHello'), 'Hello');
  });
  it('strips soft hyphens', () => {
    assert.equal(cleanMessage('Hel\u00ADlo'), 'Hello');
  });
  it('converts Arabic-Indic digits to Latin in message', () => {
    assert.equal(cleanMessage('Code: ١٢٣٤'), 'Code: 1234');
  });
  it('trims whitespace', () => {
    assert.equal(cleanMessage('  Hello World  '), 'Hello World');
  });
  it('handles null/undefined', () => {
    assert.equal(cleanMessage(null), '');
    assert.equal(cleanMessage(undefined), '');
  });
  it('preserves newlines', () => {
    assert.equal(cleanMessage('Line1\nLine2'), 'Line1\nLine2');
  });
});

describe('calculateSmsParts', () => {
  it('returns 1 part for short English message', () => {
    assert.deepEqual(calculateSmsParts('Hello'), { chars: 5, parts: 1, isUnicode: false });
  });
  it('returns 1 part for 160 GSM chars', () => {
    const msg = 'A'.repeat(160);
    assert.deepEqual(calculateSmsParts(msg), { chars: 160, parts: 1, isUnicode: false });
  });
  it('returns 2 parts for 161 GSM chars', () => {
    const msg = 'A'.repeat(161);
    assert.deepEqual(calculateSmsParts(msg), { chars: 161, parts: 2, isUnicode: false });
  });
  it('detects Arabic as Unicode', () => {
    assert.deepEqual(calculateSmsParts('مرحبا'), { chars: 5, parts: 1, isUnicode: true });
  });
  it('returns 1 part for 70 Unicode chars', () => {
    const msg = 'م'.repeat(70);
    assert.deepEqual(calculateSmsParts(msg), { chars: 70, parts: 1, isUnicode: true });
  });
  it('returns 2 parts for 71 Unicode chars', () => {
    const msg = 'م'.repeat(71);
    assert.deepEqual(calculateSmsParts(msg), { chars: 71, parts: 2, isUnicode: true });
  });
  it('mixed English+Arabic is Unicode', () => {
    const result = calculateSmsParts('Hello مرحبا');
    assert.equal(result.isUnicode, true);
  });
});
