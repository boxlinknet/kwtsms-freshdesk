/**
 * message-utils.js - Message cleaning and SMS part calculation
 * Related: server/lib/sms-sender.js
 *
 * Freshdesk ticket content can contain HTML from the rich text editor.
 * kwtSMS rejects HTML tags (ERR027) and silently queues messages with emoji.
 * This module strips all unsafe content before sending.
 */

const { KWTSMS } = require('./constants');

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

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

function isUnicode(text) {
  const gsm7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ!"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑÜa-zäöñüà\u000C^{}\[~\]|€]*$/;
  return !gsm7.test(text);
}

function calculateSmsParts(text) {
  if (!text) return { chars: 0, parts: 0, isUnicode: false };

  const unicode = isUnicode(text);
  const chars = text.length;

  let parts;
  if (unicode) {
    if (chars <= KWTSMS.UNICODE_PAGE_SIZE) parts = 1;
    else parts = Math.ceil(chars / KWTSMS.UNICODE_MULTIPAGE_SIZE);
  } else {
    if (chars <= KWTSMS.GSM7_PAGE_SIZE) parts = 1;
    else parts = Math.ceil(chars / KWTSMS.GSM7_MULTIPAGE_SIZE);
  }

  return { chars, parts, isUnicode: unicode };
}

module.exports = { cleanMessage, calculateSmsParts, isUnicode };
