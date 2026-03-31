"""HomeSick sensor platform.

One SensorEntity is created per person per measurement type.
Each entity reads its value from the coordinator snapshot so there
is never any I/O inside a property.

Sensor naming convention:
  sensor.homesick_<person_slug>_<type>
  e.g. sensor.homesick_anna_temperature
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    UnitOfMass,
    UnitOfLength,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from . import HomeSickConfigEntry
from .const import (
    DOMAIN,
    MTYPE_BLOOD_GLUCOSE,
    MTYPE_BLOOD_PRESSURE,
    MTYPE_BMI,
    MTYPE_HEIGHT,
    MTYPE_MOOD,
    MTYPE_PAIN,
    MTYPE_PULSE,
    MTYPE_SPO2,
    MTYPE_TEMPERATURE,
    MTYPE_WAIST,
    MTYPE_WEIGHT,
    TEMP_FEVER,
    TEMP_SUBFEVER,
)
from .coordinator import HomeSickCoordinator

_LOGGER = logging.getLogger(__name__)

# Unit for pulse (beats per minute) — HA doesn't have a built-in constant
BEATS_PER_MINUTE = "slag/min"
MMHG = "mmHg"


@dataclass(frozen=True)
class HomeSickSensorDescription(SensorEntityDescription):
    """Extends SensorEntityDescription with HomeSick-specific fields."""

    mtype: str = ""
    # If True, also expose value2 (e.g. diastolic for blood pressure)
    has_value2: bool = False
    value2_name_suffix: str = ""


SENSOR_DESCRIPTIONS: tuple[HomeSickSensorDescription, ...] = (
    HomeSickSensorDescription(
        key=MTYPE_TEMPERATURE,
        mtype=MTYPE_TEMPERATURE,
        name="Temperatur",
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:thermometer",
    ),
    HomeSickSensorDescription(
        key=MTYPE_PULSE,
        mtype=MTYPE_PULSE,
        name="Puls",
        native_unit_of_measurement=BEATS_PER_MINUTE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:heart-pulse",
    ),
    HomeSickSensorDescription(
        key=MTYPE_BLOOD_PRESSURE,
        mtype=MTYPE_BLOOD_PRESSURE,
        name="Blodtryck systoliskt",
        native_unit_of_measurement=MMHG,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:blood-bag",
        has_value2=True,
        value2_name_suffix="diastoliskt",
    ),
    HomeSickSensorDescription(
        key=MTYPE_WEIGHT,
        mtype=MTYPE_WEIGHT,
        name="Vikt",
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        device_class=SensorDeviceClass.WEIGHT,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:scale",
    ),
    HomeSickSensorDescription(
        key=MTYPE_SPO2,
        mtype=MTYPE_SPO2,
        name="Syremättnad",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:percent",
    ),
    HomeSickSensorDescription(
        key=MTYPE_PAIN,
        mtype=MTYPE_PAIN,
        name="Smärtnivå",
        native_unit_of_measurement=None,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:emoticon-sad-outline",
    ),
    HomeSickSensorDescription(
        key=MTYPE_MOOD,
        mtype=MTYPE_MOOD,
        name="Humör",
        native_unit_of_measurement=None,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:emoticon-outline",
    ),
    HomeSickSensorDescription(
        key=MTYPE_BLOOD_GLUCOSE,
        mtype=MTYPE_BLOOD_GLUCOSE,
        name="Blodsocker",
        native_unit_of_measurement="mmol/L",
        device_class=SensorDeviceClass.BLOOD_GLUCOSE_CONCENTRATION,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:water-percent",
    ),
    HomeSickSensorDescription(
        key=MTYPE_HEIGHT,
        mtype=MTYPE_HEIGHT,
        name="Längd",
        native_unit_of_measurement=UnitOfLength.CENTIMETERS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:human-male-height",
    ),
    HomeSickSensorDescription(
        key=MTYPE_BMI,
        mtype=MTYPE_BMI,
        name="BMI",
        native_unit_of_measurement="kg/m²",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:human",
    ),
    HomeSickSensorDescription(
        key=MTYPE_WAIST,
        mtype=MTYPE_WAIST,
        name="Midjemått",
        native_unit_of_measurement=UnitOfLength.CENTIMETERS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:tape-measure",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: HomeSickConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up HomeSick sensor platform."""
    coordinator: HomeSickCoordinator = config_entry.runtime_data.coordinator

    entities: list[HomeSickSensor] = []

    for person_id, snapshot in coordinator.data.persons.items():
        for description in SENSOR_DESCRIPTIONS:
            entities.append(
                HomeSickSensor(coordinator, person_id, description)
            )
            # Also create a sensor for diastolic BP
            if description.has_value2:
                entities.append(
                    HomeSickSensor(
                        coordinator,
                        person_id,
                        description,
                        use_value2=True,
                    )
                )

        # One sensor for the last medication
        entities.append(HomeSickMedicationSensor(coordinator, person_id))

    async_add_entities(entities)


class HomeSickSensor(CoordinatorEntity[HomeSickCoordinator], SensorEntity):
    """A measurement sensor for one person."""

    entity_description: HomeSickSensorDescription

    def __init__(
        self,
        coordinator: HomeSickCoordinator,
        person_id: str,
        description: HomeSickSensorDescription,
        use_value2: bool = False,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._person_id = person_id
        self._use_value2 = use_value2

        person_name = coordinator.data.persons[person_id].name
        person_slug = slugify(person_name)

        if use_value2:
            suffix = description.value2_name_suffix
            self._attr_unique_id = f"{DOMAIN}_{person_id}_{description.mtype}_2"
            self._attr_name = f"{person_name} Blodtryck {suffix}"
            self.entity_id = f"sensor.{DOMAIN}_{person_slug}_{description.mtype}_2"
        else:
            self._attr_unique_id = f"{DOMAIN}_{person_id}_{description.mtype}"
            self._attr_name = f"{person_name} {description.name}"
            self.entity_id = f"sensor.{DOMAIN}_{person_slug}_{description.mtype}"

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, person_id)},
            name=coordinator.data.persons[person_id].name,
            manufacturer="HomeSick",
            model="Hälsologg",
            sw_version="1.0.0",
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> float | None:
        snapshot = self.coordinator.get_snapshot(self._person_id)
        if snapshot is None:
            return None
        entry = snapshot.latest.get(self.entity_description.mtype)
        if entry is None:
            return None
        key = "value2" if self._use_value2 else "value"
        return entry.get(key)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self.coordinator.get_snapshot(self._person_id)
        if snapshot is None:
            return {}
        entry = snapshot.latest.get(self.entity_description.mtype)
        if entry is None:
            return {}

        attrs: dict[str, Any] = {
            "timestamp": entry.get("timestamp"),
            "note": entry.get("note"),
            "person_id": self._person_id,
        }

        # Temperature: add fever status
        if self.entity_description.mtype == MTYPE_TEMPERATURE and entry.get("value"):
            temp = entry["value"]
            if temp >= TEMP_FEVER:
                attrs["fever_status"] = "fever"
            elif temp >= TEMP_SUBFEVER:
                attrs["fever_status"] = "subfever"
            else:
                attrs["fever_status"] = "normal"

        # Blood pressure: include both values on each sensor
        if self.entity_description.mtype == MTYPE_BLOOD_PRESSURE:
            attrs["systolic"] = entry.get("value")
            attrs["diastolic"] = entry.get("value2")

        return attrs


class HomeSickMedicationSensor(
    CoordinatorEntity[HomeSickCoordinator], SensorEntity
):
    """Sensor showing the last logged medication for a person."""

    def __init__(
        self,
        coordinator: HomeSickCoordinator,
        person_id: str,
    ) -> None:
        super().__init__(coordinator)
        self._person_id = person_id
        person_name = coordinator.data.persons[person_id].name

        person_slug = slugify(person_name)
        self._attr_unique_id = f"{DOMAIN}_{person_id}_last_medication"
        self._attr_name = f"{person_name} Senaste medicin"
        self.entity_id = f"sensor.{DOMAIN}_{person_slug}_last_medication"
        self._attr_icon = "mdi:pill"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, person_id)},
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> str | None:
        snapshot = self.coordinator.get_snapshot(self._person_id)
        if snapshot is None or snapshot.last_medication is None:
            return None
        return snapshot.last_medication.get("name")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self.coordinator.get_snapshot(self._person_id)
        if snapshot is None or snapshot.last_medication is None:
            return {}
        med = snapshot.last_medication
        return {
            "dose": med.get("dose"),
            "unit": med.get("unit"),
            "route": med.get("route"),
            "timestamp": med.get("timestamp"),
            "skipped": med.get("skipped", False),
            "note": med.get("note"),
            "person_id": self._person_id,
        }
