# HomeSick — Installation Guide

HomeSick is a Home Assistant custom integration for family health journaling. Log temperatures, medications, vitals, body metrics and wellbeing for multiple people — all from a single Lovelace card. Set up medication reminder schedules with mobile push notifications and automatic missed-dose detection.

## ⚠️ Disclaimer

**HomeSick is not a medical software system and is not intended for clinical or diagnostic use.**

- Data logged in HomeSick is stored locally in your Home Assistant instance and is accessible to **anyone with access to your Home Assistant installation** — including other users, integrations, and anyone on your local network who can reach the HA interface.
- Do not use HomeSick as a substitute for professional medical advice, diagnosis, or treatment.
- Do not rely on HomeSick data in medical emergencies. Always contact a qualified healthcare professional.
- The developers accept no liability for decisions made based on data logged in this application.

Use HomeSick for personal reference only.

---

## Requirements
- Home Assistant Core ≥ 2024.1
- Lovelace in standard mode (not YAML-only)

---

## Installation via HACS (recommended)

1. Open HACS in your Home Assistant sidebar
2. Click ⋮ → **Custom repositories**
3. Add `https://github.com/emilgil/homesick` with category **Integration**
4. Search for "HomeSick" in HACS and install it
5. Restart Home Assistant
6. Go to **Settings → Integrations → Add integration** and search for "HomeSick"

---

## Manual Installation

### 1. Copy the files

```bash
# Copy the backend integration
cp -r custom_components/homesick/ /config/custom_components/

# Copy the frontend card
mkdir -p /config/www/homesick
cp www/homesick/homesick-card.js /config/www/homesick/
```

### 2. Restart Home Assistant

Settings → System → Restart

### 3. Install the integration

Settings → Integrations → Add integration → search "HomeSick"

Enter the name and optionally date of birth/gender for the first person.

### 4. Add the Lovelace resource (if not registered automatically)

Settings → Dashboards → ⋮ → Edit → Manage resources

Add:
- URL: `/local/homesick/homesick-card.js`
- Type: JavaScript module

### 5. Add the card to your dashboard

Edit dashboard → Add card → search "HomeSick"

Or manual YAML:
```yaml
type: custom:homesick-card
```

---

## Adding more people

Click **⚙ Manage** in the card and fill in the form — no Developer Tools needed.

Or via Developer Tools → Services:

```yaml
service: homesick.add_person
data:
  name: Erik
  birth_date: "2015-03-14"
  gender: male
```

## Deleting or deactivating a person

In **⚙ Manage**, each person has a 🗑 button with two options:
- **Delete all** — permanently removes the person and all their history
- **Keep history** — deactivates the person (hidden from home screen, history preserved)

A deactivated person appears greyed out in Manage with a ↩ button to reactivate.

## Logging a measurement via automation

```yaml
service: homesick.log_measurement
data:
  person_id: <person-uuid from sensor attributes>
  type: temperature
  value: 38.4
  unit: "°C"
```

---

## Medication reminders

HomeSick can remind you (or a family member) to take medication on a schedule, with Home Assistant mobile push notifications.

### Setting up a schedule

After you log a dose, the card asks whether you want a reminder schedule for that medicine. Choose **Yes** to open the schedule editor, where you set:

- **Frequency** — every day, several times a day (fixed times or an hourly interval), or every N days
- **Times** — one or more times of day (`HH:MM`)
- **End** — never, by date, or after a fixed number of doses
- **Notifications** — on/off
- **Notify target** — the HA notify service to use, e.g. `mobile_app_anna_phone`. Leave blank to use the default `notify.notify`.

If you choose **No**, HomeSick won't ask again for that medicine for one week. You can also set **"Never ask"** per medicine in the Medication tab.

### How reminders behave

- At each scheduled time, a push notification is sent to the configured target.
- If a dose isn't logged within the missed-dose window (default 2 hours), it's marked **missed** (shown in red, not counted as taken).
- Logging a dose near a scheduled time **auto-confirms** that dose.
- Schedules survive HA restarts.

### Editing or deleting a schedule

Each schedule row in the Medication tab's **⏰ Reminders** section has:
- a toggle to pause/resume it (keeps the schedule, stops notifications)
- **✏️ Edit** to reopen the schedule editor and change frequency, times, end condition or notify target
- **🗑** to delete the schedule entirely (asks "Delete schedule? Yes/No"). Deleting cancels its pending notification timers; "Never ask" is reset, so logging that medicine next time will prompt again — use the "Never ask" toggle on the row if you want to suppress that.

### Master switch

**⚙ Manage → ⏰ Medication reminders** has a global on/off switch. Turning it off mutes *all* reminders and notifications without deleting any schedules. Turning it back on re-arms every active schedule.

### Default dose

Every time you log a medication with a dose, HomeSick remembers it as that medicine's default. The next time you pick the same medicine in the log form, the dose and unit are pre-filled. Logging a medicine *without* a dose does not overwrite the saved default.

## Finding the person UUID

Go to Developer Tools → States → search `sensor.homesick_`
The person ID is available as the `person_id` attribute on each sensor.

---

## Units — metric / imperial

The card defaults to imperial if your browser locale is `en-US`, otherwise metric. You can override this manually in the card under **⚙ Manage → Units**.

Values are always stored in metric internally. The unit toggle only affects display and input conversion.

---

## File structure

```
custom_components/homesick/
  __init__.py        Entry point, wires everything together, REST endpoints
  config_flow.py     Setup wizard in HA UI
  const.py           Constants and measurement types
  coordinator.py     DataUpdateCoordinator, in-memory cache
  reminders.py       Medication reminder engine (schedules, timers, notifications)
  sensor.py          HA sensor entities
  services.py        15 HA services
  services.yaml      Service descriptions for the HA UI
  storage.py         Local data storage (HA Store)
  homesick-card.js   Lovelace custom card (copied to www/ on startup)
  strings.json       English UI strings
  translations/
    en.json          English
    sv.json          Swedish

www/homesick/
  homesick-card.js   Lovelace custom card (vanilla JS + ApexCharts)
```

---

## Sensor entities created per person

| Entity | Unit | Description |
|--------|------|-------------|
| `sensor.homesick_<name>_temperature` | °C | Latest temperature |
| `sensor.homesick_<name>_pulse` | bpm | Latest pulse |
| `sensor.homesick_<name>_blood_pressure` | mmHg | Latest systolic BP |
| `sensor.homesick_<name>_weight` | kg | Latest weight |
| `sensor.homesick_<name>_height` | cm | Latest height |
| `sensor.homesick_<name>_bmi` | kg/m² | Latest BMI (auto-calculated) |
| `sensor.homesick_<name>_waist` | cm | Latest waist circumference |
| `sensor.homesick_<name>_blood_glucose` | mmol/L | Latest blood glucose |
| `sensor.homesick_<name>_spo2` | % | Latest oxygen saturation |
| `sensor.homesick_<name>_pain` | NRS | Latest pain level |
| `sensor.homesick_<name>_mood` | 1–5 | Latest mood |
| `sensor.homesick_<name>_last_medication` | — | Latest medication (name) |

---

## Issues & Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/emilgil/homesick/issues).
