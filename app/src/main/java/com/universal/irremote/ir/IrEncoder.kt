package com.universal.irremote.ir

import kotlin.math.roundToInt

/** A ready-to-transmit IR signal: carrier frequency + alternating mark/space durations in µs. */
class IrSignal(val frequency: Int, val pattern: IntArray) {
    val durationMicros: Long get() = pattern.fold(0L) { acc, v -> acc + v }
}

class IrEncodeException(message: String) : IllegalArgumentException(message)

/**
 * Converts (protocol, address, code) into raw IR timings.
 * Pure Kotlin, no Android dependencies, so it is unit-testable on the JVM.
 */
object IrEncoder {

    /**
     * @param repeat how many times the frame is sent (min 1). Sony always sends at least 3.
     * @param toggle toggle bit state for RC5 / RC6 (flip it on every key press).
     */
    fun encode(
        protocol: IrProtocol,
        address: String,
        code: String,
        repeat: Int = 1,
        toggle: Boolean = false,
    ): IrSignal {
        val reps = repeat.coerceIn(1, 20)
        val addr = address.trim().takeIf { it.isNotEmpty() }
        return when (protocol) {
            IrProtocol.NEC, IrProtocol.NEC_EXT -> nec(protocol, addr, code, reps)
            IrProtocol.SAMSUNG32 -> samsung(addr, code, reps)
            IrProtocol.SONY12 -> sony(12, addr, code, reps)
            IrProtocol.SONY15 -> sony(15, addr, code, reps)
            IrProtocol.SONY20 -> sony(20, addr, code, reps)
            IrProtocol.RC5 -> rc5(addr, code, reps, toggle)
            IrProtocol.RC6 -> rc6(addr, code, reps, toggle)
            IrProtocol.PANASONIC -> panasonic(addr, code, reps)
            IrProtocol.JVC -> jvc(addr, code, reps)
            IrProtocol.LG -> lg(addr, code, reps)
            IrProtocol.PRONTO -> pronto(code, reps)
            IrProtocol.RAW -> raw(addr, code, reps)
        }
    }

    // ------------------------------------------------------------------ helpers

    /** Parses "0x20DF10EF", "20DF10EF", "20 DF 10 EF", "0x20_DF" (big-endian). */
    fun parseHex(text: String, what: String = "code"): Long {
        var s = text.trim().replace(" ", "").replace("_", "").replace("-", "").replace(":", "")
        if (s.startsWith("0x", ignoreCase = true)) s = s.substring(2)
        if (s.endsWith("h", ignoreCase = true)) s = s.dropLast(1)
        if (s.isEmpty()) throw IrEncodeException("The $what is empty")
        if (s.length > 15) throw IrEncodeException("The $what is too long")
        return s.toLongOrNull(16) ?: throw IrEncodeException("The $what \"$text\" is not valid hex")
    }

    private fun requireBits(value: Long, bits: Int, what: String) {
        if (value < 0 || (bits < 63 && value >= (1L shl bits))) {
            throw IrEncodeException("The $what must fit in $bits bits (max 0x${((1L shl bits) - 1).toString(16).uppercase()})")
        }
    }

    private fun msb(value: Long, bits: Int): List<Boolean> = (bits - 1 downTo 0).map { (value shr it) and 1L == 1L }
    private fun lsb(value: Long, bits: Int): List<Boolean> = (0 until bits).map { (value shr it) and 1L == 1L }

    private class Pattern {
        private val list = ArrayList<Int>()
        val duration: Int get() = list.sum()
        fun mark(us: Int) {
            if (us <= 0) return
            if (list.size % 2 == 1) list[list.size - 1] += us else list.add(us)
        }
        fun space(us: Int) {
            if (us <= 0 || list.isEmpty()) return
            if (list.size % 2 == 0) list[list.size - 1] += us else list.add(us)
        }
        fun append(other: IntArray) {
            other.forEachIndexed { i, v -> if (i % 2 == 0) mark(v) else space(v) }
        }
        fun build(): IntArray {
            val out = if (list.size % 2 == 0 && list.isNotEmpty()) list.dropLast(1) else list
            if (out.isEmpty()) throw IrEncodeException("The signal is empty")
            return out.toIntArray()
        }
    }

    private fun pulseDistance(
        p: Pattern, hdrMark: Int, hdrSpace: Int, bitMark: Int, zero: Int, one: Int,
        bits: List<Boolean>, stopMark: Boolean = true,
    ) {
        p.mark(hdrMark); p.space(hdrSpace)
        for (b in bits) { p.mark(bitMark); p.space(if (b) one else zero) }
        if (stopMark) p.mark(bitMark)
    }

    /** Repeats a frame `reps` times, padding each frame to `period` µs (or at least `minGap`). */
    private fun repeated(freq: Int, reps: Int, period: Int, minGap: Int, frame: (Pattern) -> Unit): IrSignal {
        val p = Pattern()
        repeat(reps) { i ->
            val start = p.duration
            frame(p)
            if (i < reps - 1) {
                val used = p.duration - start
                p.space(maxOf(period - used, minGap))
            }
        }
        return IrSignal(freq, p.build())
    }

    // ------------------------------------------------------------------ protocols

    private fun nec(protocol: IrProtocol, addr: String?, code: String, reps: Int): IrSignal {
        val bits: List<Boolean> = if (addr == null) {
            val v = parseHex(code); requireBits(v, 32, "NEC code"); msb(v, 32)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(c, 8, "command")
            if (protocol == IrProtocol.NEC_EXT || a > 0xFF) {
                requireBits(a, 16, "address")
                lsb(a, 16) + lsb(c, 8) + lsb(c.inv() and 0xFF, 8)
            } else {
                lsb(a, 8) + lsb(a.inv() and 0xFF, 8) + lsb(c, 8) + lsb(c.inv() and 0xFF, 8)
            }
        }
        return repeated(38000, reps, 108_000, 20_000) { pulseDistance(it, 9000, 4500, 560, 560, 1690, bits) }
    }

    private fun samsung(addr: String?, code: String, reps: Int): IrSignal {
        val bits: List<Boolean> = if (addr == null) {
            val v = parseHex(code); requireBits(v, 32, "Samsung code"); msb(v, 32)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(a, 8, "address"); requireBits(c, 8, "command")
            lsb(a, 8) + lsb(a, 8) + lsb(c, 8) + lsb(c.inv() and 0xFF, 8)
        }
        return repeated(38000, reps, 108_000, 20_000) { pulseDistance(it, 4500, 4500, 560, 560, 1690, bits) }
    }

    private fun sony(nbits: Int, addr: String?, code: String, reps: Int): IrSignal {
        val bits: List<Boolean> = if (addr == null) {
            val v = parseHex(code); requireBits(v, nbits, "Sony code"); msb(v, nbits)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(c, 7, "command"); requireBits(a, nbits - 7, "address")
            lsb(c, 7) + lsb(a, nbits - 7)
        }
        val frames = maxOf(3, reps)
        return repeated(40000, frames, 45_000, 10_000) { p ->
            p.mark(2400); p.space(600)
            for (b in bits) { p.mark(if (b) 1200 else 600); p.space(600) }
        }
    }

    private fun rc5(addr: String?, code: String, reps: Int, toggle: Boolean): IrSignal {
        // 14 bits: S1, S2 (inverted command bit 6), T, 5 address, 6 command
        val bits: List<Boolean> = if (addr == null) {
            var v = parseHex(code); requireBits(v, 12, "RC5 code")
            if (toggle) v = v xor (1L shl 11)
            listOf(true, true) + msb(v, 12)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(a, 5, "address"); requireBits(c, 7, "command")
            listOf(true, c < 64, toggle) + msb(a, 5) + msb(c and 0x3F, 6)
        }
        val t = 889
        return repeated(36000, reps, 113_778, 20_000) { p ->
            for (b in bits) {
                if (b) { p.space(t); p.mark(t) } else { p.mark(t); p.space(t) }
            }
        }
    }

    private fun rc6(addr: String?, code: String, reps: Int, toggle: Boolean): IrSignal {
        // leader, start bit, 3 mode bits, double-width trailer (toggle), 16 data bits
        val bits: List<Boolean> = if (addr == null) {
            var v = parseHex(code); requireBits(v, 20, "RC6 code")
            if (toggle) v = v xor (1L shl 16)
            msb(v, 20)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(a, 8, "address"); requireBits(c, 8, "command")
            listOf(false, false, false, toggle) + msb(a, 8) + msb(c, 8)
        }
        val t = 444
        return repeated(36000, reps, 107_000, 20_000) { p ->
            p.mark(6 * t); p.space(2 * t)
            p.mark(t); p.space(t) // start bit (1)
            bits.forEachIndexed { i, b ->
                val w = if (i == 3) 2 * t else t
                if (b) { p.mark(w); p.space(w) } else { p.space(w); p.mark(w) }
            }
            p.space(6 * t)
        }
    }

    private fun panasonic(addr: String?, code: String, reps: Int): IrSignal {
        val bits: List<Boolean> = if (addr == null) {
            val v = parseHex(code); requireBits(v, 48, "Panasonic code"); msb(v, 48)
        } else {
            val a = parseHex(addr, "address"); val f = parseHex(code, "function")
            requireBits(a, 16, "address"); requireBits(f, 8, "function")
            val d = (a shr 8) and 0xFF; val s = a and 0xFF
            lsb(0x02, 8) + lsb(0x20, 8) + lsb(d, 8) + lsb(s, 8) + lsb(f, 8) + lsb(d xor s xor f, 8)
        }
        return repeated(37000, reps, 130_000, 74_736) { pulseDistance(it, 3456, 1728, 432, 432, 1296, bits) }
    }

    private fun jvc(addr: String?, code: String, reps: Int): IrSignal {
        val bits: List<Boolean> = if (addr == null) {
            val v = parseHex(code); requireBits(v, 16, "JVC code"); msb(v, 16)
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(a, 8, "address"); requireBits(c, 8, "command")
            lsb(a, 8) + lsb(c, 8)
        }
        // Header only once, then the data block is repeated.
        val p = Pattern()
        p.mark(8400); p.space(4200)
        repeat(reps) { i ->
            for (b in bits) { p.mark(525); p.space(if (b) 1575 else 525) }
            p.mark(525)
            if (i < reps - 1) p.space(23_625)
        }
        return IrSignal(38000, p.build())
    }

    private fun lg(addr: String?, code: String, reps: Int): IrSignal {
        val value: Long = if (addr == null) {
            parseHex(code).also { requireBits(it, 28, "LG code") }
        } else {
            val a = parseHex(addr, "address"); val c = parseHex(code, "command")
            requireBits(a, 8, "address"); requireBits(c, 16, "command")
            val sum = (c and 0xF) + ((c shr 4) and 0xF) + ((c shr 8) and 0xF) + ((c shr 12) and 0xF)
            (a shl 20) or (c shl 4) or (sum and 0xF)
        }
        val bits = msb(value, 28)
        return repeated(38000, reps, 108_000, 20_000) { pulseDistance(it, 8400, 4200, 550, 550, 1600, bits) }
    }

    private fun pronto(code: String, reps: Int): IrSignal {
        val words = code.trim().split(Regex("[\\s,]+")).filter { it.isNotEmpty() }.map {
            it.toIntOrNull(16) ?: throw IrEncodeException("\"$it\" is not a valid Pronto hex word")
        }
        if (words.size < 6) throw IrEncodeException("Pronto code is too short")
        if (words[0] != 0x0000) throw IrEncodeException("Only learned Pronto codes (starting with 0000) are supported")
        if (words[1] == 0) throw IrEncodeException("Pronto frequency word is 0")
        val periodUs = words[1] * 0.241246
        val freq = (1_000_000.0 / periodUs).roundToInt()
        val onceLen = words[2] * 2
        val repLen = words[3] * 2
        if (words.size < 4 + onceLen + repLen) throw IrEncodeException("Pronto code is missing burst pairs")
        fun seq(from: Int, len: Int) = IntArray(len) { maxOf(1, (words[4 + from + it] * periodUs).roundToInt()) }
        val once = seq(0, onceLen)
        val rep = seq(onceLen, repLen)
        val p = Pattern()
        if (once.isNotEmpty()) {
            p.append(once)
            repeat(reps - 1) { if (rep.isNotEmpty()) p.append(rep) else p.append(once) }
        } else {
            repeat(reps) { p.append(rep) }
        }
        return IrSignal(freq, p.build())
    }

    private fun raw(addr: String?, code: String, reps: Int): IrSignal {
        val freq = addr?.let {
            it.filter { ch -> ch.isDigit() }.toIntOrNull()
                ?: throw IrEncodeException("Frequency must be a number in Hz, e.g. 38000")
        } ?: 38000
        if (freq !in 15_000..500_000) throw IrEncodeException("Frequency must be between 15000 and 500000 Hz")
        val timings = code.trim().split(Regex("[\\s,;]+")).filter { it.isNotEmpty() }.map {
            val v = it.trimStart('+', '-').toIntOrNull()
                ?: throw IrEncodeException("\"$it\" is not a valid timing")
            if (v <= 0) throw IrEncodeException("Timings must be greater than 0")
            v
        }.toIntArray()
        if (timings.isEmpty()) throw IrEncodeException("No timings entered")
        val p = Pattern()
        repeat(reps) { i ->
            p.append(timings)
            if (i < reps - 1) p.space(40_000)
        }
        return IrSignal(freq, p.build())
    }
}
