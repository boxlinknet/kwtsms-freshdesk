/**
 * iparams.js - Custom installation page logic
 * Related: config/iparams.html, config/iparams.css
 *
 * Handles Test Connection flow: validates kwtSMS credentials by calling /balance/,
 * then fetches sender IDs on success. During installation, secure iparams are not
 * yet saved, so we use client.request.post() with explicit credentials in the body
 * rather than invokeTemplate (which needs saved iparams).
 */

var client;

document.addEventListener('DOMContentLoaded', function() {
  app.initialized().then(function(_client) {
    client = _client;
  });
});

function testConnection() {
  var username = document.getElementById('kwtsms_username').value.trim();
  var password = document.getElementById('kwtsms_password').value.trim();

  if (!username || !password) {
    showStatus('error', 'Please enter username and password');
    return;
  }

  var btnTest = document.getElementById('btn-test');
  btnTest.disabled = true;
  btnTest.textContent = 'Testing...';
  showStatus('loading', 'Connecting to kwtSMS...');

  // Call balance endpoint directly (cannot use invokeTemplate before iparams are saved)
  var options = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      username: username,
      password: password
    })
  };

  client.request.post('https://www.kwtsms.com/API/balance/', options)
    .then(function(data) {
      var response = JSON.parse(data.response);
      if (response.result === 'OK') {
        document.getElementById('info-balance').textContent = response.available + ' credits';
        showStatus('success', 'Connected! Balance: ' + response.available + ' credits');
        fetchSenderIds(username, password);
        document.getElementById('gateway-info').classList.remove('hidden');
      } else {
        showStatus('error', 'Authentication failed: ' + (response.description || 'Check your credentials'));
        resetForm();
      }
    })
    .catch(function(err) {
      showStatus('error', 'Could not connect to kwtSMS. Please try again.');
      resetForm();
    })
    .finally(function() {
      btnTest.disabled = false;
      btnTest.textContent = 'Test Connection';
    });
}

function fetchSenderIds(username, password) {
  var options = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      username: username,
      password: password
    })
  };

  client.request.post('https://www.kwtsms.com/API/senderid/', options)
    .then(function(data) {
      var response = JSON.parse(data.response);
      if (response.result === 'OK' && response.senderid) {
        var select = document.getElementById('kwtsms_senderid');
        // Clear existing options before adding new ones from API
        while (select.firstChild) {
          select.removeChild(select.firstChild);
        }
        response.senderid.forEach(function(sid) {
          var option = document.createElement('option');
          option.value = sid;
          option.textContent = sid;
          select.appendChild(option);
        });
        document.getElementById('sender-group').classList.remove('hidden');
        document.getElementById('info-senders').textContent = response.senderid.join(', ');
      }
    })
    .catch(function(err) {
      console.error('Failed to fetch sender IDs:', err);
    });
}

function showStatus(type, message) {
  var statusEl = document.getElementById('connection-status');
  statusEl.classList.remove('hidden', 'status-success', 'status-error', 'status-loading');
  statusEl.classList.add('status-' + type);
  statusEl.textContent = message;
}

function resetForm() {
  document.getElementById('sender-group').classList.add('hidden');
  document.getElementById('gateway-info').classList.add('hidden');
}

/**
 * FDK validation callback. Called before iparams are saved.
 * Return an object with field-level errors to block saving.
 */
function validate() {
  var errors = {};
  if (!document.getElementById('kwtsms_username').value.trim()) {
    errors.kwtsms_username = 'Username is required';
  }
  if (!document.getElementById('kwtsms_password').value.trim()) {
    errors.kwtsms_password = 'Password is required';
  }
  if (!document.getElementById('kwtsms_company_name').value.trim()) {
    errors.kwtsms_company_name = 'Company name is required';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}
