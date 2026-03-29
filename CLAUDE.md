# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SjukJournal is a Home Assistant custom integration for health journaling. It consists of:
- **Backend**: Python HA integration in `custom_components/sjukjournal/`
- **Frontend**: A Lovelace custom card in `www/sjukjournal/sjukjournal-card.js`

No build step is required. No external Python dependencies beyond what HA provides.

## Deployment

Copy files to the running HA instance:
```bash
cp -r custom_components/sjukjournal/ /config/custom_components/
cp www/sjukjournal/sjukjournal-card.js /config/www/sjukjournal/
```

Then restart HA. The Lovelace resource (`/local/sjukjournal/sjukjournal-card.js`) is auto-registered on setup; add the card as `type: custom:sjukjournal-card`.

## Architecture

Data flows through four layers:

1. **`storage.py`** — Persists all data as JSON via HA's `Store` API (`.storage/sjukjournal_data`). Methods: `async_add_measurement`, `async_add_medication`, `async_add_symptom`, `async_add_person`, `async_delete_entry`, `async_get_all_data`.

2. **`coordinator.py`** — `DataUpdateCoordinator` that polls storage every 5 minutes and caches the latest value per measurement type per person in memory. After any service write, the coordinator is immediately refreshed via `async_request_refresh()`.

3. **`sensor.py`** — Creates HA sensor entities that read from coordinator snapshots (no I/O). One integration creates ~12 sensors per person (temperature, pulse, blood_pressure, weight, height, bmi, waist, blood_glucose, spo2, pain, mood, last_medication). BMI is auto-calculated from weight + height. Temperature sensor includes `fever_status` attribute.

4. **`services.py`** — Registers 6 HA services: `log_measurement`, `log_medication`, `add_symptom`, `add_person`, `delete_entry`, `get_summary`. All use voluptuous schemas for validation.

`__init__.py` wires everything together on `async_setup_entry`. `config_flow.py` enforces single-instance setup and collects the first person's data.

## Key Design Constraints

- **Single instance only**: `config_flow.py` returns `self.async_abort(reason="already_configured")` if an entry exists.
- **Person UUID**: Each person gets a UUID assigned at creation. This UUID is exposed as `person_id` on sensor attributes and is required for service calls.
- **`.storage/` is HA-managed**: Never manually edit `.storage/sjukjournal_data`; HA owns that file.
- **Frontend is vanilla JS**: `sjukjournal-card.js` uses no build tools. ApexCharts is loaded dynamically from CDN (`cdn.jsdelivr.net/npm/apexcharts@3.45.2`).

## Services Reference

```yaml
sjukjournal.add_person:
  name: "Anna"
  birth_date: "1990-01-15"   # optional
  gender: female              # optional: male/female/other

sjukjournal.log_measurement:
  person_id: <uuid>
  type: temperature           # see MEASUREMENT_TYPES in const.py
  value: 38.4
  unit: "°C"
  value2: 80                  # optional: diastolic for blood_pressure
  note: "After exercise"      # optional

sjukjournal.log_medication:
  person_id: <uuid>
  medication: Ibuprofen
  dose: "400mg"
  route: oral
  skipped: false

sjukjournal.delete_entry:
  person_id: <uuid>
  entry_type: measurement     # measurement/medication/symptom/wellbeing
  entry_id: <entry-uuid>
```

## Measurement Types

Defined in `const.py` as `MEASUREMENT_TYPES`: `temperature`, `blood_pressure`, `pulse`, `weight`, `height`, `bmi`, `waist`, `blood_glucose`, `spo2`, `pain`, `mood`.

## Translations

UI strings are in `strings.json` (Swedish) and `translations/sv.json` + `translations/en.json`. Swedish is the primary language.
