#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_version="${1:-1.0.0}"
release_dir="$project_root/releases"
release_name="Paycheck-Local-v${release_version}"
temporary_dir="$(mktemp -d)"
package_dir="$temporary_dir/$release_name"

cleanup() { rm -rf "$temporary_dir"; }
trap cleanup EXIT

mkdir -p "$release_dir" "$package_dir"
cp -R "$project_root/dist" "$package_dir/dist"
cp "$project_root/standalone/run-local.mjs" "$package_dir/run-local.mjs"
cp "$project_root/standalone/START-WINDOWS.bat" "$package_dir/START-WINDOWS.bat"
cp "$project_root/standalone/START-MAC-LINUX.sh" "$package_dir/START-MAC-LINUX.sh"
cp "$project_root/standalone/README.txt" "$package_dir/README.txt"
cp "$project_root/docs/PRD.md" "$package_dir/PRODUCT-REQUIREMENTS.md"
cp "$project_root/docs/SELF-HOSTING.md" "$package_dir/SELF-HOSTING.md"
chmod +x "$package_dir/START-MAC-LINUX.sh"
(cd "$temporary_dir" && zip -qr "$release_dir/${release_name}.zip" "$release_name")
(cd "$release_dir" && sha256sum "${release_name}.zip" > "${release_name}.zip.sha256")
printf 'Created %s\n' "$release_dir/${release_name}.zip"
printf 'Created %s\n' "$release_dir/${release_name}.zip.sha256"
