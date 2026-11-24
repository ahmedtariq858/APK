package com.universal.irremote.data

import android.content.Context
import android.util.Log
import com.universal.irremote.ir.IrProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Stores all remotes in a single JSON file in the app's private storage. */
class RemoteRepository(context: Context) {

    private val file = File(context.filesDir, "remotes.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val saveSignal = Channel<Unit>(Channel.CONFLATED)

    private val _remotes = MutableStateFlow(load())
    val remotes: StateFlow<List<Remote>> = _remotes.asStateFlow()

    init {
        scope.launch {
            for (ignored in saveSignal) save(_remotes.value)
        }
    }

    fun update(transform: (List<Remote>) -> List<Remote>) {
        _remotes.update(transform)
        saveSignal.trySend(Unit)
    }

    fun updateRemote(remoteId: String, transform: (Remote) -> Remote) =
        update { list -> list.map { if (it.id == remoteId) transform(it) else it } }

    fun updateButton(remoteId: String, buttonId: String, transform: (RemoteButton) -> RemoteButton) =
        updateRemote(remoteId) { r -> r.copy(buttons = r.buttons.map { if (it.id == buttonId) transform(it) else it }) }

    // ---------------------------------------------------------------- backup

    fun exportJson(): String = Serializer.toJson(_remotes.value).toString(2)

    /** Adds the remotes from a backup (with new ids so nothing is overwritten). Returns how many were added. */
    fun importJson(text: String): Int {
        val imported = Serializer.fromJson(text).map { Serializer.withNewIds(it) }
        update { it + imported }
        return imported.size
    }

    // ---------------------------------------------------------------- file io

    private fun load(): List<Remote> = try {
        if (file.exists()) Serializer.fromJson(file.readText()) else emptyList()
    } catch (e: Exception) {
        Log.e(TAG, "Could not read remotes", e)
        file.copyTo(File(file.parentFile, "remotes.corrupt.json"), overwrite = true)
        emptyList()
    }

    private fun save(remotes: List<Remote>) {
        try {
            val tmp = File(file.parentFile, "remotes.json.tmp")
            tmp.writeText(Serializer.toJson(remotes).toString())
            if (!tmp.renameTo(file)) {
                file.writeText(tmp.readText()); tmp.delete()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not save remotes", e)
        }
    }

    companion object { private const val TAG = "RemoteRepository" }
}

object Serializer {
    private const val VERSION = 1

    fun toJson(remotes: List<Remote>): JSONObject = JSONObject().apply {
        put("app", "IR Universal Remote")
        put("version", VERSION)
        put("remotes", JSONArray().apply { remotes.forEach { put(remote(it)) } })
    }

    fun fromJson(text: String): List<Remote> {
        val root = JSONObject(text)
        val arr = root.optJSONArray("remotes") ?: throw IllegalArgumentException("Not a remote backup file")
        return (0 until arr.length()).map { remote(arr.getJSONObject(it)) }
    }

    fun withNewIds(r: Remote): Remote = r.copy(
        id = newId(),
        buttons = r.buttons.map { b -> b.copy(id = newId(), codes = b.codes.map { it.copy(id = newId()) }) },
    )

    private fun remote(r: Remote) = JSONObject().apply {
        put("id", r.id); put("name", r.name); put("type", r.type.name); put("columns", r.columns)
        put("buttons", JSONArray().apply { r.buttons.forEach { put(button(it)) } })
    }

    private fun button(b: RemoteButton) = JSONObject().apply {
        put("id", b.id); put("label", b.label); put("mode", b.mode.name)
        put("delayMs", b.delayMs); put("repeat", b.repeat); put("cycleIndex", b.cycleIndex)
        put("codes", JSONArray().apply { b.codes.forEach { put(code(it)) } })
    }

    private fun code(c: IrCode) = JSONObject().apply {
        put("id", c.id); put("protocol", c.protocol.name); put("address", c.address)
        put("code", c.code); put("note", c.note)
    }

    private fun remote(o: JSONObject): Remote {
        val buttons = o.optJSONArray("buttons") ?: JSONArray()
        return Remote(
            id = o.optString("id").ifEmpty { newId() },
            name = o.optString("name", "Remote"),
            type = enumOr(o.optString("type"), RemoteType.CUSTOM),
            columns = o.optInt("columns", 3).coerceIn(1, 6),
            buttons = (0 until buttons.length()).map { button(buttons.getJSONObject(it)) },
        )
    }

    private fun button(o: JSONObject): RemoteButton {
        val codes = o.optJSONArray("codes") ?: JSONArray()
        return RemoteButton(
            id = o.optString("id").ifEmpty { newId() },
            label = o.optString("label", "?"),
            mode = enumOr(o.optString("mode"), SendMode.SEND_ALL),
            delayMs = o.optInt("delayMs", 250).coerceIn(0, 10_000),
            repeat = o.optInt("repeat", 1).coerceIn(1, 20),
            cycleIndex = o.optInt("cycleIndex", 0).coerceAtLeast(0),
            codes = (0 until codes.length()).mapNotNull { i ->
                val c = codes.getJSONObject(i)
                val protocol = IrProtocol.entries.firstOrNull { it.name == c.optString("protocol") }
                    ?: IrProtocol.fromToken(c.optString("protocol")) ?: return@mapNotNull null
                IrCode(
                    id = c.optString("id").ifEmpty { newId() },
                    protocol = protocol,
                    address = c.optString("address"),
                    code = c.optString("code"),
                    note = c.optString("note"),
                )
            },
        )
    }

    private inline fun <reified T : Enum<T>> enumOr(name: String, default: T): T =
        enumValues<T>().firstOrNull { it.name == name } ?: default
}
