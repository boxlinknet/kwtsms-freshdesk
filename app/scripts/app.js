/**
 * app.js - kwtSMS for Freshdesk Full Page App
 *
 * Main application logic for the admin UI. Handles 6 tabs:
 * Dashboard, Settings, Templates, Logs, Admin Alerts, Help.
 *
 * Uses Freshworks FDK client SDK for Data Storage, Entity Store,
 * and serverless invocations.
 *
 * Related: app/index.html, app/styles/style.css, server/server.js
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Constants (mirror server/lib/constants.js)
  // ──────────────────────────────────────────────

  /** @type {Object} Data Storage key names */
  const DS_KEYS = {
    SETTINGS: 'kwtsms_settings',
    GATEWAY: 'kwtsms_gateway',
    TEMPLATES: 'kwtsms_templates',
    ADMIN_ALERTS: 'kwtsms_admin_alerts',
    STATS: 'kwtsms_stats'
  };

  /** @type {string} Entity Store entity name */
  const ENTITY_SMS_LOG = 'sms_log';

  /** @type {Object} Default settings */
  const DEFAULT_SETTINGS = {
    enabled: false,
    test_mode: true,
    debug: false,
    language: 'en',
    active_sender_id: 'KWT-SMS',
    schema_version: 1
  };

  /** @type {Object} Default admin alerts */
  const DEFAULT_ADMIN_ALERTS = {
    phones: [],
    events: {
      new_ticket: true,
      high_priority: true,
      escalation: true
    }
  };

  /** @type {string} GSM-7 character set for SMS part calculation */
  const GSM7_CHARS = '@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9 !"#\u00a4%&\'()*+,-./0123456789:;<=>?'
    + '\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0';

  /** @type {string} GSM-7 extended chars (count as 2 characters) */
  const GSM7_EXTENDED = '|^{}[]~\\€';

  // ──────────────────────────────────────────────
  // Application State
  // ──────────────────────────────────────────────

  /** @type {Object|null} Freshworks client instance */
  let client = null;

  /** @type {Object} Current loaded settings */
  let currentSettings = null;

  /** @type {Object} Current loaded templates */
  let currentTemplates = {};

  /** @type {Object} Current loaded admin alerts */
  let currentAdminAlerts = null;

  /** @type {string} Currently selected template event */
  let activeTemplateEvent = 'ticket_created';

  /** @type {number} Current log page */
  let logPage = 1;

  /** @type {number} Logs per page */
  const LOG_PAGE_SIZE = 20;

  /** @type {boolean} Whether we are in RTL mode */
  let isRTL = false;

  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────

  /**
   * Initialize the Freshworks client SDK and boot the app.
   */
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof app !== 'undefined' && app.initialized) {
      app.initialized().then(function (_client) {
        client = _client;
        bootApp();
      }).catch(function (err) {
        console.error('[kwtsms] FDK init failed:', err);
        showToast('Failed to initialize app. Please reload.', 'error');
      });
    } else {
      // Development fallback (no FDK)
      console.warn('[kwtsms] FDK not available, running in dev mode');
      bootApp();
    }
  });

  /**
   * Boot the app after SDK initialization.
   * Sets up tab navigation and loads initial data.
   */
  function bootApp() {
    setupTabNavigation();
    setupLanguageToggle();
    setupSettingsHandlers();
    setupTemplateHandlers();
    setupLogHandlers();
    setupAlertHandlers();
    loadDashboard();
  }

  // ──────────────────────────────────────────────
  // Tab Navigation
  // ──────────────────────────────────────────────

  /**
   * Set up click handlers for tab switching.
   */
  function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    for (let i = 0; i < tabButtons.length; i++) {
      tabButtons[i].addEventListener('click', handleTabClick);
    }
  }

  /**
   * Handle tab button click. Shows the selected panel and hides others.
   * @param {Event} e - Click event
   */
  function handleTabClick(e) {
    const targetTab = e.currentTarget.getAttribute('data-tab');
    activateTab(targetTab);
  }

  /**
   * Activate a specific tab by ID.
   * @param {string} tabId - Tab identifier (e.g., "dashboard", "settings")
   */
  function activateTab(tabId) {
    // Update buttons
    const tabButtons = document.querySelectorAll('.tab-btn');
    for (let i = 0; i < tabButtons.length; i++) {
      const btn = tabButtons[i];
      const isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }

    // Update panels
    const panels = document.querySelectorAll('.tab-panel');
    for (let j = 0; j < panels.length; j++) {
      panels[j].classList.toggle('active', panels[j].id === 'tab-' + tabId);
    }

    // Load data for the activated tab
    switch (tabId) {
      case 'dashboard': loadDashboard(); break;
      case 'settings': loadSettings(); break;
      case 'templates': loadTemplates(); break;
      case 'logs': loadLogs(); break;
      case 'admin-alerts': loadAdminAlerts(); break;
      // help is static, no loading needed
    }
  }

  // ──────────────────────────────────────────────
  // Language / RTL Toggle
  // ──────────────────────────────────────────────

  /**
   * Set up the language direction toggle button.
   */
  function setupLanguageToggle() {
    const btn = document.getElementById('btn-lang-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        isRTL = !isRTL;
        document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        const label = document.getElementById('lang-toggle-label');
        if (label) {
          label.textContent = isRTL ? 'EN' : 'AR';
        }
      });
    }
  }

  // ──────────────────────────────────────────────
  // Data Storage Helpers
  // ──────────────────────────────────────────────

  /**
   * Read a value from Data Storage.
   * @param {string} key - DS key
   * @returns {Promise<Object|null>} Parsed value or null
   */
  function dbGet(key) {
    if (!client) return Promise.resolve(null);
    return client.db.get(key).then(function (result) {
      const raw = result[key];
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (e) { return raw; }
      }
      return raw || null;
    }).catch(function () {
      return null;
    });
  }

  /**
   * Write a value to Data Storage.
   * @param {string} key - DS key
   * @param {Object} value - Value to store (will be JSON stringified)
   * @returns {Promise}
   */
  function dbSet(key, value) {
    if (!client) return Promise.resolve();
    return client.db.set(key, { data: JSON.stringify(value) });
  }

  /**
   * Query Entity Store records.
   * @param {string} entity - Entity name
   * @param {Object} [opts] - Query options (filter, page, page_size)
   * @returns {Promise<Object>} Query result
   */
  function entityGetAll(entity, opts) {
    if (!client) return Promise.resolve({ records: [], next: null });
    const params = opts || {};
    return client.db.entity.getAll(entity, params).catch(function () {
      return { records: [], next: null };
    });
  }

  /**
   * Delete all records in an entity.
   * @param {string} entity - Entity name
   * @returns {Promise}
   */
  function entityDeleteAll(entity) {
    if (!client) return Promise.resolve();
    return client.db.entity.deleteAll(entity).catch(function () {
      // Ignore errors
    });
  }

  // ──────────────────────────────────────────────
  // Toast Notifications
  // ──────────────────────────────────────────────

  /**
   * Show a toast notification.
   * @param {string} message - Toast message text
   * @param {string} [type] - Type: "success", "error", "warning", or default
   */
  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type) {
      toast.className += ' toast-' + type;
    }
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('toast-out');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  // ──────────────────────────────────────────────
  // SMS Character Counter
  // ──────────────────────────────────────────────

  /**
   * Check if a string is pure GSM-7 encoding.
   * @param {string} text - Text to check
   * @returns {boolean} True if all characters are GSM-7
   */
  function isGSM7(text) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (GSM7_CHARS.indexOf(ch) === -1 && GSM7_EXTENDED.indexOf(ch) === -1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Count the effective GSM-7 character length (extended chars count as 2).
   * @param {string} text - Text to measure
   * @returns {number} GSM-7 character count
   */
  function gsm7Length(text) {
    let len = 0;
    for (let i = 0; i < text.length; i++) {
      len += GSM7_EXTENDED.indexOf(text[i]) !== -1 ? 2 : 1;
    }
    return len;
  }

  /**
   * Calculate SMS character count and number of parts.
   * @param {string} text - Message text
   * @returns {{ chars: number, parts: number, encoding: string }}
   */
  function calculateSmsParts(text) {
    if (!text || text.length === 0) {
      return { chars: 0, parts: 0, encoding: 'gsm7' };
    }

    if (isGSM7(text)) {
      const charCount = gsm7Length(text);
      let parts;
      if (charCount <= 160) {
        parts = 1;
      } else {
        parts = Math.ceil(charCount / 153);
      }
      return { chars: charCount, parts: parts, encoding: 'gsm7' };
    }

    // Unicode
    const uniLen = text.length;
    let uniParts;
    if (uniLen <= 70) {
      uniParts = 1;
    } else {
      uniParts = Math.ceil(uniLen / 67);
    }
    return { chars: uniLen, parts: uniParts, encoding: 'unicode' };
  }

  /**
   * Update the character counter display for a template textarea.
   * @param {HTMLTextAreaElement} textarea - The textarea element
   * @param {string} counterId - ID of the counter span
   */
  function updateCharCounter(textarea, counterId) {
    const counter = document.getElementById(counterId);
    if (!counter) return;
    const info = calculateSmsParts(textarea.value);
    counter.textContent = info.chars + ' chars / ' + (info.parts || 1) + ' SMS';
    if (info.parts > 3) {
      counter.classList.add('warn');
    } else {
      counter.classList.remove('warn');
    }
  }

  // ──────────────────────────────────────────────
  // Utility: Text rendering
  // ──────────────────────────────────────────────

  /**
   * Truncate a string to a max length.
   * @param {string} str - Input string
   * @param {number} max - Max length
   * @returns {string}
   */
  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  /**
   * Format an ISO date string to a friendly short format.
   * @param {string} isoStr - ISO date string
   * @returns {string} Formatted date
   */
  function formatDate(isoStr) {
    if (!isoStr) return '--';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoStr;
    }
  }

  /**
   * Format event type key to a readable label.
   * @param {string} eventType - Event type key
   * @returns {string}
   */
  function formatEventLabel(eventType) {
    const labels = {
      'ticket_created': 'Ticket Created',
      'status_changed': 'Status Changed',
      'agent_reply': 'Agent Reply',
      'admin_new_ticket': 'New Ticket (Admin)',
      'admin_high_priority': 'High Priority (Admin)',
      'admin_escalation': 'Escalation (Admin)',
      'manual_send': 'Manual Send'
    };
    return labels[eventType] || eventType;
  }

  // ──────────────────────────────────────────────
  // Dashboard Tab
  // ──────────────────────────────────────────────

  /**
   * Load and render dashboard data: stats, gateway, recent activity.
   */
  function loadDashboard() {
    loadDashboardStats();
    loadDashboardGateway();
    loadRecentActivity();
  }

  /**
   * Load and render stat cards from Data Storage.
   */
  function loadDashboardStats() {
    dbGet(DS_KEYS.STATS).then(function (stats) {
      if (!stats) return;
      setText('stat-today', String(stats.today_sent || 0));
      setText('stat-month', String(stats.month_sent || 0));
      setText('stat-failed', String(stats.month_failed || 0));
    }).catch(function () {});

    // Balance comes from gateway data
    dbGet(DS_KEYS.GATEWAY).then(function (gw) {
      if (gw && typeof gw.balance !== 'undefined') {
        setText('stat-balance', String(gw.balance));
      }
    }).catch(function () {});
  }

  /**
   * Load and render gateway status indicators.
   */
  function loadDashboardGateway() {
    dbGet(DS_KEYS.SETTINGS).then(function (settings) {
      currentSettings = settings || DEFAULT_SETTINGS;

      // Connected dot: if we have gateway data, we're connected
      dbGet(DS_KEYS.GATEWAY).then(function (gw) {
        const connected = gw && gw.last_sync;
        setStatusDot('gw-connected-dot', connected ? 'on' : 'off');
        setText('gw-connected-text', connected ? 'Connected' : 'Disconnected');

        const enabled = currentSettings.enabled;
        setStatusDot('gw-enabled-dot', enabled ? 'on' : 'off');
        setText('gw-enabled-text', enabled ? 'Enabled' : 'Disabled');

        const testMode = currentSettings.test_mode;
        setStatusDot('gw-testmode-dot', testMode ? 'warn' : 'on');
        setText('gw-testmode-text', testMode ? 'Test Mode: ON' : 'Test Mode: OFF');

        setText('gw-sender-id', currentSettings.active_sender_id || '--');
      }).catch(function () {});
    }).catch(function () {});
  }

  /**
   * Load and render recent activity table from Entity Store.
   */
  function loadRecentActivity() {
    entityGetAll(ENTITY_SMS_LOG, { page_size: 5 }).then(function (result) {
      const records = (result && result.records) || [];
      renderActivityTable('recent-activity-body', records, 'No recent activity');
    }).catch(function () {});
  }

  /**
   * Set textContent of an element by ID.
   * @param {string} id - Element ID
   * @param {string} text - Text content
   */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * Set a status dot class.
   * @param {string} id - Dot element ID
   * @param {string} state - "on", "off", or "warn"
   */
  function setStatusDot(id, state) {
    const dot = document.getElementById(id);
    if (!dot) return;
    dot.classList.remove('status-on', 'status-off', 'status-warn');
    dot.classList.add('status-' + state);
  }

  /**
   * Render SMS log records into a table body.
   * @param {string} tbodyId - Table body element ID
   * @param {Array} records - Entity Store records
   * @param {string} emptyMsg - Message when no records
   */
  function renderActivityTable(tbodyId, records, emptyMsg) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // Clear existing rows
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }

    if (!records || records.length === 0) {
      const emptyTr = document.createElement('tr');
      emptyTr.className = 'empty-row';
      const emptyTd = document.createElement('td');
      emptyTd.setAttribute('colspan', '5');
      emptyTd.textContent = emptyMsg;
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      return;
    }

    for (let i = 0; i < records.length; i++) {
      const rec = records[i].data || records[i];
      const tr = document.createElement('tr');

      // Time
      const tdTime = document.createElement('td');
      tdTime.textContent = formatDate(rec.timestamp);
      tr.appendChild(tdTime);

      // Event type badge
      const tdEvent = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge badge-event';
      badge.textContent = formatEventLabel(rec.event_type);
      tdEvent.appendChild(badge);
      tr.appendChild(tdEvent);

      // Recipient
      const tdRecip = document.createElement('td');
      tdRecip.textContent = rec.recipient_phone || '--';
      tr.appendChild(tdRecip);

      // Message (truncated)
      const tdMsg = document.createElement('td');
      const msgSpan = document.createElement('span');
      msgSpan.className = 'text-truncate';
      msgSpan.textContent = truncate(rec.message_preview, 50);
      msgSpan.title = rec.message_preview || '';
      tdMsg.appendChild(msgSpan);
      tr.appendChild(tdMsg);

      // Status badge
      const tdStatus = document.createElement('td');
      const statusBadge = document.createElement('span');
      const isSent = rec.status === 'sent';
      statusBadge.className = 'badge ' + (isSent ? 'badge-sent' : 'badge-failed');
      statusBadge.textContent = isSent ? 'Sent' : 'Failed';
      tdStatus.appendChild(statusBadge);
      tr.appendChild(tdStatus);

      tbody.appendChild(tr);
    }
  }

  // ──────────────────────────────────────────────
  // Settings Tab
  // ──────────────────────────────────────────────

  /**
   * Set up event handlers for settings controls.
   */
  function setupSettingsHandlers() {
    // Toggle switches
    addChangeListener('setting-enabled', function (val) { saveSettingField('enabled', val); });
    addChangeListener('setting-test-mode', function (val) { saveSettingField('test_mode', val); });
    addChangeListener('setting-debug', function (val) { saveSettingField('debug', val); });

    // Dropdowns
    addSelectListener('setting-language', function (val) { saveSettingField('language', val); });
    addSelectListener('setting-sender-id', function (val) { saveSettingField('active_sender_id', val); });

    // Sync Now button
    const syncBtn = document.getElementById('btn-sync-now');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSyncNow);
    }

    // Send Test SMS button
    const testBtn = document.getElementById('btn-send-test');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        showModal('modal-test-sms');
      });
    }

    // Test SMS modal
    setupModalClose('modal-test-sms', 'modal-test-close', 'modal-test-cancel');
    const sendTestBtn = document.getElementById('modal-test-send');
    if (sendTestBtn) {
      sendTestBtn.addEventListener('click', handleSendTestSms);
    }
  }

  /**
   * Load settings from Data Storage and render into the form.
   */
  function loadSettings() {
    dbGet(DS_KEYS.SETTINGS).then(function (settings) {
      currentSettings = settings || DEFAULT_SETTINGS;
      setCheckbox('setting-enabled', currentSettings.enabled);
      setCheckbox('setting-test-mode', currentSettings.test_mode);
      setCheckbox('setting-debug', currentSettings.debug);
      setSelectValue('setting-language', currentSettings.language);
      setSelectValue('setting-sender-id', currentSettings.active_sender_id);
    }).catch(function () {});

    // Gateway info
    dbGet(DS_KEYS.GATEWAY).then(function (gw) {
      if (gw) {
        setText('info-gw-status', gw.last_sync ? 'Connected' : 'Disconnected');
        setText('info-gw-balance', String(gw.balance || 0) + ' credits');
        setText('info-gw-senders', gw.senderids ? gw.senderids.join(', ') : '--');
        setText('info-gw-coverage', gw.coverage ? gw.coverage.length + ' countries' : '--');
        setText('info-gw-last-sync', formatDate(gw.last_sync));

        // Populate sender ID dropdown
        populateSenderDropdown(gw.senderids || []);
      }
    }).catch(function () {});
  }

  /**
   * Populate the sender ID dropdown with available IDs.
   * @param {string[]} senderIds - Available sender IDs
   */
  function populateSenderDropdown(senderIds) {
    const select = document.getElementById('setting-sender-id');
    if (!select) return;

    // Clear existing options
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    if (senderIds.length === 0) {
      const opt = document.createElement('option');
      opt.value = 'KWT-SMS';
      opt.textContent = 'KWT-SMS';
      select.appendChild(opt);
      return;
    }

    for (let i = 0; i < senderIds.length; i++) {
      const option = document.createElement('option');
      option.value = senderIds[i];
      option.textContent = senderIds[i];
      select.appendChild(option);
    }

    // Restore current selection
    if (currentSettings && currentSettings.active_sender_id) {
      select.value = currentSettings.active_sender_id;
    }
  }

  /**
   * Save a single setting field to Data Storage.
   * @param {string} field - Field name
   * @param {*} value - New value
   */
  function saveSettingField(field, value) {
    if (!currentSettings) currentSettings = Object.assign({}, DEFAULT_SETTINGS);
    currentSettings[field] = value;
    dbSet(DS_KEYS.SETTINGS, currentSettings).then(function () {
      showToast('Setting saved', 'success');
    }).catch(function () {
      showToast('Failed to save setting', 'error');
    });
  }

  /**
   * Handle Sync Now button click: invoke syncGateway or simulate.
   */
  function handleSyncNow() {
    const btn = document.getElementById('btn-sync-now');
    if (btn) btn.disabled = true;

    if (client && client.request && client.request.invoke) {
      client.request.invoke('syncGateway', {}).then(function () {
        showToast('Gateway synced successfully', 'success');
        loadSettings();
        loadDashboard();
      }).catch(function (err) {
        // Fallback: try invoking templates directly
        syncGatewayDirect().then(function () {
          showToast('Gateway synced successfully', 'success');
          loadSettings();
          loadDashboard();
        }).catch(function () {
          showToast('Sync failed: ' + (err.message || 'Unknown error'), 'error');
        });
      }).finally(function () {
        if (btn) btn.disabled = false;
      });
    } else {
      showToast('Cannot sync: client not available', 'error');
      if (btn) btn.disabled = false;
    }
  }

  /**
   * Attempt a direct gateway sync using request templates.
   * @returns {Promise}
   */
  function syncGatewayDirect() {
    if (!client) return Promise.reject(new Error('No client'));

    return client.iparams.get('kwtsms_username', 'kwtsms_password').then(function (iparams) {
      const credBody = JSON.stringify({
        username: iparams.kwtsms_username,
        password: iparams.kwtsms_password
      });

      return Promise.all([
        client.request.invokeTemplate('checkBalance', { body: credBody }),
        client.request.invokeTemplate('getSenderIds', { body: credBody }),
        client.request.invokeTemplate('getCoverage', { body: credBody })
      ]);
    }).then(function (results) {
      const balance = JSON.parse(results[0].response);
      const senders = JSON.parse(results[1].response);
      const coverage = JSON.parse(results[2].response);

      const gateway = {
        balance: balance.available || 0,
        senderids: senders.senderid || [],
        coverage: coverage.coverage || [],
        last_sync: new Date().toISOString()
      };

      return dbSet(DS_KEYS.GATEWAY, gateway);
    });
  }

  /**
   * Handle Send Test SMS from modal.
   */
  function handleSendTestSms() {
    const phoneInput = document.getElementById('test-phone');
    const msgInput = document.getElementById('test-message');
    if (!phoneInput || !msgInput) return;

    const phone = phoneInput.value.trim();
    const message = msgInput.value.trim();

    if (!phone) {
      showToast('Please enter a phone number', 'warning');
      return;
    }
    if (!message) {
      showToast('Please enter a message', 'warning');
      return;
    }

    const sendBtn = document.getElementById('modal-test-send');
    if (sendBtn) sendBtn.disabled = true;

    if (client && client.request && client.request.invoke) {
      client.request.invoke('manualSendSms', {
        data: { phone: phone, message: message }
      }).then(function (result) {
        if (result && result.response && result.response.success !== false) {
          showToast('Test SMS sent successfully', 'success');
          hideModal('modal-test-sms');
          phoneInput.value = '';
          msgInput.value = '';
        } else {
          showToast('Failed to send test SMS', 'error');
        }
      }).catch(function (err) {
        showToast('Error: ' + (err.message || 'Send failed'), 'error');
      }).finally(function () {
        if (sendBtn) sendBtn.disabled = false;
      });
    } else {
      showToast('Cannot send: client not available', 'error');
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ──────────────────────────────────────────────
  // Templates Tab
  // ──────────────────────────────────────────────

  /**
   * Set up event handlers for the templates tab.
   */
  function setupTemplateHandlers() {
    // Pill buttons
    const pills = document.querySelectorAll('.pill-btn[data-event]');
    for (let i = 0; i < pills.length; i++) {
      pills[i].addEventListener('click', function (e) {
        const event = e.currentTarget.getAttribute('data-event');
        selectTemplateEvent(event);
      });
    }

    // Character counters
    const enTextarea = document.getElementById('template-en');
    const arTextarea = document.getElementById('template-ar');
    if (enTextarea) {
      enTextarea.addEventListener('input', function () {
        updateCharCounter(enTextarea, 'counter-en');
      });
    }
    if (arTextarea) {
      arTextarea.addEventListener('input', function () {
        updateCharCounter(arTextarea, 'counter-ar');
      });
    }

    // Placeholder chips
    const chips = document.querySelectorAll('.chip[data-placeholder]');
    for (let j = 0; j < chips.length; j++) {
      chips[j].addEventListener('click', function (e) {
        const placeholder = e.currentTarget.getAttribute('data-placeholder');
        insertPlaceholder(placeholder);
      });
    }

    // Save and reset buttons
    const saveBtn = document.getElementById('btn-template-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleTemplateSave);
    }

    const resetBtn = document.getElementById('btn-template-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', handleTemplateReset);
    }
  }

  /**
   * Load templates from Data Storage.
   */
  function loadTemplates() {
    dbGet(DS_KEYS.TEMPLATES).then(function (templates) {
      currentTemplates = templates || {};
      renderActiveTemplate();
    }).catch(function () {});
  }

  /**
   * Select a template event and update the pill nav and editor.
   * @param {string} eventKey - Template event key
   */
  function selectTemplateEvent(eventKey) {
    activeTemplateEvent = eventKey;

    // Update pills
    const pills = document.querySelectorAll('.pill-btn[data-event]');
    for (let i = 0; i < pills.length; i++) {
      pills[i].classList.toggle('active', pills[i].getAttribute('data-event') === eventKey);
    }

    renderActiveTemplate();
  }

  /**
   * Render the currently active template into the editor textareas.
   */
  function renderActiveTemplate() {
    const enTextarea = document.getElementById('template-en');
    const arTextarea = document.getElementById('template-ar');
    if (!enTextarea || !arTextarea) return;

    const tmpl = currentTemplates[activeTemplateEvent] || {};
    enTextarea.value = tmpl.en || '';
    arTextarea.value = tmpl.ar || '';

    updateCharCounter(enTextarea, 'counter-en');
    updateCharCounter(arTextarea, 'counter-ar');
  }

  /**
   * Insert a placeholder string into the last focused template textarea.
   * @param {string} placeholder - Placeholder text (e.g., "{{ticket_id}}")
   */
  function insertPlaceholder(placeholder) {
    // Try to insert into the last focused textarea
    const enTextarea = document.getElementById('template-en');
    const arTextarea = document.getElementById('template-ar');
    let target = document.activeElement;

    if (target !== enTextarea && target !== arTextarea) {
      target = enTextarea; // Default to English
    }

    if (target) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const val = target.value;
      target.value = val.substring(0, start) + placeholder + val.substring(end);
      target.selectionStart = target.selectionEnd = start + placeholder.length;
      target.focus();

      // Trigger counter update
      const counterId = target === enTextarea ? 'counter-en' : 'counter-ar';
      updateCharCounter(target, counterId);
    }
  }

  /**
   * Save all templates to Data Storage.
   */
  function handleTemplateSave() {
    // Save current textarea values to the active event first
    const enTextarea = document.getElementById('template-en');
    const arTextarea = document.getElementById('template-ar');
    if (enTextarea && arTextarea) {
      if (!currentTemplates[activeTemplateEvent]) {
        currentTemplates[activeTemplateEvent] = {};
      }
      currentTemplates[activeTemplateEvent].en = enTextarea.value;
      currentTemplates[activeTemplateEvent].ar = arTextarea.value;
    }

    dbSet(DS_KEYS.TEMPLATES, currentTemplates).then(function () {
      showToast('Templates saved', 'success');
    }).catch(function () {
      showToast('Failed to save templates', 'error');
    });
  }

  /**
   * Reset the active template to defaults.
   */
  function handleTemplateReset() {
    const defaults = getDefaultTemplates();
    const tmpl = defaults[activeTemplateEvent];
    if (!tmpl) return;

    currentTemplates[activeTemplateEvent] = { en: tmpl.en, ar: tmpl.ar };
    renderActiveTemplate();
    showToast('Template reset to default (save to apply)', 'warning');
  }

  /**
   * Get default template definitions.
   * @returns {Object} Default templates
   */
  function getDefaultTemplates() {
    return {
      ticket_created: {
        en: "Your support ticket #{{ticket_id}} has been created. Subject: {{ticket_subject}}. We'll get back to you soon. - {{company_name}}",
        ar: "\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u062f\u0639\u0645 \u0631\u0642\u0645 #{{ticket_id}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0633\u0646\u0639\u0648\u062f \u0625\u0644\u064a\u0643 \u0642\u0631\u064a\u0628\u0627. - {{company_name}}"
      },
      status_changed: {
        en: "Your ticket #{{ticket_id}} status has been updated to: {{ticket_status}}. Subject: {{ticket_subject}}. - {{company_name}}",
        ar: "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u062d\u0627\u0644\u0629 \u062a\u0630\u0643\u0631\u062a\u0643 \u0631\u0642\u0645 #{{ticket_id}} \u0625\u0644\u0649: {{ticket_status}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. - {{company_name}}"
      },
      agent_reply: {
        en: "New reply on your ticket #{{ticket_id}} from {{agent_name}}. Subject: {{ticket_subject}}. Please check your email for details. - {{company_name}}",
        ar: "\u0631\u062f \u062c\u062f\u064a\u062f \u0639\u0644\u0649 \u062a\u0630\u0643\u0631\u062a\u0643 \u0631\u0642\u0645 #{{ticket_id}} \u0645\u0646 {{agent_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0628\u0631\u064a\u062f\u0643 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a. - {{company_name}}"
      },
      admin_new_ticket: {
        en: "New ticket #{{ticket_id}} from {{requester_name}}. Subject: {{ticket_subject}}. Priority: {{ticket_priority}}.",
        ar: "\u062a\u0630\u0643\u0631\u0629 \u062c\u062f\u064a\u062f\u0629 #{{ticket_id}} \u0645\u0646 {{requester_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629: {{ticket_priority}}."
      },
      admin_high_priority: {
        en: "New HIGH PRIORITY ticket #{{ticket_id}} from {{requester_name}}. Subject: {{ticket_subject}}. Priority: {{ticket_priority}}.",
        ar: "\u062a\u0630\u0643\u0631\u0629 \u062c\u062f\u064a\u062f\u0629 \u0639\u0627\u0644\u064a\u0629 \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629 #{{ticket_id}} \u0645\u0646 {{requester_name}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0629: {{ticket_priority}}."
      },
      admin_escalation: {
        en: "ALERT: Ticket #{{ticket_id}} escalated to {{ticket_priority}}. Subject: {{ticket_subject}}. Assigned to: {{agent_name}}.",
        ar: "\u062a\u0646\u0628\u064a\u0647: \u062a\u0645 \u062a\u0635\u0639\u064a\u062f \u0627\u0644\u062a\u0630\u0643\u0631\u0629 #{{ticket_id}} \u0625\u0644\u0649 {{ticket_priority}}. \u0627\u0644\u0645\u0648\u0636\u0648\u0639: {{ticket_subject}}. \u0645\u0633\u0646\u062f\u0629 \u0625\u0644\u0649: {{agent_name}}."
      }
    };
  }

  // ──────────────────────────────────────────────
  // Logs Tab
  // ──────────────────────────────────────────────

  /**
   * Set up event handlers for the logs tab.
   */
  function setupLogHandlers() {
    const filterBtn = document.getElementById('btn-log-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', function () {
        logPage = 1;
        loadLogs();
      });
    }

    const prevBtn = document.getElementById('btn-log-prev');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (logPage > 1) {
          logPage--;
          loadLogs();
        }
      });
    }

    const nextBtn = document.getElementById('btn-log-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        logPage++;
        loadLogs();
      });
    }

    const clearBtn = document.getElementById('btn-log-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        showModal('modal-clear-logs');
      });
    }

    // Clear logs modal
    setupModalClose('modal-clear-logs', 'modal-clear-close', 'modal-clear-cancel');
    const confirmClear = document.getElementById('modal-clear-confirm');
    if (confirmClear) {
      confirmClear.addEventListener('click', handleClearLogs);
    }
  }

  /**
   * Load and render logs from Entity Store with filters.
   */
  function loadLogs() {
    const eventFilter = document.getElementById('log-filter-event');
    const statusFilter = document.getElementById('log-filter-status');

    const params = {
      page: logPage,
      page_size: LOG_PAGE_SIZE
    };

    // Build filter object
    const filter = {};
    if (eventFilter && eventFilter.value) {
      filter.event_type = eventFilter.value;
    }
    if (statusFilter && statusFilter.value) {
      filter.status = statusFilter.value;
    }
    if (Object.keys(filter).length > 0) {
      params.filter = filter;
    }

    entityGetAll(ENTITY_SMS_LOG, params).then(function (result) {
      const records = (result && result.records) || [];
      renderActivityTable('log-table-body', records, 'No SMS logs yet');

      // Update pagination
      const prevBtn = document.getElementById('btn-log-prev');
      const nextBtn = document.getElementById('btn-log-next');
      const pageInfo = document.getElementById('log-page-info');

      if (prevBtn) prevBtn.disabled = logPage <= 1;
      if (nextBtn) nextBtn.disabled = !result || !result.next;
      if (pageInfo) pageInfo.textContent = 'Page ' + logPage;
    }).catch(function () {});
  }

  /**
   * Handle Clear Logs confirmation.
   */
  function handleClearLogs() {
    entityDeleteAll(ENTITY_SMS_LOG).then(function () {
      showToast('All logs cleared', 'success');
      hideModal('modal-clear-logs');
      logPage = 1;
      loadLogs();
    }).catch(function () {
      showToast('Failed to clear logs', 'error');
    });
  }

  // ──────────────────────────────────────────────
  // Admin Alerts Tab
  // ──────────────────────────────────────────────

  /**
   * Set up event handlers for the admin alerts tab.
   */
  function setupAlertHandlers() {
    const addBtn = document.getElementById('btn-alert-add');
    if (addBtn) {
      addBtn.addEventListener('click', handleAddAlertPhone);
    }

    const phoneInput = document.getElementById('alert-phone-input');
    if (phoneInput) {
      phoneInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          handleAddAlertPhone();
        }
      });
    }

    const saveBtn = document.getElementById('btn-alert-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSaveAlerts);
    }
  }

  /**
   * Load admin alerts from Data Storage.
   */
  function loadAdminAlerts() {
    dbGet(DS_KEYS.ADMIN_ALERTS).then(function (alerts) {
      currentAdminAlerts = alerts || Object.assign({}, DEFAULT_ADMIN_ALERTS);
      renderAlertPhones();
      setCheckbox('alert-new-ticket', currentAdminAlerts.events.new_ticket);
      setCheckbox('alert-high-priority', currentAdminAlerts.events.high_priority);
      setCheckbox('alert-escalation', currentAdminAlerts.events.escalation);
    }).catch(function () {});
  }

  /**
   * Render the phone list for admin alerts.
   */
  function renderAlertPhones() {
    const list = document.getElementById('alert-phone-list');
    const emptyMsg = document.getElementById('alert-phones-empty');
    if (!list) return;

    // Clear existing
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }

    const phones = (currentAdminAlerts && currentAdminAlerts.phones) || [];

    if (emptyMsg) {
      emptyMsg.style.display = phones.length === 0 ? 'block' : 'none';
    }

    for (let i = 0; i < phones.length; i++) {
      const li = document.createElement('li');
      li.className = 'phone-item';

      const numSpan = document.createElement('span');
      numSpan.className = 'phone-number';
      numSpan.textContent = phones[i];
      li.appendChild(numSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'phone-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('data-phone', phones[i]);
      removeBtn.addEventListener('click', handleRemoveAlertPhone);
      li.appendChild(removeBtn);

      list.appendChild(li);
    }
  }

  /**
   * Handle adding a new alert phone number.
   */
  function handleAddAlertPhone() {
    const input = document.getElementById('alert-phone-input');
    if (!input) return;

    const phone = input.value.trim();
    if (!phone) {
      showToast('Please enter a phone number', 'warning');
      return;
    }

    // Basic phone validation (starts with + and has digits)
    if (!/^\+?\d{8,15}$/.test(phone.replace(/\s/g, ''))) {
      showToast('Invalid phone number format', 'error');
      return;
    }

    if (!currentAdminAlerts) {
      currentAdminAlerts = Object.assign({}, DEFAULT_ADMIN_ALERTS);
    }

    // Check for duplicates
    if (currentAdminAlerts.phones.indexOf(phone) !== -1) {
      showToast('Phone number already added', 'warning');
      return;
    }

    currentAdminAlerts.phones.push(phone);
    input.value = '';
    renderAlertPhones();
    showToast('Phone added (save to apply)', 'success');
  }

  /**
   * Handle removing an alert phone number.
   * @param {Event} e - Click event
   */
  function handleRemoveAlertPhone(e) {
    const phone = e.currentTarget.getAttribute('data-phone');
    if (!currentAdminAlerts || !phone) return;

    const idx = currentAdminAlerts.phones.indexOf(phone);
    if (idx !== -1) {
      currentAdminAlerts.phones.splice(idx, 1);
      renderAlertPhones();
      showToast('Phone removed (save to apply)', 'success');
    }
  }

  /**
   * Save admin alerts to Data Storage.
   */
  function handleSaveAlerts() {
    if (!currentAdminAlerts) {
      currentAdminAlerts = Object.assign({}, DEFAULT_ADMIN_ALERTS);
    }

    // Read event toggles
    currentAdminAlerts.events = {
      new_ticket: getCheckbox('alert-new-ticket'),
      high_priority: getCheckbox('alert-high-priority'),
      escalation: getCheckbox('alert-escalation')
    };

    dbSet(DS_KEYS.ADMIN_ALERTS, currentAdminAlerts).then(function () {
      showToast('Admin alerts saved', 'success');
    }).catch(function () {
      showToast('Failed to save admin alerts', 'error');
    });
  }

  // ──────────────────────────────────────────────
  // Modal Helpers
  // ──────────────────────────────────────────────

  /**
   * Show a modal by ID.
   * @param {string} modalId - Modal overlay element ID
   */
  function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('visible');
  }

  /**
   * Hide a modal by ID.
   * @param {string} modalId - Modal overlay element ID
   */
  function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('visible');
  }

  /**
   * Set up close/cancel handlers for a modal.
   * @param {string} modalId - Modal overlay element ID
   * @param {string} closeId - Close button element ID
   * @param {string} cancelId - Cancel button element ID
   */
  function setupModalClose(modalId, closeId, cancelId) {
    const closeBtn = document.getElementById(closeId);
    const cancelBtn = document.getElementById(cancelId);
    const modal = document.getElementById(modalId);

    if (closeBtn) {
      closeBtn.addEventListener('click', function () { hideModal(modalId); });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { hideModal(modalId); });
    }

    // Close on overlay click
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideModal(modalId);
      });
    }
  }

  // ──────────────────────────────────────────────
  // Form Helpers
  // ──────────────────────────────────────────────

  /**
   * Set a checkbox value by element ID.
   * @param {string} id - Checkbox element ID
   * @param {boolean} checked - Whether to check
   */
  function setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
  }

  /**
   * Get a checkbox value by element ID.
   * @param {string} id - Checkbox element ID
   * @returns {boolean}
   */
  function getCheckbox(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  /**
   * Set a select element value by ID.
   * @param {string} id - Select element ID
   * @param {string} value - Option value to select
   */
  function setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  }

  /**
   * Add a change listener to a checkbox toggle.
   * @param {string} id - Checkbox element ID
   * @param {Function} callback - Called with boolean value
   */
  function addChangeListener(id, callback) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', function () {
        callback(el.checked);
      });
    }
  }

  /**
   * Add a change listener to a select element.
   * @param {string} id - Select element ID
   * @param {Function} callback - Called with selected value
   */
  function addSelectListener(id, callback) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', function () {
        callback(el.value);
      });
    }
  }

})();
