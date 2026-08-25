// Unity eval payload: make the spike fixture scene the ACTIVE scene.
//
// The shipped extract payload deliberately reads the active scene rather than
// opening one (the hook runs after recording, in the session that already
// opened it). For an E2E run there is no preceding recording pass in the same
// Editor, so this stands in for core's open-scene step.
//
//   unity command eval_file --project-path <spike/unity-project> <this file> --timeout 120

var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
    "Assets/Scenes/AudioSpike.unity",
    UnityEditor.SceneManagement.OpenSceneMode.Single);
return "{\"activeScene\":\"" + scene.name + "\"}";
