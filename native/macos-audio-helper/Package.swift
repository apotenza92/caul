// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "SusuraAudioHelper",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(name: "SusuraAudioHelper", targets: ["SusuraAudioHelper"])
  ],
  dependencies: [
    .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4")
  ],
  targets: [
    .executableTarget(
      name: "SusuraAudioHelper",
      dependencies: [
        .product(name: "FluidAudio", package: "FluidAudio")
      ],
      linkerSettings: [
        .unsafeFlags([
          "-Xlinker", "-sectcreate",
          "-Xlinker", "__TEXT",
          "-Xlinker", "__info_plist",
          "-Xlinker", "Sources/SusuraAudioHelper/Info.plist"
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
