package com.universal.irremote.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.universal.irremote.data.IrCode
import com.universal.irremote.data.Remote
import com.universal.irremote.data.RemoteButton
import com.universal.irremote.data.SendMode
import com.universal.irremote.ui.AppViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ButtonEditorScreen(vm: AppViewModel, remote: Remote, button: RemoteButton) {
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<IrCode?>(null) }
    var adding by remember { mutableStateOf(false) }
    var bulk by remember { mutableStateOf(false) }

    val rid = remote.id
    val bid = button.id
    val nextIndex = if (button.codes.isEmpty()) -1 else button.cycleIndex % button.codes.size

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Edit \"${button.label}\"", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Menu") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Move button earlier") }, onClick = { menu = false; vm.moveButton(rid, bid, -1) })
                        DropdownMenuItem(text = { Text("Move button later") }, onClick = { menu = false; vm.moveButton(rid, bid, 1) })
                        DropdownMenuItem(text = { Text("Duplicate button") }, onClick = { menu = false; vm.duplicateButton(rid, bid) })
                        DropdownMenuItem(text = { Text("Remove all codes") }, onClick = { menu = false; confirmClear = true })
                        DropdownMenuItem(text = { Text("Delete button") }, onClick = { menu = false; confirmDelete = true })
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 140.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                OutlinedTextField(
                    value = button.label,
                    onValueChange = { v -> vm.updateButton(rid, bid) { it.copy(label = v) } },
                    label = { Text("Button name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Text("When pressed", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    SendMode.entries.forEachIndexed { i, mode ->
                        SegmentedButton(
                            selected = button.mode == mode,
                            onClick = { vm.updateButton(rid, bid) { it.copy(mode = mode) } },
                            shape = SegmentedButtonDefaults.itemShape(i, SendMode.entries.size),
                        ) { Text(mode.title) }
                    }
                }
                Text(
                    button.mode.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            item {
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    NumberField(
                        "Delay between codes (ms)", button.delayMs, 0..10_000,
                        onChange = { v -> vm.updateButton(rid, bid) { it.copy(delayMs = v) } },
                        modifier = Modifier.weight(1f),
                    )
                    NumberField(
                        "Repeat each code", button.repeat, 1..20,
                        onChange = { v -> vm.updateButton(rid, bid) { it.copy(repeat = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Text("IR codes (${button.codes.size})", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    if (button.codes.isNotEmpty()) {
                        Button(onClick = { vm.press(rid, button) }) {
                            Icon(Icons.Filled.PlayArrow, null)
                            Spacer(Modifier.width(4.dp))
                            Text("Press")
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    FilledTonalButton(onClick = { adding = true }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.Add, null); Spacer(Modifier.width(4.dp)); Text("Add code")
                    }
                    OutlinedButton(onClick = { bulk = true }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.ContentPaste, null); Spacer(Modifier.width(4.dp)); Text("Paste many")
                    }
                }
            }
            if (button.codes.isEmpty()) {
                item {
                    Text(
                        "No codes yet. Add one code at a time, or use \"Paste many\" to add 20+ codes at once " +
                            "(one per line, e.g. \"NEC 0x20DF10EF\").",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                }
            }
            itemsIndexed(button.codes, key = { _, c -> c.id }) { index, code ->
                CodeRow(
                    index = index,
                    code = code,
                    isNext = button.mode == SendMode.CYCLE && index == nextIndex,
                    isFirst = index == 0,
                    isLast = index == button.codes.lastIndex,
                    showSetNext = button.mode == SendMode.CYCLE,
                    onTest = { vm.testCode(code, button.repeat) },
                    onEdit = { editing = code },
                    onUp = { vm.moveCode(rid, bid, code.id, -1) },
                    onDown = { vm.moveCode(rid, bid, code.id, 1) },
                    onDuplicate = { vm.addCodes(rid, bid, listOf(code.copy(id = com.universal.irremote.data.newId()))) },
                    onSetNext = { vm.setCycleIndex(rid, bid, index) },
                    onDelete = { vm.deleteCode(rid, bid, code.id) },
                )
            }
        }
    }

    if (adding) CodeEditorDialog(
        initial = null,
        onTest = { vm.testCode(it, button.repeat) },
        onSave = { vm.addCodes(rid, bid, listOf(it)) },
        onDismiss = { adding = false },
    )
    editing?.let { code ->
        CodeEditorDialog(
            initial = code,
            onTest = { vm.testCode(it, button.repeat) },
            onSave = { vm.replaceCode(rid, bid, it) },
            onDismiss = { editing = null },
        )
    }
    if (bulk) BulkAddDialog(
        onAdd = { vm.addCodes(rid, bid, it) },
        onDismiss = { bulk = false },
    )
    if (confirmDelete) ConfirmDialog(
        "Delete button?", "\"${button.label}\" and its ${button.codes.size} code(s) will be deleted.", "Delete",
        onConfirm = { vm.deleteButton(rid, bid); vm.back() }, onDismiss = { confirmDelete = false },
    )
    if (confirmClear) ConfirmDialog(
        "Remove all codes?", "All ${button.codes.size} code(s) on \"${button.label}\" will be removed.", "Remove",
        onConfirm = { vm.clearCodes(rid, bid) }, onDismiss = { confirmClear = false },
    )
}

@Composable
private fun CodeRow(
    index: Int,
    code: IrCode,
    isNext: Boolean,
    isFirst: Boolean,
    isLast: Boolean,
    showSetNext: Boolean,
    onTest: () -> Unit,
    onEdit: () -> Unit,
    onUp: () -> Unit,
    onDown: () -> Unit,
    onDuplicate: () -> Unit,
    onSetNext: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onEdit),
        colors = if (isNext) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
        else CardDefaults.cardColors(),
    ) {
        Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${index + 1}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.width(32.dp))
            Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                Text(code.summary(), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val extra = listOfNotNull(code.note.ifBlank { null }, if (isNext) "next to send" else null).joinToString(" · ")
                if (extra.isNotEmpty()) {
                    Text(extra, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton(onClick = onTest) { Icon(Icons.Filled.PlayArrow, "Send this code") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Code options") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; onEdit() })
                if (!isFirst) DropdownMenuItem(
                    text = { Text("Move up") }, leadingIcon = { Icon(Icons.Filled.KeyboardArrowUp, null) },
                    onClick = { menu = false; onUp() },
                )
                if (!isLast) DropdownMenuItem(
                    text = { Text("Move down") }, leadingIcon = { Icon(Icons.Filled.KeyboardArrowDown, null) },
                    onClick = { menu = false; onDown() },
                )
                DropdownMenuItem(
                    text = { Text("Duplicate") }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) },
                    onClick = { menu = false; onDuplicate() },
                )
                if (showSetNext) DropdownMenuItem(text = { Text("Send this one next") }, onClick = { menu = false; onSetNext() })
                DropdownMenuItem(
                    text = { Text("Delete") }, leadingIcon = { Icon(Icons.Filled.Delete, null) },
                    onClick = { menu = false; onDelete() },
                )
            }
        }
    }
}
