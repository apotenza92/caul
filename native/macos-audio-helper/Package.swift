// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "CaulAudioHelper",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(name: "CaulAudioHelper", targets: ["CaulAudioHelper"])
  ],
  dependencies: [
    .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4")
  ],
  targets: [
    .executableTarget(
      name: "CaulAudioHelper",
      dependencies: [
        .product(name: "FluidAudio", package: "FluidAudio")
      ],
      linkerSettings: [
        .unsafeFlags([
          "-Xlinker", "-sectcreate",
          "-Xlinker", "__TEXT",
          "-Xlinker", "__info_plist",
          "-Xlinker", "Sources/CaulAudioHelper/Info.plist"
        ]),
        .linkedFramework("AVFoundation"),
        .linkedFramework("CoreGraphics"),
        .linkedFramework("CoreMedia"),
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("CoreAudio")
      ]
    )
  ]
)
