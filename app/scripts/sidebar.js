/**
 * sidebar.js - Ticket sidebar logic for manual SMS sending
 * Related: app/sidebar.html, app/styles/style.css, server/server.js (manualSendSms SMI)
 */

(function() {
  /** @type {Object} Mutable sidebar state (const object avoids FDK scope warnings) */
  const state = {
    client: null,
    settings: null,
    templates: null,
    contactPhone: '',
    contactName: '',
    ticketId: 0,
    ticketSubject: '',
    currentLang: 'en'
  };

  document.addEventListener('DOMContentLoaded', function() {
    app.initialized().then(function(_client) {
      state.client = _client;
      loadInitialData();
    }).catch(function() { /* ignored */ });
  });

  function loadInitialData() {
    // Load settings, templates, ticket data, and contact data in parallel
    Promise.all([
      state.client.db.get('kwtsms_settings').catch(function() { return null; }),
      state.client.db.get('kwtsms_templates').catch(function() { return null; }),
      state.client.data.get('ticket').catch(function() { return null; }),
      state.client.data.get('contact').catch(function() { return null; })
    ]).then(function(results) {
      parseSettings(results[0]);
      parseTemplates(results[1]);
      parseTicket(results[2]);
      parseContact(results[3]);
      renderSidebar();
    }).catch(function () { /* ignored */ });
  }

  function parseSettings(raw) {
    if (raw && raw.kwtsms_settings) {
      state.settings = JSON.parse(raw.kwtsms_settings);
    }
  }

  function parseTemplates(raw) {
    if (raw && raw.kwtsms_templates) {
      state.templates = JSON.parse(raw.kwtsms_templates);
    }
  }

  function parseTicket(raw) {
    if (raw && raw.ticket) {
      state.ticketId = raw.ticket.id;
      state.ticketSubject = raw.ticket.subject || '';
    }
  }

  function parseContact(raw) {
    if (raw && raw.contact) {
      state.contactName = raw.contact.name || '';
      state.contactPhone = raw.contact.phone || raw.contact.mobile || '';
    }
  }

  function renderSidebar() {
    // Check if gateway is disabled
    if (!state.settings || !state.settings.enabled) {
      document.getElementById('sidebar-content').classList.add('hidden');
      document.getElementById('sidebar-disabled').classList.remove('hidden');
      return;
    }

    // Show test mode banner
    if (state.settings.test_mode) {
      document.getElementById('test-mode-banner').classList.remove('hidden');
    }

    // Show balance
    state.client.db.get('kwtsms_gateway').then(function(data) {
      const gateway = JSON.parse(data.kwtsms_gateway);
      const balanceEl = document.getElementById('sidebar-balance');
      balanceEl.textContent = (gateway.balance || 0) + ' cr';

      const statusDot = document.getElementById('status-dot');
      statusDot.className = gateway.balance > 0 ? 'dot-green' : 'dot-red';

      // Disable send if zero balance
      if (!gateway.balance || gateway.balance <= 0) {
        document.getElementById('btn-send').disabled = true;
        document.getElementById('btn-send').textContent = 'Insufficient balance';
      }
    }).catch(function() { /* gateway data may not exist yet */ });

    // Fill recipient
    const nameEl = document.getElementById('recipient-name');
    const phoneEl = document.getElementById('recipient-phone');
    nameEl.textContent = state.contactName || 'Unknown';
    phoneEl.textContent = state.contactPhone || 'No phone number';

    // Validate phone
    const validEl = document.getElementById('phone-valid');
    if (state.contactPhone && /^\+?\d{7,15}$/.test(state.contactPhone.replace(/[\s\-()]/g, ''))) {
      validEl.textContent = 'Valid';
      validEl.className = 'validation-badge valid';
    } else if (state.contactPhone) {
      validEl.textContent = 'Invalid';
      validEl.className = 'validation-badge invalid';
      document.getElementById('btn-send').disabled = true;
    } else {
      validEl.textContent = 'Missing';
      validEl.className = 'validation-badge invalid';
      document.getElementById('btn-send').disabled = true;
      document.getElementById('no-phone-msg').classList.remove('hidden');
    }

    // Populate template dropdown
    populateTemplates();

    // Load SMS history for this contact
    loadHistory();

    // Set up character counter
    const textarea = document.getElementById('sms-message');
    textarea.addEventListener('input', updateCharCount);

    // Set initial language
    state.currentLang = (state.settings && state.settings.language) || 'en';
    updateLangButtons();
  }

  function populateTemplates() {
    if (!state.templates) return;
    const select = document.getElementById('template-select');
    // Add quick templates (subset useful for agents)
    const quickTemplates = [
      { key: 'ticket_created', label: 'Ticket created notification' },
      { key: 'status_changed', label: 'Status update' },
      { key: 'agent_reply', label: 'Agent reply notification' }
    ];
    quickTemplates.forEach(function(qt) {
      if (state.templates[qt.key]) {
        const option = document.createElement('option');
        option.value = qt.key;
        option.textContent = qt.label;
        select.appendChild(option);
      }
    });
  }

  function resolvePlaceholders(template) {
    return template
      .replace(/\{\{ticket_id\}\}/g, state.ticketId || '')
      .replace(/\{\{ticket_subject\}\}/g, state.ticketSubject || '')
      .replace(/\{\{requester_name\}\}/g, state.contactName || '')
      .replace(/\{\{requester_phone\}\}/g, state.contactPhone || '')
      .replace(/\{\{company_name\}\}/g, '')
      .replace(/\{\{agent_name\}\}/g, '')
      .replace(/\{\{ticket_status\}\}/g, '')
      .replace(/\{\{ticket_priority\}\}/g, '')
      .replace(/\{\{group_name\}\}/g, '');
  }

  // Template selection handler (called from onchange)
  window.selectTemplate = function() {
    const select = document.getElementById('template-select');
    const key = select.value;
    if (!key || !state.templates || !state.templates[key]) return;

    const template = state.templates[key][state.currentLang] || state.templates[key]['en'] || '';
    const resolved = resolvePlaceholders(template);

    document.getElementById('sms-message').value = resolved;
    updateCharCount();
  };

  // Language toggle (called from onclick)
  window.setLang = function(lang) {
    state.currentLang = lang;
    updateLangButtons();
    const textarea = document.getElementById('sms-message');
    textarea.dir = lang === 'ar' ? 'rtl' : 'ltr';
    // Re-apply template if one was selected
    const select = document.getElementById('template-select');
    if (select.value) {
      window.selectTemplate();
    }
  };

  function updateLangButtons() {
    document.getElementById('btn-lang-en').className = state.currentLang === 'en' ? 'lang-btn active' : 'lang-btn';
    document.getElementById('btn-lang-ar').className = state.currentLang === 'ar' ? 'lang-btn active' : 'lang-btn';
  }

  /** GSM-7 basic charset + extended charset as a string for lookup */
  const GSM7_ALL = '@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e'
    + ' \u00c6\u00e6\u00df\u00c9!"#\u00a4%&\'()*+,-./0123456789:;<=>?'
    + '\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0'
    + '\f^{}[]~|\\' + '\u20ac';

  function isGsm7Text(text) {
    for (let i = 0; i < text.length; i++) {
      if (GSM7_ALL.indexOf(text[i]) === -1) return false;
    }
    return true;
  }

  function updateCharCount() {
    const text = document.getElementById('sms-message').value;
    const isUnicode = !isGsm7Text(text);

    const chars = text.length;
    let parts;
    if (isUnicode) {
      parts = chars <= 70 ? 1 : Math.ceil(chars / 67);
    } else {
      parts = chars <= 160 ? 1 : Math.ceil(chars / 153);
    }

    document.getElementById('char-count').textContent = chars;
    document.getElementById('char-max').textContent = isUnicode ? '70' : '160';
    document.getElementById('sms-parts').textContent = parts;
    document.getElementById('encoding-type').textContent = isUnicode ? 'Unicode' : 'GSM-7';
  }

  // Send SMS (called from onclick)
  window.sendSms = function() {
    const message = document.getElementById('sms-message').value.trim();
    if (!message) {
      showToast('Please enter a message', 'error');
      return;
    }
    if (!state.contactPhone) {
      showToast('No phone number available', 'error');
      return;
    }

    const btn = document.getElementById('btn-send');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    state.client.request.invoke('manualSendSms', {
      data: {
        phone: state.contactPhone,
        message: message,
        ticket_id: state.ticketId
      }
    }).then(function(data) {
      const result = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;
      if (result.success) {
        showToast('SMS sent successfully', 'success');
        document.getElementById('sms-message').value = '';
        updateCharCount();
        loadHistory(); // Refresh history
      } else {
        showToast(result.message || 'Failed to send SMS', 'error');
      }
    }).catch(function(err) {
      showToast('Failed to send SMS: ' + (err.message || 'Unknown error'), 'error');
    }).finally(function() {
      btn.disabled = false;
      btn.textContent = 'Send SMS';
    });
  };

  function loadHistory() {
    if (!state.contactPhone) return;

    // Normalize phone for Entity Store query
    const normalizedPhone = state.contactPhone.replace(/\D/g, '').replace(/^0+/, '');

    state.client.db.entity.getAll('sms_log', {
      filter: { recipient_phone: normalizedPhone },
      page_size: 5
    }).then(function(data) {
      const historyList = document.getElementById('history-list');
      // Clear existing
      while (historyList.firstChild) {
        historyList.removeChild(historyList.firstChild);
      }

      const records = data.records || data.data || [];
      if (records.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'history-empty';
        emptyEl.textContent = 'No SMS history';
        historyList.appendChild(emptyEl);
        return;
      }

      records.forEach(function(record) {
        const attrs = record.attributes || record;
        const item = document.createElement('div');
        item.className = 'history-item';

        const header = document.createElement('div');
        header.className = 'history-header';

        const status = document.createElement('span');
        status.className = attrs.status === 'sent' ? 'history-status sent' : 'history-status failed';
        status.textContent = attrs.status === 'sent' ? 'Sent' : 'Failed';

        const time = document.createElement('span');
        time.className = 'history-time';
        time.textContent = formatRelativeTime(attrs.timestamp);

        header.appendChild(status);
        header.appendChild(time);

        const preview = document.createElement('div');
        preview.className = 'history-preview';
        preview.textContent = attrs.message_preview || '';

        item.appendChild(header);
        item.appendChild(preview);
        historyList.appendChild(item);
      });
    }).catch(function() {
      // Entity Store may not have data yet
    });
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + ' min ago';
    if (diffHours < 24) return diffHours + ' hr ago';
    if (diffDays < 7) return diffDays + ' day(s) ago';
    return date.toLocaleDateString();
  }

  function showToast(message, type) {
    const toast = document.getElementById('sidebar-toast');
    toast.textContent = message;
    toast.className = 'sidebar-toast ' + type + ' show';
    setTimeout(function() {
      toast.className = 'sidebar-toast';
    }, 3000);
  }
})();
