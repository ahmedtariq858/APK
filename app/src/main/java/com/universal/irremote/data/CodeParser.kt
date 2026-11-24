package com.universal.irremote.data

import com.universal.irremote.ir.IrEncoder
import com.universal.irremote.ir.IrEncodeException
import com.universal.irremote.ir.IrProtocol

/**
 * Parses many codes at once (one per line), so 20+ codes can be pasted into a button quickly.
 *
 * Accepted line formats (anything after `#` becomes the note):
 *   NEC 0x20DF10EF                 protocol + full code
 *   NEC 04 08                      protocol + address + command
 *   SAMSUNG E0E040BF   # Samsung   with a note
 *   0x20DF10EF                     uses the default protocol
 *   PRONTO 0000 006D 0022 ...      Pronto hex
 *   RAW 38000 9000 4500 560 ...    frequency + timings
 *   RAW 9000 4500 560 ...          timings at 38 kHz
 */
object CodeParser {

    data class Result(val codes: List<IrCode>, val errors: List<String>)

    fun parse(text: String, defaultProtocol: IrProtocol): Result {
        val codes = ArrayList<IrCode>()
        val errors = ArrayList<String>()
        text.lines().forEachIndexed { index, rawLine ->
            val noteIdx = rawLine.indexOf('#')
            val note = if (noteIdx >= 0) rawLine.substring(noteIdx + 1).trim() else ""
            val line = (if (noteIdx >= 0) rawLine.substring(0, noteIdx) else rawLine)
                .replace(",", " ").replace(";", " ").trim()
            if (line.isEmpty()) return@forEachIndexed
            try {
                val code = parseLine(line, defaultProtocol).copy(note = note)
                IrEncoder.encode(code.protocol, code.address, code.code) // validate
                codes += code
            } catch (e: IrEncodeException) {
                errors += "Line ${index + 1}: ${e.message}"
            }
        }
        return Result(codes, errors)
    }

    private fun parseLine(line: String, defaultProtocol: IrProtocol): IrCode {
        val tokens = line.split(Regex("\\s+"))
        val first = tokens.first()
        val explicit = IrProtocol.fromToken(first)
        val looksLikePronto = explicit == null && tokens.size >= 6 && first == "0000"
        val protocol = explicit ?: if (looksLikePronto) IrProtocol.PRONTO else defaultProtocol
        val args = if (explicit != null) tokens.drop(1) else tokens
        if (args.isEmpty()) throw IrEncodeException("no code after ${protocol.displayName}")

        return when (protocol) {
            IrProtocol.PRONTO -> IrCode(protocol = protocol, code = args.joinToString(" "))
            IrProtocol.RAW -> {
                val f = args.first().toIntOrNull()
                if (f != null && f >= 15_000 && args.size > 1) {
                    IrCode(protocol = protocol, address = f.toString(), code = args.drop(1).joinToString(" "))
                } else {
                    IrCode(protocol = protocol, code = args.joinToString(" "))
                }
            }
            else -> when (args.size) {
                1 -> IrCode(protocol = protocol, code = args[0])
                2 -> IrCode(protocol = protocol, address = args[0], code = args[1])
                else -> throw IrEncodeException("expected \"${protocol.name} CODE\" or \"${protocol.name} ADDRESS COMMAND\"")
            }
        }
    }
}
