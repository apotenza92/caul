#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  echo "Usage: ./scripts/release.sh <version> [--dry-run]"
  echo "Examples:"
  echo "  ./scripts/release.sh 0.1.0"
  echo "  ./scripts/release.sh 0.1.1-beta.1"
  echo "  ./scripts/release.sh 0.1.0 --dry-run"
}

VERSION=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      if [ -z "$VERSION" ]; then
        VERSION="$arg"
      else
        echo "Error: Unexpected argument '$arg'"
        print_usage
        exit 1
      fi
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  print_usage
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: Invalid version format. Use semver, for example 0.1.0 or 0.1.1-beta.1."
  exit 1
fi

TAG="v$VERSION"
IS_STABLE=false

if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_STABLE=true
fi

BRANCH="$(git branch --show-current)"

if [ "$BRANCH" != "main" ]; then
  echo "Warning: currently on '$BRANCH', not 'main'."
  read -r -p "Continue anyway? (y/N) " confirmation
  if [[ ! "$confirmation" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

if ! git diff-index --quiet HEAD --; then
  echo "Error: uncommitted changes are present. Commit or stash them before releasing."
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists."
  exit 1
fi

PACKAGE_VERSION="$(node -p "require('./package.json').version")"

if [ "$PACKAGE_VERSION" != "$VERSION" ]; then
  echo "Error: package.json version ($PACKAGE_VERSION) does not match release version ($VERSION)."
  exit 1
fi

echo "Release: $TAG"

if [ "$IS_STABLE" = true ]; then
  read -r -p "Type \"yes do it\" to continue: " stable_confirmation

  if [ "$stable_confirmation" != "yes do it" ]; then
    echo "Error: stable releases require the exact confirmation phrase."
    exit 1
  fi
fi

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create tag $TAG"
  echo "[DRY RUN] Would push tag $TAG to origin"
  exit 0
fi

git tag "$TAG"
git push origin "$TAG"

echo "Release $TAG initiated."
