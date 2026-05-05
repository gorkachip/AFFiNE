// MOJO: ASWebAuthenticationSession bridge for OAuth.
//
// SFSafariViewController (which @capacitor/browser uses) silently
// drops navigations to custom URL schemes since iOS 14, so the
// `mojonotion://` callback never reached the app and OAuth got
// stuck on the "Opening MOJO Notion app now…" page. ASWebAuthSession
// is Apple's blessed OAuth path: it opens the same Safari sheet UI
// but explicitly captures the redirect to our scheme and returns it.

import AuthenticationServices
import Capacitor
import Foundation

@objc(MojoOAuthPlugin)
public class MojoOAuthPlugin: CAPPlugin, ASWebAuthenticationPresentationContextProviding {
  private var activeSession: ASWebAuthenticationSession?

  override public func load() {
    // No-op; the active session is created on demand.
  }

  public func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let window = bridge?.viewController?.view.window {
      return window
    }
    return ASPresentationAnchor()
  }

  @objc func startAuthSession(_ call: CAPPluginCall) {
    guard
      let urlString = call.getString("url"),
      let authURL = URL(string: urlString)
    else {
      call.reject("Missing or invalid `url`")
      return
    }
    guard let callbackScheme = call.getString("callbackScheme") else {
      call.reject("Missing `callbackScheme`")
      return
    }

    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(
        url: authURL,
        callbackURLScheme: callbackScheme
      ) { [weak self] callbackURL, error in
        defer { self?.activeSession = nil }
        if let error = error {
          let nsError = error as NSError
          if nsError.domain == ASWebAuthenticationSessionError.errorDomain,
             nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            call.reject("CANCELED", "User canceled the sign-in")
          } else {
            call.reject(error.localizedDescription)
          }
          return
        }
        guard let callbackURL = callbackURL else {
          call.reject("Auth session ended without a callback URL")
          return
        }
        call.resolve(["url": callbackURL.absoluteString])
      }

      // Lets the sheet read the existing Safari cookies (so users
      // already signed in to Google in Safari skip the password
      // prompt). false = shared session.
      session.prefersEphemeralWebBrowserSession = false
      session.presentationContextProvider = self

      self.activeSession = session
      if !session.start() {
        self.activeSession = nil
        call.reject("Failed to start ASWebAuthenticationSession")
      }
    }
  }
}
