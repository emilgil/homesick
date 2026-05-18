"""Storage layer for HomeSick.

All data lives in .storage/homesick_data as a single JSON document.
No external database is required — HA's built-in Store handles persistence
and is automatically included in HA snapshots/backups.

Data shape:
{
  "persons": {
    "<uuid>": {
      "id": "<uuid>",
      "name": "Anna",
      "birth_date": "1983-05-12",   # optional, ISO date string
      "notes": "",
      "active": true,
      "photo": "homesick/images/anna.jpg",  # relative to /local/
      "measurements": [
        {
          "id": "<uuid>",
          "type": "temperature",    # see const.MEASUREMENT_TYPES
          "value": 38.4,
          "value2": null,           # used for diastolic BP, etc.
          "unit": "°C",
          "timestamp": "2025-03-27T14:32:00",
          "note": ""
        }
      ],
      "medications": [
        {
          "id": "<uuid>",
          "name": "Alvedon 500mg",
          "dose": 500,
          "unit": "mg",
          "route": "oral",
          "timestamp": "2025-03-27T18:30:00",
          "skipped": false,
          "note": ""
        }
      ],
      "wellbeing": [
        {
          "id": "<uuid>",
          "pain": 3,                # NRS 0-10, nullable
          "mood": 2,                # 1-5, nullable
          "tags": ["hosta", "snuva"],
          "note": "",
          "timestamp": "2025-03-27T14:00:00"
        }
      ]
    }
  },
  "medication_list": ["Alvedon 500mg", ...]
}
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DEFAULT_MEDICATIONS, DOMAIN, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


def _now_iso() -> str:
    """Return current time as ISO 8601 string using HA's configured timezone."""
    return dt_util.now().isoformat(timespec="seconds")


def _make_id() -> str:
    return str(uuid4())


class HomeSickStore:
    """Thin async wrapper around HA's Store for HomeSick data."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    # ── Low-level load / save ────────────────────────────────────────────────

    async def async_load(self) -> dict[str, Any]:
        """Load data from disk, returning a fresh skeleton if nothing exists yet."""
        data = await self._store.async_load()
        if data is None:
            data = {
                "persons": {},
                "medication_list": list(DEFAULT_MEDICATIONS),
                "schedules": {},
                "reminders_enabled": True,
            }
        # Ensure keys exist for older storage versions
        data.setdefault("medication_list", list(DEFAULT_MEDICATIONS))
        data.setdefault("schedules", {})
        data.setdefault("reminders_enabled", True)
        return data

    async def async_save(self, data: dict[str, Any]) -> None:
        """Persist data to disk."""
        await self._store.async_save(data)

    # ── Person management ────────────────────────────────────────────────────

    async def async_add_person(
        self,
        name: str,
        birth_date: str | None = None,
        gender: str | None = None,
        notes: str = "",
    ) -> dict[str, Any]:
        """Create a new person and return the new person dict."""
        data = await self.async_load()
        person_id = _make_id()
        person: dict[str, Any] = {
            "id": person_id,
            "name": name,
            "birth_date": birth_date,   # ISO date string YYYY-MM-DD, or None
            "gender": gender,            # "male" | "female" | "other" | None
            "notes": notes,
            "active": True,
            "photo": None,
            "measurements": [],
            "medications": [],
            "wellbeing": [],
        }
        data["persons"][person_id] = person
        await self.async_save(data)
        _LOGGER.debug("Added person %s (%s)", name, person_id)
        return person

    async def async_update_person(
        self,
        person_id: str,
        **kwargs: Any,
    ) -> dict[str, Any] | None:
        """Update editable fields on a person. Returns updated person or None."""
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            _LOGGER.warning("async_update_person: person %s not found", person_id)
            return None
        allowed = {"name", "birth_date", "gender", "notes", "active", "photo"}
        for key, value in kwargs.items():
            if key in allowed:
                person[key] = value
        await self.async_save(data)
        return person

    @staticmethod
    def calculate_age(birth_date: str | None) -> int | None:
        """Return age in whole years from an ISO date string, or None."""
        if not birth_date:
            return None
        try:
            from datetime import date
            born = date.fromisoformat(birth_date)
            today = date.today()
            return today.year - born.year - (
                (today.month, today.day) < (born.month, born.day)
            )
        except ValueError:
            return None

    async def async_delete_person(
        self,
        person_id: str,
        keep_history: bool = False,
    ) -> bool:
        """Delete or deactivate a person. Returns True if found."""
        data = await self.async_load()
        if person_id not in data["persons"]:
            _LOGGER.warning("async_delete_person: person %s not found", person_id)
            return False
        if keep_history:
            data["persons"][person_id]["active"] = False
            _LOGGER.info("Deactivated person %s (history kept)", person_id)
        else:
            del data["persons"][person_id]
            _LOGGER.info("Deleted person %s and all history", person_id)
        await self.async_save(data)
        return True

    async def async_get_persons(self, active_only: bool = False) -> list[dict[str, Any]]:
        """Return list of persons, optionally filtered to active only."""
        data = await self.async_load()
        persons = list(data["persons"].values())
        if active_only:
            persons = [p for p in persons if p.get("active", True)]
        return persons

    async def async_get_person(self, person_id: str) -> dict[str, Any] | None:
        """Return a single person by id."""
        data = await self.async_load()
        return data["persons"].get(person_id)

    # ── Measurements ─────────────────────────────────────────────────────────

    async def async_add_measurement(
        self,
        person_id: str,
        mtype: str,
        value: float,
        unit: str,
        value2: float | None = None,
        timestamp: str | None = None,
        note: str = "",
    ) -> dict[str, Any] | None:
        """Add a measurement to a person. Returns the new entry or None."""
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            _LOGGER.warning("async_add_measurement: person %s not found", person_id)
            return None

        entry: dict[str, Any] = {
            "id": _make_id(),
            "type": mtype,
            "value": value,
            "value2": value2,
            "unit": unit,
            "timestamp": timestamp or _now_iso(),
            "note": note,
        }
        person["measurements"].append(entry)
        await self.async_save(data)
        return entry

    async def async_delete_entry(
        self,
        person_id: str,
        entry_id: str,
    ) -> bool:
        """Delete any entry (measurement, medication or wellbeing) by id.

        Returns True if something was deleted, False otherwise.
        """
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            return False

        deleted = False
        for collection in ("measurements", "medications", "wellbeing"):
            before = len(person[collection])
            person[collection] = [
                e for e in person[collection] if e["id"] != entry_id
            ]
            if len(person[collection]) < before:
                deleted = True
                break

        if deleted:
            await self.async_save(data)
        return deleted

    async def async_get_measurements(
        self,
        person_id: str,
        mtype: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return measurements for a person, newest first.

        Optionally filtered by type and/or limited to N entries.
        """
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            return []

        entries = person.get("measurements", [])
        if mtype:
            entries = [e for e in entries if e["type"] == mtype]

        # Sort newest first
        entries = sorted(entries, key=lambda e: e["timestamp"], reverse=True)

        if limit:
            entries = entries[:limit]
        return entries

    async def async_get_latest_measurement(
        self,
        person_id: str,
        mtype: str,
    ) -> dict[str, Any] | None:
        """Return the single most recent measurement of a given type."""
        entries = await self.async_get_measurements(person_id, mtype=mtype, limit=1)
        return entries[0] if entries else None

    # ── Medications ──────────────────────────────────────────────────────────

    async def async_add_medication(
        self,
        person_id: str,
        name: str,
        dose: float | None = None,
        unit: str = "mg",
        route: str = "oral",
        timestamp: str | None = None,
        skipped: bool = False,
        note: str = "",
    ) -> dict[str, Any] | None:
        """Log a medication dose. Returns the new entry or None."""
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            _LOGGER.warning("async_add_medication: person %s not found", person_id)
            return None

        entry: dict[str, Any] = {
            "id": _make_id(),
            "name": name,
            "dose": dose,
            "unit": unit,
            "route": route,
            "timestamp": timestamp or _now_iso(),
            "skipped": skipped,
            "note": note,
        }
        person["medications"].append(entry)

        # Auto-add to medication_list if it's a new name
        if name not in data["medication_list"]:
            data["medication_list"].append(name)

        await self.async_save(data)
        return entry

    async def async_get_medications(
        self,
        person_id: str,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return medications for a person, newest first."""
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            return []
        entries = sorted(
            person.get("medications", []),
            key=lambda e: e["timestamp"],
            reverse=True,
        )
        return entries[:limit] if limit else entries

    # ── Wellbeing ────────────────────────────────────────────────────────────

    async def async_add_wellbeing(
        self,
        person_id: str,
        pain: int | None = None,
        mood: int | None = None,
        tags: list[str] | None = None,
        note: str = "",
        timestamp: str | None = None,
    ) -> dict[str, Any] | None:
        """Log a wellbeing entry. Returns the new entry or None."""
        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            _LOGGER.warning("async_add_wellbeing: person %s not found", person_id)
            return None

        entry: dict[str, Any] = {
            "id": _make_id(),
            "pain": pain,
            "mood": mood,
            "tags": tags or [],
            "note": note,
            "timestamp": timestamp or _now_iso(),
        }
        person["wellbeing"].append(entry)
        await self.async_save(data)
        return entry

    # ── Medication list ──────────────────────────────────────────────────────

    async def async_get_medication_list(self) -> list[str]:
        """Return the global medication name list."""
        data = await self.async_load()
        return data.get("medication_list", [])

    async def async_add_to_medication_list(self, name: str) -> None:
        """Add a medication name to the global list if not already present."""
        data = await self.async_load()
        if name not in data["medication_list"]:
            data["medication_list"].append(name)
            await self.async_save(data)

    # ── Summary helper ───────────────────────────────────────────────────────

    async def async_get_summary(
        self,
        person_id: str,
        hours: int = 24,
    ) -> dict[str, Any]:
        """Return a summary dict for a person covering the last N hours.

        Used by the homesick.get_summary service.
        """
        from datetime import timedelta

        cutoff = (dt_util.now() - timedelta(hours=hours)).isoformat(timespec="seconds")

        data = await self.async_load()
        person = data["persons"].get(person_id)
        if person is None:
            return {}

        def recent(entries: list[dict]) -> list[dict]:
            return [e for e in entries if e.get("timestamp", "") >= cutoff]

        measurements = recent(person.get("measurements", []))
        medications = recent(person.get("medications", []))
        wellbeing = recent(person.get("wellbeing", []))

        # Latest temp
        temps = sorted(
            [m for m in measurements if m["type"] == "temperature"],
            key=lambda e: e["timestamp"],
            reverse=True,
        )
        latest_temp = temps[0]["value"] if temps else None

        return {
            "person_id": person_id,
            "person_name": person["name"],
            "hours": hours,
            "latest_temperature": latest_temp,
            "measurement_count": len(measurements),
            "medication_count": len(medications),
            "wellbeing_count": len(wellbeing),
            "measurements": measurements,
            "medications": medications,
            "wellbeing": wellbeing,
        }

    # ── Reminder schedules ───────────────────────────────────────────────────

    @staticmethod
    def _normalize_med(name: str) -> str:
        return name.strip().lower().replace(" ", "_")

    async def async_get_schedule(
        self, person_id: str, medicine_name: str
    ) -> dict | None:
        data = await self.async_load()
        key = self._normalize_med(medicine_name)
        return (
            data.get("schedules", {})
            .get(person_id, {})
            .get(key)
        )

    async def async_save_schedule(self, schedule: dict) -> None:
        data = await self.async_load()
        person_id = schedule["person_id"]
        key = self._normalize_med(schedule["medicine_name"])
        data.setdefault("schedules", {}).setdefault(person_id, {})[key] = schedule
        await self.async_save(data)

    async def async_get_all_schedules_for_person(
        self, person_id: str
    ) -> list[dict]:
        data = await self.async_load()
        return list(
            data.get("schedules", {}).get(person_id, {}).values()
        )

    async def async_set_never_ask(
        self, person_id: str, medicine_name: str, value: bool
    ) -> None:
        from datetime import datetime, timezone
        UTC = timezone.utc
        sched = await self.async_get_schedule(person_id, medicine_name)
        if sched is None:
            sched = {
                "id": f"sched_{person_id}_{self._normalize_med(medicine_name)}",
                "person_id": person_id,
                "medicine_name": medicine_name,
                "enabled": False,
                "notifications_on": False,
                "never_ask": value,
                "last_declined_at": None,
                "notify_target": None,
                "frequency": None,
                "end": {"type": "none", "date": None, "dose_count": None, "doses_taken": 0},
                "missed_window_minutes": 120,
                "created_at": datetime.now(UTC).isoformat(),
                "upcoming_doses": [],
            }
        else:
            sched["never_ask"] = value
        await self.async_save_schedule(sched)

    async def async_set_last_declined(
        self, person_id: str, medicine_name: str
    ) -> None:
        from datetime import datetime, timezone
        UTC = timezone.utc
        sched = await self.async_get_schedule(person_id, medicine_name)
        if sched is None:
            sched = {
                "id": f"sched_{person_id}_{self._normalize_med(medicine_name)}",
                "person_id": person_id,
                "medicine_name": medicine_name,
                "enabled": False,
                "notifications_on": False,
                "never_ask": False,
                "last_declined_at": datetime.now(UTC).isoformat(),
                "notify_target": None,
                "frequency": None,
                "end": {"type": "none", "date": None, "dose_count": None, "doses_taken": 0},
                "missed_window_minutes": 120,
                "created_at": datetime.now(UTC).isoformat(),
                "upcoming_doses": [],
            }
        else:
            sched["last_declined_at"] = datetime.now(UTC).isoformat()
        await self.async_save_schedule(sched)

    async def async_confirm_dose(
        self, person_id: str, medicine_name: str, dose_id: str
    ) -> bool:
        from datetime import datetime, timezone
        UTC = timezone.utc
        sched = await self.async_get_schedule(person_id, medicine_name)
        if sched is None:
            return False
        for dose in sched.get("upcoming_doses", []):
            if dose["id"] == dose_id and dose["status"] == "pending":
                dose["status"] = "taken"
                dose["taken_at"] = datetime.now(UTC).isoformat()
                sched["end"]["doses_taken"] = sched["end"].get("doses_taken", 0) + 1
                break
        end = sched["end"]
        finished = (
            end["type"] == "dose_count"
            and end["doses_taken"] >= end["dose_count"]
        )
        if finished:
            sched["enabled"] = False
        await self.async_save_schedule(sched)
        return finished

    async def async_mark_dose_missed(
        self, person_id: str, medicine_name: str, dose_id: str
    ) -> None:
        sched = await self.async_get_schedule(person_id, medicine_name)
        if sched is None:
            return
        changed = False
        for dose in sched.get("upcoming_doses", []):
            if dose["id"] == dose_id and dose["status"] == "pending":
                dose["status"] = "missed"
                changed = True
                break
        if changed:
            await self.async_save_schedule(sched)

    async def async_get_reminders_enabled(self) -> bool:
        data = await self.async_load()
        return data.get("reminders_enabled", True)

    async def async_set_reminders_enabled(self, value: bool) -> None:
        data = await self.async_load()
        data["reminders_enabled"] = value
        await self.async_save(data)
