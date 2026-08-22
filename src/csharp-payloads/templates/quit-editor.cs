// Unity eval payload: terminate the GUI Editor without a save prompt.
var parametersJson = /*__PARAMS_JSON__*/;

// Deliberately do not call any AssetDatabase or Scene save API.
// EditorApplication.Exit bypasses the save dialog and is the normal shutdown path.
UnityEditor.EditorApplication.Exit(0);
