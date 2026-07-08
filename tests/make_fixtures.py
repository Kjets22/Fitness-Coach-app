#!/usr/bin/env python3
"""Generate synthetic health-app import fixtures (stdlib only).

Outputs (into this tests/ folder):
    export-mini.xml        ~50-record Apple Health export: steps, body mass
                           (lb + kg, duplicate day), split sleep + staged
                           sleep + InBed/Awake noise, dietary water
    export-multisource.xml multi-device export (iPhone + Watch): the QA3-3
                           and QA3-4 repro cases — steps recorded by BOTH
                           devices for the same walks, and the same night's
                           sleep logged by both devices with overlapping
                           intervals
    export-20mb.xml        ~20 MB export for parser performance testing
    step_daily_trend.csv   Samsung steps CSV with the junk first line and
                           per-day device + "-2" total rows
    weight.csv             Samsung weight CSV (junk first line, dup day)

Expected values (for the browser test):
    steps  4 days:  06-25=7500, 06-26=8200, 06-27=9000, 06-28=5000
    body   3 days:  06-25=83.91 kg (185 lb), 06-26=83.23 kg (183.5 lb wins
                    over 184 lb), 06-27=83.0 kg
    sleep  3 nights: 06-25 425min bed 23:10 wake 06:45 (split), 06-26
                    450min, 06-27 450min (Core+Deep+REM staged)
    water  2 days:  06-25=1000 ml (500 mL + 0.5 L), 06-26=473 ml (16 fl_oz_us)
    csv steps 3 days: 06-28=9100, 06-29=10450, 06-30=7300 (the -2 totals)
    csv weight 2 days: 06-29=83.8 (latest of two), 06-30=83.6

Expected values for export-multisource.xml (QA3-3 / QA3-4 fixes):
    steps  07-01=3100  (iPhone 3000 + Watch 3100 over the SAME walk ->
                        max single-source total, NOT 6100)
           07-02=5000  (iPhone 2000+2500=4500 vs Watch 2400+2600=5000)
           07-03 absent (single 250000 record > 200000/day sanity cap)
    sleep  07-01 480min bed 23:00 wake 07:00 (iPhone 23:00-07:00 480 +
                        Watch 23:05-06:55 470 -> merged union, NOT 950)
           07-02 240min bed 23:00 wake 04:00 (23:00-01:00 + 00:30-02:00
                        overlap-merge to 180, plus a separate 03:00-04:00)
"""

import datetime
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TZ = " -0500"


def rec(rtype, value, unit, start, end=None, src="TestPhone"):
    end = end or start
    return ('  <Record type="%s" sourceName="%s" unit="%s" '
            'creationDate="%s%s" startDate="%s%s" endDate="%s%s" value="%s"/>'
            % (rtype, src, unit, end, TZ, start, TZ, end, TZ, value))


def cat(value, start, end, src="TestPhone"):
    return ('  <Record type="HKCategoryTypeIdentifierSleepAnalysis" '
            'sourceName="%s" creationDate="%s%s" startDate="%s%s" '
            'endDate="%s%s" value="%s"/>' % (src, end, TZ, start, TZ, end, TZ, value))


def mini():
    L = ['<?xml version="1.0" encoding="UTF-8"?>', "<HealthData locale=\"en_US\">"]
    ST = "HKQuantityTypeIdentifierStepCount"
    BM = "HKQuantityTypeIdentifierBodyMass"
    WA = "HKQuantityTypeIdentifierDietaryWater"

    # --- steps (several records per day, summed) ---
    L.append(rec(ST, 4000, "count", "2026-06-25 09:00:00", "2026-06-25 10:00:00"))
    L.append(rec(ST, 3500, "count", "2026-06-25 15:00:00", "2026-06-25 16:00:00"))
    L.append(rec(ST, 8200, "count", "2026-06-26 09:00:00", "2026-06-26 18:00:00"))
    for h in ("08", "12", "17"):
        L.append(rec(ST, 3000, "count", "2026-06-27 %s:00:00" % h))
    L.append(rec(ST, 5000, "count", "2026-06-28 11:00:00"))

    # --- body mass: lb, duplicate day (latest wins), kg ---
    L.append(rec(BM, 185, "lb", "2026-06-25 08:00:00"))
    L.append(rec(BM, 184, "lb", "2026-06-26 07:00:00"))
    L.append(rec(BM, 183.5, "lb", "2026-06-26 20:00:00"))   # later -> wins
    L.append(rec(BM, 83.0, "kg", "2026-06-27 08:00:00"))
    # BMI record must be ignored (different type)
    L.append(rec("HKQuantityTypeIdentifierBodyMassIndex", 24.9, "count",
                 "2026-06-25 08:00:00"))

    # --- sleep night 1 (wake 06-25): SPLIT sleep + InBed/Awake noise ---
    L.append(cat("HKCategoryValueSleepAnalysisInBed",
                 "2026-06-24 23:00:00", "2026-06-25 06:50:00"))       # ignored
    L.append(cat("HKCategoryValueSleepAnalysisAsleepUnspecified",
                 "2026-06-24 23:10:00", "2026-06-25 02:00:00"))       # 170 min
    L.append(cat("HKCategoryValueSleepAnalysisAwake",
                 "2026-06-25 02:00:00", "2026-06-25 02:30:00"))       # ignored
    L.append(cat("HKCategoryValueSleepAnalysisAsleepUnspecified",
                 "2026-06-25 02:30:00", "2026-06-25 06:45:00"))       # 255 min
    # night 2 (wake 06-26): single legacy "Asleep" interval
    L.append(cat("HKCategoryValueSleepAnalysisAsleep",
                 "2026-06-25 23:30:00", "2026-06-26 07:00:00"))       # 450 min
    # night 3 (wake 06-27): staged Core/Deep/REM
    L.append(cat("HKCategoryValueSleepAnalysisAsleepCore",
                 "2026-06-26 23:00:00", "2026-06-27 01:00:00"))       # 120
    L.append(cat("HKCategoryValueSleepAnalysisAsleepDeep",
                 "2026-06-27 01:00:00", "2026-06-27 03:00:00"))       # 120
    L.append(cat("HKCategoryValueSleepAnalysisAsleepREM",
                 "2026-06-27 03:00:00", "2026-06-27 06:30:00"))       # 210

    # --- water ---
    L.append(rec(WA, 500, "mL", "2026-06-25 09:00:00"))
    L.append(rec(WA, 0.5, "L", "2026-06-25 14:00:00"))                # -> 1000 total
    L.append(rec(WA, 16, "fl_oz_us", "2026-06-26 10:00:00"))          # -> 473

    # padding records of an unhandled type so the file is ~50 records
    for i in range(25):
        L.append(rec("HKQuantityTypeIdentifierHeartRate", 60 + i, "count/min",
                     "2026-06-25 %02d:00:00" % (i % 24)))

    L.append("</HealthData>")
    path = os.path.join(HERE, "export-mini.xml")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("wrote", path, os.path.getsize(path), "bytes")


def multisource():
    """QA3-3 / QA3-4 repro: iPhone + Watch both logging the same activity."""
    L = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData locale="en_US">']
    ST = "HKQuantityTypeIdentifierStepCount"
    PH, WA = "Kjetil's iPhone", "Kjetil's Apple Watch"

    # 07-01: the SAME 09:00-09:30 walk seen by both devices -> expect 3100
    L.append(rec(ST, 3000, "count", "2026-07-01 09:00:00", "2026-07-01 09:30:00", src=PH))
    L.append(rec(ST, 3100, "count", "2026-07-01 09:00:00", "2026-07-01 09:30:00", src=WA))
    # 07-02: several records per device -> per-source sums 4500 vs 5000 -> 5000
    L.append(rec(ST, 2000, "count", "2026-07-02 08:00:00", "2026-07-02 08:30:00", src=PH))
    L.append(rec(ST, 2500, "count", "2026-07-02 17:00:00", "2026-07-02 17:30:00", src=PH))
    L.append(rec(ST, 2400, "count", "2026-07-02 08:00:00", "2026-07-02 08:30:00", src=WA))
    L.append(rec(ST, 2600, "count", "2026-07-02 17:00:00", "2026-07-02 17:30:00", src=WA))
    # 07-03: garbage value above the 200000/day sanity cap -> day dropped
    L.append(rec(ST, 250000, "count", "2026-07-03 10:00:00", "2026-07-03 11:00:00", src=PH))

    # night wake 07-01: both devices log the same ~8h night (old code: 950 min)
    L.append(cat("HKCategoryValueSleepAnalysisAsleep",
                 "2026-06-30 23:00:00", "2026-07-01 07:00:00", src=PH))    # 480
    L.append(cat("HKCategoryValueSleepAnalysisAsleepCore",
                 "2026-06-30 23:05:00", "2026-07-01 06:55:00", src=WA))    # 470, inside
    # night wake 07-02: partial overlap + a separate later interval -> 240 min
    L.append(cat("HKCategoryValueSleepAnalysisAsleep",
                 "2026-07-01 23:00:00", "2026-07-02 01:00:00", src=PH))    # 120
    L.append(cat("HKCategoryValueSleepAnalysisAsleepCore",
                 "2026-07-02 00:30:00", "2026-07-02 02:00:00", src=WA))    # overlaps -> +60
    L.append(cat("HKCategoryValueSleepAnalysisAsleep",
                 "2026-07-02 03:00:00", "2026-07-02 04:00:00", src=PH))    # +60

    L.append("</HealthData>")
    path = os.path.join(HERE, "export-multisource.xml")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("wrote", path, os.path.getsize(path), "bytes")


def big(target_mb=20):
    path = os.path.join(HERE, "export-20mb.xml")
    day0 = datetime.date(2020, 1, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n')
        n = 0
        while f.tell() < target_mb * 1024 * 1024:
            d = (day0 + datetime.timedelta(days=(n // 40) % 2000)).isoformat()
            # mostly steps, a body mass every 200 lines
            if n % 200 == 0:
                f.write(rec("HKQuantityTypeIdentifierBodyMass", 180 - (n % 1000) / 100,
                            "lb", "%s 08:00:00" % d) + "\n")
            f.write(rec("HKQuantityTypeIdentifierStepCount", 100 + n % 900, "count",
                        "%s 09:00:00" % d, "%s 10:00:00" % d) + "\n")
            n += 1
        f.write("</HealthData>\n")
    print("wrote", path, os.path.getsize(path), "bytes,", n, "step records")


def epoch_ms(iso):
    d = datetime.datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    return int(d.timestamp() * 1000)


def samsung():
    steps = os.path.join(HERE, "step_daily_trend.csv")
    with open(steps, "w", encoding="utf-8") as f:
        f.write("com.samsung.shealth.step_daily_trend,100001,3\n")  # junk first line
        f.write("binning_data,count,create_time,datauuid,day_time,deviceuuid,distance,pkg_name,source_type,speed,update_time\n")
        rows = [
            ("2026-06-28", 8800, "0"), ("2026-06-28", 9100, "-2"),
            ("2026-06-29", 10450, "-2"), ("2026-06-29", 9900, "0"),
            ("2026-06-30", 7300, "-2"),
        ]
        for date, count, src in rows:
            f.write(",%d,%s 00:00:00.000,uuid-%d,%d,dev1,%d,com.sec.android.app.shealth,%s,1.2,%s 23:59:00.000\n"
                    % (count, date, count, epoch_ms(date), count, src, date))
    print("wrote", steps, os.path.getsize(steps), "bytes")

    weight = os.path.join(HERE, "weight.csv")
    with open(weight, "w", encoding="utf-8") as f:
        f.write("com.samsung.health.weight,100001,3\n")  # junk first line
        f.write("height,weight,start_time,create_time,update_time,time_offset,datauuid,pkg_name\n")
        f.write("178,84.1,2026-06-29 07:30:00.000,2026-06-29 07:30:00.000,2026-06-29 07:30:00.000,UTC+0100,u1,com.sec.android.app.shealth\n")
        f.write("178,83.8,2026-06-29 21:00:00.000,2026-06-29 21:00:00.000,2026-06-29 21:00:00.000,UTC+0100,u2,com.sec.android.app.shealth\n")
        f.write("178,83.6,2026-06-30 08:00:00.000,2026-06-30 08:00:00.000,2026-06-30 08:00:00.000,UTC+0100,u3,com.sec.android.app.shealth\n")
    print("wrote", weight, os.path.getsize(weight), "bytes")


if __name__ == "__main__":
    mini()
    multisource()
    big()
    samsung()
