# kwtSMS for Freshdesk

[![Version](https://img.shields.io/badge/version-0.7.0-blue.svg)](https://github.com/boxlinknet/kwtsms-freshdesk/releases/tag/v0.7.0)
[![Platform](https://img.shields.io/badge/platform-Freshdesk-green.svg)](https://www.freshworks.com/apps/)
[![FDK](https://img.shields.io/badge/FDK-v2.3-orange.svg)](https://developers.freshworks.com/docs/app-sdk/v2.3/freshdesk/)
[![License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)
[![kwtSMS](https://img.shields.io/badge/SMS%20Gateway-kwtSMS-0066cc.svg)](https://www.kwtsms.com)

kwtSMS for Freshdesk integrates the [kwtSMS](https://www.kwtsms.com) SMS gateway with Freshdesk. Send automatic SMS notifications to customers and admins on ticket events, and let agents send manual SMS directly from the ticket sidebar.

## Features

- **Automatic SMS notifications** for customers on ticket creation, status changes, and agent replies
- **Admin SMS notifications** on new tickets, high-priority tickets, and priority escalations
- **Ticket sidebar** for agents to send manual SMS directly from any ticket
- **English and Arabic support** with RTL layout and bilingual SMS templates
- **Smart send pipeline** with phone normalization, validation, coverage check, deduplication, and batch sending
- **Customizable templates** with dynamic placeholders (ticket ID, subject, status, agent name, company name)
- **Dashboard** with real-time balance, message stats, gateway status, and recent activity
- **Notification controls** to toggle each customer and admin notification independently
- **SMS logs** with instant filtering by event type and status
- **Gateway test** to verify your connection with a test SMS before going live
- **Daily auto-sync** for balance, sender IDs, and country coverage
- **Test mode** to queue SMS without delivery during setup

## Requirements

- A [kwtSMS](https://www.kwtsms.com) account with API access
- SMS credits in your kwtSMS account
- A registered sender ID (KWT-SMS is for testing only)

## Installation

1. Install the app from the Freshworks Marketplace
2. Enter your kwtSMS API username and password (only 2 fields)
3. Open the app, go to Settings, and configure sender ID, company name, and country code
4. Go to Notifications and toggle which SMS notifications to enable
5. Enable the SMS gateway in Settings

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
