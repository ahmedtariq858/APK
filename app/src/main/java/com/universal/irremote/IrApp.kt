package com.universal.irremote

import android.app.Application
import com.universal.irremote.data.RemoteRepository

class IrApp : Application() {
    val repository: RemoteRepository by lazy { RemoteRepository(this) }
}
