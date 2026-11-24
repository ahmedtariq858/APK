package com.universal.irremote.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.universal.irremote.data.Remote
import com.universal.irremote.data.RemoteButton
import com.universal.irremote.data.SendMode
import com.universal.irremote.ui.AppViewModel
import com.universal.irremote.ui.Screen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteScreen(vm: AppViewModel, remote: Remote) {
    var editMode by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var addButton by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (editMode) "Editing: ${remote.name}" else remote.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                actions = {
                    IconButton(onClick = { editMode = !editMode }) {
                        if (editMode) Icon(Icons.Filled.Done, "Done editing") else Icon(Icons.Filled.Edit, "Edit buttons")
                    }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Menu") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Add button") }, onClick = { menu = false; addButton = true })
                        DropdownMenuItem(text = { Text("Rename remote") }, onClick = { menu = false; rename = true })
                        HorizontalDivider()
                        (2..5).forEach { c ->
                            DropdownMenuItem(
                                text = { Text("$c columns" + if (remote.columns == c) "  ✓" else "") },
                                onClick = { menu = false; vm.setColumns(remote.id, c) },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (editMode || remote.buttons.isEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { addButton = true },
                    icon = { Icon(Icons.Filled.Add, null) },
                    text = { Text("Add button") },
                )
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Text(
                if (editMode) "Tap a button to edit its name and IR codes."
                else "Tap to send · long-press to edit codes",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (remote.buttons.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text("This remote has no buttons yet.\nTap \"Add button\".", textAlign = TextAlign.Center)
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(remote.columns),
                    contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 140.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(remote.buttons, key = { it.id }) { button ->
                        RemoteKey(
                            button = button,
                            editMode = editMode,
                            onPress = { vm.press(remote.id, button) },
                            onEdit = { vm.navigate(Screen.ButtonEditor(remote.id, button.id)) },
                        )
                    }
                }
            }
        }
    }

    if (rename) TextInputDialog("Rename remote", "Name", remote.name, onConfirm = { vm.renameRemote(remote.id, it) }, onDismiss = { rename = false })
    if (addButton) TextInputDialog(
        "Add button", "Button name", "", confirmText = "Add",
        onConfirm = { label ->
            val id = vm.addButton(remote.id, label)
            vm.navigate(Screen.ButtonEditor(remote.id, id))
        },
        onDismiss = { addButton = false },
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RemoteKey(button: RemoteButton, editMode: Boolean, onPress: () -> Unit, onEdit: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val empty = button.codes.isEmpty()
    val shape = RoundedCornerShape(18.dp)
    val container = when {
        editMode -> MaterialTheme.colorScheme.secondaryContainer
        empty -> MaterialTheme.colorScheme.surfaceVariant
        button.label.equals("Power", ignoreCase = true) -> MaterialTheme.colorScheme.errorContainer
        else -> MaterialTheme.colorScheme.primaryContainer
    }
    val content = when {
        editMode -> MaterialTheme.colorScheme.onSecondaryContainer
        empty -> MaterialTheme.colorScheme.onSurfaceVariant
        button.label.equals("Power", ignoreCase = true) -> MaterialTheme.colorScheme.onErrorContainer
        else -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    Surface(
        color = container,
        contentColor = content,
        shape = shape,
        tonalElevation = if (empty) 0.dp else 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 68.dp)
            .clip(shape)
            .then(if (editMode) Modifier.border(1.dp, MaterialTheme.colorScheme.outline, shape) else Modifier)
            .combinedClickable(
                onClick = {
                    if (editMode) onEdit() else {
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onPress()
                    }
                },
                onLongClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onEdit()
                },
            ),
    ) {
        Column(
            Modifier.padding(horizontal = 6.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                button.label,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            val sub = when {
                empty -> "no code"
                button.codes.size == 1 -> "1 code"
                button.mode == SendMode.CYCLE -> "cycle ${(button.cycleIndex % button.codes.size) + 1}/${button.codes.size}"
                else -> "${button.codes.size} codes"
            }
            Text(sub, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}
