import AppKit
import SwiftUI

@main
struct PulseboardStatusApp: App {
  @StateObject private var model = StatusModel.shared

  var body: some Scene {
    MenuBarExtra {
      StatusPopover()
        .environmentObject(model)
        .task { model.start() }
    } label: {
      Image(systemName: model.menuBarSymbol)
        .accessibilityLabel(model.menuBarAccessibilityLabel)
    }
    .menuBarExtraStyle(.window)
  }
}

private struct StatusPopover: View {
  @EnvironmentObject private var model: StatusModel

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text("Pulseboard")
            .font(.headline)
          Text(model.summary)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        if model.isRefreshing {
          ProgressView()
            .controlSize(.small)
        }
      }
      .padding(14)

      Divider()

      VStack(spacing: 4) {
        ForEach(model.devices) { device in
          DeviceRow(device: device)
        }
      }
      .padding(10)

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 14)
          .padding(.bottom, 8)
      }

      Divider()

      HStack(spacing: 8) {
        Button {
          model.openPulseboard()
        } label: {
          Label("Open Pulseboard", systemImage: "arrow.up.right.square")
        }

        Spacer()

        Button {
          Task { await model.refresh() }
        } label: {
          Image(systemName: "arrow.clockwise")
        }
        .help("Refresh now")
        .disabled(model.isRefreshing)

        Menu {
          Label("Starts at Login", systemImage: "checkmark.circle")
          Divider()
          Button("Quit Pulseboard Status") {
            NSApplication.shared.terminate(nil)
          }
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
      }
      .padding(12)
    }
    .frame(width: 286)
  }
}

private struct DeviceRow: View {
  let device: FleetDevice

  var body: some View {
    HStack(spacing: 11) {
      Circle()
        .fill(device.status.color)
        .frame(width: 10, height: 10)
        .shadow(color: device.status == .online ? .green.opacity(0.45) : .clear, radius: 4)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 2) {
        Text(device.name)
          .font(.system(size: 13, weight: .semibold))
        Text(device.detail)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }

      Spacer()

      Text(device.status.label)
        .font(.caption)
        .foregroundStyle(device.status.color)
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 8)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(device.name), \(device.status.label), \(device.detail)")
  }
}
