// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "PulseboardStatus",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "PulseboardStatus", targets: ["PulseboardStatus"]),
  ],
  targets: [
    .executableTarget(
      name: "PulseboardStatus",
      path: "Sources/PulseboardStatus"
    ),
  ]
)
