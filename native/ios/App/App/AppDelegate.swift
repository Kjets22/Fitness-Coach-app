import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var bounceKillTimer: Timer?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // iOS re-enables the WKWebView scroll bounce behind our back during a
        // session — most reliably around keyboard show/hide, and after the
        // WebContent process is relaunched. Re-assert "no bounce" on every
        // signal we can observe...
        let nc = NotificationCenter.default
        let triggers: [Notification.Name] = [
            UIResponder.keyboardWillShowNotification,
            UIResponder.keyboardDidShowNotification,
            UIResponder.keyboardWillHideNotification,
            UIResponder.keyboardDidHideNotification,
            UIResponder.keyboardDidChangeFrameNotification,
            UIApplication.didBecomeActiveNotification
        ]
        for name in triggers {
            nc.addObserver(self, selector: #selector(reassertNoBounce), name: name, object: nil)
        }
        // ...plus a slow safety-net sweep for the paths that fire no
        // notification at all, so the bounce can never persist more than ~2 s.
        // (The view walk touches a few dozen views — negligible cost.)
        // Scheduled in .common run-loop mode: the default mode is starved while
        // a finger is tracking a scroll — exactly when a bounce would show.
        let timer = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.reassertNoBounce()
        }
        RunLoop.main.add(timer, forMode: .common)
        bounceKillTimer = timer
        return true
    }

    /// Disable the rubber-band bounce on the WKWebView's OWN scroll view only:
    /// that page-level bounce is what drags the app's fixed header/tab bar.
    /// Deliberately NOT a blanket sweep of every UIScrollView — WebKit backs
    /// inner overflow scrollers (chat lists, horizontal strips) with their own
    /// UIScrollViews on modern iOS, and those should keep their native feel.
    /// Idempotent and cheap — safe to call repeatedly.
    private func disableWebViewBounce(in view: UIView) {
        if let web = view as? WKWebView {
            web.scrollView.bounces = false
            web.scrollView.alwaysBounceVertical = false
            web.scrollView.alwaysBounceHorizontal = false
            return   // don't descend into WebKit's internal scroller hierarchy
        }
        for sub in view.subviews {
            disableWebViewBounce(in: sub)
        }
    }

    @objc private func reassertNoBounce() {
        if let root = window?.rootViewController?.view {
            disableWebViewBounce(in: root)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // The web view exists by the time the app becomes active — kill the
        // scroll bounce on it (see disableWebViewBounce above).
        if let root = window?.rootViewController?.view {
            disableWebViewBounce(in: root)
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
