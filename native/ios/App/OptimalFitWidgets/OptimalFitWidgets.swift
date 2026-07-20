import WidgetKit
import SwiftUI
import AppIntents

// ============================================================
// OptimalFit home-screen widgets (iOS 17+, interactive).
//  - Water widget (small): live progress ring + a "+ glass" button that
//    logs WITHOUT opening the app (AppIntent -> App Group -> app drains).
//  - Today widget (medium): water / steps / calories / streak overview
//    with deep-link shortcuts into the food and workout loggers.
// State comes from the app via WidgetBridgePlugin (App Group defaults).
// ============================================================

let kSuite = "group.com.optimalfit.app"
let kGlassMl = 237.0

func localDayString(_ date: Date = .now) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
}

struct TodayState {
    var waterMl: Double, waterGoalMl: Double
    var steps: Double, stepsGoal: Double
    var kcal: Double, kcalGoal: Double
    var streak: Int
    var waterUnit: String = "oz"

    // display in the user's in-app unit (oz users see oz, ml users see ml)
    var waterValueText: String {
        waterUnit == "ml" ? "\(Int(waterMl.rounded()))" : "\(Int((waterMl / 29.5735).rounded()))"
    }

    static func load() -> TodayState {
        let d = UserDefaults(suiteName: kSuite)
        // the app stamps which day its totals belong to; past midnight they
        // are yesterday's numbers and a "Today" widget must show a fresh day
        let appDay = d?.string(forKey: "today") ?? ""
        let stale = !appDay.isEmpty && appDay != localDayString()
        let base = stale ? 0 : (d?.double(forKey: "waterMl") ?? 0)
        let pending = d?.double(forKey: "pendingWaterMl") ?? 0
        return TodayState(
            waterMl: base + pending,
            waterGoalMl: max(d?.double(forKey: "waterGoalMl") ?? 2500, 1),
            steps: stale ? 0 : (d?.double(forKey: "steps") ?? 0),
            stepsGoal: max(d?.double(forKey: "stepsGoal") ?? 8000, 1),
            kcal: stale ? 0 : (d?.double(forKey: "kcal") ?? 0),
            kcalGoal: max(d?.double(forKey: "kcalGoal") ?? 2000, 1),
            streak: Int(d?.double(forKey: "streak") ?? 0),
            waterUnit: d?.string(forKey: "waterUnit") ?? "oz"
        )
    }
}

// MARK: - Interactive intent: +1 glass straight from the home screen

struct LogWaterIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a glass of water"
    static var description = IntentDescription("Adds one glass of water to today's OptimalFit log.")

    func perform() async throws -> some IntentResult {
        let d = UserDefaults(suiteName: kSuite)
        let pending = d?.double(forKey: "pendingWaterMl") ?? 0
        // first tap of a batch: remember WHICH day it happened — the app may
        // not drain until tomorrow, and a 11:55pm glass belongs to today
        if pending == 0 { d?.set(localDayString(), forKey: "pendingWaterDate") }
        d?.set(pending + kGlassMl, forKey: "pendingWaterMl")
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
    let date: Date
    let state: TodayState
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: .now, state: TodayState(waterMl: 950, waterGoalMl: 2500, steps: 5200, stepsGoal: 8000, kcal: 1450, kcalGoal: 2200, streak: 6))
    }
    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: .now, state: TodayState.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let entry = TodayEntry(date: .now, state: TodayState.load())
        // refresh at midnight (so stale-day zeroing shows on time), else 30 min
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86400))
        let next = min(Date.now.addingTimeInterval(30 * 60), midnight.addingTimeInterval(2))
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Shared styling

let ofBG = LinearGradient(colors: [Color(red: 0.02, green: 0.028, blue: 0.06), Color(red: 0.06, green: 0.086, blue: 0.153)], startPoint: .top, endPoint: .bottom)
let ofAccent = Color(red: 0.545, green: 0.361, blue: 0.965)   // violet
let ofCyan = Color(red: 0.133, green: 0.827, blue: 0.933)
let ofBlue = Color(red: 0.35, green: 0.65, blue: 1.0)

// MARK: - Water widget (small, interactive)

struct WaterWidgetView: View {
    var entry: TodayEntry
    var body: some View {
        let s = entry.state
        let frac = min(s.waterMl / s.waterGoalMl, 1.0)
        VStack(spacing: 6) {
            HStack {
                Text("WATER").font(.system(size: 11, weight: .heavy)).kerning(1).foregroundStyle(.secondary)
                Spacer()
                Image(systemName: "drop.fill").foregroundStyle(ofBlue).font(.system(size: 11))
            }
            Gauge(value: frac) {
                EmptyView()
            } currentValueLabel: {
                VStack(spacing: 0) {
                    Text(s.waterValueText).font(.system(size: 20, weight: .heavy, design: .rounded))
                    Text(s.waterUnit).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                }
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(ofBlue)
            .frame(maxHeight: .infinity)
            Button(intent: LogWaterIntent()) {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                    Text("Glass").font(.system(size: 12, weight: .bold))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(ofBlue.opacity(0.85))
        }
        .containerBackground(for: .widget) { ofBG }
    }
}

struct WaterWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OptimalFitWater", provider: TodayProvider()) { entry in
            WaterWidgetView(entry: entry)
        }
        .configurationDisplayName("Water")
        .description("See today's water and log a glass with one tap.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Today overview widget (medium, deep links)

struct StatColumn: View {
    let icon: String, tint: Color, value: String, label: String, frac: Double
    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: icon).foregroundStyle(tint).font(.system(size: 13, weight: .semibold))
            Text(value).font(.system(size: 15, weight: .heavy, design: .rounded)).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            ProgressView(value: min(frac, 1)).tint(tint).scaleEffect(y: 0.8)
        }
        .frame(maxWidth: .infinity)
    }
}

struct TodayWidgetView: View {
    var entry: TodayEntry
    var body: some View {
        let s = entry.state
        VStack(spacing: 8) {
            HStack {
                Text("TODAY").font(.system(size: 11, weight: .heavy)).kerning(1.2).foregroundStyle(.secondary)
                Spacer()
                if s.streak > 0 {
                    HStack(spacing: 2) {
                        Image(systemName: "flame.fill").foregroundStyle(.orange).font(.system(size: 10))
                        Text("\(s.streak)").font(.system(size: 11, weight: .heavy))
                    }
                }
            }
            HStack(spacing: 10) {
                StatColumn(icon: "drop.fill", tint: ofBlue,
                           value: "\(s.waterValueText) \(s.waterUnit)", label: "water",
                           frac: s.waterMl / s.waterGoalMl)
                StatColumn(icon: "figure.walk", tint: ofCyan,
                           value: "\(Int(s.steps))", label: "steps",
                           frac: s.steps / s.stepsGoal)
                StatColumn(icon: "fork.knife", tint: ofAccent,
                           value: "\(Int(s.kcal))", label: "kcal",
                           frac: s.kcal / s.kcalGoal)
            }
            HStack(spacing: 8) {
                Button(intent: LogWaterIntent()) {
                    Label("Glass", systemImage: "plus").font(.system(size: 11, weight: .bold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(ofBlue.opacity(0.85))
                Link(destination: URL(string: "optimalfit://log?tab=food")!) {
                    Label("Meal", systemImage: "plus").font(.system(size: 11, weight: .bold)).frame(maxWidth: .infinity)
                        .padding(.vertical, 6).background(ofAccent.opacity(0.85), in: RoundedRectangle(cornerRadius: 8)).foregroundStyle(.white)
                }
                Link(destination: URL(string: "optimalfit://log?tab=exercise")!) {
                    Label("Lift", systemImage: "plus").font(.system(size: 11, weight: .bold)).frame(maxWidth: .infinity)
                        .padding(.vertical, 6).background(ofCyan.opacity(0.7), in: RoundedRectangle(cornerRadius: 8)).foregroundStyle(.white)
                }
            }
        }
        .containerBackground(for: .widget) { ofBG }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OptimalFitToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today at a glance")
        .description("Water, steps and calories with one-tap logging shortcuts.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - Bundle

@main
struct OptimalFitWidgetBundle: WidgetBundle {
    var body: some Widget {
        WaterWidget()
        TodayWidget()
    }
}
