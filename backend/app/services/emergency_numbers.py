"""Per-country emergency numbers, for global applicability.

The reverse geocoder (Nominatim) gives us ISO 3166-1 alpha-2 country
codes for any lat/lng (e.g. 'in', 'us', 'gb'). This module maps those
to the right local emergency numbers, with a sensible 'all' fallback
for unknown territories.

Coverage: ~50 countries, picked from the World Bank top-50 by population
and the top travel destinations. Adding more is a one-line edit.
"""
from __future__ import annotations

# Country code -> { police, ambulance, fire, all (preferred unified) }.
# 'all' is what the SOS giant tap dials. None = service not numbered
# separately in that country (use 'all' for everything).
NUMBERS = {
    "in": {"name": "India",          "police": "100", "ambulance": "102", "fire": "101", "all": "112"},
    "us": {"name": "United States",  "police": "911", "ambulance": "911", "fire": "911", "all": "911"},
    "ca": {"name": "Canada",         "police": "911", "ambulance": "911", "fire": "911", "all": "911"},
    "mx": {"name": "Mexico",         "police": "911", "ambulance": "911", "fire": "911", "all": "911"},
    "gb": {"name": "United Kingdom", "police": "999", "ambulance": "999", "fire": "999", "all": "112"},
    "ie": {"name": "Ireland",        "police": "999", "ambulance": "999", "fire": "999", "all": "112"},
    "fr": {"name": "France",         "police": "17",  "ambulance": "15",  "fire": "18",  "all": "112"},
    "de": {"name": "Germany",        "police": "110", "ambulance": "112", "fire": "112", "all": "112"},
    "es": {"name": "Spain",          "police": "091", "ambulance": "061", "fire": "080", "all": "112"},
    "it": {"name": "Italy",          "police": "113", "ambulance": "118", "fire": "115", "all": "112"},
    "pt": {"name": "Portugal",       "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "nl": {"name": "Netherlands",    "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "be": {"name": "Belgium",        "police": "101", "ambulance": "100", "fire": "100", "all": "112"},
    "ch": {"name": "Switzerland",    "police": "117", "ambulance": "144", "fire": "118", "all": "112"},
    "at": {"name": "Austria",        "police": "133", "ambulance": "144", "fire": "122", "all": "112"},
    "se": {"name": "Sweden",         "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "no": {"name": "Norway",         "police": "112", "ambulance": "113", "fire": "110", "all": "112"},
    "dk": {"name": "Denmark",        "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "fi": {"name": "Finland",        "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "pl": {"name": "Poland",         "police": "997", "ambulance": "999", "fire": "998", "all": "112"},
    "cz": {"name": "Czechia",        "police": "158", "ambulance": "155", "fire": "150", "all": "112"},
    "gr": {"name": "Greece",         "police": "100", "ambulance": "166", "fire": "199", "all": "112"},
    "ru": {"name": "Russia",         "police": "102", "ambulance": "103", "fire": "101", "all": "112"},
    "ua": {"name": "Ukraine",        "police": "102", "ambulance": "103", "fire": "101", "all": "112"},
    "tr": {"name": "Turkey",         "police": "155", "ambulance": "112", "fire": "110", "all": "112"},
    "jp": {"name": "Japan",          "police": "110", "ambulance": "119", "fire": "119", "all": "110"},
    "kr": {"name": "South Korea",    "police": "112", "ambulance": "119", "fire": "119", "all": "112"},
    "cn": {"name": "China",          "police": "110", "ambulance": "120", "fire": "119", "all": "110"},
    "tw": {"name": "Taiwan",         "police": "110", "ambulance": "119", "fire": "119", "all": "112"},
    "hk": {"name": "Hong Kong",      "police": "999", "ambulance": "999", "fire": "999", "all": "999"},
    "sg": {"name": "Singapore",      "police": "999", "ambulance": "995", "fire": "995", "all": "999"},
    "my": {"name": "Malaysia",       "police": "999", "ambulance": "999", "fire": "999", "all": "112"},
    "id": {"name": "Indonesia",      "police": "110", "ambulance": "118", "fire": "113", "all": "112"},
    "th": {"name": "Thailand",       "police": "191", "ambulance": "1669","fire": "199", "all": "112"},
    "vn": {"name": "Vietnam",        "police": "113", "ambulance": "115", "fire": "114", "all": "112"},
    "ph": {"name": "Philippines",    "police": "911", "ambulance": "911", "fire": "911", "all": "911"},
    "au": {"name": "Australia",      "police": "000", "ambulance": "000", "fire": "000", "all": "000"},
    "nz": {"name": "New Zealand",    "police": "111", "ambulance": "111", "fire": "111", "all": "111"},
    "ae": {"name": "UAE",            "police": "999", "ambulance": "998", "fire": "997", "all": "999"},
    "sa": {"name": "Saudi Arabia",   "police": "999", "ambulance": "997", "fire": "998", "all": "911"},
    "qa": {"name": "Qatar",          "police": "999", "ambulance": "999", "fire": "999", "all": "999"},
    "il": {"name": "Israel",         "police": "100", "ambulance": "101", "fire": "102", "all": "112"},
    "eg": {"name": "Egypt",          "police": "122", "ambulance": "123", "fire": "180", "all": "122"},
    "za": {"name": "South Africa",   "police": "10111", "ambulance": "10177", "fire": "10177", "all": "112"},
    "ng": {"name": "Nigeria",        "police": "112", "ambulance": "112", "fire": "112", "all": "112"},
    "ke": {"name": "Kenya",          "police": "999", "ambulance": "999", "fire": "999", "all": "112"},
    "br": {"name": "Brazil",         "police": "190", "ambulance": "192", "fire": "193", "all": "190"},
    "ar": {"name": "Argentina",      "police": "911", "ambulance": "107", "fire": "100", "all": "911"},
    "cl": {"name": "Chile",          "police": "133", "ambulance": "131", "fire": "132", "all": "133"},
    "co": {"name": "Colombia",       "police": "123", "ambulance": "125", "fire": "119", "all": "123"},
    "pe": {"name": "Peru",           "police": "105", "ambulance": "117", "fire": "116", "all": "105"},
    "np": {"name": "Nepal",          "police": "100", "ambulance": "102", "fire": "101", "all": "112"},
    "bd": {"name": "Bangladesh",     "police": "999", "ambulance": "999", "fire": "999", "all": "999"},
    "pk": {"name": "Pakistan",       "police": "15",  "ambulance": "115", "fire": "16",  "all": "15"},
    "lk": {"name": "Sri Lanka",      "police": "119", "ambulance": "1990","fire": "110", "all": "119"},
    "mm": {"name": "Myanmar",        "police": "199", "ambulance": "192", "fire": "191", "all": "199"},
    "kh": {"name": "Cambodia",       "police": "117", "ambulance": "119", "fire": "118", "all": "117"},
}

# Fallback when reverse geocoder returns a country we haven't mapped yet.
# 112 is the GSM-mandated universal mobile emergency number and works on
# most cellular networks worldwide even where 'official' numbers differ.
DEFAULT = {
    "name": "Unknown region",
    "police": "112",
    "ambulance": "112",
    "fire": "112",
    "all": "112",
}


def get_numbers(country_code: str | None) -> dict:
    """Return a numbers bundle for an ISO 3166-1 alpha-2 code.
    Always returns SOMETHING -- falls back to GSM 112 globally."""
    if not country_code:
        return DEFAULT.copy()
    rec = NUMBERS.get(country_code.lower())
    if rec is None:
        return {**DEFAULT, "queried_code": country_code.lower()}
    return rec.copy()


def all_countries() -> list[dict]:
    """For client-side bulk-cache so an offline user crossing borders
    still gets right numbers without a network round-trip."""
    out = []
    for code, rec in NUMBERS.items():
        out.append({"code": code, **rec})
    out.sort(key=lambda r: r["name"])
    return out
