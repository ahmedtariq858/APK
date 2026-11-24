package com.universal.irremote.data

object Templates {

    private val numbers = (1..9).map { it.toString() }

    private fun labels(type: RemoteType): List<String> = when (type) {
        RemoteType.TV -> listOf(
            "Power", "Input", "Mute",
            "Vol +", "▲", "Ch +",
            "◀", "OK", "▶",
            "Vol −", "▼", "Ch −",
            "Menu", "Home", "Back",
        ) + numbers + listOf("Info", "0", "Exit")

        RemoteType.SET_TOP_BOX -> listOf(
            "Power", "Mute", "Guide",
            "Vol +", "▲", "Ch +",
            "◀", "OK", "▶",
            "Vol −", "▼", "Ch −",
            "Menu", "Info", "Back",
        ) + numbers + listOf("Fav", "0", "Exit", "⏪", "⏯", "⏩", "Red", "Green", "Yellow")

        RemoteType.AC -> listOf(
            "Power", "Mode", "Fan speed",
            "Temp +", "Swing", "Turbo",
            "Temp −", "Timer", "Sleep",
            "Cool", "Heat", "Dry",
        )

        RemoteType.FAN -> listOf(
            "Power", "Speed", "Oscillate",
            "Timer", "Mode", "Light",
        )

        RemoteType.AUDIO -> listOf(
            "Power", "Input", "Mute",
            "Vol +", "Bass +", "Treble +",
            "Vol −", "Bass −", "Treble −",
            "⏮", "⏯", "⏭",
            "Bluetooth", "Sound mode", "Night",
        )

        RemoteType.PROJECTOR -> listOf(
            "Power", "Source", "Blank",
            "Menu", "▲", "Back",
            "◀", "OK", "▶",
            "Zoom +", "▼", "Zoom −",
            "Vol +", "Vol −", "Keystone",
        )

        RemoteType.CUSTOM -> emptyList()
    }

    fun create(name: String, type: RemoteType): Remote =
        Remote(name = name, type = type, columns = 3, buttons = labels(type).map { RemoteButton(label = it) })
}
