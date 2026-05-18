"""HomeSick HA service registrations.

Services exposed under the 'homesick' domain:

  homesick.log_measurement   — log any measurement type
  homesick.log_medication    — log a medication dose
  homesick.add_symptom       — log a wellbeing/symptom entry
  homesick.add_person        — add a new person at runtime
  homesick.delete_entry      — delete any entry by id
  homesick.get_summary       — return a summary as a persistent notification

All write services call coordinator.async_request_refresh() afterwards so
sensor states update immediately without waiting for the background poll.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, MEASUREMENT_TYPES
from .coordinator import HomeSickCoordinator
from .storage import HomeSickStore

_LOGGER = logging.getLogger(__name__)

# ── Service field names ──────────────────────────────────────────────────────
ATTR_PERSON_ID   = "person_id"
ATTR_TYPE        = "type"
ATTR_VALUE       = "value"
ATTR_VALUE2      = "value2"
ATTR_UNIT        = "unit"
ATTR_TIMESTAMP   = "timestamp"
ATTR_NOTE        = "note"
ATTR_MEDICATION  = "medication"
ATTR_DOSE        = "dose"
ATTR_DOSE_UNIT   = "dose_unit"
ATTR_ROUTE       = "route"
ATTR_SKIPPED     = "skipped"
ATTR_TAGS        = "tags"
ATTR_PAIN        = "pain"
ATTR_MOOD        = "mood"
ATTR_NAME        = "name"
ATTR_BIRTH_DATE  = "birth_date"
ATTR_GENDER      = "gender"
ATTR_ENTRY_ID    = "entry_id"
ATTR_HOURS       = "hours"

# ── Schemas ──────────────────────────────────────────────────────────────────

LOG_MEASUREMENT_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Required(ATTR_TYPE): vol.In(MEASUREMENT_TYPES),
    vol.Required(ATTR_VALUE): vol.Coerce(float),
    vol.Optional(ATTR_VALUE2): vol.Coerce(float),
    vol.Optional(ATTR_UNIT, default=""): cv.string,
    vol.Optional(ATTR_TIMESTAMP): cv.string,
    vol.Optional(ATTR_NOTE, default=""): cv.string,
})

LOG_MEDICATION_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Required(ATTR_MEDICATION): cv.string,
    vol.Optional(ATTR_DOSE): vol.Any(None, vol.Coerce(float)),
    vol.Optional(ATTR_DOSE_UNIT, default="mg"): cv.string,
    vol.Optional(ATTR_ROUTE, default="oral"): vol.In(
        ["oral", "inhalation", "injection", "topical", "other"]
    ),
    vol.Optional(ATTR_TIMESTAMP): cv.string,
    vol.Optional(ATTR_SKIPPED, default=False): cv.boolean,
    vol.Optional(ATTR_NOTE, default=""): cv.string,
})

ADD_SYMPTOM_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Optional(ATTR_PAIN): vol.All(vol.Coerce(int), vol.Range(min=0, max=10)),
    vol.Optional(ATTR_MOOD): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
    vol.Optional(ATTR_TAGS, default=[]): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional(ATTR_NOTE, default=""): cv.string,
    vol.Optional(ATTR_TIMESTAMP): cv.string,
})

ADD_PERSON_SCHEMA = vol.Schema({
    vol.Required(ATTR_NAME): cv.string,
    vol.Optional(ATTR_BIRTH_DATE): cv.string,
    vol.Optional(ATTR_GENDER): vol.In(["male", "female", "other"]),
    vol.Optional(ATTR_NOTE, default=""): cv.string,
})

DELETE_ENTRY_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Required(ATTR_ENTRY_ID): cv.string,
})

GET_SUMMARY_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Optional(ATTR_HOURS, default=24): vol.All(vol.Coerce(int), vol.Range(min=1, max=720)),
})

DELETE_PERSON_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
    vol.Optional("keep_history", default=False): cv.boolean,
})

ACTIVATE_PERSON_SCHEMA = vol.Schema({
    vol.Required(ATTR_PERSON_ID): cv.string,
})


# ── Registration ─────────────────────────────────────────────────────────────

async def async_register_services(
    hass: HomeAssistant,
    coordinator: HomeSickCoordinator,
    store: HomeSickStore,
) -> None:
    """Register all HomeSick services with HA."""

    async def handle_log_measurement(call: ServiceCall) -> None:
        data = call.data
        entry = await store.async_add_measurement(
            person_id=data[ATTR_PERSON_ID],
            mtype=data[ATTR_TYPE],
            value=data[ATTR_VALUE],
            unit=data.get(ATTR_UNIT, ""),
            value2=data.get(ATTR_VALUE2),
            timestamp=data.get(ATTR_TIMESTAMP),
            note=data.get(ATTR_NOTE, ""),
        )
        if entry:
            _LOGGER.info(
                "Logged %s=%.2f for person %s",
                data[ATTR_TYPE],
                data[ATTR_VALUE],
                data[ATTR_PERSON_ID],
            )
            await coordinator.async_request_refresh()
        else:
            _LOGGER.warning(
                "log_measurement: person %s not found", data[ATTR_PERSON_ID]
            )

    async def handle_log_medication(call: ServiceCall) -> None:
        data = call.data
        entry = await store.async_add_medication(
            person_id=data[ATTR_PERSON_ID],
            name=data[ATTR_MEDICATION],
            dose=data.get(ATTR_DOSE),
            unit=data.get(ATTR_DOSE_UNIT, "mg"),
            route=data.get(ATTR_ROUTE, "oral"),
            timestamp=data.get(ATTR_TIMESTAMP),
            skipped=data.get(ATTR_SKIPPED, False),
            note=data.get(ATTR_NOTE, ""),
        )
        if entry:
            _LOGGER.info(
                "Logged medication %s for person %s",
                data[ATTR_MEDICATION],
                data[ATTR_PERSON_ID],
            )
            await coordinator.async_request_refresh()

    async def handle_add_symptom(call: ServiceCall) -> None:
        data = call.data
        await store.async_add_wellbeing(
            person_id=data[ATTR_PERSON_ID],
            pain=data.get(ATTR_PAIN),
            mood=data.get(ATTR_MOOD),
            tags=data.get(ATTR_TAGS, []),
            note=data.get(ATTR_NOTE, ""),
            timestamp=data.get(ATTR_TIMESTAMP),
        )
        await coordinator.async_request_refresh()

    async def handle_add_person(call: ServiceCall) -> None:
        data = call.data
        person = await store.async_add_person(
            name=data[ATTR_NAME],
            birth_date=data.get(ATTR_BIRTH_DATE),
            gender=data.get(ATTR_GENDER),
            notes=data.get(ATTR_NOTE, ""),
        )
        _LOGGER.info("Added person: %s (%s)", person["name"], person["id"])
        # Reload the config entry so new sensor entities are created
        hass.async_create_task(
            hass.config_entries.async_reload(
                next(iter(hass.config_entries.async_entries(DOMAIN))).entry_id
            )
        )

    async def handle_delete_entry(call: ServiceCall) -> None:
        data = call.data
        deleted = await store.async_delete_entry(
            person_id=data[ATTR_PERSON_ID],
            entry_id=data[ATTR_ENTRY_ID],
        )
        if deleted:
            await coordinator.async_request_refresh()
        else:
            _LOGGER.warning(
                "delete_entry: entry %s not found for person %s",
                data[ATTR_ENTRY_ID],
                data[ATTR_PERSON_ID],
            )

    async def handle_delete_person(call: ServiceCall) -> None:
        data = call.data
        found = await store.async_delete_person(
            person_id=data[ATTR_PERSON_ID],
            keep_history=data.get("keep_history", False),
        )
        if found:
            # Reload config entry so removed sensors are cleaned up
            hass.async_create_task(
                hass.config_entries.async_reload(
                    next(iter(hass.config_entries.async_entries(DOMAIN))).entry_id
                )
            )
        else:
            _LOGGER.warning("delete_person: person %s not found", data[ATTR_PERSON_ID])

    async def handle_activate_person(call: ServiceCall) -> None:
        data = call.data
        person = await store.async_update_person(data[ATTR_PERSON_ID], active=True)
        if person:
            _LOGGER.info("Reactivated person %s", data[ATTR_PERSON_ID])
            hass.async_create_task(
                hass.config_entries.async_reload(
                    next(iter(hass.config_entries.async_entries(DOMAIN))).entry_id
                )
            )
        else:
            _LOGGER.warning("activate_person: person %s not found", data[ATTR_PERSON_ID])

    async def handle_get_summary(call: ServiceCall) -> None:
        data = call.data
        summary = await store.async_get_summary(
            person_id=data[ATTR_PERSON_ID],
            hours=data.get(ATTR_HOURS, 24),
        )
        # Surface the summary as a persistent notification so it's visible in HA
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": f"HomeSick — {summary.get('person_name', '')}",
                "message": _format_summary(summary),
                "notification_id": f"homesick_summary_{data[ATTR_PERSON_ID]}",
            },
        )

    hass.services.async_register(
        DOMAIN, "log_measurement", handle_log_measurement, schema=LOG_MEASUREMENT_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "log_medication", handle_log_medication, schema=LOG_MEDICATION_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "add_symptom", handle_add_symptom, schema=ADD_SYMPTOM_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "add_person", handle_add_person, schema=ADD_PERSON_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "delete_entry", handle_delete_entry, schema=DELETE_ENTRY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "get_summary", handle_get_summary, schema=GET_SUMMARY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "delete_person", handle_delete_person, schema=DELETE_PERSON_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "activate_person", handle_activate_person, schema=ACTIVATE_PERSON_SCHEMA
    )

    _LOGGER.debug("HomeSick: registered 8 services")


def _format_summary(summary: dict[str, Any]) -> str:
    """Format summary dict as a readable notification message."""
    lines = [
        f"**{summary.get('person_name')}** — last {summary.get('hours')} hours",
        "",
        f"Latest temperature: **{summary.get('latest_temperature', '—')} °C**",
        f"Measurements: {summary.get('measurement_count', 0)}",
        f"Medication doses: {summary.get('medication_count', 0)}",
        f"Wellbeing entries: {summary.get('wellbeing_count', 0)}",
    ]

    meds = summary.get("medications", [])
    if meds:
        lines += ["", "**Medication:**"]
        for m in meds[:5]:
            ts = m.get("timestamp", "")[:16].replace("T", " ")
            lines.append(f"- {ts} {m['name']}")

    return "\n".join(lines)
