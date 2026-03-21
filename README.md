# kwtSMS for Freshdesk

[![Version](https://img.shields.io/badge/version-0.7.0-blue.svg)](https://github.com/boxlinknet/kwtsms-freshdesk/releases/tag/v0.7.0)
[![Platform](https://img.shields.io/badge/platform-Freshdesk-green.svg)](https://www.freshworks.com/apps/)
[![FDK](https://img.shields.io/badge/FDK-v2.3-orange.svg)](https://developers.freshworks.com/docs/app-sdk/v2.3/freshdesk/)
[![License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)
[![kwtSMS](https://img.shields.io/badge/SMS%20Gateway-kwtSMS-0066cc.svg)](https://www.kwtsms.com)

kwtSMS for Freshdesk integrates the [kwtSMS](https://www.kwtsms.com) SMS gateway with Freshdesk. Send automatic SMS notifications to customers and admins on ticket events, and let agents send manual SMS directly from the ticket sidebar.

## Features

### Customer Notifications (toggleable)
- SMS when a new ticket is created
- SMS when ticket status changes to resolved or closed
- SMS when an agent replies to a ticket

### Admin Notifications (toggleable)
- SMS alert on new ticket creation
- SMS alert on high/urgent priority tickets
- SMS alert on priority escalation

### Ticket Sidebar
- Send manual SMS to ticket requester
- Template dropdown with auto-filled placeholders
- Live character counter with English/Arabic detection
- SMS history for the current contact

### Dashboard
- Gateway status bar (SMS enabled/disabled, connected/disconnected, test mode, sender ID)
- Balance, sent today, this month, and failed counters
- Recent activity table

### Settings
- Enable/disable SMS gateway
- Test mode (SMS queued but not delivered)
- Debug logging
- Default language (English/Arabic)
- Company name for SMS templates
- Default country code (from coverage)
- Active sender ID (from account)
- Gateway info with Sync Now
- Inline gateway test (send test SMS with phone number and message)

### Notifications
- Customer notification toggles (ticket created, status changed, agent reply)
- Admin notification toggles (new ticket, high priority, escalation)
- Admin recipient phone numbers (add/remove)

### Templates
- Pre-built SMS templates for all 6 event types
- English and Arabic side-by-side editors
- Dynamic placeholders: ticket_id, ticket_subject, ticket_status, ticket_priority, requester_name, agent_name, company_name
- Live character counter and SMS part calculator
- Reset to default

### Logs
- Filterable SMS log (by event type and status)
- Instant filtering on dropdown change
- Pagination
- Danger zone with clear all logs

### Other
- Daily cron sync for balance, sender IDs, and coverage
- Full send pipeline: phone normalization, validation, coverage check, message cleaning (HTML strip, emoji removal), deduplication, batch sending
- RTL/Arabic support throughout the UI
- kwtSMS branding (Montserrat/Lato fonts, amber/blue color scheme)

## Installation

1. Install the app from the Freshworks Marketplace
2. Enter your kwtSMS API username and password (only 2 fields)
3. Open the app, go to Settings, and configure sender ID, company name, and country code
4. Go to Notifications and toggle which SMS notifications to enable
5. Enable the SMS gateway in Settings

## Requirements

- A [kwtSMS](https://www.kwtsms.com) account with API access
- SMS credits in your kwtSMS account
- A registered sender ID (KWT-SMS is for testing only)

## Support

- Website: [www.kwtsms.com](https://www.kwtsms.com)
- Support: [www.kwtsms.com/support.html](https://www.kwtsms.com/support.html)

## Privacy and Terms

- [Privacy Policy](https://www.kwtsms.com/privacy.html)
- [Usage Policy](https://www.kwtsms.com/policy.html)

## Version

0.7.0

## License

MIT
