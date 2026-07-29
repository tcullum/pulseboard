import AppKit
import Foundation
import Security
import SwiftUI

enum DeviceState: String, Codable, Sendable {
  case online
  case stale
  case offline

  var label: String {
    switch self {
    case .online: "Online"
    case .stale: "Stale"
    case .offline: "Offline"
    }
  }

  var color: Color {
    switch self {
    case .online: .green
    case .stale: .orange
    case .offline: .secondary
    }
  }
}

struct FleetDevice: Codable, Identifiable, Sendable {
  let id: String
  let name: String
  let platform: String
  let ageSeconds: Int?
  let status: DeviceState
  let lastSeenAt: String?

  var detail: String {
    guard let ageSeconds else { return "No telemetry received" }
    if ageSeconds < 5 { return "Updated just now" }
    if ageSeconds < 60 { return "Updated \(ageSeconds)s ago" }
    let minutes = ageSeconds / 60
    if minutes < 60 { return "Updated \(minutes)m ago" }
    return "Updated \(minutes / 60)h ago"
  }
}

private struct FleetResponse: Codable, Sendable {
  let generatedAt: String
  let staleAfterSeconds: Int
  let devices: [FleetDevice]
}

@MainActor
final class StatusModel: ObservableObject {
  static let shared = StatusModel()

  @Published var devices: [FleetDevice] = [
    FleetDevice(id: "macbook", name: "Thomas's MacBook Pro", platform: "macos", ageSeconds: nil, status: .offline, lastSeenAt: nil),
    FleetDevice(id: "windows-plex", name: "Windows Plex", platform: "windows", ageSeconds: nil, status: .offline, lastSeenAt: nil),
    FleetDevice(id: "fedora", name: "Linux Dell Fedora", platform: "linux", ageSeconds: nil, status: .offline, lastSeenAt: nil),
  ]
  @Published var isRefreshing = false
  @Published var errorMessage: String?

  private let endpoint = URL(string: "https://pulseboard-mac-monitor.rysingsun.chatgpt.site/api/fleet-status")!
  private let dashboard = URL(string: "https://pulseboard-mac-monitor.rysingsun.chatgpt.site")!
  private var pollingTask: Task<Void, Never>?

  private init() {
    Task { [weak self] in self?.start() }
  }

  var summary: String {
    let online = devices.filter { $0.status == .online }.count
    return "\(online) of \(devices.count) clients online"
  }

  var menuBarSymbol: String {
    if devices.allSatisfy({ $0.status == .online }) { return "circle.fill" }
    if devices.contains(where: { $0.status == .online || $0.status == .stale }) { return "circle.lefthalf.filled" }
    return "circle"
  }

  var menuBarAccessibilityLabel: String {
    "Pulseboard, \(summary)"
  }

  func start() {
    guard pollingTask == nil else { return }
    pollingTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refresh()
        try? await Task.sleep(for: .seconds(15))
      }
    }
  }

  func refresh() async {
    guard !isRefreshing else { return }
    guard let statusToken = Keychain.read(account: "status-token"),
          let sitesToken = Keychain.read(account: "sites-token") else {
      errorMessage = "Pulseboard credentials are not installed."
      return
    }

    isRefreshing = true
    defer { isRefreshing = false }

    var request = URLRequest(url: endpoint)
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.timeoutInterval = 8
    request.setValue("Bearer \(statusToken)", forHTTPHeaderField: "Authorization")
    request.setValue("Bearer \(sitesToken)", forHTTPHeaderField: "OAI-Sites-Authorization")

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw URLError(.userAuthenticationRequired)
      }
      let payload = try JSONDecoder().decode(FleetResponse.self, from: data)
      devices = payload.devices
      errorMessage = nil
    } catch {
      devices = devices.map {
        FleetDevice(id: $0.id, name: $0.name, platform: $0.platform, ageSeconds: $0.ageSeconds, status: .offline, lastSeenAt: $0.lastSeenAt)
      }
      errorMessage = "Couldn’t reach the Pulseboard status feed."
    }
  }

  func openPulseboard() {
    NSWorkspace.shared.open(dashboard)
  }
}

private enum Keychain {
  private static let service = "com.pulseboard.status"

  static func read(account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
