"""HomeSick DataUpdateCoordinator.

The coordinator is the single source of truth for all sensor entities.
It holds a snapshot of the latest measurement per person per type,
refreshed either on demand (after a service call) or on a slow background
poll so the HA history graph stays up to date.

There is no remote API — all data comes from the local Store — so
async_update_data is cheap and never raises ConfigEntryNotReady.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, MEASUREMENT_TYPES
from .storage import HomeSickStore

_LOGGER = logging.getLogger(__name__)

# Background poll — keeps HA's recorder graph alive even without user activity.
# Sensor state is also pushed immediately after every service call so the UI
# feels instant regardless of this interval.
POLL_INTERVAL = timedelta(minutes=5)


@dataclass
class PersonSnapshot:
    """Latest values for one person, ready for sensor entities to consume."""

    person_id: str
    name: str
    active: bool
    # latest[mtype] = {"value": float, "value2": float|None, "timestamp": str, ...}
    latest: dict[str, dict[str, Any]] = field(default_factory=dict)
    # last medication logged
    last_medication: dict[str, Any] | None = None


@dataclass
class HomeSickData:
    """Full coordinator payload."""

    persons: dict[str, PersonSnapshot]  # keyed by person_id


class HomeSickCoordinator(DataUpdateCoordinator[HomeSickData]):
    """Coordinator for HomeSick."""

    def __init__(
        self,
        hass: HomeAssistant,
        config_entry: ConfigEntry,
        store: HomeSickStore,
    ) -> None:
        self.store = store

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}",
            update_interval=POLL_INTERVAL,
            update_method=self.async_update_data,
        )

    async def async_update_data(self) -> HomeSickData:
        """Rebuild PersonSnapshot objects from stored data.

        Called automatically every POLL_INTERVAL and also manually via
        async_request_refresh() after every service call.

        Loads storage exactly once and processes everything in-memory to
        avoid N×M disk reads (one per person per measurement type).
        """
        data = await self.store.async_load()
        snapshots: dict[str, PersonSnapshot] = {}

        for person in data.get("persons", {}).values():
            pid = person["id"]
            snapshot = PersonSnapshot(
                person_id=pid,
                name=person["name"],
                active=person.get("active", True),
            )

            # Build latest dict: one entry per measurement type, in-memory
            measurements = person.get("measurements", [])
            for mtype in MEASUREMENT_TYPES:
                type_entries = [m for m in measurements if m["type"] == mtype]
                if type_entries:
                    snapshot.latest[mtype] = max(
                        type_entries, key=lambda e: e["timestamp"]
                    )

            # Last medication
            meds = sorted(
                person.get("medications", []),
                key=lambda e: e["timestamp"],
                reverse=True,
            )
            snapshot.last_medication = meds[0] if meds else None

            snapshots[pid] = snapshot

        return HomeSickData(persons=snapshots)

    def get_snapshot(self, person_id: str) -> PersonSnapshot | None:
        """Return snapshot for a person, or None if coordinator has no data yet."""
        if self.data is None:
            return None
        return self.data.persons.get(person_id)
