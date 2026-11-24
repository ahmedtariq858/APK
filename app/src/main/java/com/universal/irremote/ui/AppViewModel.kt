package com.universal.irremote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.universal.irremote.IrApp
import com.universal.irremote.data.IrCode
import com.universal.irremote.data.Remote
import com.universal.irremote.data.RemoteButton
import com.universal.irremote.data.RemoteType
import com.universal.irremote.data.SendMode
import com.universal.irremote.data.Serializer
import com.universal.irremote.data.Templates
import com.universal.irremote.ir.IrEncoder
import com.universal.irremote.ir.IrProtocol
import com.universal.irremote.ir.IrTransmitter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

sealed interface Screen {
    data object Home : Screen
    data class RemoteView(val remoteId: String) : Screen
    data class ButtonEditor(val remoteId: String, val buttonId: String) : Screen
}

data class SendStatus(
    val title: String,
    val sent: Int,
    val total: Int,
    val failed: Int = 0,
    val running: Boolean = true,
    val message: String? = null,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = (app as IrApp).repository
    private val transmitter = IrTransmitter(app)

    val remotes: StateFlow<List<Remote>> = repo.remotes
    val hasIrBlaster: Boolean = transmitter.hasIrBlaster
    val frequencyRanges: String = transmitter.frequencyRanges()

    // ------------------------------------------------------------- navigation

    private val _backStack = MutableStateFlow<List<Screen>>(listOf(Screen.Home))
    val backStack: StateFlow<List<Screen>> = _backStack.asStateFlow()

    fun navigate(screen: Screen) { _backStack.value = _backStack.value + screen }
    fun back(): Boolean {
        val s = _backStack.value
        if (s.size <= 1) return false
        _backStack.value = s.dropLast(1)
        return true
    }

    // ------------------------------------------------------------- remotes

    fun createRemote(name: String, type: RemoteType): String {
        val remote = Templates.create(name.ifBlank { type.title }, type)
        repo.update { it + remote }
        return remote.id
    }

    fun renameRemote(id: String, name: String) = repo.updateRemote(id) { it.copy(name = name) }
    fun setColumns(id: String, columns: Int) = repo.updateRemote(id) { it.copy(columns = columns.coerceIn(1, 6)) }
    fun deleteRemote(id: String) = repo.update { list -> list.filterNot { it.id == id } }
    fun duplicateRemote(id: String) = repo.update { list ->
        val r = list.firstOrNull { it.id == id } ?: return@update list
        list + Serializer.withNewIds(r).copy(name = r.name + " (copy)")
    }

    fun moveRemote(id: String, delta: Int) = repo.update { list -> list.moved(list.indexOfFirst { it.id == id }, delta) }

    // ------------------------------------------------------------- buttons

    fun addButton(remoteId: String, label: String): String {
        val b = RemoteButton(label = label.ifBlank { "Button" })
        repo.updateRemote(remoteId) { it.copy(buttons = it.buttons + b) }
        return b.id
    }

    fun updateButton(remoteId: String, buttonId: String, transform: (RemoteButton) -> RemoteButton) =
        repo.updateButton(remoteId, buttonId, transform)

    fun deleteButton(remoteId: String, buttonId: String) =
        repo.updateRemote(remoteId) { r -> r.copy(buttons = r.buttons.filterNot { it.id == buttonId }) }

    fun duplicateButton(remoteId: String, buttonId: String) = repo.updateRemote(remoteId) { r ->
        val i = r.buttons.indexOfFirst { it.id == buttonId }
        if (i < 0) return@updateRemote r
        val src = r.buttons[i]
        val copy = src.copy(id = com.universal.irremote.data.newId(), label = src.label + " copy",
            codes = src.codes.map { it.copy(id = com.universal.irremote.data.newId()) })
        r.copy(buttons = r.buttons.toMutableList().apply { add(i + 1, copy) })
    }

    fun moveButton(remoteId: String, buttonId: String, delta: Int) = repo.updateRemote(remoteId) { r ->
        r.copy(buttons = r.buttons.moved(r.buttons.indexOfFirst { it.id == buttonId }, delta))
    }

    // ------------------------------------------------------------- codes

    fun addCodes(remoteId: String, buttonId: String, codes: List<IrCode>) =
        updateButton(remoteId, buttonId) { it.copy(codes = it.codes + codes) }

    fun replaceCode(remoteId: String, buttonId: String, code: IrCode) =
        updateButton(remoteId, buttonId) { b -> b.copy(codes = b.codes.map { if (it.id == code.id) code else it }) }

    fun deleteCode(remoteId: String, buttonId: String, codeId: String) =
        updateButton(remoteId, buttonId) { b -> b.copy(codes = b.codes.filterNot { it.id == codeId }, cycleIndex = 0) }

    fun moveCode(remoteId: String, buttonId: String, codeId: String, delta: Int) =
        updateButton(remoteId, buttonId) { b -> b.copy(codes = b.codes.moved(b.codes.indexOfFirst { it.id == codeId }, delta)) }

    fun clearCodes(remoteId: String, buttonId: String) =
        updateButton(remoteId, buttonId) { it.copy(codes = emptyList(), cycleIndex = 0) }

    // ------------------------------------------------------------- sending

    private val _status = MutableStateFlow<SendStatus?>(null)
    val status: StateFlow<SendStatus?> = _status.asStateFlow()
    private var sendJob: Job? = null
    private val toggles = HashMap<IrProtocol, Boolean>()

    fun press(remoteId: String, button: RemoteButton) {
        if (button.codes.isEmpty()) {
            showMessage(button.label, "No IR codes yet. Long-press or use Edit to add codes.")
            return
        }
        when (button.mode) {
            SendMode.SEND_ALL -> send(button.label, button.codes, button.repeat, button.delayMs)
            SendMode.CYCLE -> {
                val index = button.cycleIndex % button.codes.size
                send("${button.label} · code ${index + 1}/${button.codes.size}", listOf(button.codes[index]), button.repeat, 0)
                updateButton(remoteId, button.id) { it.copy(cycleIndex = (index + 1) % it.codes.size.coerceAtLeast(1)) }
            }
        }
    }

    fun setCycleIndex(remoteId: String, buttonId: String, index: Int) =
        updateButton(remoteId, buttonId) { it.copy(cycleIndex = index.coerceAtLeast(0)) }

    fun testCode(code: IrCode, repeat: Int) = send("Test: ${code.protocol.displayName}", listOf(code), repeat, 0)

    fun stopSending() {
        sendJob?.cancel()
        _status.value = _status.value?.copy(running = false, message = "Stopped")
    }

    fun dismissStatus() { if (_status.value?.running != true) _status.value = null }

    private fun showMessage(title: String, message: String) {
        _status.value = SendStatus(title, 0, 0, running = false, message = message)
    }

    private fun send(title: String, codes: List<IrCode>, repeat: Int, delayMs: Int) {
        sendJob?.cancel()
        if (!transmitter.hasIrBlaster) {
            showMessage(title, "This phone has no IR blaster, so nothing can be sent.")
            return
        }
        sendJob = viewModelScope.launch(Dispatchers.IO) {
            var sent = 0
            var failed = 0
            var lastError: String? = null
            _status.value = SendStatus(title, 0, codes.size)
            for ((i, code) in codes.withIndex()) {
                if (!isActive) return@launch
                try {
                    val toggle = toggles[code.protocol] ?: false
                    val signal = IrEncoder.encode(code.protocol, code.address, code.code, repeat, toggle)
                    transmitter.transmit(signal)
                    sent++
                } catch (e: Exception) {
                    failed++
                    lastError = "Code ${i + 1}: ${e.message ?: e.javaClass.simpleName}"
                }
                _status.value = SendStatus(title, sent, codes.size, failed, running = i < codes.size - 1, message = lastError)
                if (i < codes.size - 1 && delayMs > 0) delay(delayMs.toLong())
            }
            codes.map { it.protocol }.distinct().forEach { toggles[it] = !(toggles[it] ?: false) }
            if (failed == 0) {
                delay(1500)
                if (_status.value?.running == false && _status.value?.title == title) _status.value = null
            }
        }
    }

    // ------------------------------------------------------------- backup

    fun exportJson(): String = repo.exportJson()

    fun importJson(text: String): Result<Int> = runCatching { repo.importJson(text) }
}

private fun <T> List<T>.moved(index: Int, delta: Int): List<T> {
    val target = index + delta
    if (index !in indices || target !in indices) return this
    return toMutableList().apply { add(target, removeAt(index)) }
}
