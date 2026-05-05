import Capacitor
import Intelligents
import UIKit
import WebKit

class AFFiNEViewController: CAPBridgeViewController, WKUIDelegate {
  var intelligentsButton: IntelligentsButton?

  override func viewDidLoad() {
    super.viewDidLoad()
    webView?.allowsBackForwardNavigationGestures = true
    // MOJO: claim the WKUIDelegate so target="_blank" / window.open
    // calls land in the same WebView instead of dropping out to Safari.
    webView?.uiDelegate = self
    navigationController?.navigationBar.isHidden = true
    extendedLayoutIncludesOpaqueBars = false
    edgesForExtendedLayout = []
    let intelligentsButton = installIntelligentsButton()
    intelligentsButton.delegate = self
    self.intelligentsButton = intelligentsButton
    dismissIntelligentsButton()

    // When iOS reclaims the WKWebView's process while the app is in
    // background, returning to foreground often shows a blank screen
    // because the WebView never re-renders. Watch the process state
    // and reload the page once it's terminated.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAppDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleAppDidBecomeActive() {
    guard let webView = webView else { return }
    // The blank-screen case is when iOS killed the WebView process while
    // the app was backgrounded. Two signals: webView.url goes nil, or
    // evaluateJavaScript fails because the underlying process is dead.
    if webView.url == nil {
      // If we ever lost the URL, reload to the configured server.
      if let serverURL = bridge?.config.serverURL {
        webView.load(URLRequest(url: serverURL))
      } else {
        webView.reload()
      }
      return
    }
    webView.evaluateJavaScript("document.readyState") { [weak self] result, error in
      if error != nil || result == nil {
        self?.webView?.reload()
      }
    }
  }

  override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
    let configuration = super.webViewConfiguration(for: instanceConfiguration)
    return configuration
  }

  override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
    super.webView(with: frame, configuration: configuration)
  }

  override func capacitorDidLoad() {
    let plugins: [CAPPlugin] = [
      AuthPlugin(),
      CookiePlugin(),
      HashcashPlugin(),
      MojoOAuthPlugin(),
      NavigationGesturePlugin(),
      NbStorePlugin(),
      PayWallPlugin(associatedController: self),
      PreviewPlugin(),
    ]
    plugins.forEach { bridge?.registerPluginInstance($0) }
  }

  private var intelligentsButtonTimer: Timer?
  private var isCheckingIntelligentEligibility = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    IntelligentContext.shared.webView = webView
    navigationController?.setNavigationBarHidden(false, animated: animated)
    let timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
      self?.checkEligibilityOfIntelligent()
    }
    intelligentsButtonTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func checkEligibilityOfIntelligent() {
    guard !isCheckingIntelligentEligibility else { return }
    assert(intelligentsButton != nil)
    guard intelligentsButton?.isHidden ?? false else { return } // already eligible
    isCheckingIntelligentEligibility = true
    IntelligentContext.shared.webView = webView
    IntelligentContext.shared.preparePresent { [self] result in
      DispatchQueue.main.async {
        defer { self.isCheckingIntelligentEligibility = false }
        switch result {
        case .failure: break
        case .success:
          self.presentIntelligentsButton()
        }
      }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    intelligentsButtonTimer?.invalidate()
  }

  // MOJO: WKWebView's default behaviour for window.open / target="_blank"
  // is to return nil here and the link silently dies. Capacitor's fallback
  // then forwards the URL to Safari. Load it in the existing WebView
  // instead so the user never leaves the app.
  func webView(
    _ webView: WKWebView,
    createWebViewWith _: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures _: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url, navigationAction.targetFrame == nil {
      webView.load(URLRequest(url: url))
    }
    return nil
  }
}
