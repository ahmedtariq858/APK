package com.universal.irremote.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.selection.selectable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.SettingsRemote
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.universal.irremote.data.Remote
import com.universal.irremote.data.RemoteType
import com.universal.irremote.ui.AppViewModel
import com.universal.irremote.ui.Screen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: AppViewModel, remotes: List<Remote>, onExport: () -> Unit, onImport: () -> Unit) {
    var showNew by remember { mutableStateOf(false) }
    var showAbout by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("IR Universal Remote") },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Menu") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Import backup") }, onClick = { menu = false; onImport() })
                        DropdownMenuItem(text = { Text("Export backup") }, onClick = { menu = false; onExport() })
                        DropdownMenuItem(text = { Text("About / IR blaster info") }, onClick = { menu = false; showAbout = true })
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showNew = true },
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text("New remote") },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (!vm.hasIrBlaster) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Warning, null, tint = MaterialTheme.colorScheme.onErrorContainer)
                            Spacer(Modifier.width(12.dp))
                            Text(
                                "No IR blaster found on this phone. You can still create remotes and enter codes, " +
                                    "but buttons can only send on a phone with an IR blaster.",
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
            }
            if (remotes.isEmpty()) {
                item {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 64.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Filled.SettingsRemote, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(16.dp))
                        Text("No remotes yet", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Tap \"New remote\" to start from a TV, AC, set-top box or fan layout, or build your own.",
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
            items(remotes, key = { it.id }) { remote ->
                RemoteCard(vm, remote)
            }
        }
    }

    if (showNew) NewRemoteDialog(
        onCreate = { name, type ->
            val id = vm.createRemote(name, type)
            vm.navigate(Screen.RemoteView(id))
        },
        onDismiss = { showNew = false },
    )
    if (showAbout) AlertDialog(
        onDismissRequest = { showAbout = false },
        title = { Text("IR Universal Remote") },
        text = {
            Text(
                "IR blaster: ${if (vm.hasIrBlaster) "found" else "not found"}\n" +
                    "Supported carrier frequencies: ${vm.frequencyRanges}\n\n" +
                    "Every button can hold any number of IR codes (20, 50 or more). " +
                    "\"Send all\" fires them one after another; \"Cycle\" sends the next one on each press.\n\n" +
                    "Phone IR blasters can only send, not receive, so codes are added by typing or pasting " +
                    "them (protocol + hex code, Pronto hex or raw timings) or by importing a backup file.",
            )
        },
        confirmButton = { TextButton(onClick = { showAbout = false }) { Text("OK") } },
    )
}

@Composable
private fun RemoteCard(vm: AppViewModel, remote: Remote) {
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var delete by remember { mutableStateOf(false) }
    val codeCount = remote.buttons.sumOf { it.codes.size }

    Card(Modifier.fillMaxWidth().clickable { vm.navigate(Screen.RemoteView(remote.id)) }) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.SettingsRemote, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(remote.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    "${remote.type.title} · ${remote.buttons.size} buttons · $codeCount codes",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Options") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename = true })
                    DropdownMenuItem(text = { Text("Duplicate") }, onClick = { menu = false; vm.duplicateRemote(remote.id) })
                    DropdownMenuItem(text = { Text("Move up") }, onClick = { menu = false; vm.moveRemote(remote.id, -1) })
                    DropdownMenuItem(text = { Text("Move down") }, onClick = { menu = false; vm.moveRemote(remote.id, 1) })
                    DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; delete = true })
                }
            }
        }
    }

    if (rename) TextInputDialog("Rename remote", "Name", remote.name, onConfirm = { vm.renameRemote(remote.id, it) }, onDismiss = { rename = false })
    if (delete) ConfirmDialog(
        "Delete remote?", "\"${remote.name}\" and all its $codeCount codes will be deleted.", "Delete",
        onConfirm = { vm.deleteRemote(remote.id) }, onDismiss = { delete = false },
    )
}

@Composable
private fun NewRemoteDialog(onCreate: (String, RemoteType) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf(RemoteType.TV) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New remote") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Name (e.g. Living room TV)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Text("Layout", style = MaterialTheme.typography.labelLarge)
                RemoteType.entries.forEach { t ->
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = t == type, onClick = { type = t }).padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = t == type, onClick = { type = t })
                        Text(t.title)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name.trim(), type); onDismiss() }) { Text("Create") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
