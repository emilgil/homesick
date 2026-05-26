"""HomeSick — Home Assistant integration.

Lifecycle:
  async_setup_entry   — called by HA when the config entry is loaded.
    1. Creates HomeSickStore
    2. Creates HomeSickCoordinator and does first refresh
    3. Saves runtime_data on the config entry
    4. Forwards setup to the sensor platform
    5. Registers HA services
    6. Creates the first person (from config flow data) if the store is empty

  async_unload_entry  — cleans up platforms and services.
"""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import CONF_PERSON_BIRTH_DATE, CONF_PERSON_GENDER, CONF_PERSON_NAME, DOMAIN
from .coordinator import HomeSickCoordinator
from .reminders import ReminderEngine
from .services import async_register_services
from .storage import HomeSickStore

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

# Typed config entry so other modules can import HomeSickConfigEntry
type HomeSickConfigEntry = ConfigEntry[HomeSickRuntimeData]


@dataclass
class HomeSickRuntimeData:
    """Objects that live for the lifetime of the config entry."""

    coordinator: HomeSickCoordinator
    store: HomeSickStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomeSickConfigEntry,
) -> bool:
    """Set up HomeSick from a config entry."""

    # 1. Storage
    store = HomeSickStore(hass)

    # 2. Add config_flow person if not already in storage (match by name)
    cf_name = entry.data.get(CONF_PERSON_NAME, "")
    existing = await store.async_get_persons()
    existing_names = {p["name"].lower() for p in existing}
    if cf_name and cf_name.lower() not in existing_names:
        await store.async_add_person(
            name=cf_name,
            birth_date=entry.data.get(CONF_PERSON_BIRTH_DATE),
            gender=entry.data.get(CONF_PERSON_GENDER),
        )
        _LOGGER.info("HomeSick: created person '%s' from config flow", cf_name)

    # 3. Coordinator
    coordinator = HomeSickCoordinator(hass, entry, store)
    await coordinator.async_config_entry_first_refresh()

    # 4. Store runtime data on the entry
    entry.runtime_data = HomeSickRuntimeData(
        coordinator=coordinator,
        store=store,
    )

    # 5. Forward to sensor platform
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # 6. Register services
    await async_register_services(hass, coordinator, store)

    # 7. Register WebSocket API
    _async_register_websocket_api(hass, store)

    # 8. Copy Lovelace card JS into www/ and register the resource
    await _async_ensure_frontend(hass)
    await _async_register_lovelace_resource(hass)

    # 9. Boot reminder engine
    engine = ReminderEngine(hass, store)
    hass.data.setdefault(DOMAIN, {})["reminder_engine"] = engine
    person_ids = [p["id"] for p in await store.async_get_persons(active_only=True)]
    await engine.async_boot(person_ids)

    # 10. Register REST endpoints for schedules + settings (once per HA boot)
    if not hass.data[DOMAIN].get("_views_registered"):
        hass.http.register_view(HomeSickScheduleView())
        hass.http.register_view(HomeSickSettingsView())
        hass.http.register_view(HomeSickMedCatalogView())
        hass.data[DOMAIN]["_views_registered"] = True

    _LOGGER.info("HomeSick: setup complete")
    return True


@websocket_api.websocket_command({vol.Required("type"): "homesick/get_persons"})
@websocket_api.async_response
async def _ws_get_persons(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return all persons with full data."""
    store: HomeSickStore = connection.hass.data[DOMAIN]["store"]
    data = await store.async_load()
    persons = list(data.get("persons", {}).values())

    # Augment each person with their actual entity_ids from HA state machine
    entity_registry = connection.hass.data.get("entity_registry") or \
        connection.hass.data.get("entity_comp", {})
    states = connection.hass.states.async_all()
    for person in persons:
        pid = person["id"]
        entity_ids: dict[str, str] = {}
        for state in states:
            attrs = state.attributes
            if attrs.get("person_id") == pid:
                # Derive mtype from unique_id stored in entity registry
                pass
        person["entity_ids"] = entity_ids

    # Better: scan entity registry for unique_ids matching this person
    er = connection.hass.data.get("entity_registry")
    if er is None:
        try:
            from homeassistant.helpers import entity_registry as er_helper
            er = er_helper.async_get(connection.hass)
        except Exception:
            er = None

    if er:
        for person in persons:
            pid = person["id"]
            entity_ids: dict[str, str] = {}
            for entry in er.entities.values():
                if entry.platform == DOMAIN and entry.unique_id.startswith(f"{DOMAIN}_{pid}_"):
                    mtype = entry.unique_id[len(f"{DOMAIN}_{pid}_"):]
                    entity_ids[mtype] = entry.entity_id
            person["entity_ids"] = entity_ids

    _LOGGER.debug("WS get_persons: returning %d persons", len(persons))
    connection.send_result(msg["id"], persons)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homesick/get_person_data",
        vol.Required("person_id"): str,
    }
)
@websocket_api.async_response
async def _ws_get_person_data(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return full data for a single person."""
    store: HomeSickStore = connection.hass.data[DOMAIN]["store"]
    data = await store.async_load()
    person = data.get("persons", {}).get(msg["person_id"])
    if person is None:
        _LOGGER.warning("WS get_person_data: person %s not found", msg["person_id"])
        connection.send_error(msg["id"], "not_found", "Person not found")
        return
    _LOGGER.debug("WS get_person_data: returning data for %s", person.get("name"))
    connection.send_result(msg["id"], person)


def _async_register_websocket_api(hass: HomeAssistant, store: HomeSickStore) -> None:
    """Register WebSocket commands and expose store via hass.data."""
    hass.data.setdefault(DOMAIN, {})["store"] = store
    websocket_api.async_register_command(hass, _ws_get_persons)
    websocket_api.async_register_command(hass, _ws_get_person_data)


class HomeSickScheduleView(HomeAssistantView):
    """GET /api/homesick/schedules/<person_id>"""

    url = "/api/homesick/schedules/{person_id}"
    name = "api:homesick:schedules"
    requires_auth = True

    async def get(self, request, person_id: str):
        hass = request.app["hass"]
        store: HomeSickStore = hass.data[DOMAIN]["store"]
        schedules = await store.async_get_all_schedules_for_person(person_id)
        return self.json(schedules)


class HomeSickSettingsView(HomeAssistantView):
    """GET /api/homesick/settings — global settings incl. reminders_enabled."""

    url = "/api/homesick/settings"
    name = "api:homesick:settings"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        store: HomeSickStore = hass.data[DOMAIN]["store"]
        enabled = await store.async_get_reminders_enabled()
        return self.json({"reminders_enabled": enabled})


class HomeSickMedCatalogView(HomeAssistantView):
    """GET /api/homesick/med_catalog — global medication catalog with default doses."""

    url = "/api/homesick/med_catalog"
    name = "api:homesick:med_catalog"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        store: HomeSickStore = hass.data[DOMAIN]["store"]
        catalog = await store.async_get_med_catalog()
        return self.json(list(catalog.values()))


async def _async_ensure_frontend(hass: HomeAssistant) -> None:
    """Copy homesick-card.js from the integration dir to www/homesick/.

    Idempotent — only copies when the destination is missing or older than
    the source, so HACS-installed users always get the JS shipped with the
    integration without manual setup.
    """
    src = Path(__file__).parent / "homesick-card.js"
    dst_dir = Path(hass.config.path("www", "homesick"))
    dst = dst_dir / "homesick-card.js"

    if not src.exists():
        _LOGGER.error("HomeSick: source JS not found at %s", src)
        return

    def _copy() -> bool:
        dst_dir.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or src.stat().st_mtime > dst.stat().st_mtime:
            shutil.copy2(str(src), str(dst))
            return True
        return False

    copied = await hass.async_add_executor_job(_copy)
    if copied:
        _LOGGER.info("HomeSick: copied homesick-card.js to %s", dst)


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Add the custom card JS to Lovelace resources, replacing any stale version."""
    manifest_path = Path(__file__).parent / "manifest.json"
    manifest_text = await hass.async_add_executor_job(manifest_path.read_text)
    card_version = json.loads(manifest_text).get("version", "1")
    base = "/local/homesick/homesick-card.js"
    url = f"{base}?v={card_version}"
    try:
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            return
        resources = lovelace.get("resources") if isinstance(lovelace, dict) else None
        if resources is None:
            return
        existing = await resources.async_get_resources()
        # Find any existing homesick resource (any version)
        old = next((r for r in existing if r.get("url", "").split("?")[0] == base), None)
        if old:
            if old.get("url") != url:
                # Update URL in-place to current version
                update_fn = getattr(resources, "async_update_resource", None) or getattr(resources, "async_update_item", None)
                if update_fn:
                    await update_fn(old["id"], {"url": url, "res_type": "module"})
                    _LOGGER.info("HomeSick: updated Lovelace resource to %s", url)
        else:
            await resources.async_create_resource({"res_type": "module", "url": url})
            _LOGGER.info("HomeSick: Lovelace resource registered: %s", url)
    except Exception as err:  # pylint: disable=broad-except
        _LOGGER.debug("HomeSick: could not auto-register Lovelace resource: %s", err)


async def async_unload_entry(
    hass: HomeAssistant,
    entry: HomeSickConfigEntry,
) -> bool:
    """Unload a config entry."""
    engine = hass.data.get(DOMAIN, {}).pop("reminder_engine", None)
    if engine:
        await engine.async_teardown()

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Remove services — only if no other entries exist (there can only be one,
        # but be defensive)
        if not hass.config_entries.async_entries(DOMAIN):
            for service in (
                "log_measurement",
                "log_medication",
                "add_symptom",
                "add_person",
                "delete_entry",
                "get_summary",
                "delete_person",
                "activate_person",
                "create_schedule",
                "toggle_schedule",
                "delete_schedule",
                "confirm_dose",
                "set_never_ask",
                "decline_reminder",
                "set_reminders_enabled",
            ):
                hass.services.async_remove(DOMAIN, service)

    return unload_ok
