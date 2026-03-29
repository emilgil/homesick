"""Config flow for SjukJournal.

Step 1 — user: enter name of the first person.
Step 2 — done: config entry created, sensors registered.

Adding more persons after installation is done via the
sjukjournal.add_person service or directly in the Lovelace panel.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import CONF_PERSON_BIRTH_DATE, CONF_PERSON_GENDER, CONF_PERSON_NAME, DOMAIN, GENDERS

_LOGGER = logging.getLogger(__name__)

STEP_USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_PERSON_NAME, description={"suggested_value": "Anna"}): cv.string,
        vol.Optional(CONF_PERSON_BIRTH_DATE): cv.string,
        vol.Optional(CONF_PERSON_GENDER): vol.In(GENDERS),
    }
)


class SjukJournalConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the SjukJournal config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First (and only) step: name + optional birth date of first person."""
        # Only allow one instance of the integration
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        errors: dict[str, str] = {}

        if user_input is not None:
            name = user_input[CONF_PERSON_NAME].strip()
            if not name:
                errors[CONF_PERSON_NAME] = "name_required"
            else:
                return self.async_create_entry(
                    title="SjukJournal",
                    data={
                        CONF_PERSON_NAME: name,
                        CONF_PERSON_BIRTH_DATE: user_input.get(CONF_PERSON_BIRTH_DATE),
                        CONF_PERSON_GENDER: user_input.get(CONF_PERSON_GENDER),
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_SCHEMA,
            errors=errors,
            description_placeholders={
                "docs_url": "https://github.com/ditt-repo/sjukjournal"
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SjukJournalOptionsFlow(config_entry)


class SjukJournalOptionsFlow(OptionsFlow):
    """Options flow — currently no configurable options.

    Placeholder so the 'Configure' button appears in the integration card.
    Future options: default medication list, temperature unit, etc.
    """

    def __init__(self, config_entry: ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({}),
            description_placeholders={
                "info": (
                    "Lägg till fler personer via tjänsten sjukjournal.add_person "
                    "eller direkt i SjukJournal-panelen."
                )
            },
        )
