package com.universal.irremote.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.universal.irremote.data.CodeParser
import com.universal.irremote.data.IrCode
import com.universal.irremote.ir.IrEncoder
import com.universal.irremote.ir.IrProtocol

/** Add or edit a single IR code. */
@Composable
fun CodeEditorDialog(
    initial: IrCode?,
    onTest: (IrCode) -> Unit,
    onSave: (IrCode) -> Unit,
    onDismiss: () -> Unit,
) {
    var protocol by remember { mutableStateOf(initial?.protocol ?: IrProtocol.NEC) }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var code by remember { mutableStateOf(initial?.code ?: "") }
    var note by remember { mutableStateOf(initial?.note ?: "") }

    val current = (initial ?: IrCode()).copy(
        protocol = protocol,
        address = if (protocol == IrProtocol.PRONTO) "" else address.trim(),
        code = code.trim(),
        note = note.trim(),
    )
    val check: Result<String> = remember(protocol, address, code) {
        runCatching {
            val s = IrEncoder.encode(current.protocol, current.address, current.code)
            "Valid · ${"%.1f".format(s.frequency / 1000.0)} kHz · ${s.pattern.size} pulses · ${s.durationMicros / 1000} ms"
        }
    }
    val multiline = protocol == IrProtocol.PRONTO || protocol == IrProtocol.RAW

    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.padding(16.dp),
        title = { Text(if (initial == null) "Add IR code" else "Edit IR code") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ProtocolPicker(protocol, { protocol = it }, Modifier.fillMaxWidth())
                Text(protocol.hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (protocol != IrProtocol.PRONTO) {
                    OutlinedTextField(
                        value = address, onValueChange = { address = it },
                        label = { Text(protocol.addressLabel) }, singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = code, onValueChange = { code = it },
                    label = { Text(protocol.codeLabel) },
                    singleLine = !multiline,
                    minLines = if (multiline) 3 else 1,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("Note (optional, e.g. brand / model)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (code.isNotBlank()) {
                    Text(
                        check.fold({ it }, { it.message ?: "Invalid code" }),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (check.isSuccess) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = { onTest(current) }, enabled = check.isSuccess) { Text("Test") }
                TextButton(onClick = { onSave(current); onDismiss() }, enabled = check.isSuccess) { Text("Save") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Paste many codes at once, one per line. */
@Composable
fun BulkAddDialog(onAdd: (List<IrCode>) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var defaultProtocol by remember { mutableStateOf(IrProtocol.NEC) }
    val result = remember(text, defaultProtocol) { CodeParser.parse(text, defaultProtocol) }

    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.padding(16.dp),
        title = { Text("Paste many codes") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "One code per line. Start a line with the protocol, or it uses the default below.\n" +
                        "Examples:\n" +
                        "  NEC 0x20DF10EF\n" +
                        "  NEC 04 08          (address command)\n" +
                        "  SAMSUNG E0E040BF   # Samsung TV\n" +
                        "  SONY12 A90\n" +
                        "  RC5 00 0C\n" +
                        "  PRONTO 0000 006D 0022 0002 ...\n" +
                        "  RAW 38000 9000 4500 560 560 ...\n" +
                        "Protocols: NEC, NECEXT, SAMSUNG, SONY12, SONY15, SONY20, RC5, RC6, PANASONIC, JVC, LG, PRONTO, RAW",
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ProtocolPicker(defaultProtocol, { defaultProtocol = it }, Modifier.fillMaxWidth())
                OutlinedTextField(
                    value = text, onValueChange = { text = it },
                    label = { Text("Codes") },
                    minLines = 6,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                )
                if (text.isNotBlank()) {
                    Text(
                        "${result.codes.size} code(s) ready" + if (result.errors.isNotEmpty()) ", ${result.errors.size} line(s) with errors" else "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    result.errors.take(8).forEach {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    if (result.errors.size > 8) {
                        Text("…and ${result.errors.size - 8} more", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onAdd(result.codes); onDismiss() },
                enabled = result.codes.isNotEmpty(),
            ) { Text("Add ${result.codes.size}") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
