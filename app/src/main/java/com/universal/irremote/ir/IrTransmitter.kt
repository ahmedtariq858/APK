package com.universal.irremote.ir

import android.content.Context
import android.hardware.ConsumerIrManager

/** Thin wrapper around Android's built-in IR blaster API. */
class IrTransmitter(context: Context) {

    private val manager: ConsumerIrManager? =
        context.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager

    val hasIrBlaster: Boolean
        get() = try { manager?.hasIrEmitter() == true } catch (e: Exception) { false }

    /** Human readable carrier frequency ranges supported by the phone, if reported. */
    fun frequencyRanges(): String = try {
        manager?.carrierFrequencies?.joinToString { "${it.minFrequency / 1000}–${it.maxFrequency / 1000} kHz" }
            ?.ifEmpty { null } ?: "unknown"
    } catch (e: Exception) { "unknown" }

    /** Blocks until the signal has been sent. Must be called off the main thread. */
    fun transmit(signal: IrSignal) {
        val ir = manager ?: throw IllegalStateException("This phone has no IR blaster")
        if (!ir.hasIrEmitter()) throw IllegalStateException("This phone has no IR blaster")
        ir.transmit(signal.frequency, signal.pattern)
    }
}
