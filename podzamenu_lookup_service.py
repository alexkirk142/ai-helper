"""
Podzamenu Lookup Service
FastAPI service for VIN/FRAME lookups via Playwright.
Sources: podzamenu.ru (EU/JP/KR/RU), prof-rf (Chinese VIN).

Env:
  PODZAMENU_BASE_URL  - base URL (default https://podzamenu.ru)
  PROF_RF_BASE_URL    - prof-rf base (default https://xn--80aagvgd7a1ae.xn--p1acf)
  SOURCE_STRATEGY     - "auto" | "podzamenu" | "prof_rf" (auto: China VIN -> prof_rf)
  HEADLESS            - browser headless (default true)
  SCREENSHOT_ON_ERROR - save base64 screenshot on error (default false)
"""

import asyncio
import base64
import os
import re
from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Podzamenu Lookup Service")

PORT = int(os.environ.get("PORT", "8200"))
PODZAMENU_BASE_URL = os.environ.get("PODZAMENU_BASE_URL", "https://podzamenu.ru").rstrip("/")
PROF_RF_BASE_URL = os.environ.get("PROF_RF_BASE_URL", "https://xn--80aagvgd7a1ae.xn--p1acf").rstrip("/")
SOURCE_STRATEGY = (os.environ.get("SOURCE_STRATEGY", "auto") or "auto").lower()
HEADLESS = os.environ.get("HEADLESS", "true").lower() in ("true", "1", "yes")
SCREENSHOT_ON_ERROR = os.environ.get("SCREENSHOT_ON_ERROR", "false").lower() in ("true", "1", "yes")
LOOKUP_TIMEOUT_MS = 60_000
MAX_RETRIES = 2  # retry on timeout


def is_china_vin(vin: str) -> bool:
    """Return True if VIN starts with L (China)."""
    return bool(vin and vin.upper().strip().startswith("L"))

# One browser per process
_browser = None
_playwright = None
_lookup_semaphore = asyncio.Semaphore(2)
_fetch_semaphore = asyncio.Semaphore(5)


class FetchPageRequest(BaseModel):
    url: str
    timeout: Optional[int] = 10000


class FetchPageResponse(BaseModel):
    html: str
    status: int
    finalUrl: str


class LookupRequest(BaseModel):
    idType: str  # "VIN" | "FRAME"
    value: str


class GearboxOemCandidate(BaseModel):
    oem: str
    name: str


class GearboxInfo(BaseModel):
    model: Optional[str] = None
    factoryCode: Optional[str] = None
    oem: Optional[str] = None
    oemCandidates: list[GearboxOemCandidate] = []
    oemStatus: str  # "FOUND" | "NOT_FOUND" | "NOT_AVAILABLE" | "MODEL_ONLY"
    needsManualKppCode: bool = False


class LookupResponse(BaseModel):
    vehicleMeta: dict
    gearbox: GearboxInfo
    evidence: dict


# Link text to find "Коробка передач" page (case-insensitive)
GEARBOX_LINK_TEXTS = ["коробка передач", "кпп"]

# --- Universal СХЕМЫ УЗЛОВ navigation keywords ---
# Section names in the left menu of СХЕМЫ УЗЛОВ (varies by brand)
TRANSMISSION_SECTION_KEYWORDS = [
    # Russian — exact section names
    "коробка передач",
    "трансмиссия",
    "ходовая часть и трансмиссия",
    "трансмиссия/шасси",
    "автоматическая коробка передач",
    "механическая коробка передач",
    "акпп",
    "мкпп",
    "вариатор",
    # English — exact section names
    "transmission",
    "transaxle",
    "power train",
    "powertrain",
    "drivetrain",
    "drive train",
    "gearbox",
    "automatic transmission",
    "manual transmission",
    "cvt",
    # Brand-specific
    "power train system",
    # French / German (Renault, Mercedes, BMW)
    "boîte",
    "getriebe",
    "schaltgetriebe",
    "automatikgetriebe",
]

# Card/scheme titles inside the transmission section
GEARBOX_CARD_KEYWORDS = [
    # Russian
    "коробка передач в сборе",
    "акпп в сборе",
    "мкпп в сборе",
    "вариатор в сборе",
    "коробка передач",
    "акпп",
    "мкпп",
    # English
    "transaxle assy",
    "transmission assy",
    "automatic transaxle",
    "manual transaxle",
    "a/t assy",
    "m/t assy",
    "cvt assy",
    "automatic transmission assy",
    "manual transmission assy",
    "t/m & t/c attachment",
    "auto trans assy",
    # GM / Chevrolet (e.g. "PART 1 D16 СБОРКА КОРОБКИ ПЕРЕДАЧ(MFH)")
    "сборка коробки передач",
    "part 1 d",
    "part 2 d",
    "коробка передач part",
    # KIA/Hyundai
    "ведущий мост трансмиссии",
    "ведущий мост",
    # Partial (for long card titles)
    "transaxle",
    "transmission",
    "getriebe",
]

# VW Group WMI prefixes (first 3 chars of VIN) — model code is sufficient for price search
VW_GROUP_WMI = {
    "WVW", "WV1", "WV2", "WV3", "WV6",  # Volkswagen
    "WAU", "WA1",                          # Audi
    "TMB",                                 # Skoda (Чехия)
    "XW8",                                 # Skoda (Россия, Нижний Новгород)
    "VSS", "VS6", "VS7",                   # Seat
    "WP0", "WP1",                          # Porsche
    "9BW", "8AW", "1VW",                   # VW other countries
}


def is_vw_group(vin: str) -> bool:
    """Check if VIN belongs to VW Group by WMI (first 3 characters)."""
    return bool(vin) and len(vin) >= 3 and vin[:3].upper() in VW_GROUP_WMI


# Ford WMI prefixes — transmission model from vehicleMeta is sufficient for price search
FORD_WMI = {
    "1FT", "1FA", "1FB", "1FC", "1FD",  # Ford USA
    "1FM",                                # Ford Motor Company SUV/Trucks (Expedition, Explorer)
    "2FT", "2FA", "2FB",                  # Ford Canada
    "3FA", "3FB", "3FE",                  # Ford Mexico
    "WF0",                                # Ford Europe
    "SAJ", "SAL",                          # Jaguar (Ford group)
    "Z6F", "Z6R",                          # Ford Europe (Kuga etc.)
    "X9F",                                # Ford Russia (Vsevolozhsk plant)
    "MAJ",                                 # Ford Malaysia
}

_FORD_TRANS_MODEL_RE = re.compile(r"\b(\d[A-Z]{1,3}\d{1,3}[A-Z]{0,2})\b")
_FORD_TRANS_MODEL_EU_RE = re.compile(r"\b([A-Z]{1,4}\d[A-Z0-9]{0,4})\b")
_FORD_EU_NOISE = {"AT", "MT", "CVT"}


def is_ford(vin: str) -> bool:
    """Check if VIN belongs to Ford by WMI (first 3 characters)."""
    return bool(vin) and len(vin) >= 3 and vin[:3].upper() in FORD_WMI


def extract_ford_transmission_model(transmission_str: str) -> Optional[str]:
    """Extract Ford transmission model code from vehicleMeta transmission field.

    Input examples:
      "TRTC0 - 5R44E/5R55E - 5 Speed Auto Trans" → "5R55E"
      "6DCT450 - MPS6 - PowerShift 6-Speed" → "6DCT450"
      "5-ступенчатая механическая- B5/IB5" → "IB5"

    US patterns: 5R55E, 6R80, 10R80, 4R70W, CD4E, 6DCT450, 4EAT, 6F35
    EU patterns: IB5, B5, MTX75, CD4E, CFT23, MMT6
    """
    if not transmission_str:
        return None
    upper = transmission_str.upper()
    matches = _FORD_TRANS_MODEL_RE.findall(upper)
    if matches:
        return matches[-1]
    # Fallback: split by / or - and find short alphanumeric tokens (EU models)
    parts = re.split(r"[/\-]", upper)
    for part in reversed(parts):
        token = part.strip()
        if 2 <= len(token) <= 8 and re.match(r"^[A-Z0-9]+$", token) and \
                re.search(r"\d", token) and re.search(r"[A-Z]", token) and \
                token not in _FORD_EU_NOISE:
            return token
    # Last resort: EU regex on whole string (skip generic terms)
    eu_matches = _FORD_TRANS_MODEL_EU_RE.findall(upper)
    for m in reversed(eu_matches):
        if m not in _FORD_EU_NOISE and len(m) >= 2:
            return m
    return None


# Name filter: include if contains any (gearbox-related)
OEM_INCLUDE_PATTERNS = [
    "кпп", "акпп", "коробк", "коробка передач", "коробка передач в сборе",
    "мкп", "акп", "вариатор", "вариатор в сборе", "cvt",
    "трансмиссия", "transmission", "gearbox", "gear box",
    "at transmission", "mt transmission",
    "автоматическая коробка", "механическая коробка",
    "transaxle",
]

# Name filter: exclude if contains any
OEM_EXCLUDE_PATTERNS = [
    "масло", "шайб", "фиксатор", "шумоизоляц", "болт", "гайк", "уплотн",
    "прокладк", "сальник", "фильтр", "датчик", "крепеж",
]

# Priority: candidates with these in name rank higher
OEM_PRIORITY_TERMS = [
    "в сборе", "трансмиссия", "коробка передач",
    "transaxle package", "transmission assy", "transaxle assy",
]

# Table column headers (case-insensitive substring match)
OEM_HEADERS = [
    "oem", "оем", "артикул", "каталожный номер",
    "part number", "p/n", "каталожный №",
    "номер детали", "oemcode",
]
# "номер" is common but ambiguous — matched separately with exclusions
OEM_HEADER_LOOSE = ["номер", "код", "№"]
OEM_HEADER_EXCLUDE = ["заказ", "п/п", "строк", "серийн", "телефон"]

NAME_HEADERS = [
    "наименование", "название", "name", "описание",
    "description", "деталь", "запчасть",
]


def _matches_oem_header(cell: str) -> bool:
    """Check if a header cell text looks like an OEM/part-number column."""
    c = cell.lower().strip()
    if any(h in c for h in OEM_HEADERS):
        return True
    if any(h in c for h in OEM_HEADER_LOOSE):
        if not any(ex in c for ex in OEM_HEADER_EXCLUDE):
            return True
    return False


def _matches_name_header(cell: str) -> bool:
    """Check if a header cell text looks like a name/description column."""
    return any(h in cell.lower().strip() for h in NAME_HEADERS)


# Not-found text patterns (Russian) - podzamenu
NOT_FOUND_PATTERNS = [
    r"не\s+найдено",
    r"ничего\s+не\s+найдено",
    r"не\s+найден",
    r"данные\s+не\s+найдены",
    r"автомобиль\s+не\s+найден",
    r"vehicle\s+not\s+found",
    r"no\s+results",
]

# prof_rf specific
PROF_RF_NOT_FOUND_PATTERNS = [
    r"отсутствует\s+в\s+базе\s+данных",
    r"vin\s+код\s+отсутствует",
    r"данный\s+vin\s+код\s+отсутствует",
    r"не\s+найден",
]

# Labels for vehicle meta
META_LABELS = {
    "марка": "make",
    "модель": "model",
    "год": "year",
    "двигатель": "engine",
    "engine": "engine",
    "make": "make",
    "model": "model",
    "year": "year",
    "привод": "driveType",
    "тип привода": "driveType",
    "drive": "driveType",
    "drivetrain": "driveType",
}


def is_valid_gearbox_oem(code: str) -> bool:
    """Distinguish real OEM part number (09G300032P) from factory codes (QCE(6A))
    and garbage metadata dumps (Model Year: 2004;Family: CS;...).
    """
    if not code or len(code) < 6:
        return False
    if "(" in code or ")" in code:
        return False
    if not re.search(r"\d{3,}", code):
        return False
    if any(c in code for c in [";", ":", "="]):
        return False
    if len(code) > 25:
        return False
    return True


def is_factory_code(code: str) -> bool:
    """Detect factory/aggregate code like QCE(6A), DQ250, F4A42."""
    if not code:
        return False
    if re.match(r"^[A-Z]{2,5}\(\d+[A-Z]?\)$", code, re.IGNORECASE):
        return True
    if re.match(r"^[A-Z]{2,4}\d{1,3}$", code, re.IGNORECASE) and len(code) <= 6:
        return True
    return False


FACTORY_CODE_PATTERNS = [
    (r"маркировк[аи]\s*[:：]\s*([^\s<,;]+)", "маркировка"),
    (r"marking\s*[:：]\s*([^\s<,;]+)", "marking"),
    (r"заводской\s+код\s*[:：]\s*([^\s<,;]+)", "заводской код"),
    (r"factory\s*code\s*[:：]\s*([^\s<,;]+)", "factory code"),
    (r"код\s+агрегата\s*[:：]\s*([^\s<,;]+)", "код агрегата"),
]


def _extract_factory_code(html: str, selectors_used: list[str]) -> Optional[str]:
    """Extract factory/aggregate code (e.g. QCE(6A)) from HTML."""
    for pat, label in FACTORY_CODE_PATTERNS:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            code = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            if code and len(code) >= 2 and len(code) <= 20:
                selectors_used.append(f"factoryCode:{label}")
                return code
    return None


# --- Model candidate validation filters ---

_CSS_HASH_RE = re.compile(r"^[a-z]{1,6}\d{2,3}[a-z]?$")
_BODY_CODE_RE = re.compile(r"^[A-Z]{2,4}\d{2}[A-Z]{1,2}$", re.I)
_DATE_RE = re.compile(r"^\d{2}\.\d{4}$")

_GEO_NAMES = {
    "america", "north america", "south america",
    "europe", "europa",
    "russia", "россия",
    "asia", "азия",
    "japan", "япония",
    "china", "китай",
    "korea", "корея",
    "general", "domestic", "export",
}


def _is_css_hash(token: str) -> bool:
    """Filter CSS module hashes like rw88l, zt445r from class names."""
    return bool(_CSS_HASH_RE.match(token.strip().lower()))


def _is_body_code(token: str) -> bool:
    """Filter vehicle body/chassis codes like ZSA44L, ACU25L."""
    t = token.strip()
    if not _BODY_CODE_RE.match(t):
        return False
    return sum(c.isdigit() for c in t) <= 2


def _is_geo_name(token: str) -> bool:
    """Filter geographic region names like 'America', 'Europe', 'Russia'."""
    return token.strip().lower() in _GEO_NAMES


def _is_date_string(token: str) -> bool:
    """Filter date strings like '09.2008' (MM.YYYY or DD.YYYY)."""
    return bool(_DATE_RE.match(token.strip()))


def _is_valid_model_candidate(token: str) -> bool:
    """Check if extracted token is a plausible gearbox model, not CSS hash, body code, geo name or date."""
    t = token.strip()
    if not t or len(t) < 2:
        return False
    if _is_css_hash(t):
        return False
    if _is_body_code(t):
        return False
    if _is_geo_name(t):
        return False
    if _is_date_string(t):
        return False
    return True


def _strip_html_tags(html: str) -> str:
    """Remove HTML tags, return text content only."""
    return re.sub(r"<[^>]+>", " ", html)


def _parse_vehicle_title(title: str) -> tuple[Optional[str], Optional[str]]:
    """Parse vehicle title like 'KIA Spectra' or 'OPEL / INSIGNIA-A' into (make, model)."""
    if not title:
        return None, None
    title = re.sub(r"\s+", " ", title).strip()
    if " / " in title:
        parts = title.split(" / ", 1)
        return parts[0].strip() or None, parts[1].strip() or None
    words = title.split(None, 1)
    if len(words) >= 2:
        return words[0], words[1]
    if len(words) == 1:
        return words[0], None
    return None, None


_KPP_DESC_WORDS_RE = re.compile(
    r"\b(ТРАНСМИССИ[А-ЯЁ]*|РУЧНОГО|УПРАВЛЕНИ[А-ЯЁ]*|АВТОМАТИЧ[А-ЯЁ]*|"
    r"МЕХАНИЧ[А-ЯЁ]*|TRANSMISSION|MANUAL|AUTOMATIC|AUTO|SPEED|SPD|MAN|"
    r"СТУПЕНЧ[А-ЯЁ]*)\b",
    re.IGNORECASE,
)
_KPP_DESC_SPEED_RE = re.compile(r"\d+\s*-?\s*(ступенч|speed|spd)", re.IGNORECASE)
_KPP_MODEL_NOISE = {"AT", "MT", "CVT", "SPD", "MAN", "5SPD", "6SPD", "4SPD"}


def _extract_model_from_kpp_description(kpp_str: str) -> tuple[Optional[str], Optional[str]]:
    """Extract gearbox model code from descriptive KPP column value.

    Examples:
        "(MDG) F17 (CR) ТРАНСМИССИЯ РУЧНОГО УПРАВЛЕНИЯ"  → ("F17", "MDG")
        "(MFG) TRANSMISSION MAN 5 SPD, Y4M"              → ("Y4M", "MFG")
        "(MR6) ТРАНСМИССИЯ РУЧНОГО УПРАВЛЕНИЯ"           → ("MR6", None)
    Returns (model, factory_code).
    """
    if not kpp_str:
        return None, None

    paren_codes = re.findall(r"\(([A-Z0-9]{2,6})\)", kpp_str, re.IGNORECASE)

    # Strategy 1: code after last comma — "TRANSMISSION MAN 5 SPD, Y4M"
    if "," in kpp_str:
        after_comma = kpp_str.rsplit(",", 1)[1].strip()
        m = re.match(r"^([A-Z][A-Z0-9]{1,5})$", after_comma)
        if m:
            factory_code = paren_codes[0] if paren_codes else None
            return m.group(1), factory_code

    # Strategy 2: alphanumeric token between/after parenthesized groups
    stripped = re.sub(r"\([^)]*\)", " ", kpp_str)
    stripped = _KPP_DESC_WORDS_RE.sub(" ", stripped)
    stripped = _KPP_DESC_SPEED_RE.sub(" ", stripped)
    tokens = re.findall(r"[A-Z][A-Z0-9]{1,8}|[A-Z0-9]{2,8}", stripped)
    for token in tokens:
        has_letter = bool(re.search(r"[A-Z]", token, re.IGNORECASE))
        has_digit = bool(re.search(r"\d", token))
        if has_letter and has_digit and token.upper() not in _KPP_MODEL_NOISE:
            factory_code = paren_codes[0] if paren_codes else None
            return token, factory_code

    # Strategy 3: single parenthesized code with digits IS the model (MR6)
    if len(paren_codes) == 1:
        code = paren_codes[0]
        if re.search(r"\d", code) and re.search(r"[A-Z]", code, re.IGNORECASE):
            return code, None

    factory_code = paren_codes[0] if paren_codes else None
    return None, factory_code


def _extract_model_from_aggregates(text: str) -> Optional[str]:
    """Extract gearbox model from Mercedes 'Используемые агрегаты' field.

    Example: "GA - автоматическая КП: 722964 04 060017 (722.964 W7 X 700...)"
    → "722.964"
    """
    if not text:
        return None
    parts = re.split(r"[;\n]", text)
    for part in parts:
        lower = part.lower()
        if not any(kw in lower for kw in ["кп:", "кп :", "коробк", "transmission", "getriebe"]):
            continue
        m = re.search(r"(\d{3}\.\d{3})", part)
        if m:
            return m.group(1)
        m = re.search(r"(?:кп|КП|transmission|getriebe)\S*\s*[:：]\s*(\d{6})", part, re.IGNORECASE)
        if m:
            return m.group(1)
        m = re.search(r"\b(\d{6})\b", part)
        if m:
            return m.group(1)
    return None


async def _extract_vehicle_info_js(page) -> dict:
    """Extract vehicleMeta, КПП hints, gearbox model/factory code from podzamenu MUI tables.
    Returns dict: meta, kppHint, gearboxModel, gearboxFactoryCode, aggregates, vehicleTitle.
    """
    try:
        result = await page.evaluate("""() => {
            const meta = {};
            let kppHint = null;
            let gearboxModel = null;
            let gearboxFactoryCode = null;
            let aggregates = null;
            let vehicleTitle = null;

            // --- 1. Vehicle title from page headings ---
            // On podzamenu.ru, the vehicle title is in <h6> elements:
            //   "NISSAN ALMERA" (first h6, short, uppercase brand)
            //   "NISSAN / ALMERA" (h6 with " / " separator)
            // Accordion section h6 elements are inside MuiAccordion and should be skipped.

            // Strategy A: h6 with " / " separator (most reliable)
            for (const h of document.querySelectorAll('h6')) {
                const t = h.textContent.trim();
                if (t.includes(' / ') && t.length >= 3 && t.length <= 60) {
                    if (h.closest('[class*="Accordion"]')) continue;
                    vehicleTitle = t;
                    break;
                }
            }
            // Strategy B: first short h6 with uppercase Latin brand (not inside accordion)
            if (!vehicleTitle) {
                for (const h of document.querySelectorAll('h6')) {
                    if (h.closest('[class*="Accordion"]')) continue;
                    const t = h.textContent.trim();
                    if (t.length < 3 || t.length > 50) continue;
                    if (/[A-Z]{2,}/.test(t)) {
                        vehicleTitle = t;
                        break;
                    }
                }
            }
            // Strategy C: any h1-h4 (not accordion headings) with brand pattern
            if (!vehicleTitle) {
                const skipT = ['найден', 'поиск', 'фильтр', 'схемы', 'результат',
                    'каталог', 'запчаст', 'корзин', 'вход', 'регистр',
                    'детал', 'двигател', 'трансмисс', 'тормоз', 'кузов', 'систем',
                    'заказ', 'город', 'помощ', 'оригинал', 'спецификац'];
                for (const h of document.querySelectorAll('h1, h2, h4')) {
                    if (h.closest('[class*="Accordion"]')) continue;
                    const t = h.textContent.trim();
                    if (t.length < 3 || t.length > 50) continue;
                    const lower = t.toLowerCase();
                    if (skipT.some(w => lower.includes(w))) continue;
                    if (/[A-Z]{2,}/.test(t)) {
                        vehicleTitle = t;
                        break;
                    }
                }
            }

            // --- 2. Extract from tables ---
            for (const table of document.querySelectorAll('table')) {
                const rows = [...table.querySelectorAll('tr')];
                if (!rows.length) continue;

                // 2a. Horizontal table (column headers in first row)
                const firstCells = [...rows[0].querySelectorAll('th, td')];
                const headers = firstCells.map(c => c.innerText.trim().toLowerCase());

                const gearboxModelIdx = headers.findIndex(h =>
                    h.includes('модель кпп') || h.includes('модель коробки'));
                const gearboxFactoryIdx = headers.findIndex(h =>
                    h.includes('заводской номер коробки') || h.includes('заводской номер кпп'));
                const aggregatesIdx = headers.findIndex(h =>
                    h.includes('используемые агрегаты'));
                const kppIdx = headers.findIndex((h, i) =>
                    (h === 'кпп' || h.includes('кпп'))
                    && i !== gearboxModelIdx && i !== gearboxFactoryIdx);
                const modelIdx = headers.findIndex(h => h === 'модель');
                const engineIdx = headers.findIndex(h => h === 'двигатель');
                const yearIdx = headers.findIndex(h =>
                    h.includes('дата выпуска') || h === 'год');
                const bodyIdx = headers.findIndex(h => h === 'кузов');
                const makeIdx = headers.findIndex(h =>
                    h === 'марка' || h === 'бренд');
                const transIdx = headers.findIndex(h =>
                    h === 'transmission' || h === 'трансмиссия');
                const driveIdx = headers.findIndex(h =>
                    h === 'привод' || h.includes('тип привода') || h === 'drive' || h === 'drivetrain');

                const hasAnyCol = kppIdx >= 0 || gearboxModelIdx >= 0
                    || gearboxFactoryIdx >= 0 || aggregatesIdx >= 0
                    || modelIdx >= 0 || makeIdx >= 0;
                if (hasAnyCol) {
                    for (let i = 1; i < rows.length; i++) {
                        const cells = [...rows[i].querySelectorAll('th, td')];
                        const g = (idx) => idx >= 0 && idx < cells.length
                            ? cells[idx].innerText.trim() : '';
                        const gFull = (idx) => idx >= 0 && idx < cells.length
                            ? cells[idx].textContent.trim() : '';
                        if (!kppHint && g(kppIdx)) kppHint = g(kppIdx);
                        if (!gearboxModel && g(gearboxModelIdx))
                            gearboxModel = g(gearboxModelIdx).substring(0, 200);
                        if (!gearboxFactoryCode && g(gearboxFactoryIdx))
                            gearboxFactoryCode = g(gearboxFactoryIdx).substring(0, 200);
                        const aggVal = gFull(aggregatesIdx);
                        if (aggVal && (!aggregates || aggVal.length > aggregates.length))
                            aggregates = aggVal.substring(0, 2000);
                        if (!meta.model && g(modelIdx))
                            meta.model = g(modelIdx).substring(0, 200);
                        if (!meta.engine && g(engineIdx))
                            meta.engine = g(engineIdx).substring(0, 200);
                        if (!meta.year && g(yearIdx))
                            meta.year = g(yearIdx).substring(0, 200);
                        if (!meta.body && g(bodyIdx))
                            meta.body = g(bodyIdx).substring(0, 200);
                        if (!meta.make && g(makeIdx))
                            meta.make = g(makeIdx).substring(0, 200);
                        if (!meta.transmission && g(transIdx))
                            meta.transmission = g(transIdx).substring(0, 200);
                        if (!meta.driveType && g(driveIdx))
                            meta.driveType = g(driveIdx).substring(0, 200);
                        break;
                    }
                }

                // 2b. Key-value rows (th/td pairs)
                for (const row of rows) {
                    const cells = [...row.querySelectorAll('th, td')];
                    if (cells.length < 2) continue;
                    const key = cells[0].innerText.trim().toLowerCase();
                    const val = cells[1].innerText.trim();
                    if (!val) continue;

                    // Specific KPP columns first (before generic "кпп")
                    if ((key === 'модель кпп' || key.includes('модель кпп')
                        || key.includes('модель коробки')) && !gearboxModel) {
                        gearboxModel = val.substring(0, 200);
                        continue;
                    }
                    if ((key.includes('заводской номер коробки')
                        || key.includes('заводской номер кпп')) && !gearboxFactoryCode) {
                        gearboxFactoryCode = val.substring(0, 200);
                        continue;
                    }
                    if (key.includes('используемые агрегаты')) {
                        const fullVal = cells[1].textContent.trim().substring(0, 2000);
                        if (!aggregates || fullVal.length > aggregates.length) {
                            aggregates = fullVal;
                        }
                        continue;
                    }

                    if ((key === 'кпп' || (key.includes('кпп')
                        && !key.includes('модель') && !key.includes('заводской')
                        && !key.includes('номер'))) && !kppHint) {
                        kppHint = val;
                    }
                    if ((key.includes('марка') || key.includes('бренд'))
                        && !meta.make) meta.make = val.substring(0, 200);
                    if (key === 'модель' && !meta.model)
                        meta.model = val.substring(0, 200);
                    if (key.includes('двигатель') && !meta.engine)
                        meta.engine = val.substring(0, 200);
                    if ((key.includes('дата') || key === 'год') && !meta.year)
                        meta.year = val.substring(0, 200);
                    if (key === 'кузов' && !meta.body)
                        meta.body = val.substring(0, 200);
                    if ((key === 'transmission' || key === 'трансмиссия')
                        && !meta.transmission) meta.transmission = val.substring(0, 200);
                    if ((key === 'привод' || key.includes('тип привода')
                        || key === 'drive' || key === 'drivetrain')
                        && !meta.driveType) meta.driveType = val.substring(0, 200);
                }
            }

            return { meta, kppHint, gearboxModel, gearboxFactoryCode, aggregates, vehicleTitle };
        }""")
        return result or {}
    except Exception:
        return {}


async def _navigate_to_gearbox_detail(page, selectors_used: list[str]) -> bool:
    """Navigate to gearbox/transmission detail page on podzamenu React SPA.

    Path A: Sidebar accordion 'Трансмиссия' -> expand -> click 'Коробка передач' div
    Path C: Tab 'СХЕМЫ УЗЛОВ' -> universal transmission section -> gearbox card (JS evaluate)
    Path B: Any visible div link 'Коробка передач' on the page
    Path D: Legacy <a> tag links (old site versions)

    Returns True if navigation to a gearbox detail page succeeded.
    """

    # ---- Path A: Two-level accordion navigation ----
    # podzamenu has NESTED MUI accordions:
    #   Level 1: "Трансмиссия" → expand → shows sub-accordions
    #   Level 2: "Автоматическая/Механическая коробка передач" → expand → shows parts
    #   Level 3: Part link → click → detail page with OEM data
    # Key: try ALL matching sub-accordions (АКПП, МКПП, etc.), not just the first
    try:
        step1 = await page.evaluate("""() => {
            const buttons = document.querySelectorAll('button.MuiAccordionSummary-root');
            for (const btn of buttons) {
                if (btn.innerText.trim().toLowerCase().includes('трансмисси')) {
                    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
                    return { found: true };
                }
            }
            return { found: false };
        }""")

        if step1.get("found"):
            selectors_used.append("nav:L1_transmissiya")
            await page.wait_for_timeout(2000)

            GEARBOX_SUB_KW = ["коробк", "кпп", "акпп", "мкпп", "вариатор", "transmission", "gearbox"]
            L3_LINK_KW = [
                "коробка передач", "акпп", "мкпп", "вариатор",
                "ведущий мост", "transaxle", "transmission",
                "коробка передач в сборе", "акпп в сборе",
            ]

            # Get ALL matching sub-accordion indices
            sub_indices = await page.evaluate("""(keywords) => {
                const buttons = document.querySelectorAll('button.MuiAccordionSummary-root');
                let transAccordion = null;
                for (const btn of buttons) {
                    const t = btn.innerText.trim().toLowerCase();
                    if (t.includes('трансмисси') && !t.includes('коробк')) {
                        transAccordion = btn.closest('.MuiAccordion-root');
                        break;
                    }
                }
                if (!transAccordion) return [];

                const subBtns = Array.from(transAccordion.querySelectorAll('button.MuiAccordionSummary-root'));
                const result = [];
                for (let i = 0; i < subBtns.length; i++) {
                    const text = subBtns[i].innerText.trim().toLowerCase();
                    if (text.includes('трансмисси') && !text.includes('коробк')) continue;
                    if (keywords.some(kw => text.includes(kw))) {
                        result.push({ idx: i, text: subBtns[i].innerText.trim() });
                    }
                }
                return result;
            }""", GEARBOX_SUB_KW)

            # Try each sub-accordion until we find a part link
            for sub_info in (sub_indices or []):
                sub_text = sub_info.get("text", "")[:40]
                sub_idx = sub_info.get("idx", -1)

                # Expand this sub-accordion
                await page.evaluate("""(idx) => {
                    const buttons = document.querySelectorAll('button.MuiAccordionSummary-root');
                    let transAccordion = null;
                    for (const btn of buttons) {
                        const t = btn.innerText.trim().toLowerCase();
                        if (t.includes('трансмисси') && !t.includes('коробк')) {
                            transAccordion = btn.closest('.MuiAccordion-root');
                            break;
                        }
                    }
                    if (!transAccordion) return;
                    const subBtns = Array.from(transAccordion.querySelectorAll('button.MuiAccordionSummary-root'));
                    if (idx < subBtns.length) {
                        if (subBtns[idx].getAttribute('aria-expanded') !== 'true')
                            subBtns[idx].click();
                    }
                }""", sub_idx)
                selectors_used.append(f"nav:L2_{sub_text}")
                await page.wait_for_timeout(2000)

                # L3: find a part link inside (exact then contains)
                step3 = await page.evaluate("""(linkKw) => {
                    const links = document.querySelectorAll('[class*="selectorPaperContentLink"]');
                    const lowerKw = linkKw.map(k => k.toLowerCase());

                    // Exact match first
                    for (const link of links) {
                        const tc = link.textContent.trim().toLowerCase();
                        if (lowerKw.includes(tc) && link.offsetParent !== null) {
                            link.click();
                            return { clicked: true, text: link.textContent.trim(), match: 'exact' };
                        }
                    }
                    // Contains match
                    for (const kw of lowerKw) {
                        for (const link of links) {
                            const tc = link.textContent.trim().toLowerCase();
                            if (tc.includes(kw) && link.offsetParent !== null && tc.length < 200) {
                                link.click();
                                return { clicked: true, text: link.textContent.trim(), match: 'contains', kw };
                            }
                        }
                    }
                    return { clicked: false };
                }""", L3_LINK_KW)

                if step3.get("clicked"):
                    selectors_used.append(f"nav:L3_{step3.get('match', '')}:{step3.get('text', '')[:40]}")
                    try:
                        await page.wait_for_selector(
                            '[class*="searchDetailCell"], a[href*="/search?query="]',
                            timeout=10000,
                        )
                    except Exception:
                        await asyncio.sleep(4)
                    return True
    except Exception:
        pass

    # ---- Path C: Universal 'СХЕМЫ УЗЛОВ' tab navigation (JS evaluate) ----
    try:
        tab_clicked = await page.evaluate("""() => {
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const text = el.textContent.trim().toUpperCase();
                if (text === 'СХЕМЫ УЗЛОВ' && el.children.length === 0) {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")

        if tab_clicked:
            selectors_used.append("nav:pathC_schemas_tab")
            await asyncio.sleep(2)

            # Step 2: Find transmission section in left menu by keywords
            found_section = await page.evaluate("""(keywords) => {
                const links = document.querySelectorAll(
                    'a, button, [class*="selectorLink"], [class*="menuItem"], ' +
                    '[class*="categoryLink"], [class*="navLink"], ' +
                    '[class*="selectorPaperContentLink"], [class*="ContentLink"], ' +
                    '[role="tab"], [role="button"], [role="link"]'
                );
                const lowerKeywords = keywords.map(k => k.toLowerCase());

                // Priority 1: exact match on full textContent
                for (const link of links) {
                    const text = link.textContent.trim().toLowerCase();
                    if (lowerKeywords.includes(text)) {
                        link.click();
                        return { found: true, text: link.textContent.trim(), priority: 'exact' };
                    }
                }

                // Priority 2: link text contains a keyword (visible elements only)
                for (const keyword of lowerKeywords) {
                    for (const link of links) {
                        const text = link.textContent.trim().toLowerCase();
                        if (text.includes(keyword) && link.offsetParent !== null) {
                            link.click();
                            return { found: true, text: link.textContent.trim(), priority: 'contains', keyword };
                        }
                    }
                }

                return { found: false };
            }""", TRANSMISSION_SECTION_KEYWORDS)

            if found_section and found_section.get("found"):
                selectors_used.append(
                    f"nav:pathC_section_{found_section.get('priority', '')}:"
                    f"{found_section.get('text', '')[:40]}"
                )
                await asyncio.sleep(2)

                # Step 3: Find gearbox card on the opened section page
                # NOTE: MUI CardActionArea buttons require dispatchEvent with MouseEvent;
                # plain .click() does NOT trigger React synthetic event handlers.
                found_card = await page.evaluate("""(keywords) => {
                    const MAX_TEXT = 300;
                    function muiClick(el) {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    }
                    const lowerKeywords = keywords.map(k => k.toLowerCase());

                    // --- Priority 0: MUI Card-root elements (СХЕМЫ УЗЛОВ view) ---
                    // These are the actual scheme cards with MuiCardActionArea buttons.
                    // Must be checked BEFORE selectorPaperContentLink to avoid clicking
                    // the section nav link (which also matches gearbox keywords).
                    const muiCards = document.querySelectorAll('[class*="Card-root"]');
                    if (muiCards.length > 0) {
                        // Prefer "сборка" / "assembly" / "assy" / "part 1" cards
                        const assemblyKw = ['сборка', 'assembly', 'assy', 'в сборе', 'part 1'];
                        for (const card of muiCards) {
                            const text = card.textContent.trim();
                            const lower = text.toLowerCase();
                            if (lowerKeywords.some(kw => lower.includes(kw))
                                && assemblyKw.some(ak => lower.includes(ak))) {
                                const btn = card.querySelector('button.MuiCardActionArea-root');
                                if (btn) { muiClick(btn); return { found: true, text: text.substring(0, 80), priority: 'muiCard_assembly' }; }
                            }
                        }
                        // Fall back: first MUI card matching any keyword
                        for (const card of muiCards) {
                            const text = card.textContent.trim();
                            const lower = text.toLowerCase();
                            if (lowerKeywords.some(kw => lower.includes(kw))) {
                                const btn = card.querySelector('button.MuiCardActionArea-root');
                                if (btn) { muiClick(btn); return { found: true, text: text.substring(0, 80), priority: 'muiCard' }; }
                            }
                        }
                    }

                    // --- Priority 1+2: Generic elements (non-MUI card pages) ---
                    const cards = document.querySelectorAll(
                        '[class*="selectorPaperContentLink"], [class*="ContentLink"], ' +
                        '[class*="schemeCard"], [class*="scheme"] p, ' +
                        '[class*="card"] p, [class*="card"] span, [class*="card"] h3, ' +
                        '[class*="card"] h4, [class*="card"] div, ' +
                        'h3, h4, [class*="title"], [class*="Title"]'
                    );

                    // Exact match
                    for (const card of cards) {
                        const text = card.textContent.trim();
                        if (text.length > MAX_TEXT) continue;
                        const lower = text.toLowerCase();
                        if (lowerKeywords.includes(lower)) {
                            const parent = card.closest(
                                '[class*="Card-root"], [class*="card"], article, [class*="scheme"], [class*="Scheme"]'
                            );
                            if (parent) {
                                const btn = parent.querySelector('button.MuiCardActionArea-root, a, button, [class*="viewBtn"]');
                                if (btn) { muiClick(btn); return { found: true, text: text.substring(0, 80), priority: 'exact' }; }
                            }
                            muiClick(card);
                            return { found: true, text: text.substring(0, 80), priority: 'exact' };
                        }
                    }

                    // Contains keyword (visible, short text only)
                    for (const keyword of lowerKeywords) {
                        for (const card of cards) {
                            const text = card.textContent.trim();
                            if (text.length > MAX_TEXT) continue;
                            const lower = text.toLowerCase();
                            if (lower.includes(keyword) && card.offsetParent !== null) {
                                const parent = card.closest(
                                    '[class*="Card-root"], [class*="card"], article, [class*="scheme"], [class*="Scheme"]'
                                );
                                if (parent) {
                                    const btn = parent.querySelector('button.MuiCardActionArea-root, a, button');
                                    if (btn) { muiClick(btn); return { found: true, text: text.substring(0, 80), priority: 'contains', keyword }; }
                                }
                                muiClick(card);
                                return { found: true, text: text.substring(0, 80), priority: 'contains', keyword };
                            }
                        }
                    }

                    return { found: false };
                }""", GEARBOX_CARD_KEYWORDS)

                if found_card and found_card.get("found"):
                    selectors_used.append(
                        f"nav:pathC_card_{found_card.get('priority', '')}:"
                        f"{found_card.get('text', '')[:40]}"
                    )
                    try:
                        await page.wait_for_selector(
                            '[class*="searchDetailCell"], a[href*="/search?query="]',
                            timeout=10000,
                        )
                    except Exception:
                        await asyncio.sleep(4)

                    # Verify OEM data is present; if not, try clicking deeper
                    has_oem_data = await page.evaluate("""() =>
                        document.querySelectorAll('a[href*="/search?query="]').length > 0
                        || document.querySelectorAll('[class*="searchDetailCell"]').length > 0
                    """)
                    if has_oem_data:
                        return True

                    # Page has no OEM links — try clicking a deeper scheme link
                    selectors_used.append("nav:pathC_card_no_oem_retry")
                    deeper = await page.evaluate("""(keywords) => {
                        const MAX_TEXT = 200;
                        function muiClick(el) {
                            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        }
                        const links = document.querySelectorAll(
                            '[class*="selectorPaperContentLink"], [class*="ContentLink"], ' +
                            'a[class*="scheme"], a[class*="card"], ' +
                            'button.MuiCardActionArea-root'
                        );
                        const lowerKw = keywords.map(k => k.toLowerCase());
                        for (const link of links) {
                            const text = link.textContent.trim();
                            if (text.length > MAX_TEXT || text.length < 3) continue;
                            const lower = text.toLowerCase();
                            if (lowerKw.some(kw => lower.includes(kw)) && link.offsetParent !== null) {
                                muiClick(link);
                                return { found: true, text: text.substring(0, 80) };
                            }
                        }
                        // Fallback: click first visible selectorPaperContentLink
                        for (const link of links) {
                            if (link.offsetParent !== null && link.textContent.trim().length > 2) {
                                muiClick(link);
                                return { found: true, text: link.textContent.trim().substring(0, 80), fallback: true };
                            }
                        }
                        return { found: false };
                    }""", GEARBOX_CARD_KEYWORDS)

                    if deeper and deeper.get("found"):
                        selectors_used.append(
                            f"nav:pathC_deeper:{deeper.get('text', '')[:40]}"
                        )
                        try:
                            await page.wait_for_selector(
                                '[class*="searchDetailCell"], a[href*="/search?query="]',
                                timeout=10000,
                            )
                        except Exception:
                            await asyncio.sleep(4)
                    return True

                # No card found — try parsing OEM directly from the section page
                selectors_used.append("nav:pathC_section_no_card")
                return True
    except Exception:
        pass

    # ---- Path B: Direct textContent click on "Коробка передач" anywhere ----
    try:
        clicked = await page.evaluate("""() => {
            const links = document.querySelectorAll('[class*="selectorPaperContentLink"], [class*="ContentLink"]');
            for (const link of links) {
                const tc = link.textContent.trim().toLowerCase();
                if (tc === 'коробка передач' || tc === 'коробка передач в сборе') {
                    link.click();
                    return true;
                }
            }
            return false;
        }""")
        if clicked:
            await page.wait_for_timeout(3000)
            selectors_used.append("nav:pathB_textContent_click")
            return True
    except Exception:
        pass

    # ---- Path D: Legacy <a> tag links (old site versions) ----
    for link_sel in [
        'a:has-text("Коробка передач")', 'a:has-text("КПП")',
        '[role="link"]:has-text("Коробка передач")',
    ]:
        try:
            loc = page.locator(link_sel)
            if await loc.count() > 0:
                await loc.first.click(timeout=5000)
                await page.wait_for_timeout(3000)
                selectors_used.append(f"nav:pathD_{link_sel[:30]}")
                return True
        except Exception:
            continue

    return False


async def _extract_oem_from_schema_page_js(page) -> tuple[list[tuple[str, str]], Optional[str]]:
    """Extract OEM candidates and gearbox model from СХЕМЫ УЗЛОВ detail page via JS.

    Schema pages use:
      [class*="searchDetailCell"] a[href*="/search?query="]  → OEM links
      [class*="vehicleCell"]                                  → model/description cells

    Returns (candidates: [(oem, name), ...], model_hint: str|None).
    """
    try:
        result = await page.evaluate("""() => {
            const output = { oems: [], models: [], raw: [] };
            const oemRe = /^[A-Z0-9][A-Z0-9\\-]{4,14}$/;

            // Extract OEM from searchDetailCell links
            const oemLinks = document.querySelectorAll(
                '[class*="searchDetailCell"] a[href*="/search?query="]'
            );
            for (const a of oemLinks) {
                try {
                    const oem = new URLSearchParams(a.href.split('?')[1]).get('query');
                    const clean = (oem || '').replace(/\\s+/g, '').toUpperCase();
                    const text = a.textContent.trim();
                    if (clean && oemRe.test(clean)) {
                        output.oems.push({ oem: clean, text });
                    }
                } catch(e) {}
            }

            // Extract model from vehicleCell elements
            const modelCells = document.querySelectorAll('[class*="vehicleCell"]');
            for (const c of modelCells) {
                const t = c.textContent.trim();
                if (t.length > 0 && t.length < 100) {
                    output.models.push(t);
                }
            }

            // Fallback: all OEM links on page (Infiniti etc. where searchDetailCell is absent)
            if (output.oems.length === 0) {
                const seen = new Set();
                const allLinks = document.querySelectorAll('a[href*="/search?query="]');
                for (const a of allLinks) {
                    try {
                        const oem = new URLSearchParams(a.href.split('?')[1]).get('query');
                        const clean = (oem || '').replace(/\\s+/g, '').toUpperCase();
                        if (clean && oemRe.test(clean) && !seen.has(clean)) {
                            seen.add(clean);
                            output.oems.push({ oem: clean, text: a.textContent.trim() });
                        }
                    } catch(e) {}
                }
            }

            // Extract model from bracket notation in headings: [DGL], [42RLE]
            for (const h of document.querySelectorAll(
                    'h1, h2, h3, h4, h5, h6, [class*="title"], [class*="Title"]')) {
                const t = h.textContent.trim();
                const bm = t.match(/\\[([A-Z0-9]{2,8})\\]/);
                if (bm) {
                    output.bracketModel = bm[1];
                    break;
                }
            }

            return output;
        }""")

        candidates: list[tuple[str, str]] = []
        model_hint: Optional[str] = None

        oems = result.get("oems", [])
        models = result.get("models", [])
        bracket_model = result.get("bracketModel")

        for i, item in enumerate(oems):
            oem_code = item.get("oem", "")
            name = models[i] if i < len(models) else item.get("text", "")
            if oem_code:
                candidates.append((oem_code, name))

        if models:
            first_model = models[0]
            if _is_valid_model_candidate(first_model):
                model_hint = first_model

        if not model_hint and bracket_model:
            model_hint = bracket_model

        return candidates, model_hint
    except Exception:
        return [], None


async def _extract_oem_from_table_js(page) -> list[tuple[str, str]]:
    """Extract OEM candidates from classic HTML tables with 'OEM' header column via JS.

    Strategy 3: For pages where _parse_oem_table() fails on MUI-rendered tables
    (Infiniti, Nissan JP etc.) — reads table cells directly from the DOM.

    Returns list of (oem, name) tuples.
    """
    try:
        result = await page.evaluate("""() => {
            const results = [];
            const oemPattern = /^[A-Z0-9][A-Z0-9\\-]{4,14}$/;
            const hasDigits3 = /\\d{3,}/;
            const isOem = (v) => oemPattern.test(v) && hasDigits3.test(v);
            const tables = document.querySelectorAll('table');

            for (const table of tables) {
                const rows = Array.from(table.querySelectorAll('tr'));
                if (rows.length < 2) continue;

                const headerCells = rows[0].querySelectorAll('th, td');
                const headers = Array.from(headerCells).map(c => c.textContent.trim().toLowerCase());

                let oemCol = -1;
                let nameCol = -1;
                for (let i = 0; i < headers.length; i++) {
                    const h = headers[i];
                    if (oemCol < 0 && (h === 'oem' || h === 'оем' || h === 'артикул'
                        || h === 'каталожный номер' || h === 'part number' || h === 'p/n'
                        || h === 'oemcode' || h === 'номер детали')) {
                        oemCol = i;
                    }
                    if (nameCol < 0 && (h === 'наименование' || h === 'название' || h === 'name'
                        || h === 'описание' || h === 'description' || h === 'деталь')) {
                        nameCol = i;
                    }
                }

                if (oemCol < 0 && headers.length === 2) {
                    for (let i = 0; i < headers.length; i++) {
                        if (headers[i] === 'oem' || headers[i] === 'оем') { oemCol = i; nameCol = 1 - i; break; }
                    }
                }

                // Fallback: no OEM header — find column with 2+ OEM-like values (parts table, not vehicle info)
                if (oemCol < 0) {
                    const dataRows = rows.filter(r => r.querySelectorAll('td').length > 0);
                    const maxCols = Math.max(...dataRows.map(r => r.querySelectorAll('td').length), 0);
                    for (let col = 0; col < maxCols; col++) {
                        let matchCount = 0;
                        for (const row of dataRows) {
                            const cells = Array.from(row.querySelectorAll('td'));
                            if (col < cells.length) {
                                const val = cells[col].textContent.trim().replace(/\\s+/g, '');
                                if (isOem(val)) matchCount++;
                            }
                        }
                        if (matchCount >= 2) {
                            oemCol = col;
                            nameCol = col === 0 ? 1 : 0;
                            break;
                        }
                    }
                }

                if (oemCol < 0) continue;
                if (nameCol < 0 && headers.length === 2) nameCol = 1 - oemCol;
                if (nameCol < 0) nameCol = oemCol === 0 ? 1 : 0;

                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length <= oemCol) continue;
                    const oem = cells[oemCol].textContent.trim().replace(/\\s+/g, '');
                    const name = nameCol < cells.length ? cells[nameCol].textContent.trim() : '';
                    if (oem && isOem(oem)) {
                        results.push({ oem, name });
                    }
                }
                if (results.length > 0) break;
            }
            return results;
        }""")

        return [(item.get("oem", ""), item.get("name", "")) for item in (result or [])]
    except Exception:
        return []


async def _get_browser():
    """Lazy-init single browser instance."""
    global _browser, _playwright
    if _browser is None:
        from playwright.async_api import async_playwright
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=HEADLESS,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
    return _browser


def _build_podzamenu_url(value: str) -> str:
    """Build direct search URL. Podzamenu uses vin= for both VIN and frame."""
    return f"{PODZAMENU_BASE_URL}/search-vehicle?vin={quote(value)}"


def _build_prof_rf_url(vin: str) -> str:
    """Build prof_rf search URL."""
    return f"{PROF_RF_BASE_URL}/search?query={quote(vin)}&type=vin"


def _is_not_found(html: str, patterns: Optional[list[str]] = None) -> bool:
    """Check if page indicates 'not found'."""
    text = html.lower()
    pats = patterns if patterns is not None else NOT_FOUND_PATTERNS
    for pat in pats:
        if re.search(pat, text, re.IGNORECASE):
            return True
    return False


def _extract_model_from_page(html: str, selectors_used: list[str]) -> Optional[str]:
    """
    Extract gearbox.model from search page HTML (fallback for when JS eval doesn't work).
    Searches tag-stripped text to avoid CSS class hash artifacts.
    """
    # Strategy 1: Structured HTML patterns (th/td, dt/dd) — safe, parses tag structure
    table_patterns = [
        (r"<dt[^>]*>\s*кпп\s*</dt>\s*<dd[^>]*>\s*([^<]+)\s*</dd>", "dt/dd (КПП)"),
        (r"<dt[^>]*>\s*коробка[^<]*</dt>\s*<dd[^>]*>\s*([^<]+)\s*</dd>", "dt/dd (коробка)"),
        (r"<th[^>]*>\s*кпп\s*</th>\s*<td[^>]*>\s*([^<]+)\s*</td>", "th/td (КПП)"),
        (r"<th[^>]*>\s*коробка[^<]*</th>\s*<td[^>]*>\s*([^<]+)\s*</td>", "th/td (коробка)"),
        (r"<td[^>]*>\s*кпп\s*</td>\s*<td[^>]*>\s*([^<]+)\s*</td>", "td/td (КПП)"),
    ]
    for pat, name in table_patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            val = re.sub(r"\s+", " ", m.group(1).strip())
            if len(val) >= 2 and len(val) <= 80 and _is_valid_model_candidate(val):
                selectors_used.append(f"gearbox.model:{name}")
                return val

    # Strategy 2: Known OEM gearbox codes in text content (tags stripped to avoid CSS hashes)
    text_content = _strip_html_tags(html)
    oem_codes = [
        r"\b(6HP\d{2}[A-Z]?)\b",
        r"\b(8HP\d{2}[A-Z]?)\b",
        r"\b(AW\d{2}[A-Z]*)\b",
        r"\b(A[345]\d{3}[A-Z]*)\b",
        r"\b(TF-\d{2}[A-Z]*)\b",
        r"\b(ZF\s*\d+[A-Z]*)\b",
        r"\b(09G|09K|0AW|0B5|0B6)\b",
        r"\b([A-Z]{2,4}\s*-?\s*\d{2,4}[A-Z]?)\b",
    ]
    for code_pat in oem_codes:
        m = re.search(code_pat, text_content, re.IGNORECASE)
        if m:
            snippet = text_content[max(0, m.start() - 100) : m.end() + 50].lower()
            if any(lbl in snippet for lbl in ["кпп", "коробка", "transmission", "gearbox"]):
                candidate = m.group(1).strip().replace(" ", "")
                if _is_valid_model_candidate(candidate):
                    selectors_used.append("gearbox.model:oem_code_regex")
                    return candidate

    # Strategy 3: inline label:value patterns in text content
    inline_patterns = [
        (r"кпп\s*[:：]\s*([a-zA-Z0-9\-_\s]+?)(?:\s{2,}|$)", "inline (КПП:)"),
        (r"коробка\s*[:：]\s*([a-zA-Z0-9\-_\s]+?)(?:\s{2,}|$)", "inline (коробка:)"),
        (r"transmission\s*[:：]\s*([a-zA-Z0-9\-_\s]+?)(?:\s{2,}|$)", "inline (transmission:)"),
    ]
    for pat, name in inline_patterns:
        m = re.search(pat, text_content, re.IGNORECASE)
        if m:
            val = re.sub(r"\s+", " ", m.group(1).strip())
            if len(val) >= 2 and len(val) <= 80 and _is_valid_model_candidate(val):
                selectors_used.append(f"gearbox.model:{name}")
                return val

    return None


def _extract_meta_from_page(html: str) -> dict:
    """Extract vehicle meta (марка, модель, год, двигатель) from HTML."""
    meta: dict = {}
    html_lower = html.lower()
    for ru_label, en_key in META_LABELS.items():
        if en_key in meta:
            continue
        pat = rf"{re.escape(ru_label)}\s*[:：]\s*([^<\n]+)"
        m = re.search(pat, html_lower, re.IGNORECASE)
        if m:
            meta[en_key] = m.group(1).strip()[:200]
    return meta


def _parse_oem_table(html: str) -> list[tuple[str, str]]:
    """
    Find table with OEM and Наименование columns, return list of (oem, name).
    Returns [] if table not found.
    """
    rows: list[tuple[str, str]] = []

    table_re = re.compile(r"<table[^>]*>([\s\S]*?)</table>", re.IGNORECASE | re.DOTALL)
    for table_match in table_re.finditer(html):
        table_html = table_match.group(1)

        # Get first row as header (from thead or first tr)
        thead_match = re.search(r"<thead[^>]*>([\s\S]*?)</thead>", table_html, re.I | re.DOTALL)
        header_html = thead_match.group(1) if thead_match else table_html

        header_re = re.compile(r"<t[hd][^>]*>([^<]*)</t[hd]>", re.IGNORECASE)
        header_cells: list[str] = []
        first_tr = re.search(r"<tr[^>]*>([\s\S]*?)</tr>", header_html, re.I | re.DOTALL)
        if first_tr:
            for m in header_re.finditer(first_tr.group(1)):
                header_cells.append(m.group(1).strip())
        if not header_cells:
            continue

        oem_idx = next((i for i, c in enumerate(header_cells) if _matches_oem_header(c)), -1)
        name_idx = next((i for i, c in enumerate(header_cells) if _matches_name_header(c)), -1)

        # Fallback: if only 2 columns and one looks like OEM header, assume the other is name
        if oem_idx >= 0 and name_idx < 0 and len(header_cells) == 2:
            name_idx = 1 - oem_idx
        if name_idx >= 0 and oem_idx < 0 and len(header_cells) == 2:
            oem_idx = 1 - name_idx

        if oem_idx < 0 or name_idx < 0:
            continue

        # Parse data rows (skip header row when no tbody)
        tbody_match = re.search(r"<tbody[^>]*>([\s\S]*?)</tbody>", table_html, re.I | re.DOTALL)
        body_html = tbody_match.group(1) if tbody_match else table_html
        tr_re = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.IGNORECASE | re.DOTALL)
        td_re = re.compile(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", re.IGNORECASE | re.DOTALL)

        tr_matches = list(tr_re.finditer(body_html))
        for idx, tr_match in enumerate(tr_matches):
            if not tbody_match and idx == 0:
                continue
            cells: list[str] = []
            for td_match in td_re.finditer(tr_match.group(1)):
                cells.append(re.sub(r"<[^>]+>", "", td_match.group(1)).strip())
            if len(cells) > max(oem_idx, name_idx):
                oem = cells[oem_idx].strip()[:100]
                name = cells[name_idx].strip()[:500]
                if oem or name:
                    rows.append((oem, name))
        if rows:
            return rows

    return rows


def _has_priority_term(name: str) -> bool:
    """Check if name contains a priority term (в сборе, трансмиссия, коробка передач)."""
    n = name.lower()
    return any(t in n for t in OEM_PRIORITY_TERMS)


def _filter_oem_candidates(
    candidates: list[tuple[str, str]],
    sort_by_priority: bool = False,
) -> list[tuple[str, str]]:
    """Filter candidates: include by OEM_INCLUDE_PATTERNS, exclude by OEM_EXCLUDE_PATTERNS."""
    result: list[tuple[str, str]] = []
    for oem, name in candidates:
        name_lower = name.lower()
        if any(ex in name_lower for ex in OEM_EXCLUDE_PATTERNS):
            continue
        if any(inc in name_lower for inc in OEM_INCLUDE_PATTERNS):
            result.append((oem, name))
    if sort_by_priority:
        result.sort(key=lambda x: (0 if _has_priority_term(x[1]) else 1, x[1]))
    return result


async def _do_lookup_podzamenu(id_type: str, value: str, evidence: dict) -> LookupResponse:
    """Perform lookup via podzamenu React SPA (Material UI).
    Uses Playwright JS eval for table data, SPA navigation for gearbox detail page.
    """
    evidence["source"] = "podzamenu"
    browser = await _get_browser()
    context = await browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport={"width": 1280, "height": 720},
        locale="ru-RU",
    )
    page = None
    try:
        page = await context.new_page()
        url = _build_podzamenu_url(value)
        evidence["finalUrl"] = url

        await page.goto(url, wait_until="domcontentloaded", timeout=LOOKUP_TIMEOUT_MS)

        # Wait for table or main content to render
        for sel in ["table", "main", ".content", "#content"]:
            try:
                await page.locator(sel).first.wait_for(state="visible", timeout=8000)
                break
            except Exception:
                pass

        await asyncio.sleep(3)
        html = await page.content()
        evidence["finalUrl"] = page.url

        if _is_not_found(html):
            raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})

        selectors_used: list[str] = []

        # Step 1: Extract vehicle meta + КПП hints via JS (clean, no CSS artifacts)
        vehicle_info = await _extract_vehicle_info_js(page)
        meta = vehicle_info.get("meta", {})
        kpp_hint = vehicle_info.get("kppHint")
        gearbox_model_from_table = vehicle_info.get("gearboxModel")
        gearbox_factory_from_table = vehicle_info.get("gearboxFactoryCode")
        aggregates_hint = vehicle_info.get("aggregates")
        vehicle_title = vehicle_info.get("vehicleTitle")

        # Override make/model from page title (authoritative over table data)
        if vehicle_title:
            title_make, title_model = _parse_vehicle_title(vehicle_title)
            if title_make:
                meta["make"] = title_make
                selectors_used.append(f"make:title:{title_make}")
            if title_model and not meta.get("model"):
                meta["model"] = title_model
                selectors_used.append(f"model:title:{title_model}")

        if not meta:
            meta = _extract_meta_from_page(html)

        # Step 2: Determine gearbox model (priority cascade)
        gearbox_model = None

        if gearbox_model_from_table and _is_valid_model_candidate(gearbox_model_from_table):
            gearbox_model = gearbox_model_from_table
            selectors_used.append("gearbox.model:table_model_kpp")

        if not gearbox_model and kpp_hint and _is_valid_model_candidate(kpp_hint):
            gearbox_model = kpp_hint
            selectors_used.append("gearbox.model:mui_table_kpp")

        kpp_desc_model = None
        kpp_desc_factory = None
        if not gearbox_model and kpp_hint:
            kpp_desc_model, kpp_desc_factory = _extract_model_from_kpp_description(kpp_hint)
            if kpp_desc_model:
                gearbox_model = kpp_desc_model
                selectors_used.append("gearbox.model:kpp_description_parse")

        if not gearbox_model and aggregates_hint:
            agg_model = _extract_model_from_aggregates(aggregates_hint)
            if agg_model:
                gearbox_model = agg_model
                selectors_used.append("gearbox.model:aggregates")

        if not gearbox_model:
            gearbox_model = _extract_model_from_page(html, selectors_used)

        # Factory code (cascade)
        search_page_factory_code = _extract_factory_code(html, selectors_used)
        if not search_page_factory_code and gearbox_factory_from_table:
            search_page_factory_code = gearbox_factory_from_table
            selectors_used.append("factoryCode:table_factory_kpp")
        if not search_page_factory_code and kpp_desc_factory:
            search_page_factory_code = kpp_desc_factory
            selectors_used.append("factoryCode:kpp_description_parse")

        # If extracted "model" is a factory code pattern, save it as factoryCode too
        if gearbox_model and is_factory_code(gearbox_model):
            if not search_page_factory_code:
                search_page_factory_code = gearbox_model

        gearbox = GearboxInfo(
            model=gearbox_model,
            factoryCode=search_page_factory_code,
            oem=None,
            oemCandidates=[],
            oemStatus="NOT_AVAILABLE",
        )

        # VW Group early exit: model code (e.g. JQJ(SA)) is sufficient for price search
        if gearbox_model and id_type == "VIN" and is_vw_group(value):
            gearbox.oemStatus = "MODEL_ONLY"
            if not gearbox.factoryCode:
                gearbox.factoryCode = gearbox_model
            selectors_used.append("vw_group:model_only_early_exit")
            evidence["selectorsUsed"] = selectors_used
            evidence["vwGroupEarlyExit"] = True
            return LookupResponse(vehicleMeta=meta, gearbox=gearbox, evidence=evidence)

        # Ford early exit: transmission model from vehicleMeta or kpp_hint
        if id_type == "VIN" and is_ford(value):
            ford_model = None
            # Try vehicleMeta "Transmission" column first (Ford USA)
            trans_field = meta.get("transmission") or meta.get("Transmission") or ""
            if trans_field:
                ford_model = extract_ford_transmission_model(trans_field)
            # Fallback: try extracting from kpp_hint / gearbox_model (Ford EU)
            if not ford_model and gearbox_model:
                ford_model = extract_ford_transmission_model(gearbox_model)
            if ford_model:
                gearbox.model = ford_model
                gearbox.factoryCode = ford_model
                gearbox.oemStatus = "MODEL_ONLY"
                selectors_used.append("ford:model_only_early_exit")
                evidence["selectorsUsed"] = selectors_used
                evidence["fordEarlyExit"] = True
                return LookupResponse(vehicleMeta=meta, gearbox=gearbox, evidence=evidence)

        # Step 3: Navigate to gearbox detail page (React SPA navigation)
        # Attempt navigation even without a model — the detail page might have OEM data
        gearbox_detail_reached = await _navigate_to_gearbox_detail(page, selectors_used)

        if gearbox_detail_reached:
            try:
                await page.wait_for_selector(
                    '[class*="searchDetailCell"], a[href*="/search?query="]',
                    timeout=10000,
                )
            except Exception:
                await asyncio.sleep(4)
            gearbox_html = await page.content()
            evidence["finalUrl"] = page.url

            factory_code = _extract_factory_code(gearbox_html, selectors_used)
            if factory_code:
                gearbox.factoryCode = factory_code

            if not gearbox.model:
                detail_model = _extract_model_from_page(gearbox_html, selectors_used)
                if detail_model:
                    gearbox.model = detail_model

            # Diagnostic: count DOM elements to understand page state
            dom_diag = await page.evaluate("""() => ({
                tables: document.querySelectorAll('table').length,
                tableTds: document.querySelectorAll('table td').length,
                searchDetailCells: document.querySelectorAll('[class*="searchDetailCell"]').length,
                oemLinks: document.querySelectorAll('a[href*="/search?query="]').length,
                allLinks: document.querySelectorAll('a').length,
            })""")
            evidence["domDiag"] = dom_diag

            # Strategy 1: HTML table parsing (works for classic table layouts)
            candidates_raw = _parse_oem_table(gearbox_html)
            if candidates_raw:
                evidence["strategy1_count"] = len(candidates_raw)
                evidence["strategy1_sample"] = [(o[:30], n[:50]) for o, n in candidates_raw[:5]]

            # Strategy 2: JS-based extraction for schema pages (searchDetailCell links)
            if not candidates_raw:
                js_candidates, js_model_hint = await _extract_oem_from_schema_page_js(page)
                evidence["strategy2_count"] = len(js_candidates) if js_candidates else 0
                if js_candidates:
                    evidence["strategy2_sample"] = [(o[:30], n[:50]) for o, n in js_candidates[:5]]
                    candidates_raw = js_candidates
                    selectors_used.append("oem:schema_page_js")
                if js_model_hint and not gearbox.model:
                    gearbox.model = js_model_hint
                    selectors_used.append("gearbox.model:schema_page_js")

            # Strategy 3: JS-based classic HTML table with "OEM" header (Infiniti, Nissan JP etc.)
            if not candidates_raw:
                table_js_candidates = await _extract_oem_from_table_js(page)
                evidence["strategy3_count"] = len(table_js_candidates) if table_js_candidates else 0
                if table_js_candidates:
                    evidence["strategy3_sample"] = [(o[:30], n[:50]) for o, n in table_js_candidates[:5]]
                    candidates_raw = table_js_candidates
                    selectors_used.append("oem:table_js")

            valid_candidates: list[tuple[str, str]] = []
            for oem_code, name in candidates_raw:
                if is_valid_gearbox_oem(oem_code):
                    valid_candidates.append((oem_code, name))
                elif is_factory_code(oem_code) and not gearbox.factoryCode:
                    gearbox.factoryCode = oem_code
                    selectors_used.append("factoryCode:oem_table_cell")

            gearbox.oemCandidates = [
                GearboxOemCandidate(oem=o, name=n) for o, n in valid_candidates[:10]
            ]

            if valid_candidates:
                filtered = _filter_oem_candidates(valid_candidates, sort_by_priority=True)
                if filtered:
                    gearbox.oem = filtered[0][0] or None
                    gearbox.oemStatus = "FOUND"
                elif valid_candidates:
                    gearbox.oem = valid_candidates[0][0] or None
                    gearbox.oemStatus = "FOUND" if gearbox.oem else "NOT_FOUND"
                else:
                    gearbox.oemStatus = "NOT_FOUND"
            elif candidates_raw:
                evidence["oemTableHadOnlyFactoryCodes"] = True
                gearbox.oemStatus = "NOT_FOUND"
            else:
                evidence["gearboxPageParseFailed"] = True
        else:
            evidence["gearboxLinkNotFound"] = True

        # FRAME with no OEM data — agent should ask for manual KPP marking
        if id_type == "FRAME" and gearbox.oemStatus in ("NOT_AVAILABLE", "NOT_FOUND"):
            gearbox.needsManualKppCode = True

        # If we have neither model nor OEM, report PARSE_FAILED
        if not gearbox.model and not gearbox.oem:
            evidence["selectorsUsed"] = selectors_used
            evidence["parseError"] = "no gearbox.model nor oem after navigation"
            evidence["kppHint"] = kpp_hint
            if SCREENSHOT_ON_ERROR and page:
                screenshot = await page.screenshot(type="png")
                evidence["screenshotOnError"] = base64.b64encode(screenshot).decode()
            # For FRAME with needsManualKppCode, return result instead of raising
            if gearbox.needsManualKppCode:
                return LookupResponse(vehicleMeta=meta, gearbox=gearbox, evidence=evidence)
            raise HTTPException(
                status_code=500,
                detail={"error": "PARSE_FAILED", "evidence": evidence},
            )

        evidence["selectorsUsed"] = selectors_used
        return LookupResponse(
            vehicleMeta=meta,
            gearbox=gearbox,
            evidence=evidence,
        )
    finally:
        await context.close()


@app.post("/lookup", response_model=LookupResponse)
async def lookup(request: LookupRequest):
    """Lookup vehicle info by VIN or FRAME via podzamenu.ru."""
    if not request.value or not request.value.strip():
        raise HTTPException(status_code=400, detail="value is required")

    evidence: dict = {"finalUrl": "", "selectorsUsed": []}
    last_error: Optional[Exception] = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            async with _lookup_semaphore:
                return await _do_lookup_routed(request.idType, request.value, evidence)
        except HTTPException:
            raise
        except Exception as e:
            last_error = e
            is_timeout = "timeout" in str(e).lower() or "Timeout" in type(e).__name__
            if is_timeout and attempt < MAX_RETRIES:
                continue
            break

    err_msg = str(last_error) if last_error else "Unknown error"
    evidence["error"] = err_msg
    if SCREENSHOT_ON_ERROR:
        try:
            browser = await _get_browser()
            ctx = await browser.new_context()
            page = await ctx.new_page()
            await page.goto(_build_podzamenu_url(request.value), timeout=5000)
            screenshot = await page.screenshot(type="png")
            evidence["screenshotOnError"] = base64.b64encode(screenshot).decode()
            await ctx.close()
        except Exception:
            pass
    raise HTTPException(status_code=500, detail={"error": "LOOKUP_ERROR", "message": err_msg, "evidence": evidence})


@app.post("/fetch-page", response_model=FetchPageResponse)
async def fetch_page(request: FetchPageRequest):
    """Fetch a rendered HTML page via Playwright. Used by the Node.js price search pipeline."""
    async with _fetch_semaphore:
        browser = await _get_browser()
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
            locale="ru-RU",
            extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9"},
        )
        try:
            page = await context.new_page()
            response = await page.goto(
                request.url,
                wait_until="domcontentloaded",
                timeout=request.timeout,
            )
            await asyncio.sleep(2)
            html = await page.content()
            return FetchPageResponse(
                html=html,
                status=response.status if response else 0,
                finalUrl=page.url,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            await context.close()


# prof_rf: header patterns "Коробка передач 3043001600" / "Трансмиссия <OEM>"
PROF_RF_HEADER_PATTERN = re.compile(
    r"(Коробка\s+передач|Трансмиссия)\s+([A-Z0-9]{6,20})",
    re.IGNORECASE,
)


def _extract_prof_rf_header_oem(html: str, selectors_used: list[str]) -> Optional[tuple[str, str]]:
    """
    Extract from headers like "Коробка передач 3043001600" or "Трансмиссия 3043001600".
    Returns (model_text, oem) or None.
    """
    for m in PROF_RF_HEADER_PATTERN.finditer(html):
        prefix = m.group(1).strip()
        oem = m.group(2).strip()
        model_text = f"{prefix} {oem}"
        selectors_used.append("prof_rf:header_oem")
        return (model_text, oem)
    return None


def _parse_prof_rf_blocks(html: str) -> tuple[list[tuple[str, str, str]], list[tuple[str, str]]]:
    """
    Parse blocks Оригинал, Аналоги, Копии. Returns (blocked_rows, all_table_rows).
    blocked_rows: [(oem, name, block_type), ...]
    """
    blocked: list[tuple[str, str, str]] = []
    block_headers = ["Оригинал", "Аналоги", "Копии"]
    html_lower = html.lower()

    for block_name in block_headers:
        pat = re.compile(
            rf"(?:^|>)\s*{re.escape(block_name)}\s*(?:<|$|[\s:])",
            re.IGNORECASE,
        )
        for m in pat.finditer(html):
            start = m.end()
            next_block = len(html)
            for other in block_headers:
                if other.lower() == block_name.lower():
                    continue
                other_pat = re.compile(
                    rf"(?:^|>)\s*{re.escape(other)}\s*(?:<|$|[\s:])",
                    re.IGNORECASE,
                )
                om = other_pat.search(html, start)
                if om and om.start() < next_block:
                    next_block = om.start()
            section = html[start:next_block]
            table_matches = re.findall(r"<table[^>]*>[\s\S]*?</table>", section, re.I | re.DOTALL)
            for table_html in table_matches:
                rows = _parse_oem_table_from_html(table_html)
                for oem_val, name_val in rows:
                    if oem_val or name_val:
                        blocked.append((oem_val, name_val, block_name))

    all_rows = _parse_oem_table(html)
    return blocked, all_rows


def _parse_oem_table_from_html(table_html: str) -> list[tuple[str, str]]:
    """Parse OEM table rows from a single table HTML."""
    rows: list[tuple[str, str]] = []
    header_re = re.compile(r"<t[hd][^>]*>([^<]*)</t[hd]>", re.I)
    thead = re.search(r"<thead[^>]*>([\s\S]*?)</thead>", table_html, re.I | re.DOTALL)
    header_html = thead.group(1) if thead else table_html
    first_tr = re.search(r"<tr[^>]*>([\s\S]*?)</tr>", header_html, re.I | re.DOTALL)
    header_cells: list[str] = []
    if first_tr:
        for mm in header_re.finditer(first_tr.group(1)):
            header_cells.append(mm.group(1).strip())
    oem_idx = next((i for i, c in enumerate(header_cells) if _matches_oem_header(c)), -1)
    name_idx = next((i for i, c in enumerate(header_cells) if _matches_name_header(c)), -1)
    if oem_idx >= 0 and name_idx < 0 and len(header_cells) == 2:
        name_idx = 1 - oem_idx
    if name_idx >= 0 and oem_idx < 0 and len(header_cells) == 2:
        oem_idx = 1 - name_idx
    if oem_idx < 0 or name_idx < 0:
        return rows
    tbody = re.search(r"<tbody[^>]*>([\s\S]*?)</tbody>", table_html, re.I | re.DOTALL)
    body_html = tbody.group(1) if tbody else table_html
    tr_re = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.I | re.DOTALL)
    td_re = re.compile(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", re.I | re.DOTALL)
    tr_matches = list(tr_re.finditer(body_html))
    for idx, tr_m in enumerate(tr_matches):
        if not tbody and idx == 0:
            continue
        cells = [re.sub(r"<[^>]+>", "", td_m.group(1)).strip() for td_m in td_re.finditer(tr_m.group(1))]
        if len(cells) > max(oem_idx, name_idx):
            rows.append((cells[oem_idx].strip()[:100], cells[name_idx].strip()[:500]))
    return rows


def _extract_from_prof_rf(html: str, selectors_used: list[str]) -> tuple[dict, Optional[str], Optional[str], list[tuple[str, str]]]:
    """
    Extract vehicleMeta, gearbox.model, gearbox.oem, and oemCandidates from prof_rf page.
    Returns (meta, model, oem, candidates_raw).
    """
    meta = _extract_meta_from_page(html)

    model: Optional[str] = None
    oem: Optional[str] = None

    # 1) Header extractor: "Коробка передач 3043001600" / "Трансмиссия 3043001600"
    header_result = _extract_prof_rf_header_oem(html, selectors_used)
    if header_result:
        model, oem = header_result
        candidates_raw = _parse_oem_table(html)
        if candidates_raw:
            selectors_used.append("prof_rf:table_candidates")
        else:
            candidates_raw = [(oem, model)] if oem else []
        return meta, model, oem, candidates_raw

    # 2) Parse blocks Оригинал / Аналоги / Копии
    blocked_rows, candidates_raw = _parse_prof_rf_blocks(html)
    original_oems: list[tuple[str, str]] = []
    for oem_val, name_val, block_type in blocked_rows:
        if block_type.lower() == "оригинал":
            name_lower = name_val.lower()
            if any(ex in name_lower for ex in OEM_EXCLUDE_PATTERNS):
                continue
            if any(inc in name_lower for inc in OEM_INCLUDE_PATTERNS):
                original_oems.append((oem_val, name_val))
    if original_oems:
        selectors_used.append("prof_rf:original_block")
        filtered = _filter_oem_candidates(original_oems, sort_by_priority=True)
        if filtered:
            oem = filtered[0][0] or None
            model = model or filtered[0][1]
        else:
            oem = original_oems[0][0] or None
            model = model or original_oems[0][1]

    # 3) Fallback: table candidates with filter and priority
    if not oem and candidates_raw:
        selectors_used.append("prof_rf:table_candidates")
        filtered = _filter_oem_candidates(candidates_raw, sort_by_priority=True)
        if filtered:
            oem = filtered[0][0] or None
            model = model or filtered[0][1]

    if not model:
        model = _extract_model_from_page(html, selectors_used)

    return meta, model, oem, candidates_raw


async def _do_lookup_prof_rf(vin: str, evidence: dict) -> LookupResponse:
    """Perform lookup via prof_rf (Chinese autos). Raises HTTPException on not-found."""
    evidence["source"] = "prof_rf"
    browser = await _get_browser()
    context = await browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport={"width": 1280, "height": 720},
        locale="ru-RU",
    )
    try:
        page = await context.new_page()
        url = _build_prof_rf_url(vin)
        evidence["finalUrl"] = url

        await page.goto(url, wait_until="domcontentloaded", timeout=LOOKUP_TIMEOUT_MS)

        for sel in ["main", "article", ".content", "#content"]:
            try:
                await page.locator(sel).first.wait_for(state="visible", timeout=8000)
                break
            except Exception:
                pass

        await asyncio.sleep(3)
        html = await page.content()
        evidence["finalUrl"] = page.url

        if _is_not_found(html, PROF_RF_NOT_FOUND_PATTERNS):
            raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})

        selectors_used: list[str] = []
        meta, model, oem, candidates_raw = _extract_from_prof_rf(html, selectors_used)
        evidence["selectorsUsed"] = selectors_used

        if not model and not oem:
            evidence["parseError"] = "no gearbox.model nor gearbox.oem"
            if SCREENSHOT_ON_ERROR:
                try:
                    screenshot = await page.screenshot(type="png")
                    evidence["screenshotOnError"] = base64.b64encode(screenshot).decode()
                except Exception:
                    pass
            raise HTTPException(
                status_code=500,
                detail={"error": "PARSE_FAILED", "evidence": evidence},
            )

        oem_status = "FOUND" if oem else "NOT_AVAILABLE"
        gearbox = GearboxInfo(
            model=model,
            oem=oem,
            oemCandidates=[GearboxOemCandidate(oem=ov, name=nv) for ov, nv in candidates_raw[:10]],
            oemStatus=oem_status,
        )
        return LookupResponse(vehicleMeta=meta, gearbox=gearbox, evidence=evidence)
    finally:
        await context.close()


def _add_source_evidence(resp: LookupResponse, source_tried: list[str], source_selected: str) -> None:
    """Add sourceTried and sourceSelected to response evidence."""
    resp.evidence["sourceTried"] = source_tried
    resp.evidence["sourceSelected"] = source_selected


async def _do_lookup_routed(id_type: str, value: str, evidence: dict) -> LookupResponse:
    """
    Route to appropriate source.
    auto: VIN -> podzamenu first; 404 -> prof_rf; success without FOUND -> try prof_rf, prefer prof_rf if FOUND.
    FRAME: only podzamenu (prof_rf not supported).
    """
    source_tried: list[str] = []

    # FRAME: only podzamenu (prof_rf does not support FRAME)
    if id_type == "FRAME":
        if SOURCE_STRATEGY == "prof_rf":
            raise HTTPException(status_code=400, detail={"error": "UNSUPPORTED_ID_TYPE"})
        ev = {**evidence, "finalUrl": "", "selectorsUsed": []}
        result = await _do_lookup_podzamenu(id_type, value, ev)
        _add_source_evidence(result, ["podzamenu"], "podzamenu")
        return result

    # VIN
    if SOURCE_STRATEGY == "podzamenu":
        ev = {**evidence, "finalUrl": "", "selectorsUsed": []}
        result = await _do_lookup_podzamenu(id_type, value, ev)
        _add_source_evidence(result, ["podzamenu"], "podzamenu")
        return result

    if SOURCE_STRATEGY == "prof_rf":
        ev = {**evidence, "finalUrl": "", "selectorsUsed": []}
        result = await _do_lookup_prof_rf(value, ev)
        _add_source_evidence(result, ["prof_rf"], "prof_rf")
        return result

    # auto: always try podzamenu first for VIN
    ev = {**evidence, "finalUrl": "", "selectorsUsed": []}
    try:
        result = await _do_lookup_podzamenu(id_type, value, ev)
        source_tried.append("podzamenu")

        if result.gearbox.oemStatus == "FOUND":
            _add_source_evidence(result, source_tried, "podzamenu")
            return result

        # podzamenu success but no FOUND -> try prof_rf
        ev2 = {**evidence, "finalUrl": "", "selectorsUsed": []}
        try:
            result2 = await _do_lookup_prof_rf(value, ev2)
            source_tried.append("prof_rf")
            if result2.gearbox.oemStatus == "FOUND":
                _add_source_evidence(result2, source_tried, "prof_rf")
                return result2
        except HTTPException:
            pass
        _add_source_evidence(result, source_tried, "podzamenu")
        return result

    except HTTPException as e:
        detail = getattr(e, "detail", None)
        is_not_found = e.status_code == 404 and isinstance(detail, dict) and detail.get("error") == "NOT_FOUND"
        is_parse_failed = e.status_code == 500 and isinstance(detail, dict) and detail.get("error") == "PARSE_FAILED"
        if is_not_found or is_parse_failed:
            source_tried.append("podzamenu")
            ev2 = {**evidence, "finalUrl": "", "selectorsUsed": []}
            try:
                result2 = await _do_lookup_prof_rf(value, ev2)
                source_tried.append("prof_rf")
                _add_source_evidence(result2, source_tried, "prof_rf")
                return result2
            except HTTPException:
                pass
        raise


@app.on_event("shutdown")
async def shutdown():
    global _browser, _playwright
    if _browser:
        await _browser.close()
        _browser = None
    if _playwright:
        await _playwright.stop()
        _playwright = None


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)


# --- Test reference ---
# auto: VIN always tries podzamenu first; 404 -> prof_rf; no FOUND -> try prof_rf
# EU: WV1ZZZ7HZ8H020981 | China: LVSHCAMB0CE123456
# curl -X POST http://localhost:8200/lookup -H "Content-Type: application/json" \
#   -d '{"idType": "VIN", "value": "WV1ZZZ7HZ8H020981"}'
# curl -X POST http://localhost:8200/lookup -H "Content-Type: application/json" \
#   -d '{"idType": "VIN", "value": "LVSHCAMB0CE123456"}'
