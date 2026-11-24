package com.universal.irremote.ir

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IrEncoderTest {

    /** Decodes a pulse-distance frame back to its bits (MSB-first order of transmission). */
    private fun decodePulseDistance(pattern: IntArray, nbits: Int, threshold: Int): Long {
        var v = 0L
        for (i in 0 until nbits) {
            val space = pattern[3 + 2 * i]
            v = (v shl 1) or (if (space > threshold) 1L else 0L)
        }
        return v
    }

    @Test fun necFullCode() {
        val s = IrEncoder.encode(IrProtocol.NEC, "", "0x20DF10EF")
        assertEquals(38000, s.frequency)
        assertEquals(9000, s.pattern[0]); assertEquals(4500, s.pattern[1])
        assertEquals(2 + 64 + 1, s.pattern.size)
        assertEquals(0x20DF10EFL, decodePulseDistance(s.pattern, 32, 1000))
    }

    @Test fun necAddressCommandMatchesFullCode() {
        // address 0x04, command 0x08 => bytes 04 FB 08 F7 sent LSB first => MSB value 0x20DF10EF
        val a = IrEncoder.encode(IrProtocol.NEC, "04", "08")
        val b = IrEncoder.encode(IrProtocol.NEC, "", "20DF10EF")
        assertArrayEquals(b.pattern, a.pattern)
    }

    @Test fun samsungAddressCommandMatchesFullCode() {
        val a = IrEncoder.encode(IrProtocol.SAMSUNG32, "07", "02")
        val b = IrEncoder.encode(IrProtocol.SAMSUNG32, "", "0xE0E040BF")
        assertArrayEquals(b.pattern, a.pattern)
        assertEquals(4500, a.pattern[0])
    }

    @Test fun sonyAddressCommandMatchesFullCode_and3Frames() {
        val a = IrEncoder.encode(IrProtocol.SONY12, "1", "15")
        val b = IrEncoder.encode(IrProtocol.SONY12, "", "A90")
        assertArrayEquals(b.pattern, a.pattern)
        assertEquals(40000, a.frequency)
        assertEquals(3, a.pattern.count { it == 2400 })
    }

    @Test fun jvcAddressCommandMatchesFullCode() {
        val a = IrEncoder.encode(IrProtocol.JVC, "A3", "17")
        val b = IrEncoder.encode(IrProtocol.JVC, "", "C5E8")
        assertArrayEquals(b.pattern, a.pattern)
    }

    @Test fun panasonicAddressFunctionMatchesFullCode() {
        val a = IrEncoder.encode(IrProtocol.PANASONIC, "8000", "3D")
        val b = IrEncoder.encode(IrProtocol.PANASONIC, "", "40040100BCBD")
        assertArrayEquals(b.pattern, a.pattern)
    }

    @Test fun lgChecksum() {
        val a = IrEncoder.encode(IrProtocol.LG, "88", "C005")
        val b = IrEncoder.encode(IrProtocol.LG, "", "88C0051")
        assertArrayEquals(b.pattern, a.pattern)
    }

    @Test fun rc5ManchesterAndToggle() {
        val a = IrEncoder.encode(IrProtocol.RC5, "0", "0C")
        val b = IrEncoder.encode(IrProtocol.RC5, "", "00C")
        assertArrayEquals(b.pattern, a.pattern)
        assertEquals(36000, a.frequency)
        a.pattern.forEach { assertTrue(it == 889 || it == 1778) }
        val t = IrEncoder.encode(IrProtocol.RC5, "0", "0C", toggle = true)
        assertTrue(!t.pattern.contentEquals(a.pattern))
    }

    @Test fun rc6AddressCommandMatchesFullCode() {
        val a = IrEncoder.encode(IrProtocol.RC6, "0", "0C")
        val b = IrEncoder.encode(IrProtocol.RC6, "", "0C")
        assertArrayEquals(b.pattern, a.pattern)
        assertEquals(2664, a.pattern[0])
    }

    @Test fun prontoParsing() {
        val pronto = "0000 006D 0002 0000 0157 00AC 0015 0689"
        val s = IrEncoder.encode(IrProtocol.PRONTO, "", pronto)
        assertNear(38029, s.frequency, 100)
        assertEquals(3, s.pattern.size) // trailing space dropped
        assertNear((0x157 * 0x6D * 0.241246).toInt(), s.pattern[0], 2)
    }

    @Test fun rawParsing() {
        val s = IrEncoder.encode(IrProtocol.RAW, "40000", "+2400 -600 1200, 600 600")
        assertEquals(40000, s.frequency)
        assertArrayEquals(intArrayOf(2400, 600, 1200, 600, 600), s.pattern)
    }

    @Test fun repeatAddsFrames() {
        val s = IrEncoder.encode(IrProtocol.NEC, "", "20DF10EF", repeat = 3)
        assertEquals(3, s.pattern.count { it == 9000 })
    }

    @Test(expected = IrEncodeException::class) fun invalidHexThrows() {
        IrEncoder.encode(IrProtocol.NEC, "", "XYZ")
    }

    @Test(expected = IrEncodeException::class) fun tooManyBitsThrows() {
        IrEncoder.encode(IrProtocol.SONY12, "", "1FFF")
    }

    private fun assertNear(expected: Int, actual: Int, tolerance: Int) {
        assertTrue("expected $expected ± $tolerance but was $actual", kotlin.math.abs(expected - actual) <= tolerance)
    }
}
