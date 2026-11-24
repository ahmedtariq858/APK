package com.universal.irremote.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.universal.irremote.ui.screens.ButtonEditorScreen
import com.universal.irremote.ui.screens.HomeScreen
import com.universal.irremote.ui.screens.RemoteScreen
import com.universal.irremote.ui.screens.SendStatusBar
import com.universal.irremote.ui.theme.IrTheme

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    private val exportLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(vm.exportJson().toByteArray()) }
            toast("Backup saved")
        } catch (e: Exception) {
            toast("Could not save backup: ${e.message}")
        }
    }

    private val importLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        val text = try {
            contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() }
        } catch (e: Exception) { null }
        if (text == null) { toast("Could not read the file"); return@registerForActivityResult }
        vm.importJson(text)
            .onSuccess { toast("Imported $it remote(s)") }
            .onFailure { toast("Not a valid backup file: ${it.message}") }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            IrTheme {
                App(
                    vm = vm,
                    onExport = { exportLauncher.launch("ir-remotes-backup.json") },
                    onImport = { importLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream", "*/*")) },
                )
            }
        }
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
}

@Composable
private fun App(vm: AppViewModel, onExport: () -> Unit, onImport: () -> Unit) {
    val stack by vm.backStack.collectAsState()
    val remotes by vm.remotes.collectAsState()
    val status by vm.status.collectAsState()

    BackHandler(enabled = stack.size > 1) { vm.back() }

    Box(Modifier.fillMaxSize()) {
        when (val screen = stack.last()) {
            Screen.Home -> HomeScreen(vm, remotes, onExport, onImport)
            is Screen.RemoteView -> {
                val remote = remotes.firstOrNull { it.id == screen.remoteId }
                if (remote == null) LaunchedEffect(screen) { vm.back() } else RemoteScreen(vm, remote)
            }
            is Screen.ButtonEditor -> {
                val remote = remotes.firstOrNull { it.id == screen.remoteId }
                val button = remote?.buttons?.firstOrNull { it.id == screen.buttonId }
                if (remote == null || button == null) LaunchedEffect(screen) { vm.back() } else ButtonEditorScreen(vm, remote, button)
            }
        }
        SendStatusBar(
            status = status,
            onStop = vm::stopSending,
            onDismiss = vm::dismissStatus,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}
