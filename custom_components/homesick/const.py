"""Constants for HomeSick."""

DOMAIN = "homesick"
STORAGE_KEY = "homesick_data"
STORAGE_VERSION = 1

# Measurement types
MTYPE_TEMPERATURE = "temperature"
MTYPE_BLOOD_PRESSURE = "blood_pressure"
MTYPE_PULSE = "pulse"
MTYPE_WEIGHT = "weight"
MTYPE_SPO2 = "spo2"
MTYPE_PAIN = "pain"
MTYPE_MOOD = "mood"
MTYPE_BLOOD_GLUCOSE = "blood_glucose"
MTYPE_HEIGHT = "height"
MTYPE_BMI = "bmi"
MTYPE_WAIST = "waist"

MEASUREMENT_TYPES = [
    MTYPE_TEMPERATURE,
    MTYPE_BLOOD_PRESSURE,
    MTYPE_PULSE,
    MTYPE_WEIGHT,
    MTYPE_SPO2,
    MTYPE_PAIN,
    MTYPE_MOOD,
    MTYPE_BLOOD_GLUCOSE,
    MTYPE_HEIGHT,
    MTYPE_BMI,
    MTYPE_WAIST,
]

# Default medication list shown in the UI
DEFAULT_MEDICATIONS = [
    "Alvedon 500mg",
    "Alvedon 1g",
    "Ipren 200mg",
    "Ipren 400mg",
    "Ipren 600mg",
    "Näsdroppar",
    "Voltaren",
]

# Fever thresholds (°C)
TEMP_SUBFEVER = 37.3
TEMP_FEVER = 38.0

# Config flow keys
CONF_PERSON_NAME = "person_name"
CONF_PERSON_BIRTH_DATE = "birth_date"
CONF_PERSON_GENDER = "gender"

# Gender options
GENDER_MALE = "male"
GENDER_FEMALE = "female"
GENDER_OTHER = "other"
GENDERS = [GENDER_MALE, GENDER_FEMALE, GENDER_OTHER]

# ── Reminder / schedule constants ──────────────────────────────────────────

REMINDER_FREQ_DAILY         = "daily"
REMINDER_FREQ_MULTIPLE      = "multiple_daily"
REMINDER_FREQ_EVERY_N       = "every_n_days"

REMINDER_END_NONE           = "none"
REMINDER_END_DATE           = "date"
REMINDER_END_DOSE_COUNT     = "dose_count"

REMINDER_STATUS_PENDING     = "pending"
REMINDER_STATUS_TAKEN       = "taken"
REMINDER_STATUS_MISSED      = "missed"

DEFAULT_MISSED_WINDOW_MIN   = 120          # 2 hours
SCHEDULE_HORIZON_DAYS       = 14           # how many days ahead to pre-generate doses
WEEK_SECONDS                = 7 * 24 * 3600

# HA persistent notification / mobile notify
NOTIFY_SERVICE_DOMAIN       = "notify"
NOTIFY_SERVICE_NAME         = "mobile_app"   # overridden per-user in config

# ── Masterswitch ────────────────────────────────────────────────────────────
REMINDERS_ENABLED_KEY       = "reminders_enabled"   # top-level key in homesick_data
