// swift-tools-version: 6.0
// The translation helper embedded in irodr-local (docs/local-server.md). macOS only.
import PackageDescription

let package = Package(
    name: "irodr-translate",
    platforms: [.macOS("26.0")],
    products: [.executable(name: "irodr-translate", targets: ["irodr-translate"])],
    targets: [.executableTarget(name: "irodr-translate")],
    swiftLanguageModes: [.v5]
)
