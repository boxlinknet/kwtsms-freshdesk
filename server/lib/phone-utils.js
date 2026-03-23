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

// Country-specific phone validation rules (from kwtsms-js)
const PHONE_RULES = {
  '965':{l:[8],s:['4','5','6','9']},'966':{l:[9],s:['5']},'971':{l:[9],s:['5']},
  '973':{l:[8],s:['3','6']},'974':{l:[8],s:['3','5','6','7']},'968':{l:[8],s:['7','9']},
  '962':{l:[9],s:['7']},'961':{l:[7,8],s:['3','7','8']},'970':{l:[9],s:['5']},
  '964':{l:[10],s:['7']},'963':{l:[9],s:['9']},'967':{l:[9],s:['7']},
  '20':{l:[10],s:['1']},'218':{l:[9],s:['9']},'216':{l:[8],s:['2','4','5','9']},
  '212':{l:[9],s:['6','7']},'213':{l:[9],s:['5','6','7']},'249':{l:[9],s:['9']},
  '98':{l:[10],s:['9']},'90':{l:[10],s:['5']},'972':{l:[9],s:['5']},
  '91':{l:[10],s:['6','7','8','9']},'92':{l:[10],s:['3']},'880':{l:[10],s:['1']},
  '94':{l:[9],s:['7']},'960':{l:[7],s:['7','9']},
  '86':{l:[11],s:['1']},'81':{l:[10],s:['7','8','9']},'82':{l:[10],s:['1']},'886':{l:[9],s:['9']},
  '65':{l:[8],s:['8','9']},'60':{l:[9,10],s:['1']},'62':{l:[9,10,11,12],s:['8']},
  '63':{l:[10],s:['9']},'66':{l:[9],s:['6','8','9']},'84':{l:[9],s:['3','5','7','8','9']},
  '95':{l:[9],s:['9']},'855':{l:[8,9],s:['1','6','7','8','9']},'976':{l:[8],s:['6','8','9']},
  '44':{l:[10],s:['7']},'33':{l:[9],s:['6','7']},'49':{l:[10,11],s:['1']},
  '39':{l:[10],s:['3']},'34':{l:[9],s:['6','7']},'31':{l:[9],s:['6']},
  '32':{l:[9]},'41':{l:[9],s:['7']},'43':{l:[10],s:['6']},'47':{l:[8],s:['4','9']},
  '48':{l:[9]},'30':{l:[10],s:['6']},'420':{l:[9],s:['6','7']},'46':{l:[9],s:['7']},
  '45':{l:[8]},'40':{l:[9],s:['7']},'36':{l:[9]},'380':{l:[9]},
  '1':{l:[10]},'52':{l:[10]},'55':{l:[11]},'57':{l:[10],s:['3']},
  '54':{l:[10],s:['9']},'56':{l:[9],s:['9']},'58':{l:[10],s:['4']},
  '51':{l:[9],s:['9']},'593':{l:[9],s:['9']},'53':{l:[8],s:['5','6']},
  '27':{l:[9],s:['6','7','8']},'234':{l:[10],s:['7','8','9']},'254':{l:[9],s:['1','7']},
  '233':{l:[9],s:['2','5']},'251':{l:[9],s:['7','9']},'255':{l:[9],s:['6','7']},
  '256':{l:[9],s:['7']},'237':{l:[9],s:['6']},'225':{l:[10]},'221':{l:[9],s:['7']},
  '252':{l:[9],s:['6','7']},'250':{l:[9],s:['7']},
  '61':{l:[9],s:['4']},'64':{l:[8,9,10],s:['2']}
};

/**
 * Find the country code prefix for a normalized phone number.
 * Tries 3-digit, then 2-digit, then 1-digit prefixes against PHONE_RULES.
 * @param {string} n - Normalized digits-only phone number
 * @returns {string|null} Country code string, or null if not found
 */
function findCC(n) {
  if (n.length >= 3 && PHONE_RULES[n.slice(0,3)]) return n.slice(0,3);
  if (n.length >= 2 && PHONE_RULES[n.slice(0,2)]) return n.slice(0,2);
  if (n.length >= 1 && PHONE_RULES[n.slice(0,1)]) return n.slice(0,1);
  return null;
}

/**
 * Validate a normalized phone number.
 * Checks E.164 range (7-15 digits) and country-specific rules.
 * @param {string} phone - Normalized phone (digits only)
 * @returns {boolean}
 */
function validate(phone) {
  if (!phone) return false;
  if (!/^\d{7,15}$/.test(phone)) return false;
  const cc = findCC(phone);
  if (!cc) return true;
  const rule = PHONE_RULES[cc];
  const local = phone.slice(cc.length);
  if (rule.l.indexOf(local.length) === -1) {
    // Try stripping local leading zero
    if (local.charAt(0) === '0') {
      const stripped = local.slice(1);
      if (rule.l.indexOf(stripped.length) !== -1) return true;
    }
    return false;
  }
  if (rule.s && rule.s.length > 0) {
    return rule.s.some(function(p) { return local.indexOf(p) === 0; });
  }
  return true;
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

module.exports = { normalize, validate, deduplicate, PHONE_RULES, findCC };
