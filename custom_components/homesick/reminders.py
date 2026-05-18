"""HomeSick reminder engine."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_time

from .const import (
    DEFAULT_MISSED_WINDOW_MIN,
    REMINDER_END_DATE,
    REMINDER_END_DOSE_COUNT,
    REMINDER_FREQ_DAILY,
    REMINDER_FREQ_EVERY_N,
    REMINDER_FREQ_MULTIPLE,
    REMINDER_STATUS_PENDING,
    SCHEDULE_HORIZON_DAYS,
)
from .storage import HomeSickStore

_LOGGER = logging.getLogger(__name__)
UTC = timezone.utc


class ReminderEngine:
    """Manages all medication reminder schedules."""

    def __init__(self, hass: HomeAssistant, storage: HomeSickStore) -> None:
        self.hass = hass
        self.storage = storage
        self._unsub: dict[str, list] = {}

    # ── Boot ──────────────────────────────────────────────────────────────

    async def async_boot(self, person_ids: list[str]) -> None:
        """Call on integration startup. Registers timers for all active schedules."""
        enabled = await self.storage.async_get_reminders_enabled()
        if not enabled:
            _LOGGER.info("Reminder masterswitch is OFF — skipping timer registration.")
            return
        for pid in person_ids:
            schedules = await self.storage.async_get_all_schedules_for_person(pid)
            for sched in schedules:
                if not sched.get("enabled"):
                    continue
                await self._ensure_horizon(sched)
                for dose in sched.get("upcoming_doses", []):
                    if dose["status"] == REMINDER_STATUS_PENDING:
                        self._register_dose_timers(sched, dose)

    async def async_teardown(self) -> None:
        """Cancel all timers on unload."""
        for dose_id, unsubs in self._unsub.items():
            for unsub in unsubs:
                unsub()
        self._unsub.clear()

    # ── Schedule activation / deactivation ───────────────────────────────

    async def async_activate_schedule(self, schedule: dict) -> None:
        """Activate a schedule: generate horizon + register timers."""
        schedule["enabled"] = True
        await self._ensure_horizon(schedule)
        await self.storage.async_save_schedule(schedule)
        for dose in schedule.get("upcoming_doses", []):
            if dose["status"] == REMINDER_STATUS_PENDING:
                self._register_dose_timers(schedule, dose)

    async def async_deactivate_schedule(
        self, person_id: str, medicine_name: str
    ) -> None:
        """Pause schedule without deleting it."""
        sched = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched is None:
            return
        sched["enabled"] = False
        await self.storage.async_save_schedule(sched)
        for dose in sched.get("upcoming_doses", []):
            self._cancel_dose_timers(dose["id"])

    # ── Dose confirmation ─────────────────────────────────────────────────

    async def async_auto_confirm_nearest(
        self, person_id: str, medicine_name: str
    ) -> None:
        """Confirm the nearest pending dose within the miss window."""
        sched = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched is None or not sched.get("enabled"):
            return
        now = datetime.now(UTC)
        window = timedelta(
            minutes=sched.get("missed_window_minutes", DEFAULT_MISSED_WINDOW_MIN)
        )
        best: dict | None = None
        best_delta = timedelta.max
        for dose in sched.get("upcoming_doses", []):
            if dose["status"] != REMINDER_STATUS_PENDING:
                continue
            scheduled = datetime.fromisoformat(dose["scheduled_at"])
            delta = abs(now - scheduled)
            if delta <= window and delta < best_delta:
                best = dose
                best_delta = delta
        if best is not None:
            self._cancel_dose_timers(best["id"])
            finished = await self.storage.async_confirm_dose(
                person_id, medicine_name, best["id"]
            )
            if finished:
                _LOGGER.info(
                    "Schedule for %s/%s ended (dose count reached).",
                    person_id, medicine_name,
                )
            else:
                sched2 = await self.storage.async_get_schedule(person_id, medicine_name)
                if sched2:
                    await self._ensure_horizon(sched2)

    async def async_manual_confirm(
        self, person_id: str, medicine_name: str, dose_id: str
    ) -> None:
        """Manual confirmation from the UI also logs a dose entry."""
        self._cancel_dose_timers(dose_id)
        await self.storage.async_confirm_dose(person_id, medicine_name, dose_id)
        sched = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched:
            await self.storage.async_add_medication(
                person_id=person_id,
                name=sched["medicine_name"],
                note="Manuell bekräftelse",
            )

    # ── Timer registration ─────────────────────────────────────────────────

    def _register_dose_timers(self, sched: dict, dose: dict) -> None:
        dose_id = dose["id"]
        scheduled_at = datetime.fromisoformat(dose["scheduled_at"])
        now = datetime.now(UTC)
        missed_window = timedelta(
            minutes=sched.get("missed_window_minutes", DEFAULT_MISSED_WINDOW_MIN)
        )
        person_id = sched["person_id"]
        medicine_name = sched["medicine_name"]

        unsubs: list = []

        if scheduled_at > now:
            @callback
            def _fire_notify(_now, _pid=person_id, _med=medicine_name, _did=dose_id):
                self.hass.async_create_task(
                    self._async_send_notification(_pid, _med, _did)
                )

            unsubs.append(
                async_track_point_in_time(self.hass, _fire_notify, scheduled_at)
            )

        miss_at = scheduled_at + missed_window
        if miss_at > now:
            @callback
            def _fire_miss(_now, _pid=person_id, _med=medicine_name, _did=dose_id):
                self.hass.async_create_task(
                    self._async_check_missed(_pid, _med, _did)
                )

            unsubs.append(
                async_track_point_in_time(self.hass, _fire_miss, miss_at)
            )

        if unsubs:
            self._unsub[dose_id] = unsubs

    def _cancel_dose_timers(self, dose_id: str) -> None:
        for unsub in self._unsub.pop(dose_id, []):
            unsub()

    # ── Notification ──────────────────────────────────────────────────────

    async def _async_send_notification(
        self, person_id: str, medicine_name: str, dose_id: str
    ) -> None:
        if not await self.storage.async_get_reminders_enabled():
            return
        sched = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched is None or not sched.get("notifications_on") or not sched.get("enabled"):
            return
        for dose in sched.get("upcoming_doses", []):
            if dose["id"] == dose_id and dose["status"] != REMINDER_STATUS_PENDING:
                return
        person_data = await self.storage.async_get_person(person_id)
        person_name = person_data.get("name", person_id) if person_data else person_id
        notify_service = sched.get("notify_target") or "notify"
        await self.hass.services.async_call(
            "notify",
            notify_service,
            {
                "title": f"Dags att ta {medicine_name}",
                "message": f"{person_name} ska ta {medicine_name} nu.",
                "data": {
                    "tag": f"homesick_dose_{dose_id}",
                    "actions": [
                        {"action": f"confirm_dose_{dose_id}", "title": "Tagen ✓"},
                    ],
                },
            },
            blocking=False,
        )

    # ── Miss detection ─────────────────────────────────────────────────────

    async def _async_check_missed(
        self, person_id: str, medicine_name: str, dose_id: str
    ) -> None:
        sched = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched is None:
            return
        for dose in sched.get("upcoming_doses", []):
            if dose["id"] == dose_id and dose["status"] == REMINDER_STATUS_PENDING:
                await self.storage.async_mark_dose_missed(person_id, medicine_name, dose_id)
                _LOGGER.info("Dose %s for %s/%s marked missed.", dose_id, person_id, medicine_name)
                break
        sched2 = await self.storage.async_get_schedule(person_id, medicine_name)
        if sched2 and sched2.get("enabled"):
            await self._ensure_horizon(sched2)

    # ── Horizon generation ─────────────────────────────────────────────────

    async def _ensure_horizon(self, sched: dict) -> None:
        """Generate upcoming_doses up to SCHEDULE_HORIZON_DAYS ahead if needed."""
        if not sched.get("frequency"):
            return
        end = sched.get("end", {})
        now = datetime.now(UTC)
        horizon = now + timedelta(days=SCHEDULE_HORIZON_DAYS)

        if end.get("type") == REMINDER_END_DATE and end.get("date"):
            end_dt = datetime.fromisoformat(end["date"]).replace(tzinfo=UTC)
            if end_dt < now:
                sched["enabled"] = False
                await self.storage.async_save_schedule(sched)
                return
            horizon = min(horizon, end_dt)

        existing_pending = {
            d["scheduled_at"]
            for d in sched.get("upcoming_doses", [])
            if d["status"] == REMINDER_STATUS_PENDING
        }

        new_times = list(self._generate_schedule_times(sched, now, horizon))
        for t_iso in new_times:
            if t_iso not in existing_pending:
                dose_count_ok = True
                if end.get("type") == REMINDER_END_DOSE_COUNT:
                    remaining = end["dose_count"] - end.get("doses_taken", 0)
                    pending_count = len(existing_pending)
                    if pending_count >= remaining:
                        dose_count_ok = False
                if dose_count_ok:
                    new_dose = {
                        "id": f"dose_{uuid.uuid4().hex[:8]}",
                        "scheduled_at": t_iso,
                        "status": REMINDER_STATUS_PENDING,
                        "taken_at": None,
                    }
                    sched.setdefault("upcoming_doses", []).append(new_dose)
                    existing_pending.add(t_iso)

        await self.storage.async_save_schedule(sched)
        for dose in sched.get("upcoming_doses", []):
            if dose["status"] == REMINDER_STATUS_PENDING and dose["id"] not in self._unsub:
                self._register_dose_timers(sched, dose)

    def _generate_schedule_times(
        self, sched: dict, from_dt: datetime, to_dt: datetime
    ) -> list[str]:
        """Yield ISO timestamps for all scheduled doses between from_dt and to_dt."""
        freq = sched["frequency"]
        ftype = freq["type"]
        result = []
        cursor = from_dt.replace(second=0, microsecond=0)

        if ftype == REMINDER_FREQ_DAILY:
            for time_str in freq.get("times", ["08:00"]):
                h, m = map(int, time_str.split(":"))
                t = cursor.replace(hour=h, minute=m)
                if t < from_dt:
                    t += timedelta(days=1)
                while t <= to_dt:
                    result.append(t.isoformat())
                    t += timedelta(days=1)

        elif ftype == REMINDER_FREQ_MULTIPLE:
            if freq.get("interval_hours"):
                h, m = map(int, freq["times"][0].split(":"))
                t = cursor.replace(hour=h, minute=m)
                if t < from_dt:
                    t += timedelta(days=1)
                interval = timedelta(hours=freq["interval_hours"])
                while t <= to_dt:
                    result.append(t.isoformat())
                    t += interval
            else:
                for time_str in freq.get("times", []):
                    h, m = map(int, time_str.split(":"))
                    t = cursor.replace(hour=h, minute=m)
                    if t < from_dt:
                        t += timedelta(days=1)
                    while t <= to_dt:
                        result.append(t.isoformat())
                        t += timedelta(days=1)

        elif ftype == REMINDER_FREQ_EVERY_N:
            n = freq.get("every_n_days", 1)
            for time_str in freq.get("times", ["08:00"]):
                h, m = map(int, time_str.split(":"))
                t = cursor.replace(hour=h, minute=m)
                if t < from_dt:
                    t += timedelta(days=n)
                while t <= to_dt:
                    result.append(t.isoformat())
                    t += timedelta(days=n)

        return sorted(set(result))
