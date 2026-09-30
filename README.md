# MyAgenda

An Apple-Calendar-style agenda for [Obsidian](https://obsidian.md) with **two-way iCloud / CalDAV sync**.

![Obsidian](https://img.shields.io/badge/Obsidian-1.7.2+-blueviolet) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Two-way sync** with iCloud Calendar (and any CalDAV server) — events you create on your phone show up in Obsidian, and everything you edit here syncs back
- **Five views**: agenda stream, day & week time grids, month grid, and statistics
- **Apple-style interactions**: drag events between days and time slots, drag on empty space to create, resize by dragging the bottom edge
- **Recurring events** with full RRULE support (weekly classes, BYDAY, INTERVAL…); dragging one instance moves only that instance
- **Natural-language quick add**: type `明天下午3点开产品会1小时 @会议室 #工作`
- **Daily-note injection**: today's events automatically appear in your daily note as a checklist
- **Reminders** for upcoming events while Obsidian is open
- **Conflict handling** with a manual "theirs / mine" choice, incremental sync (sync-token + multiget), and a one-click **force full sync** for recovery

## Setup

1. Get an **app-specific password** for your Apple ID (appleid.apple.com → Sign-In and Security → App-Specific Passwords). Do **not** use your main Apple ID password.
2. Open MyAgenda settings → enter the account and app-specific password.
3. Click **Discover iCloud calendars** and pick the calendars to import.
4. Set a sync interval (or sync manually).

Your credentials are stored **only** in this plugin's local `data.json` inside your vault. Nothing is sent anywhere except the CalDAV server you configured (iCloud). The plugin has no telemetry.

## Daily-note injection

Create your daily notes with a marker line (default `> [!todo]+ todo`). When a daily note is created, today's events are injected right below the marker as checkboxes. Re-inject anytime from the command palette; sync refreshes today's list automatically (checked boxes are preserved).

## Privacy

- Calendar credentials: stored locally in `data.json`, never synced, never logged
- Network access: exclusively to the CalDAV endpoints you configure (e.g. `caldav.icloud.com`)
- No analytics, no telemetry, no external requests beyond your calendar server

## Development

```bash
npm install
npm run build   # typecheck + bundle to main.js
```

Source lives in `src/`; sync engine, views, and injection core are covered by unit tests in `dev/`.

## License

[MIT](LICENSE)
