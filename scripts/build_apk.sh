#!/usr/bin/env bash
# Build an Android APK from a Unity project in batch mode.
#   scripts/build_apk.sh <project-dir> [output.apk]
# License: set UNITY_LICENSE (contents of a .ulf file), or UNITY_SERIAL +
# UNITY_EMAIL + UNITY_PASSWORD (Pro/Plus), before running.
set -euo pipefail
PROJECT=$(realpath "${1:?usage: build_apk.sh <project-dir> [output.apk]}")
OUT=$(realpath -m "${2:-$PROJECT/Builds/app.apk}")
UNITY=${UNITY:-/opt/unity/current/Editor/Unity}
AP=$(dirname "$UNITY")/Data/PlaybackEngines/AndroidPlayer
LOG=${LOG:-/dev/stdout}

# Activate license if one is provided
if [[ -n "${UNITY_LICENSE:-}" ]]; then
  mkdir -p ~/.local/share/unity3d/Unity
  printf '%s' "$UNITY_LICENSE" > ~/.local/share/unity3d/Unity/Unity_lic.ulf
elif [[ -n "${UNITY_SERIAL:-}" ]]; then
  "$UNITY" -batchmode -nographics -quit -logFile - \
    -serial "$UNITY_SERIAL" -username "$UNITY_EMAIL" -password "$UNITY_PASSWORD"
fi

# Drop in a generic build method if the project has none
EDITOR_DIR="$PROJECT/Assets/Editor"
if ! grep -rqs "class CIBuild" "$PROJECT/Assets"; then
  mkdir -p "$EDITOR_DIR"
  cat > "$EDITOR_DIR/CIBuild.cs" <<'CS'
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
public static class CIBuild {
    public static void BuildAndroid() {
        var args = System.Environment.GetCommandLineArgs();
        int i = System.Array.IndexOf(args, "-buildOutput");
        string output = i >= 0 ? args[i + 1] : "Builds/app.apk";
        EditorUserBuildSettings.buildAppBundle = false;
        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = scenes, locationPathName = output,
            target = BuildTarget.Android, options = BuildOptions.None });
        EditorApplication.Exit(report.summary.result == BuildResult.Succeeded ? 0 : 1);
    }
}
CS
fi

mkdir -p "$(dirname "$OUT")"
"$UNITY" -batchmode -nographics -quit -logFile "$LOG" \
  -projectPath "$PROJECT" -buildTarget Android \
  -executeMethod CIBuild.BuildAndroid -buildOutput "$OUT"
echo "APK: $OUT"
