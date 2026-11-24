package com.universal.irremote.data

import com.universal.irremote.ir.IrProtocol
import org.junit.Assert.assertEquals
import org.junit.Test

class CodeParserTest {

    @Test fun parsesMixedLines() {
        val text = """
            NEC 0x20DF10EF   # LG power
            SAMSUNG 07 02
            0x20DF40BF
            SONY12 A90
            RC5 00 0C
            PRONTO 0000 006D 0002 0000 0157 00AC 0015 0689
            0000 006D 0002 0000 0157 00AC 0015 0689
            RAW 38000 9000 4500 560
            RAW 9000 4500 560

            NEC ZZZ
            BOGUS 1 2 3
        """.trimIndent()
        val r = CodeParser.parse(text, IrProtocol.NEC)
        assertEquals(9, r.codes.size)
        assertEquals(2, r.errors.size)
        assertEquals("LG power", r.codes[0].note)
        assertEquals(IrProtocol.SAMSUNG32, r.codes[1].protocol)
        assertEquals("07", r.codes[1].address)
        assertEquals(IrProtocol.NEC, r.codes[2].protocol)
        assertEquals(IrProtocol.PRONTO, r.codes[6].protocol)
        assertEquals("38000", r.codes[7].address)
        assertEquals("", r.codes[8].address)
    }

    @Test fun twentyFiveCodesInOneButton() {
        val text = (0 until 25).joinToString("\n") { "NEC 04 %02X".format(it) }
        val r = CodeParser.parse(text, IrProtocol.NEC)
        assertEquals(25, r.codes.size)
        assertEquals(0, r.errors.size)
    }
}
