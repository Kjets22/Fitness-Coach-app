import Foundation
import Capacitor
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Bridge between the web app and the OptimalFit home-screen widgets.
/// State lives in the App Group's UserDefaults so the widget extension can
/// read it; the widget writes "pending" quick-log actions the app drains.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise)
    ]

    static let suite = "group.com.optimalfit.app"

    private var store: UserDefaults? { UserDefaults(suiteName: Self.suite) }

    /// App -> widget: push today's totals + goals. Reloads widget timelines.
    @objc func sync(_ call: CAPPluginCall) {
        guard let d = store else { call.reject("app group unavailable"); return }
        for key in ["waterMl", "waterGoalMl", "steps", "stepsGoal", "kcal", "kcalGoal", "streak"] {
            if let v = call.getDouble(key) { d.set(v, forKey: key) }
        }
        if let today = call.getString("today") { d.set(today, forKey: "today") }
        if let unit = call.getString("waterUnit") { d.set(unit, forKey: "waterUnit") }
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        #endif
        call.resolve()
    }

    /// Widget -> app: hand over quick-logged water (and zero it out).
    /// pendingWaterDate = the day the FIRST undrained tap happened, so a
    /// glass tapped at 11:55pm lands on the right day even if the app only
    /// opens tomorrow morning.
    @objc func drain(_ call: CAPPluginCall) {
        guard let d = store else { call.reject("app group unavailable"); return }
        let pending = d.double(forKey: "pendingWaterMl")
        let date = d.string(forKey: "pendingWaterDate") ?? ""
        d.set(0.0, forKey: "pendingWaterMl")
        d.removeObject(forKey: "pendingWaterDate")
        call.resolve(["pendingWaterMl": pending, "pendingWaterDate": date])
    }
}
