# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

HomeSick is a Home Assistant custom integration for health journaling. It consists of:
- **Backend**: Python HA integration in `custom_components/homesick/`
- **Frontend**: A Lovelace custom card. The canonical source is `custom_components/homesick/homesick-card.js`; on `async_setup_entry` it is auto-copied to `www/homesick/homesick-card.js` (the runtime location). Both copies are tracked in git and must be kept in sync.

No build step is required. No external Python dependencies beyond what HA provides.

## Deployment

Use the `Makefile` (reads SSH/HA config from `.env`):
```bash
make deploy            # validate JSON, scp backend + frontend, restart HA
make deploy-backend    # scp custom_components/homesick only
make deploy-frontend   # scp www/homesick only
make logs              # tail HomeSick log lines
make enable-debug      # turn on debug logging for the integration
```

Or copy files manually to the running HA instance:
```bash
cp -r custom_components/homesick/ /config/custom_components/
cp www/homesick/homesick-card.js /config/www/homesick/
```

Then restart HA. The Lovelace resource (`/local/homesick/homesick-card.js`) is auto-registered on setup; add the card as `type: custom:homesick-card`.

## Architecture

Data flows through these layers:

1. **`storage.py`** — `HomeSickStore` persists all data as JSON via HA's `Store` API (`.storage/homesick_data`). **Not cached in memory** — every method does `data = await self.async_load(); ...; await self.async_save(data)`. Covers persons, measurements, medications, wellbeing, reminder `schedules`, the global `med_catalog`, and the `reminders_enabled` master flag.

2. **`coordinator.py`** — `DataUpdateCoordinator` that polls storage every 5 minutes and caches the latest value per measurement type per person in memory. After any service write, the coordinator is immediately refreshed via `async_request_refresh()`.

3. **`sensor.py`** — Creates HA sensor entities that read from coordinator snapshots (no I/O). One integration creates ~12 sensors per person (temperature, pulse, blood_pressure, weight, height, bmi, waist, blood_glucose, spo2, pain, mood, last_medication). BMI is auto-calculated from weight + height. Temperature sensor includes `fever_status` attribute.

4. **`services.py`** — Registers 14 HA services. Core: `log_measurement`, `log_medication`, `add_symptom`, `add_person`, `delete_entry`, `get_summary`, `delete_person`, `activate_person`. Reminders: `create_schedule`, `toggle_schedule`, `confirm_dose`, `set_never_ask`, `decline_reminder`, `set_reminders_enabled`. All use voluptuous schemas for validation.

5. **`reminders.py`** — `ReminderEngine` owns all medication-reminder logic: boots on startup, registers `async_track_point_in_time` timers for each pending dose, sends HA `notify` push notifications, detects missed doses, regenerates the dose horizon, and auto-confirms doses logged near a scheduled time.

`__init__.py` wires everything together on `async_setup_entry`, boots the `ReminderEngine`, and registers REST endpoints (`HomeAssistantView`): `GET /api/homesick/schedules/{person_id}`, `GET /api/homesick/settings`, `GET /api/homesick/med_catalog`. It also exposes WebSocket commands (`homesick/get_persons`, `homesick/get_person_data`). `config_flow.py` enforces single-instance setup and collects the first person's data.

## Key Design Constraints

- **Single instance only**: `config_flow.py` returns `self.async_abort(reason="already_configured")` if an entry exists.
- **Person UUID**: Each person gets a UUID assigned at creation. This UUID is exposed as `person_id` on sensor attributes and is required for service calls.
- **`.storage/` is HA-managed**: Never manually edit `.storage/homesick_data`; HA owns that file.
- **Frontend is vanilla JS**: `homesick-card.js` uses no build tools. ApexCharts is loaded dynamically from CDN (`cdnjs.cloudflare.com/ajax/libs/apexcharts/3.45.2`). DOM is built with the `el()` helper; modals use template strings appended to `shadowRoot`.
- **Two card copies**: edits to `homesick-card.js` must be applied to both `custom_components/homesick/` (source) and `www/homesick/` (runtime), kept identical.
- **Person active flag**: Persons can be deactivated (`active: false`) via `delete_person` with `keep_history: true`. They are hidden from the home view but visible (greyed out) in the admin view. Reactivate with `activate_person`.
- **Reminder master switch**: `reminders_enabled` (top-level in storage, default `true`) globally mutes reminders without touching individual schedule `enabled` flags.
- **Schedule keys**: schedules are stored per person → per normalized medicine name (`name.strip().lower().replace(" ", "_")`).
- **Med catalog**: `med_catalog` stores a global default dose/unit per medicine, updated on every `log_medication` that includes a dose. Logging without a dose never overwrites the stored default.

## Services Reference

### Core services

```yaml
homesick.add_person:
  name: "Anna"
  birth_date: "1990-01-15"   # optional
  gender: female              # optional: male/female/other

homesick.log_measurement:
  person_id: <uuid>
  type: temperature           # see MEASUREMENT_TYPES in const.py
  value: 38.4
  unit: "°C"
  value2: 80                  # optional: diastolic for blood_pressure
  note: "After exercise"      # optional

homesick.log_medication:
  person_id: <uuid>
  medication: Ibuprofen
  dose: 400                   # optional — omit or null to log without a dose
  dose_unit: mg               # optional, default "mg"
  route: oral
  skipped: false

homesick.add_symptom:
  person_id: <uuid>
  pain: 3                     # optional: NRS 0-10
  mood: 4                     # optional: 1-5
  tags: ["hosta", "snuva"]   # optional
  note: ""                    # optional

homesick.delete_entry:
  person_id: <uuid>
  entry_id: <entry-uuid>      # deletes any measurement/medication/wellbeing entry

homesick.delete_person:
  person_id: <uuid>
  keep_history: false         # true = deactivate (hide), false = delete permanently

homesick.activate_person:
  person_id: <uuid>           # reactivates a deactivated person

homesick.get_summary:
  person_id: <uuid>
  hours: 24                   # optional, default 24 (max 720)
```

### Reminder services

```yaml
homesick.create_schedule:
  person_id: <uuid>
  medicine_name: Metformin
  frequency:
    type: daily               # daily | multiple_daily | every_n_days
    times: ["08:00", "20:00"]
    interval_hours: null       # for multiple_daily interval mode
    every_n_days: null         # for every_n_days
  end:                         # optional
    type: none                 # none | date | dose_count
    date: null
    dose_count: null
  notifications_on: true        # optional, default true
  notify_target: mobile_app_anna_phone   # optional — blank uses notify.notify
  missed_window_minutes: 120    # optional, default 120

homesick.toggle_schedule:
  person_id: <uuid>
  medicine_name: Metformin
  enabled: false                # pause/resume without deleting

homesick.confirm_dose:
  person_id: <uuid>
  medicine_name: Metformin
  dose_id: <dose-uuid>

homesick.set_never_ask:
  person_id: <uuid>
  medicine_name: Metformin
  value: true                   # stop prompting for a schedule after dose logging

homesick.decline_reminder:
  person_id: <uuid>
  medicine_name: Metformin      # records a "No" — won't re-prompt for one week

homesick.set_reminders_enabled:
  enabled: false                # global master switch for all reminders
```

## Measurement Types

Defined in `const.py` as `MEASUREMENT_TYPES`: `temperature`, `blood_pressure`, `pulse`, `weight`, `height`, `bmi`, `waist`, `blood_glucose`, `spo2`, `pain`, `mood`.

## Translations

UI strings are in `strings.json` (Swedish) and `translations/sv.json` + `translations/en.json`. Swedish is the primary language.
