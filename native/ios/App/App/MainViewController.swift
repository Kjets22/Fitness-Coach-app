import UIKit
import Capacitor

/// Registers in-app Capacitor plugins (Capacitor 8's documented pattern for
/// custom native code that lives in the app target rather than a pod).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
