package com.universal.irremote.data

import com.universal.irremote.ir.IrProtocol
import java.util.UUID

fun newId(): String = UUID.randomUUID().toString()

/** What happens when a button that holds several IR codes is pressed. */
enum class SendMode(val title: String, val description: String) {
    SEND_ALL("Send all", "Every code is sent one after another"),
    CYCLE("Cycle", "Each press sends the next code in the list"),
}

enum class RemoteType(val title: String) {
    TV("TV"),
    AC("Air conditioner"),
    SET_TOP_BOX("Set-top box"),
    FAN("Fan"),
    AUDIO("Audio / Sound bar"),
    PROJECTOR("Projector"),
    CUSTOM("Custom (empty)"),
}

data class IrCode(
    val id: String = newId(),
    val protocol: IrProtocol = IrProtocol.NEC,
    val address: String = "",
    val code: String = "",
    val note: String = "",
) {
    fun summary(): String = buildString {
        append(protocol.displayName)
        if (protocol.usesAddress && address.isNotBlank()) append("  addr ").append(address)
        append("  ")
        append(if (code.length > 40) code.take(40) + "…" else code)
    }
}

data class RemoteButton(
    val id: String = newId(),
    val label: String,
    val codes: List<IrCode> = emptyList(),
    val mode: SendMode = SendMode.SEND_ALL,
    /** Pause between codes when sending several codes (ms). */
    val delayMs: Int = 250,
    /** How many times each code's frame is transmitted. */
    val repeat: Int = 1,
    /** Next code to send in CYCLE mode. */
    val cycleIndex: Int = 0,
)

data class Remote(
    val id: String = newId(),
    val name: String,
    val type: RemoteType = RemoteType.CUSTOM,
    val columns: Int = 3,
    val buttons: List<RemoteButton> = emptyList(),
)
