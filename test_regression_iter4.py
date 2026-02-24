"""Regression test — Iteration 4: all working VINs from Iterations 1+2+3 (48 total).
VINs that return HTTP 500 / PARSE_FAILED (not found on podzamenu.ru) are excluded.
"""
import urllib.request
import urllib.error
import json
import sys
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

BASE_URL = "http://localhost:8200/lookup"

TESTS = [
    # === Iteration 1 (11 working VINs) ===
    {"id": "T01", "vin": "WV1ZZZ7HZ8H020981", "idType": "VIN", "auto": "VW Crafter"},
    {"id": "T04", "vin": "Z8NAJL00050413920", "idType": "VIN", "auto": "Nissan Almera"},
    {"id": "T05", "vin": "GX110-0069622", "idType": "FRAME", "auto": "Toyota Mark II"},
    {"id": "T08", "vin": "Xw8cj41z8ck253790", "idType": "VIN", "auto": "Skoda Octavia"},
    {"id": "T09", "vin": "WVWZZZ7MZ6V025007", "idType": "VIN", "auto": "VW Sharan"},
    {"id": "T10", "vin": "3VW267AJ0GM371297", "idType": "VIN", "auto": "VW Jetta"},
    {"id": "T15", "vin": "EU11105303", "idType": "FRAME", "auto": "Toyota Hilux (JP)"},
    {"id": "T17", "vin": "JTMDDREV60D023449", "idType": "VIN", "auto": "Toyota RAV4"},
    {"id": "T18", "vin": "JN1TBNT30Z0000001", "idType": "VIN", "auto": "Infiniti QX80"},
    {"id": "T19", "vin": "JTEHD21A050039782", "idType": "VIN", "auto": "Toyota Highlander"},
    {"id": "T21", "vin": "KM8SC73D53U468841", "idType": "VIN", "auto": "Hyundai Santa Fe"},
    {"id": "TA1", "vin": "KL1JF69E9BK120628", "idType": "VIN", "auto": "Chevrolet Cruze"},
    # === Iteration 2 (16 VINs) ===
    {"id": "N01", "vin": "YV1CM5957C1619537", "idType": "VIN", "auto": "Volvo"},
    {"id": "N02", "vin": "SJNFAAJ10U2579962", "idType": "VIN", "auto": "Nissan EU"},
    {"id": "N03", "vin": "Z8NTANT31CS074024", "idType": "VIN", "auto": "Nissan Russia"},
    {"id": "N04", "vin": "9BWCC45X25T142539", "idType": "VIN", "auto": "VW Brazil"},
    {"id": "N05", "vin": "WBADM11000GP11860", "idType": "VIN", "auto": "BMW"},
    {"id": "N06", "vin": "SCP110067053", "idType": "FRAME", "auto": "Toyota FRAME JDM"},
    {"id": "N07", "vin": "5UXFG83588LZ91789", "idType": "VIN", "auto": "BMW X5 USA"},
    {"id": "N08", "vin": "XWEJC813BJ0008709", "idType": "VIN", "auto": "Lada/VAZ"},
    {"id": "N09", "vin": "XUFFN9E59F3502224", "idType": "VIN", "auto": "Renault Russia"},
    {"id": "N10", "vin": "4A3AA46G71E229998", "idType": "VIN", "auto": "Mitsubishi USA"},
    {"id": "N11", "vin": "Z8NFAABD0F0003332", "idType": "VIN", "auto": "Nissan Russia 2"},
    {"id": "N12", "vin": "X9FSXXEEDS8S04800", "idType": "VIN", "auto": "Ford Russia"},
    {"id": "N13", "vin": "1FMEU75E09UA06227", "idType": "VIN", "auto": "Ford Expedition USA"},
    {"id": "N14", "vin": "WVWZZZ3BZWP127573", "idType": "VIN", "auto": "VW Passat"},
    {"id": "N15", "vin": "SJNBAAP12U2296642", "idType": "VIN", "auto": "Nissan EU 2"},
    {"id": "N16", "vin": "SALFA24B69H128975", "idType": "VIN", "auto": "Land Rover FL2"},
    # === Iteration 3 — target VINs for fix validation (10 working VINs) ===
    {"id": "V01", "vin": "XWKFB227280077324", "idType": "VIN", "auto": "KIA Spectra",
     "expect_make": "KIA", "expect_oem": "0K2N303000"},
    {"id": "V02", "vin": "WDC2049811F906300", "idType": "VIN", "auto": "Mercedes GLK 280",
     "expect_make": "Mercedes", "expect_model": "722.964", "expect_oem": "A 204 270 84 04"},
    {"id": "V09", "vin": "XWFGM8EM1C0001114", "idType": "VIN", "auto": "Opel Insignia-A",
     "expect_make": "OPEL"},
    {"id": "V10", "vin": "VF1LZBR0A44807941", "idType": "VIN", "auto": "Renault Fluence",
     "expect_make": "Renault", "expect_model": "DP0111"},
    {"id": "V11", "vin": "RUMGJ4268EV008390", "idType": "VIN", "auto": "Mazda 6",
     "expect_make": "Mazda"},
    {"id": "V12", "vin": "X7L4SRAV457676089", "idType": "VIN", "auto": "Renault Logan Sandero II",
     "expect_make": "Renault", "expect_model": "JH3542"},
    {"id": "V13", "vin": "VF1BG0V0532290872", "idType": "VIN", "auto": "Renault Laguna",
     "expect_make": "Renault", "expect_model": "JR5015"},
    {"id": "V14", "vin": "VSKJVWR51U0100073", "idType": "VIN", "auto": "Nissan Pathfinder",
     "expect_make": "Nissan"},
    {"id": "V15", "vin": "KL1SF69TJ8B008577", "idType": "VIN", "auto": "Chevrolet Aveo",
     "expect_make": "Chevrolet", "expect_model": "Y4M"},
    {"id": "V16", "vin": "XUFPE6DD4C3025834", "idType": "VIN", "auto": "Opel Astra-J",
     "expect_make": "OPEL", "expect_model": "F17"},
    # === Extra VINs (10) ===
    {"id": "X01", "vin": "Wauzzz4f57n083242", "idType": "VIN", "auto": "Audi 2007"},
    {"id": "X02", "vin": "TMBNB46Y333673324", "idType": "VIN", "auto": "Skoda Fabia 2003"},
    {"id": "X03", "vin": "X9F5XXEED57E75983", "idType": "VIN", "auto": "Ford Focus 2"},
    {"id": "X04", "vin": "Z8TXTGF3WEM015096", "idType": "VIN", "auto": "Mitsubishi 2014"},
    {"id": "X05", "vin": "XWFD91ED1B0000538", "idType": "VIN", "auto": "Cadillac CTS2"},
    {"id": "X06", "vin": "Z6FRXXESDRCC10918", "idType": "VIN", "auto": "Ford Kuga"},
    {"id": "X07", "vin": "JN1TANJ50U0402412", "idType": "VIN", "auto": "Infiniti EX35"},
    {"id": "X08", "vin": "Z8UA0B1SSB0006285", "idType": "VIN", "auto": "SsangYong Action"},
    {"id": "X09", "vin": "Z8832300083086797", "idType": "VIN", "auto": "Fiat Linea"},
    {"id": "X10", "vin": "FB15-806559", "idType": "FRAME", "auto": "Nissan Sunny FB15"},
]

results = []
checks_passed = 0
checks_failed = 0

for t in TESTS:
    tid = t["id"]
    print(f"\n{tid}: {t['auto']} ({t['vin'][:20]}) ... ", end="", flush=True)

    data = json.dumps({"idType": t["idType"], "value": t["vin"]}).encode()
    req = urllib.request.Request(BASE_URL, data=data, headers={"Content-Type": "application/json"}, method="POST")

    start = time.time()
    row = {"id": tid, "auto": t["auto"]}
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        body = resp.read().decode("utf-8", errors="replace")
        elapsed = time.time() - start
        parsed = json.loads(body)
        gb = parsed.get("gearbox", {})
        ev = parsed.get("evidence", {})
        meta = parsed.get("vehicleMeta", {})
        row["http"] = 200
        row["time"] = f"{elapsed:.0f}s"
        row["model"] = gb.get("model")
        row["oem"] = gb.get("oem")
        row["oemStatus"] = gb.get("oemStatus")
        row["factoryCode"] = gb.get("factoryCode")
        row["candidates"] = len(gb.get("oemCandidates", []))
        row["make"] = meta.get("make", "")
        row["source"] = ev.get("sourceSelected", ev.get("source", ""))
        row["selectors"] = ev.get("selectorsUsed", [])

        status_str = f"200 {elapsed:.0f}s make={row['make']} model={gb.get('model')} oem={gb.get('oem')} status={gb.get('oemStatus')}"

        # Validate expectations for V-series (Iteration 3 targets)
        issues = []
        if "expect_make" in t:
            actual_make = (row["make"] or "").upper()
            expected_make = t["expect_make"].upper()
            if expected_make not in actual_make and actual_make not in expected_make:
                issues.append(f"make: {row['make']!r} != {t['expect_make']!r}")
        if "expect_model" in t and t["expect_model"]:
            actual_model = (gb.get("model") or "")
            if t["expect_model"].upper() not in actual_model.upper():
                issues.append(f"model: {actual_model!r} != {t['expect_model']!r}")
        if "expect_oem" in t and t["expect_oem"]:
            actual_oem = (gb.get("oem") or "").replace(" ", "")
            expected_oem = t["expect_oem"].replace(" ", "")
            if expected_oem.upper() not in actual_oem.upper():
                issues.append(f"oem: {gb.get('oem')!r} != {t['expect_oem']!r}")

        if issues:
            row["check"] = "FAIL"
            checks_failed += 1
            print(f"{status_str} *** FAIL: {'; '.join(issues)}")
        else:
            row["check"] = "OK"
            checks_passed += 1
            print(status_str)

    except urllib.error.HTTPError as e:
        elapsed = time.time() - start
        body = e.read().decode("utf-8", errors="replace")
        row["http"] = e.code
        row["time"] = f"{elapsed:.0f}s"
        row["check"] = f"HTTP_{e.code}"
        try:
            parsed = json.loads(body)
            detail = parsed.get("detail", {})
            if isinstance(detail, dict):
                row["error"] = detail.get("error")
                ev = detail.get("evidence", {})
                row["source"] = ev.get("sourceSelected", ev.get("source", ""))
        except Exception:
            row["error"] = body[:200]
        print(f"{e.code} {elapsed:.0f}s error={row.get('error')}")

    except Exception as ex:
        elapsed = time.time() - start
        row["http"] = "ERR"
        row["time"] = f"{elapsed:.0f}s"
        row["error"] = str(ex)[:100]
        row["check"] = "ERR"
        print(f"ERR {elapsed:.0f}s {ex}")

    results.append(row)

# === Summary ===
found = [r for r in results if r.get("oemStatus") == "FOUND"]
model_only = [r for r in results if r.get("oemStatus") == "MODEL_ONLY"]
not_avail = [r for r in results if r.get("oemStatus") == "NOT_AVAILABLE"]
http_ok = [r for r in results if r.get("http") == 200]
http_fail = [r for r in results if r.get("http") != 200]
v_tests = [r for r in results if r["id"].startswith("V")]
v_ok = [r for r in v_tests if r.get("check") == "OK"]
v_fail = [r for r in v_tests if r.get("check") == "FAIL"]

print(f"\n\n{'='*130}")
print(f"  REGRESSION RESULTS: {len(http_ok)}/{len(results)} HTTP 200 | {len(found)} FOUND + {len(model_only)} MODEL_ONLY | {len(http_fail)} FAILED")
print(f"  Iteration 3 targets: {len(v_ok)}/{len(v_tests)} passed, {len(v_fail)} failed")
print(f"{'='*130}")
print(f"{'ID':<5} {'Auto':<24} {'HTTP':<5} {'Time':<6} {'Make':<14} {'Model':<16} {'OEM':<22} {'Status':<16} {'Chk'}")
print("-" * 130)
for r in results:
    make = str(r.get("make", "-"))[:14]
    model = str(r.get("model", r.get("error", "-")))[:16]
    oem = str(r.get("oem", "-"))[:22]
    status = r.get("oemStatus", r.get("error", "-"))
    chk = r.get("check", "-")
    icon = "\u2705" if chk == "OK" else ("\u274c" if chk == "FAIL" else "\u26a0\ufe0f")
    print(f"{r['id']:<5} {r['auto']:<24} {r.get('http','?'):<5} {r.get('time','?'):<6} {make:<14} {model:<16} {oem:<22} {status:<16} {icon}")

# Final verdict
print(f"\n{'='*60}")
if len(http_fail) == 0 and len(v_fail) == 0:
    print(f"  ALL TESTS PASSED: {len(http_ok)}/{len(results)} OK")
elif len(v_fail) > 0:
    print(f"  ITER 3 REGRESSIONS: {len(v_fail)} V-tests failed:")
    for r in v_fail:
        print(f"    {r['id']}: make={r.get('make')}, model={r.get('model')}, oem={r.get('oem')}")
if len(http_fail) > 0:
    print(f"  HTTP FAILURES: {len(http_fail)}:")
    for r in http_fail:
        print(f"    {r['id']} {r['auto']}: HTTP {r.get('http')} {r.get('error', '')}")
print(f"{'='*60}")
