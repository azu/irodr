// Builds the macOS translation helper that `vp pack` embeds (swift/irodr-translate), so the executable
// never carries a stale one. Elsewhere, irodr-local is built without translation.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const PACKAGE = "swift/irodr-translate";

if (process.platform === "darwin") {
    execFileSync("swift", ["build", "-c", "release", "--package-path", PACKAGE], { stdio: "inherit" });
} else {
    // A helper left from another build must not be embedded.
    rmSync(`${PACKAGE}/.build/release/irodr-translate`, { force: true });
    console.info("Skipping the translation helper: it needs macOS.");
}
