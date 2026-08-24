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

private struct LocalTelemetryResponse: Codable, Sendable {
  let timestamp: String
  let device: LocalDevice
}

private struct LocalDevice: Codable, Sendable {
  let id: String?
  let name: String
  let platform: String
}

private struct RelayConfig: Codable, Sendable {
  let relayUrl: String
  let deviceToken: String
}

private struct RelayAuth: Codable, Sendable {
  let username: String
  let password: String
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

  private let localEndpoint = URL(string: "http://127.0.0.1:4319/telemetry")!
  private let dashboard = URL(string: "https://pulse.cullum.dad")!
  private let telemetryAgent = "com.pulseboard.telemetry"
  private var lastRepairAttempt: Date?
  private var pollingTask: Task<Void, Never>?

  private init() {
    start()
  }

  var summary: String {
    let online = devices.filter { $0.status == .online }.count
    return "\(online) of \(devices.count) clients online"
  }

  var menuBarSymbol: String {
    devices.allSatisfy({ $0.status == .online }) ? "circle" : "xmark.circle"
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
    guard let relayConfig = readRelayConfig(), let relayAuth = readRelayAuth(),
          let endpoint = URL(string: relayConfig.relayUrl + "/api/fleet-status") else {
      errorMessage = "Pulseboard credentials are not installed."
      return
    }

    isRefreshing = true
    defer { isRefreshing = false }

    await ensureTelemetryCompanion()

    var request = URLRequest(url: endpoint)
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.timeoutInterval = 8
    let basic = Data("\(relayAuth.username):\(relayAuth.password)".utf8).base64EncodedString()
    request.setValue("Basic \(basic)", forHTTPHeaderField: "Authorization")
    request.setValue("Bearer \(relayConfig.deviceToken)", forHTTPHeaderField: "X-Pulseboard-Authorization")

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw URLError(.userAuthenticationRequired)
      }
      let payload = try JSONDecoder().decode(FleetResponse.self, from: data)
      devices = payload.devices
      errorMessage = nil
    } catch {
      await refreshLocalFallback()
    }
  }

  private func readRelayConfig() -> RelayConfig? {
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/Pulseboard/relay.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(RelayConfig.self, from: data)
  }

  private func readRelayAuth() -> RelayAuth? {
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/Pulseboard/relay-auth.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(RelayAuth.self, from: data)
  }

  private func refreshLocalFallback() async {
    repairTelemetryCompanionIfNeeded()

    var localRequest = URLRequest(url: localEndpoint)
    localRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    localRequest.timeoutInterval = 3

    do {
      let (data, response) = try await URLSession.shared.data(for: localRequest)
      guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
      let payload = try JSONDecoder().decode(LocalTelemetryResponse.self, from: data)
      let now = Date()
      devices = devices.map { device in
        let isLocalMac = device.platform == payload.device.platform && payload.device.platform == "macos"
        return FleetDevice(
          id: device.id,
          name: isLocalMac ? payload.device.name : device.name,
          platform: device.platform,
          ageSeconds: isLocalMac ? 0 : nil,
          status: isLocalMac ? .online : .offline,
          lastSeenAt: isLocalMac ? ISO8601DateFormatter().string(from: now) : nil
        )
      }
      errorMessage = "Remote status feed unavailable; showing this Mac."
    } catch {
      devices = devices.map {
        FleetDevice(id: $0.id, name: $0.name, platform: $0.platform, ageSeconds: $0.ageSeconds, status: .offline, lastSeenAt: $0.lastSeenAt)
      }
      errorMessage = "Couldn’t reach Pulseboard telemetry."
    }
  }

  private func ensureTelemetryCompanion() async {
    var request = URLRequest(url: localEndpoint)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 2
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      repairTelemetryCompanionIfNeeded()
    }
  }

  private func repairTelemetryCompanionIfNeeded() {
    let now = Date()
    if let lastRepairAttempt, now.timeIntervalSince(lastRepairAttempt) < 60 {
      return
    }
    lastRepairAttempt = now

    let domain = "gui/\(getuid())"
    let plist = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/LaunchAgents/com.pulseboard.telemetry.plist")
      .path

    if launchctl(["print", "\(domain)/\(telemetryAgent)"]) == 0 {
      _ = launchctl(["kickstart", "-k", "\(domain)/\(telemetryAgent)"])
      return
    }

    guard FileManager.default.fileExists(atPath: plist) else { return }
    _ = launchctl(["bootstrap", domain, plist])
    _ = launchctl(["enable", "\(domain)/\(telemetryAgent)"])
    _ = launchctl(["kickstart", "-k", "\(domain)/\(telemetryAgent)"])
  }

  @discardableResult
  private func launchctl(_ arguments: [String]) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus
    } catch {
      return -1
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
