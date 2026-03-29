# SjukJournal — Installationsguide

## Förutsättningar
- Home Assistant Core ≥ 2024.1
- Lovelace i standard-läge (inte YAML-only)

---

## 1. Kopiera filerna

```bash
# Kopiera backend-integrationen
cp -r custom_components/sjukjournal/ /config/custom_components/

# Kopiera frontend-kortet
mkdir -p /config/www/sjukjournal
cp www/sjukjournal/sjukjournal-card.js /config/www/sjukjournal/
```

## 2. Starta om Home Assistant

Inställningar → System → Starta om

## 3. Installera integrationen

Inställningar → Integrationer → Lägg till integration → sök "SjukJournal"

Ange namn och eventuellt födelsedatum/kön på den första personen.

## 4. Lägg till Lovelace-resursen (om den inte registrerades automatiskt)

Inställningar → Instrumentpaneler → ⋮-menyn → Redigera → Hantera resurser

Lägg till:
- URL: `/local/sjukjournal/sjukjournal-card.js`
- Typ: JavaScript-modul

## 5. Lägg till kortet i din dashboard

Redigera dashboard → Lägg till kort → Sök "SjukJournal"

Eller manuell YAML:
```yaml
type: custom:sjukjournal-card
```

---

## Lägga till fler personer

Via Developer Tools → Tjänster:

```yaml
service: sjukjournal.add_person
data:
  name: Erik
  birth_date: "2015-03-14"
  gender: male
```

## Logga en mätning via automation

```yaml
service: sjukjournal.log_measurement
data:
  person_id: <person-uuid från sensor-attribut>
  type: temperature
  value: 38.4
  unit: "°C"
```

## Hitta person-UUID

Gå till Developer Tools → Stater → sök `sensor.sjukjournal_`
Person-ID finns som attribut `person_id` på varje sensor.

---

## Filstruktur

```
custom_components/sjukjournal/
  __init__.py        Ingångspunkt, registrerar allt
  config_flow.py     Installationsguide i HA UI
  const.py           Konstanter och mättyper
  coordinator.py     DataUpdateCoordinator, cache
  sensor.py          HA sensor-entiteter
  services.py        6 HA-tjänster
  storage.py         Lokal datalagring (HA Store)
  strings.json       Svenska UI-strängar
  translations/
    sv.json          Svenska
    en.json          Engelska

www/sjukjournal/
  sjukjournal-card.js   Lovelace custom card (vanilla JS + ApexCharts)
```

---

## Sensor-entiteter som skapas per person

| Entitet | Enhet | Beskrivning |
|---------|-------|-------------|
| `sensor.sjukjournal_<namn>_temperature` | °C | Senaste temperatur |
| `sensor.sjukjournal_<namn>_pulse` | slag/min | Senaste puls |
| `sensor.sjukjournal_<namn>_blood_pressure` | mmHg | Senaste systoliskt BT |
| `sensor.sjukjournal_<namn>_weight` | kg | Senaste vikt |
| `sensor.sjukjournal_<namn>_height` | cm | Senaste längd |
| `sensor.sjukjournal_<namn>_bmi` | kg/m² | Senaste BMI (auto-beräknat) |
| `sensor.sjukjournal_<namn>_waist` | cm | Senaste midjemått |
| `sensor.sjukjournal_<namn>_blood_glucose` | mmol/L | Senaste blodsocker |
| `sensor.sjukjournal_<namn>_spo2` | % | Senaste syremättnad |
| `sensor.sjukjournal_<namn>_pain` | NRS | Senaste smärtnivå |
| `sensor.sjukjournal_<namn>_mood` | 1-5 | Senaste humör |
| `sensor.sjukjournal_<namn>_last_medication` | — | Senaste medicin (namn) |
