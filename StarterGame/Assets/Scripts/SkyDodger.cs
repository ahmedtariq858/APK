using System.Collections.Generic;
using UnityEngine;

// Sky Dodger: drag/tap left-right to move the paddle and avoid falling blocks.
// Everything is built from code, so the scene only needs this one component
// (and even that is added automatically on startup).
public class SkyDodger : MonoBehaviour
{
    const float HalfHeight = 8f;          // orthographic camera half-height (world units)
    const float PlayerY = -6.5f;
    const float PlayerSpeed = 18f;

    Camera cam;
    Transform player;
    readonly List<Transform> blocks = new List<Transform>();

    float halfWidth;
    float spawnTimer;
    float elapsed;
    int best;
    bool gameOver;
    GUIStyle bigStyle, smallStyle;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (FindAnyObjectByType<SkyDodger>() == null)
            new GameObject("SkyDodger").AddComponent<SkyDodger>();
    }

    void Start()
    {
        Application.targetFrameRate = 60;
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
        best = PlayerPrefs.GetInt("best", 0);

        cam = Camera.main;
        if (cam == null) cam = new GameObject("Main Camera") { tag = "MainCamera" }.AddComponent<Camera>();
        cam.orthographic = true;
        cam.orthographicSize = HalfHeight;
        cam.transform.position = new Vector3(0, 0, -10);
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.08f, 0.10f, 0.20f);

        player = MakeCube("Player", new Vector3(2.2f, 0.5f, 1f), new Color(0.2f, 0.9f, 0.6f));
        ResetGame();
    }

    void ResetGame()
    {
        foreach (var b in blocks) Destroy(b.gameObject);
        blocks.Clear();
        player.position = new Vector3(0, PlayerY, 0);
        elapsed = 0;
        spawnTimer = 0;
        gameOver = false;
    }

    void Update()
    {
        halfWidth = HalfHeight * cam.aspect;

        if (gameOver)
        {
            if (Input.GetMouseButtonDown(0)) ResetGame();
            return;
        }

        elapsed += Time.deltaTime;
        float difficulty = 1f + elapsed / 20f;

        // Move toward the finger / mouse, or use arrow keys in the editor.
        Vector3 p = player.position;
        if (Input.GetMouseButton(0))
        {
            float targetX = cam.ScreenToWorldPoint(Input.mousePosition).x;
            p.x = Mathf.MoveTowards(p.x, targetX, PlayerSpeed * Time.deltaTime);
        }
        p.x += Input.GetAxisRaw("Horizontal") * PlayerSpeed * Time.deltaTime;
        float limit = halfWidth - player.localScale.x / 2f;
        p.x = Mathf.Clamp(p.x, -limit, limit);
        player.position = p;

        // Spawn blocks faster as time goes on.
        spawnTimer -= Time.deltaTime;
        if (spawnTimer <= 0)
        {
            spawnTimer = Mathf.Max(0.18f, 0.8f / difficulty);
            float size = Random.Range(0.6f, 1.6f);
            var b = MakeCube("Block", Vector3.one * size, Color.HSVToRGB(Random.value, 0.7f, 1f));
            b.position = new Vector3(Random.Range(-halfWidth + size, halfWidth - size), HalfHeight + size, 0);
            blocks.Add(b);
        }

        // Move blocks, check collisions, remove off-screen ones.
        var pb = new Bounds(player.position, player.localScale);
        float fall = (5f + 2.5f * difficulty) * Time.deltaTime;
        for (int i = blocks.Count - 1; i >= 0; i--)
        {
            var b = blocks[i];
            b.position += Vector3.down * fall;
            b.Rotate(0, 0, 90f * Time.deltaTime);
            if (pb.Intersects(new Bounds(b.position, b.localScale * 0.9f)))
            {
                GameOver();
                return;
            }
            if (b.position.y < -HalfHeight - 2f)
            {
                Destroy(b.gameObject);
                blocks.RemoveAt(i);
            }
        }
    }

    void GameOver()
    {
        gameOver = true;
        int score = Score;
        if (score > best)
        {
            best = score;
            PlayerPrefs.SetInt("best", best);
            PlayerPrefs.Save();
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        Handheld.Vibrate();
#endif
    }

    int Score => Mathf.FloorToInt(elapsed * 10f);

    static Transform MakeCube(string name, Vector3 scale, Color color)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        Destroy(go.GetComponent<Collider>());
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().material.color = color;
        return go.transform;
    }

    void OnGUI()
    {
        if (bigStyle == null)
        {
            bigStyle = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
            smallStyle = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.UpperCenter };
        }
        int unit = Mathf.Max(12, Screen.height / 30);
        bigStyle.fontSize = unit * 2;
        smallStyle.fontSize = unit;
        bigStyle.normal.textColor = smallStyle.normal.textColor = Color.white;

        GUI.Label(new Rect(0, unit, Screen.width, unit * 2), $"Score {Score}    Best {best}", smallStyle);
        if (gameOver)
        {
            GUI.Label(new Rect(0, Screen.height / 2f - unit * 3, Screen.width, unit * 3), "GAME OVER", bigStyle);
            GUI.Label(new Rect(0, Screen.height / 2f + unit, Screen.width, unit * 2), "Tap to play again", smallStyle);
        }
    }
}
