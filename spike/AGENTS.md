# Spike Unity Project — Editor Launch Rules

Rules for opening `spike/unity-project` (or any Unity project in this repo). These exist to prevent interactive Editor dialogs that block unattended runs and bother the user.

## Always pin the Editor version

- The project version is defined in `spike/unity-project/ProjectSettings/ProjectVersion.txt` (currently `6000.0.36f1`).
- ALWAYS launch with an explicit, exactly matching version:

  ```powershell
  unity open --path "<absolute path>\spike\unity-project" --editor-version 6000.0.36f1
  ```

- NEVER run `unity open` without `--editor-version`. An unpinned open selects the newest installed Editor (e.g. 6000.3.x), which triggers the "project was saved with a different version / upgrade?" dialog and, after switching back, the "rebuild Library?" dialog.

## Pass `-automated` to the Editor

- Always launch the Editor with the `-automated` Editor argument in addition to the version pin. It puts the Editor in automation mode and suppresses most interactive dialogs while staying in GUI mode (do NOT combine with `-batchmode` / `-nographics`).
- If `unity open` can forward Editor arguments, append `-automated` through that mechanism. If it cannot, launch the Editor executable directly instead:

  ```powershell
  & "<editor install path>\6000.0.36f1\Editor\Unity.exe" -projectPath "<absolute path>\spike\unity-project" -automated
  ```

- Record in `spike/README.md` which launch form actually worked, so later tasks reuse it.
- NEVER upgrade the project to a newer Unity version, and never open it with any version other than the one in `ProjectVersion.txt`. If a version change is genuinely required, update `ProjectVersion.txt` deliberately in its own commit and note it in `spike/README.md`.

## Other dialog-avoidance rules

- Do not open the project in two Editor instances at once (causes the "project already open" dialog). Check for a running Editor on the project (e.g. port 7800 or `Temp/UnityLockfile`) before opening.
- Quit the Editor via `EditorApplication.Exit(0)` (no save dialogs) as established by the spike; do not leave orphan Editor processes between tasks.
- If Unity still shows a blocking dialog during an unattended run, record the exact dialog text in `spike/README.md` and choose the non-destructive option.
