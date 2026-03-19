/**
 * phone-utils.js - Phone number normalization, validation, deduplication
 * Related: server/lib/sms-sender.js, server/server.js
 *
 * kwtSMS requires digits only, no + prefix, no spaces, no dashes.
 * International format: country code + number (e.g., 96598765432)
 */

// Arabic-Indic and Extended Arabic-Indic digit mapping
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Normalize a phone number to kwtSMS-accepted format (digits only).
 * Strips all non-digit chars, converts Arabic digits, strips leading zeros.
 * @param {string|null|undefined} phone - Raw phone input
 * @returns {string} Normalized digits-only string, or empty string
 */
function normalize(phone) {
  if (!phone) return '';
  let result = String(phone);

  // Convert Arabic-Indic digits to Latin
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(ARABIC_DIGITS[i], 'g'), String(i));
    result = result.replace(new RegExp(EXTENDED_DIGITS[i], 'g'), String(i));
  }

  // Strip all non-digit characters
  result = result.replace(/\D/g, '');

  // Strip leading zeros (handles 00 prefix like 0096598765432)
  result = result.replace(/^0+/, '');

  return result;
}

/**
 * Validate a normalized phone number.
 * Must be 7-15 digits (ITU-T E.164 range).
 * @param {string} phone - Normalized phone (digits only)
 * @returns {boolean}
 */
function validate(phone) {
  if (!phone) return false;
  return /^\d{7,15}$/.test(phone);
}

/**
 * Remove duplicate phone numbers from an array.
 * Preserves order (first occurrence kept).
 * @param {string[]} phones - Array of normalized phone numbers
 * @returns {string[]}
 */
function deduplicate(phones) {
  return [...new Set(phones)];
}

module.exports = { normalize, validate, deduplicate };
