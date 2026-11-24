package com.universal.irremote.ir

/**
 * Supported IR protocols.
 *
 * Every protocol accepts a code in one of two ways:
 *  - "Full code" mode: leave the address empty and type the complete data value in hex
 *    (for example NEC `0x20DF10EF`, Sony `0xA90`). Bits are sent MSB first, the same as
 *    the classic Arduino IRremote / LIRC style codes found on most websites.
 *  - "Address + command" mode: type the device address and the command in hex
 *    (for example NEC address `04`, command `08`, as used in Flipper Zero / IRDB files).
 */
enum class IrProtocol(
    val displayName: String,
    val defaultFrequency: Int,
    val aliases: List<String>,
    val addressLabel: String,
    val codeLabel: String,
    val hint: String,
) {
    NEC(
        "NEC", 38000, listOf("NEC", "NEC1", "NEC32"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 32-bit code like 0x20DF10EF, or address 04 + command 08",
    ),
    NEC_EXT(
        "NEC Extended", 38000, listOf("NECEXT", "NEC_EXT", "NEC-EXT", "NEC42", "NECX"),
        "Address 16-bit (hex, optional)", "Code / command (hex)",
        "Full 32-bit code, or 16-bit address + 8-bit command",
    ),
    SAMSUNG32(
        "Samsung32", 38000, listOf("SAMSUNG", "SAMSUNG32", "SAMSUNG36"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 32-bit code like 0xE0E040BF, or address 07 + command 02",
    ),
    SONY12(
        "Sony SIRC 12-bit", 40000, listOf("SONY", "SONY12", "SIRC", "SIRC12"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 12-bit code like 0xA90, or address 01 + command 15",
    ),
    SONY15(
        "Sony SIRC 15-bit", 40000, listOf("SONY15", "SIRC15"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 15-bit code, or 8-bit address + 7-bit command",
    ),
    SONY20(
        "Sony SIRC 20-bit", 40000, listOf("SONY20", "SIRC20"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 20-bit code, or 13-bit address + 7-bit command",
    ),
    RC5(
        "Philips RC5", 36000, listOf("RC5", "RC-5"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 12-bit code (toggle+addr+cmd), or address 00 + command 0C",
    ),
    RC6(
        "Philips RC6", 36000, listOf("RC6", "RC-6", "RC6-0", "RC6_0"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 20-bit code like 0x0C, or address 00 + command 0C",
    ),
    PANASONIC(
        "Panasonic (Kaseikyo)", 37000, listOf("PANASONIC", "KASEIKYO", "KASEIKYO48"),
        "Device+Subdevice 16-bit (hex, optional)", "Code / function (hex)",
        "Full 48-bit code like 0x40040100BCBD, or address 0x8000 + function 3D",
    ),
    JVC(
        "JVC", 38000, listOf("JVC"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 16-bit code like 0xC5E8, or address A3 + command 17",
    ),
    LG(
        "LG 28-bit", 38000, listOf("LG", "LG28"),
        "Address (hex, optional)", "Code / command (hex)",
        "Full 28-bit code like 0x88C0051, or address 88 + 16-bit command",
    ),
    PRONTO(
        "Pronto Hex", 0, listOf("PRONTO", "PRONTOHEX", "CCF"),
        "(not used)", "Pronto hex words",
        "0000 006D 0022 0002 0157 00AC ...",
    ),
    RAW(
        "Raw timings", 38000, listOf("RAW"),
        "Frequency in Hz (default 38000)", "Timings in µs (mark space mark ...)",
        "9000 4500 560 560 560 1690 ...",
    );

    val usesAddress: Boolean get() = this != PRONTO && this != RAW

    companion object {
        fun fromToken(token: String): IrProtocol? {
            val t = token.trim().uppercase()
            return entries.firstOrNull { it.name == t || t in it.aliases }
        }
    }
}
