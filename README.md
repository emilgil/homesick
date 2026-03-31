# HomeSick — Installation Guide

HomeSick is a Home Assistant custom integration for family health journaling. Log temperatures, medications, vitals, body metrics and wellbeing for multiple people — all from a single Lovelace card.

## Requirements
- Home Assistant Core ≥ 2024.1
- Lovelace in standard mode (not YAML-only)

---

## 1. Copy the files

```bash
# Copy the backend integration
cp -r custom_components/homesick/ /config/custom_components/

# Copy the frontend card
mkdir -p /config/www/homesick
cp www/homesick/homesick-card.js /config/www/homesick/
```

## 2. Restart Home Assistant

Settings → System → Restart

## 3. Install the integration

Settings → Integrations → Add integration → search "HomeSick"

Enter the name and optionally date of birth/gender for the first person.

## 4. Add the Lovelace resource (if not registered automatically)

Settings → Dashboards → ⋮ → Edit → Manage resources

Add:
- URL: `/local/homesick/homesick-card.js`
- Type: JavaScript module

## 5. Add the card to your dashboard

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
  __init__.py        Entry point, wires everything together
  config_flow.py     Setup wizard in HA UI
  const.py           Constants and measurement types
  coordinator.py     DataUpdateCoordinator, in-memory cache
  sensor.py          HA sensor entities
  services.py        8 HA services
  storage.py         Local data storage (HA Store)
  strings.json       English UI strings
  translations/
    en.json          English
    sv.json          Swedish

www/homesick/
  homesick-card.js   Lovelace custom card (vanilla JS + ApexCharts)
  logo.svg           Icon (no text)
  logo_with_text.svg Full logo
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
