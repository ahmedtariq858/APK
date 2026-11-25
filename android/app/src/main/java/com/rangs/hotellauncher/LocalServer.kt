package com.rangs.hotellauncher

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The hotel server, built into the TV app ("একক মোড" / standalone mode).
 * Serves the admin panel at http://<tv-ip>:8080/admin/ and the same JSON API as server/src/server.js,
 * so one TV works with nothing but a phone on the same Wi-Fi. Data lives in files/store.json.
 * (No WebSockets here: the guest screen and the admin panel poll instead.)
 */
class LocalServer private constructor(private val ctx: Context) {

    companion object {
        const val PORT = 8080
        private const val TAG = "HotelLocalServer"
        private const val SESSION_TTL = 12L * 3600 * 1000
        private const val OFFLINE_AFTER = 150_000L
        @Volatile private var instance: LocalServer? = null

        fun start(ctx: Context): LocalServer = synchronized(this) {
            instance ?: LocalServer(ctx.applicationContext).also { it.run(); instance = it }
        }
        val running get() = instance != null

        private val TV_ENDPOINTS = setOf("state", "heartbeat", "orders", "alert", "result")
        private val ROLE_PERMS = mapOf(
            "reception" to listOf("dashboard", "checkin", "notices", "orders.view"),
            "kitchen" to listOf("dashboard", "orders.view", "orders.manage", "menu"),
            "manager" to listOf("*"),
            "technician" to listOf("dashboard", "tv")
        )
    }

    private val store = File(ctx.filesDir, "store.json")
    private val uploads = File(ctx.filesDir, "uploads").apply { mkdirs() }
    private lateinit var db: JSONObject
    private val pending = ConcurrentHashMap<String, JSONArray>()
    private val rnd = SecureRandom()
    private var cmdSeq = 0

    // ------------------------------------------------------------------ lifecycle

    private fun run() {
        load()
        val sock = ServerSocket(PORT, 50, InetAddress.getByName("0.0.0.0")).apply { reuseAddress = true }
        val pool = Executors.newFixedThreadPool(8)
        Thread({
            while (true) {
                val s = try { sock.accept() } catch (e: Exception) { Log.w(TAG, "accept", e); continue }
                pool.execute { serve(s) }
            }
        }, "hotel-http").apply { isDaemon = true }.start()
        Thread({
            while (true) {
                Thread.sleep(60_000)
                try { minuteTick() } catch (e: Exception) { Log.w(TAG, "tick", e) }
            }
        }, "hotel-tick").apply { isDaemon = true }.start()
        Log.i(TAG, "listening on :$PORT")
    }

    private fun load() {
        db = if (store.exists()) JSONObject(store.readText()) else seed()
        save()
    }

    @Synchronized private fun save() {
        val tmp = File(store.path + ".tmp")
        tmp.writeText(db.toString())
        tmp.renameTo(store)
    }

    private fun seed(): JSONObject {
        val s = JSONObject(ctx.assets.open("seed/seed.json").bufferedReader().readText())
        val now = System.currentTimeMillis()
        val tvDefaults = s.getJSONObject("tv")
        val salt = hex(bytes(8))
        val tv = JSONObject()
            .put("pinSalt", salt).put("pinHash", sha256(salt + tvDefaults.getString("pin"))).put("pinIsDefault", true)
            .put("combo", tvDefaults.getJSONArray("combo")).put("maxVolume", tvDefaults.getInt("maxVolume"))
            .put("clearPackages", tvDefaults.getJSONArray("clearPackages")).put("kiosk", false)
        val admin = JSONObject().put("id", 1).put("username", "admin").put("display_name", "Manager")
            .put("pass_hash", hashPassword("admin123")).put("role", "manager").put("active", true).put("created_at", now)
        return JSONObject()
            .put("users", JSONArray().put(admin))
            .put("sessions", JSONObject())
            .put("rooms", s.getJSONArray("rooms"))
            .put("menu", s.getJSONArray("menu"))
            .put("orders", JSONArray())
            .put("notices", JSONArray())
            .put("content", s.getJSONObject("content"))
            .put("tv", tv)
            .put("audit", JSONArray())
            .put("alerts", JSONArray())
            .put("devices", JSONObject())
            .put("offline", JSONObject())
            .put("seq", JSONObject().put("menu", 100).put("order", 0).put("notice", 0).put("user", 1).put("alert", 0).put("audit", 0))
    }

    private fun nextId(kind: String): Int {
        val seq = db.getJSONObject("seq")
        val n = seq.optInt(kind, 0) + 1
        seq.put(kind, n)
        return n
    }

    // ------------------------------------------------------------------ HTTP plumbing

    private class Req(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>, val body: ByteArray, val ip: String) {
        val json: JSONObject by lazy { if (body.isEmpty()) JSONObject() else try { JSONObject(String(body, Charsets.UTF_8)) } catch (e: Exception) { JSONObject() } }
        fun cookie(name: String): String? = headers["cookie"]?.split(";")?.map { it.trim() }?.firstOrNull { it.startsWith("$name=") }?.substringAfter("=")
    }

    private class Resp(val status: Int, val type: String, val body: ByteArray, val headers: Map<String, String> = emptyMap())

    private class HttpError(val status: Int, msg: String) : Exception(msg)

    private fun json(o: Any, status: Int = 200, headers: Map<String, String> = emptyMap()) =
        Resp(status, "application/json; charset=utf-8", o.toString().toByteArray(Charsets.UTF_8), headers)

    private fun bad(msg: String): Nothing = throw HttpError(400, msg)

    private fun serve(s: Socket) {
        s.use { sock ->
            sock.soTimeout = 30_000
            try {
                val input = BufferedInputStream(sock.getInputStream())
                val req = readRequest(input, sock.inetAddress.hostAddress ?: "") ?: return
                val resp = try {
                    route(req)
                } catch (e: HttpError) {
                    json(JSONObject().put("error", e.message), e.status)
                } catch (e: Exception) {
                    Log.w(TAG, "${req.method} ${req.path}", e)
                    json(JSONObject().put("error", "সার্ভারে সমস্যা হয়েছে"), 500)
                }
                write(sock.getOutputStream(), resp)
            } catch (e: Exception) {
                Log.d(TAG, "conn: ${e.message}")
            }
        }
    }

    private fun readLine(i: InputStream): String? {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read()
            if (c < 0) return if (b.size() == 0) null else b.toString("UTF-8")
            if (c == '\n'.code) return b.toString("UTF-8").trimEnd('\r')
            b.write(c)
            if (b.size() > 16_384) throw HttpError(431, "header too large")
        }
    }

    private fun readRequest(i: InputStream, ip: String): Req? {
        val line = readLine(i) ?: return null
        val parts = line.split(" ")
        if (parts.size < 2) return null
        val headers = HashMap<String, String>()
        while (true) {
            val h = readLine(i) ?: break
            if (h.isEmpty()) break
            val idx = h.indexOf(':')
            if (idx > 0) headers[h.substring(0, idx).trim().lowercase()] = h.substring(idx + 1).trim()
        }
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        if (len > 15 * 1024 * 1024) throw HttpError(413, "too large")
        val body = ByteArray(len)
        var read = 0
        while (read < len) { val n = i.read(body, read, len - read); if (n < 0) break; read += n }
        val target = parts[1]
        val path = URLDecoder.decode(target.substringBefore('?'), "UTF-8")
        val query = HashMap<String, String>()
        if (target.contains('?')) for (kv in target.substringAfter('?').split('&')) {
            if (kv.isEmpty()) continue
            query[URLDecoder.decode(kv.substringBefore('='), "UTF-8")] = URLDecoder.decode(kv.substringAfter('=', ""), "UTF-8")
        }
        return Req(parts[0].uppercase(), path, query, headers, body, ip)
    }

    private fun write(out: OutputStream, r: Resp) {
        val reason = mapOf(200 to "OK", 204 to "No Content", 302 to "Found", 400 to "Bad Request", 401 to "Unauthorized",
            403 to "Forbidden", 404 to "Not Found", 500 to "Internal Server Error")[r.status] ?: "OK"
        val sb = StringBuilder("HTTP/1.1 ${r.status} $reason\r\n")
        sb.append("Content-Type: ${r.type}\r\nContent-Length: ${r.body.size}\r\nConnection: close\r\n")
        sb.append("Cache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\n")
        for ((k, v) in r.headers) sb.append("$k: $v\r\n")
        sb.append("\r\n")
        out.write(sb.toString().toByteArray(Charsets.UTF_8))
        out.write(r.body)
        out.flush()
    }

    // ------------------------------------------------------------------ static files

    private fun mime(p: String) = when (p.substringAfterLast('.').lowercase()) {
        "html" -> "text/html; charset=utf-8"; "css" -> "text/css; charset=utf-8"; "js" -> "application/javascript; charset=utf-8"
        "json" -> "application/json"; "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "webp" -> "image/webp"
        "gif" -> "image/gif"; "svg" -> "image/svg+xml"; else -> "application/octet-stream"
    }

    private fun asset(dir: String, rest: String): Resp {
        val clean = rest.trimStart('/').ifEmpty { "index.html" }
        if (clean.contains("..")) throw HttpError(404, "not found")
        return try {
            Resp(200, mime(clean), ctx.assets.open("$dir/$clean").use { it.readBytes() })
        } catch (e: Exception) { throw HttpError(404, "not found") }
    }

    // ------------------------------------------------------------------ routing

    @Synchronized
    private fun route(r: Req): Resp {
        val p = r.path
        if (r.method == "OPTIONS") return Resp(204, "text/plain", ByteArray(0))
        when {
            p == "/" || p == "/admin" -> return Resp(302, "text/plain", ByteArray(0), mapOf("Location" to "/admin/"))
            p == "/tv" -> return Resp(302, "text/plain", ByteArray(0), mapOf("Location" to "/tv/"))
            p.startsWith("/admin/") -> return asset("admin", p.removePrefix("/admin/"))
            p.startsWith("/tv/") -> return asset("tv", p.removePrefix("/tv/"))
            p.startsWith("/uploads/") -> {
                val f = File(uploads, p.removePrefix("/uploads/").substringAfterLast('/'))
                if (!f.exists()) throw HttpError(404, "not found")
                return Resp(200, mime(f.name), f.readBytes())
            }
            p == "/health" -> return json(JSONObject().put("ok", true).put("time", now()).put("standalone", true))
            // /api/tv/{state,heartbeat,orders,alert,result} are the TV's; /api/tv/{settings,command,apk} are staff pages.
            p.startsWith("/api/tv/") && p.removePrefix("/api/tv/") in TV_ENDPOINTS -> return tvApi(r, p.removePrefix("/api/tv/"))
            p.startsWith("/api/") -> return staffApi(r, p.removePrefix("/api/"))
        }
        throw HttpError(404, "not found")
    }

    private fun now() = System.currentTimeMillis()

    // ------------------------------------------------------------------ helpers over db

    private fun arr(k: String) = db.getJSONArray(k)
    private fun JSONArray.objs(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
    private fun room(n: String?) = arr("rooms").objs().firstOrNull { it.getString("number") == n }
    private fun nul(v: Any?) = v ?: JSONObject.NULL
    private fun JSONObject.optLongOrNull(k: String): Long? = if (isNull(k) || !has(k)) null else optLong(k)
    private fun JSONObject.optStr(k: String): String? = if (isNull(k) || !has(k)) null else optString(k)

    private fun audit(user: JSONObject?, action: String, detail: Any? = null) {
        val a = arr("audit")
        a.put(JSONObject().put("id", nextId("audit")).put("at", now()).put("username", nul(user?.optString("username")))
            .put("action", action).put("detail", nul(detail?.toString())))
        while (a.length() > 1000) a.remove(0)
    }

    private fun alert(roomN: String?, kind: String, msg: String) {
        arr("alerts").put(JSONObject().put("id", nextId("alert")).put("at", now()).put("room", nul(roomN))
            .put("kind", kind).put("message", msg).put("seen", 0))
    }

    private fun activeNotices(rm: JSONObject?, t: Long = now()) = arr("notices").objs().filter {
        (it.optLongOrNull("starts_at")?.let { s -> s <= t } ?: true) && (it.optLongOrNull("ends_at")?.let { e -> e > t } ?: true)
    }.filter {
        rm == null || when (it.getString("target_type")) {
            "all" -> true
            "floor" -> it.getString("target") == rm.getString("floor")
            else -> it.getString("target") == rm.getString("number")
        }
    }

    private fun roomOrders(rm: JSONObject?): List<JSONObject> {
        val since = rm?.optLongOrNull("checkin_at") ?: return emptyList()
        return arr("orders").objs().filter { it.getString("room") == rm.getString("number") && it.getLong("created_at") >= since }
            .sortedByDescending { it.getInt("id") }
    }

    private fun tvPublic(): JSONObject {
        val tv = db.getJSONObject("tv")
        return JSONObject().put("pinSalt", tv.getString("pinSalt")).put("pinHash", tv.getString("pinHash"))
            .put("combo", tv.getJSONArray("combo")).put("maxVolume", tv.getInt("maxVolume"))
            .put("clearPackages", tv.getJSONArray("clearPackages")).put("kiosk", tv.optBoolean("kiosk")).put("latestApk", JSONObject.NULL)
    }

    private fun roomState(n: String): JSONObject {
        val rm = room(n)
        val guest = if (rm?.optStr("guest_name") != null) JSONObject().put("name", rm.getString("guest_name"))
            .put("language", rm.optString("language", "bn")).put("checkinAt", nul(rm.optLongOrNull("checkin_at")))
            .put("checkoutAt", nul(rm.optLongOrNull("checkout_at"))) else JSONObject.NULL
        val notices = JSONArray()
        if (rm != null) for (x in activeNotices(rm)) notices.put(JSONObject().put("id", x.getInt("id")).put("style", x.getString("style"))
            .put("text", JSONObject().put("bn", x.getString("text_bn")).put("en", x.getString("text_en")))
            .put("startsAt", nul(x.optLongOrNull("starts_at"))).put("endsAt", nul(x.optLongOrNull("ends_at"))))
        val menu = JSONArray(arr("menu").objs().sortedWith(compareBy({ it.optInt("sort") }, { it.getInt("id") })))
        return JSONObject().put("room", n).put("known", rm != null).put("floor", rm?.getString("floor") ?: "")
            .put("guest", guest).put("content", db.getJSONObject("content")).put("notices", notices).put("menu", menu)
            .put("orders", JSONArray(roomOrders(rm))).put("tv", tvPublic()).put("serverTime", now())
    }

    private fun touchDevice(id: String?, roomN: String?, ip: String, version: String?, model: String?) {
        if (id.isNullOrBlank()) return
        val devs = db.getJSONObject("devices")
        val d = devs.optJSONObject(id) ?: JSONObject().put("id", id)
        d.put("room", nul(roomN)).put("ip", ip).put("last_seen", now())
        if (!version.isNullOrBlank()) d.put("version", version)
        if (!model.isNullOrBlank()) d.put("model", model)
        devs.put(id, d)
    }

    private fun sendCommand(rooms: List<String>, command: String, args: JSONObject): JSONObject {
        val cmd = JSONObject().put("id", "${now()}-${++cmdSeq}").put("command", command).put("args", args)
        for (r in rooms) {
            val q = pending.getOrPut(r) { JSONArray() }
            q.put(cmd)
            while (q.length() > 10) q.remove(0)
        }
        // TVs poll every few seconds in standalone mode: count online ones as delivered.
        val online = rooms.count { r -> isOnline(r) }
        return JSONObject().put("delivered", online).put("queued", rooms.size - online)
    }

    private fun lastSeen(roomN: String): Long = db.getJSONObject("devices").let { d ->
        d.keys().asSequence().map { d.getJSONObject(it) }.filter { it.optStr("room") == roomN }.maxOfOrNull { it.optLong("last_seen") } ?: 0L
    }
    private fun isOnline(roomN: String) = now() - lastSeen(roomN) < OFFLINE_AFTER

    @Synchronized private fun minuteTick() {
        val day = dayKey(now())
        val off = db.getJSONObject("offline")
        val devs = db.getJSONObject("devices")
        val rooms = devs.keys().asSequence().mapNotNull { devs.getJSONObject(it).optStr("room") }.toSet()
        for (r in rooms) if (!isOnline(r)) {
            val k = "$day|$r"
            off.put(k, off.optInt(k) + 1)
        }
        save()
    }

    private fun dayKey(t: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(t))

    // ------------------------------------------------------------------ TV API

    private fun tvApi(r: Req, p: String): Resp {
        when ("${r.method} $p") {
            "GET state" -> {
                val n = r.query["room"] ?: bad("room দরকার")
                touchDevice(r.query["device"], n, r.ip, r.query["version"], r.query["model"])
                val cmds = pending.remove(n) ?: JSONArray()
                save()
                return json(roomState(n).put("commands", cmds))
            }
            "POST heartbeat" -> {
                val b = r.json
                touchDevice(b.optStr("device"), b.optStr("room"), r.ip, b.optStr("version"), b.optStr("model"))
                return json(JSONObject().put("ok", true))
            }
            "POST orders" -> {
                val b = r.json
                val rm = room(b.optStr("room")) ?: bad("অজানা রুম")
                val clientId = b.optStr("clientId")
                if (clientId != null) arr("orders").objs().firstOrNull { it.optStr("client_id") == clientId }?.let {
                    return json(JSONObject().put("order", it).put("duplicate", true))
                }
                val items = b.optJSONArray("items") ?: bad("অর্ডারে কিছু নেই")
                if (items.length() == 0) bad("অর্ডারে কিছু নেই")
                val lines = JSONArray()
                var total = 0
                for (it in items.objs()) {
                    val m = arr("menu").objs().firstOrNull { x -> x.getInt("id") == it.optInt("id") } ?: bad("মেনুতে নেই এমন খাবার")
                    if (!m.optBoolean("available", true)) bad("${m.getString("name_bn")} এখন পাওয়া যাচ্ছে না")
                    val qty = it.optInt("qty").coerceIn(1, 20)
                    lines.put(JSONObject().put("id", m.getInt("id")).put("name_bn", m.getString("name_bn")).put("name_en", m.optString("name_en"))
                        .put("price", m.getInt("price")).put("qty", qty))
                    total += m.getInt("price") * qty
                }
                val t = now()
                val order = JSONObject().put("id", nextId("order")).put("client_id", nul(clientId)).put("room", rm.getString("number"))
                    .put("guest_name", nul(rm.optStr("guest_name"))).put("items", lines).put("note", b.optString("note").take(300))
                    .put("total", total).put("status", "new").put("billed", false).put("created_at", t).put("updated_at", t)
                arr("orders").put(order)
                save()
                return json(JSONObject().put("order", order))
            }
            "POST alert" -> {
                val b = r.json
                val msgs = mapOf("pin_lockout" to "টিভি-অ্যাডমিন পিন ৫ বার ভুল দেওয়া হয়েছে", "clear_failed" to "অতিথির লগইন মোছা যায়নি",
                    "exit" to "টিভিতে লঞ্চার থেকে বের হওয়া হয়েছে")
                val kind = b.optString("kind")
                val def = msgs[kind] ?: bad("unknown alert")
                alert(b.optStr("room"), kind, b.optStr("message")?.take(200) ?: def)
                save()
                return json(JSONObject().put("ok", true))
            }
            "POST result" -> {
                val b = r.json
                if (b.optString("command") == "clearGuestData" && !b.optBoolean("ok"))
                    alert(b.optStr("room"), "clear_failed", "অতিথির লগইন মোছা যায়নি (${b.optString("message")})")
                save()
                return json(JSONObject().put("ok", true))
            }
        }
        throw HttpError(404, "not found")
    }

    // ------------------------------------------------------------------ staff API

    private fun sessionUser(r: Req): JSONObject? {
        val tok = r.cookie("sid") ?: return null
        val s = db.getJSONObject("sessions").optJSONObject(tok) ?: return null
        if (s.getLong("expires_at") < now()) return null
        return arr("users").objs().firstOrNull { it.getInt("id") == s.getInt("user_id") && it.optBoolean("active", true) }
    }

    private fun can(u: JSONObject, perm: String): Boolean {
        val p = ROLE_PERMS[u.getString("role")] ?: emptyList()
        return "*" in p || perm in p
    }

    private fun auth(r: Req, perm: String? = null): JSONObject {
        val u = sessionUser(r) ?: throw HttpError(401, "লগইন করুন")
        if (perm != null && !can(u, perm)) throw HttpError(403, "এই কাজের অনুমতি নেই")
        return u
    }

    private fun publicUser(u: JSONObject) = JSONObject().put("id", u.getInt("id")).put("username", u.getString("username"))
        .put("displayName", u.optString("display_name")).put("role", u.getString("role"))
        .put("perms", JSONArray(ROLE_PERMS[u.getString("role")] ?: emptyList<String>()))

    private fun parseTime(v: Any?): Long? {
        if (v == null || v == JSONObject.NULL || v.toString().isBlank()) return null
        val s = v.toString()
        for (f in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX", "yyyy-MM-dd'T'HH:mm")) {
            try { return SimpleDateFormat(f, Locale.US).parse(s)?.time } catch (e: Exception) { /* next */ }
        }
        bad("সময় ঠিক নয়")
    }

    private fun staffApi(r: Req, p: String): Resp {
        val seg = p.split('/')
        val norm = seg.mapIndexed { i, x -> if (i == 1 && (x.matches(Regex("\\d+")) || seg[0] == "rooms" || seg[0] == "checkout")) ":id" else x }
        val key = "${r.method} ${norm.joinToString("/")}"
        val id = seg.getOrNull(1) ?: ""
        val b = r.json
        when (key) {
            "POST login" -> {
                val u = arr("users").objs().firstOrNull { it.getString("username") == b.optString("username") && it.optBoolean("active", true) }
                if (u == null || !verifyPassword(b.optString("password"), u.getString("pass_hash"))) {
                    audit(JSONObject().put("username", b.optString("username")), "login.failed"); save()
                    throw HttpError(401, "ইউজারনেম বা পাসওয়ার্ড ভুল")
                }
                val tok = hex(bytes(32))
                val sessions = db.getJSONObject("sessions")
                sessions.keys().asSequence().toList().forEach { if (sessions.getJSONObject(it).getLong("expires_at") < now()) sessions.remove(it) }
                sessions.put(tok, JSONObject().put("user_id", u.getInt("id")).put("expires_at", now() + SESSION_TTL))
                audit(u, "login"); save()
                return json(JSONObject().put("user", publicUser(u)), headers = mapOf("Set-Cookie" to "sid=$tok; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}"))
            }
            "POST logout" -> {
                r.cookie("sid")?.let { db.getJSONObject("sessions").remove(it) }; save()
                return json(JSONObject().put("ok", true), headers = mapOf("Set-Cookie" to "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"))
            }
            "GET me" -> {
                val u = auth(r)
                return json(JSONObject().put("user", publicUser(u)).put("warnings", JSONObject().put("defaultPin", db.getJSONObject("tv").optBoolean("pinIsDefault"))).put("standalone", true))
            }
            "POST me/password" -> {
                val u = auth(r)
                if (!verifyPassword(b.optString("current"), u.getString("pass_hash"))) bad("বর্তমান পাসওয়ার্ড ভুল")
                if (b.optString("next").length < 6) bad("নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষর")
                u.put("pass_hash", hashPassword(b.optString("next"))); audit(u, "password.change"); save()
                return json(JSONObject().put("ok", true))
            }
            "GET dashboard" -> {
                auth(r, "dashboard")
                val devs = db.getJSONObject("devices").let { d -> d.keys().asSequence().map { d.getJSONObject(it) }.toList() }
                val active = arr("orders").objs().filter { it.getString("status") in listOf("new", "preparing") }.groupingBy { it.getString("room") }.eachCount()
                val rooms = JSONArray()
                for (rm in arr("rooms").objs().sortedWith(compareBy({ it.getString("floor") }, { it.getString("number") }))) {
                    val n = rm.getString("number")
                    val mine = devs.filter { it.optStr("room") == n }
                    val last = mine.maxOfOrNull { it.optLong("last_seen") } ?: 0L
                    rooms.put(JSONObject().put("number", n).put("floor", rm.getString("floor")).put("guestName", nul(rm.optStr("guest_name")))
                        .put("language", rm.optString("language")).put("checkinAt", nul(rm.optLongOrNull("checkin_at"))).put("checkoutAt", nul(rm.optLongOrNull("checkout_at")))
                        .put("tv", if (mine.isEmpty()) "none" else if (now() - last < OFFLINE_AFTER) "online" else "offline")
                        .put("lastSeen", if (last > 0) last else JSONObject.NULL)
                        .put("devices", JSONArray(mine.map { JSONObject().put("id", it.getString("id")).put("ip", it.optString("ip")).put("version", it.optString("version")).put("model", it.optString("model")).put("lastSeen", it.optLong("last_seen")) }))
                        .put("activeOrders", active[n] ?: 0))
                }
                val alerts = JSONArray(arr("alerts").objs().filter { it.optInt("seen") == 0 }.sortedByDescending { it.getInt("id") }.take(20))
                val known = arr("rooms").objs().map { it.getString("number") }.toSet()
                val unassigned = JSONArray(devs.filter { it.optStr("room") !in known })
                return json(JSONObject().put("rooms", rooms).put("alerts", alerts).put("unassignedDevices", unassigned))
            }
            "POST alerts/seen" -> { auth(r, "dashboard"); arr("alerts").objs().forEach { it.put("seen", 1) }; save(); return json(JSONObject().put("ok", true)) }
            "GET rooms" -> { auth(r, "dashboard"); return json(JSONObject().put("rooms", JSONArray(arr("rooms").objs().sortedWith(compareBy({ it.getString("floor") }, { it.getString("number") }))))) }
            "POST rooms" -> {
                val u = auth(r, "content")
                val n = b.optString("number").trim()
                if (!n.matches(Regex("[\\w-]{1,10}"))) bad("রুম নম্বর ঠিক নয়")
                val rm = room(n)
                if (rm != null) rm.put("floor", b.optString("floor"))
                else arr("rooms").put(JSONObject().put("number", n).put("floor", b.optString("floor")).put("guest_name", JSONObject.NULL).put("language", "bn").put("checkin_at", JSONObject.NULL).put("checkout_at", JSONObject.NULL))
                audit(u, "room.save", n); save()
                return json(JSONObject().put("ok", true))
            }
            "DELETE rooms/:id" -> {
                val u = auth(r, "content")
                removeWhere(arr("rooms")) { it.getString("number") == id }
                audit(u, "room.delete", id); save()
                return json(JSONObject().put("ok", true))
            }
            "POST checkin" -> {
                val u = auth(r, "checkin")
                val rm = room(b.optString("room")) ?: bad("অজানা রুম")
                val name = b.optString("guestName").trim()
                if (name.isEmpty()) bad("অতিথির নাম দিন")
                val lang = b.optString("language", "bn")
                if (lang !in listOf("bn", "en")) bad("ভাষা bn বা en")
                rm.put("guest_name", name.take(80)).put("language", lang).put("checkin_at", now()).put("checkout_at", nul(parseTime(b.opt("checkoutAt"))))
                audit(u, "checkin", "${rm.getString("number")} $name"); save()
                return json(JSONObject().put("ok", true).put("tvOnline", isOnline(rm.getString("number"))))
            }
            "GET checkout/:id" -> {
                auth(r, "checkin")
                val rm = room(id) ?: bad("অজানা রুম")
                val orders = roomOrders(rm).filter { !it.optBoolean("billed") && it.getString("status") != "cancelled" }
                return json(JSONObject().put("room", rm).put("orders", JSONArray(orders)).put("total", orders.sumOf { it.getInt("total") }))
            }
            "POST checkout" -> {
                val u = auth(r, "checkin")
                val rm = room(b.optString("room")) ?: bad("অজানা রুম")
                val orders = roomOrders(rm).filter { !it.optBoolean("billed") && it.getString("status") != "cancelled" }
                orders.forEach { it.put("billed", true).put("updated_at", now()) }
                val n = rm.getString("number")
                audit(u, "checkout", "$n ${rm.optString("guest_name")}")
                rm.put("guest_name", JSONObject.NULL).put("checkin_at", JSONObject.NULL).put("checkout_at", JSONObject.NULL).put("language", "bn")
                val delivery = sendCommand(listOf(n), "clearGuestData", JSONObject().put("packages", db.getJSONObject("tv").getJSONArray("clearPackages")))
                save()
                return json(JSONObject().put("ok", true).put("billedOrders", JSONArray(orders)).put("total", orders.sumOf { it.getInt("total") }).put("delivery", delivery))
            }
            "GET notices" -> { auth(r, "notices"); return json(JSONObject().put("notices", JSONArray(arr("notices").objs().sortedByDescending { it.getInt("id") })).put("now", now())) }
            "POST notices" -> {
                val u = auth(r, "notices")
                val tt = b.optString("targetType", "all"); val style = b.optString("style", "ticker")
                if (tt !in listOf("all", "floor", "room")) bad("লক্ষ্য ঠিক নয়")
                if (style !in listOf("ticker", "popup")) bad("ধরন ঠিক নয়")
                val bn = b.optString("textBn").take(500); val en = b.optString("textEn").take(500)
                if (bn.isBlank() && en.isBlank()) bad("নোটিশের লেখা দিন")
                if (tt != "all" && b.optString("target").isBlank()) bad("ফ্লোর বা রুম নম্বর দিন")
                val s = parseTime(b.opt("startsAt")); val e = parseTime(b.opt("endsAt"))
                if (s != null && e != null && e <= s) bad("শেষের সময় শুরুর পরে হতে হবে")
                val nid = nextId("notice")
                arr("notices").put(JSONObject().put("id", nid).put("target_type", tt).put("target", if (tt == "all") "" else b.optString("target").trim())
                    .put("style", style).put("text_bn", bn).put("text_en", en).put("starts_at", nul(s)).put("ends_at", nul(e))
                    .put("created_by", u.getString("username")).put("created_at", now()))
                audit(u, "notice.create", nid); save()
                return json(JSONObject().put("ok", true).put("id", nid))
            }
            "DELETE notices/:id" -> {
                val u = auth(r, "notices")
                removeWhere(arr("notices")) { it.getInt("id") == id.toIntOrNull() }
                audit(u, "notice.delete", id); save()
                return json(JSONObject().put("ok", true))
            }
            "GET content" -> { auth(r); return json(JSONObject().put("content", db.getJSONObject("content"))) }
            "PUT content" -> {
                val u = auth(r, "content")
                val c = b.optJSONObject("content") ?: bad("content দরকার")
                val cur = db.getJSONObject("content")
                for (k in c.keys()) cur.put(k, c.get(k))
                audit(u, "content.update"); save()
                return json(JSONObject().put("content", cur))
            }
            "POST upload" -> {
                val u = auth(r)
                if (!can(u, "content") && !can(u, "menu")) throw HttpError(403, "এই কাজের অনুমতি নেই")
                val m = Regex("^data:image/(png|jpe?g|webp|gif);base64,(.+)$").find(b.optString("dataUrl")) ?: bad("শুধু PNG, JPG, WebP বা GIF ছবি")
                val bytes = Base64.decode(m.groupValues[2], Base64.DEFAULT)
                val ext = if (m.groupValues[1] == "jpeg") "jpg" else m.groupValues[1]
                val name = sha256Bytes(bytes).take(20) + "." + ext
                File(uploads, name).writeBytes(bytes)
                return json(JSONObject().put("url", "/uploads/$name"))
            }
            "GET menu" -> { auth(r); return json(JSONObject().put("items", JSONArray(arr("menu").objs().sortedWith(compareBy({ it.optInt("sort") }, { it.getInt("id") }))))) }
            "POST menu" -> {
                val u = auth(r, "menu")
                if (b.optString("name_bn").isBlank()) bad("খাবারের নাম দিন")
                val price = b.optDouble("price", -1.0).let { if (it.isNaN()) -1 else Math.round(it).toInt() }
                if (price < 0) bad("দাম ঠিক নয়")
                val mid = b.optInt("id", 0)
                val item = (if (mid > 0) arr("menu").objs().firstOrNull { it.getInt("id") == mid } else null)
                    ?: JSONObject().put("id", nextId("menu")).also { arr("menu").put(it) }
                item.put("category", b.optString("category")).put("name_bn", b.optString("name_bn").trim()).put("name_en", b.optString("name_en"))
                    .put("description_bn", b.optString("description_bn")).put("description_en", b.optString("description_en"))
                    .put("price", price).put("image", nul(b.optStr("image")?.ifBlank { null })).put("available", b.optBoolean("available", true))
                    .put("sort", b.optInt("sort"))
                audit(u, "menu.save", item.getInt("id")); save()
                return json(JSONObject().put("ok", true).put("id", item.getInt("id")))
            }
            "DELETE menu/:id" -> {
                val u = auth(r, "menu")
                removeWhere(arr("menu")) { it.getInt("id") == id.toIntOrNull() }
                audit(u, "menu.delete", id); save()
                return json(JSONObject().put("ok", true))
            }
            "GET orders" -> {
                auth(r, "orders.view")
                val all = arr("orders").objs()
                val list = if ((r.query["scope"] ?: "active") == "active") all.filter { it.getString("status") in listOf("new", "preparing") }.sortedBy { it.getInt("id") }
                else all.sortedByDescending { it.getInt("id") }.take(200)
                return json(JSONObject().put("orders", JSONArray(list)))
            }
            "POST orders/:id/status" -> {
                val u = auth(r, "orders.manage")
                val st = b.optString("status")
                if (st !in listOf("new", "preparing", "delivered", "cancelled")) bad("অবস্থা ঠিক নয়")
                val o = arr("orders").objs().firstOrNull { it.getInt("id") == id.toIntOrNull() } ?: throw HttpError(404, "অর্ডার নেই")
                o.put("status", st).put("updated_at", now())
                audit(u, "order.status", "$id $st"); save()
                return json(JSONObject().put("ok", true))
            }
            "GET tv/settings" -> {
                auth(r, "tv")
                val s = JSONObject(db.getJSONObject("tv").toString()).apply { remove("pinHash"); remove("pinSalt") }
                return json(JSONObject().put("settings", s).put("apk", JSONObject.NULL))
            }
            "PUT tv/settings" -> {
                val u = auth(r, "tv")
                val tv = db.getJSONObject("tv")
                if (b.has("pin") && !b.isNull("pin")) {
                    val pin = b.optString("pin")
                    if (!pin.matches(Regex("\\d{4}"))) bad("পিন ৪ অঙ্কের হতে হবে")
                    if (pin == "1234") bad("১২৩৪ পিন রাখা যাবে না")
                    val salt = hex(bytes(8))
                    tv.put("pinSalt", salt).put("pinHash", sha256(salt + pin)).put("pinIsDefault", false)
                }
                if (b.has("maxVolume")) { val v = b.optInt("maxVolume"); if (v !in 10..100) bad("ভলিউম ১০–১০০"); tv.put("maxVolume", v) }
                if (b.has("combo")) {
                    val c = b.getJSONArray("combo"); val ok = setOf("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter")
                    if (c.length() !in 4..12 || (0 until c.length()).any { c.getString(it) !in ok }) bad("কম্বিনেশন ৪–১২টি তীর/OK বোতাম")
                    tv.put("combo", c)
                }
                if (b.has("clearPackages")) tv.put("clearPackages", b.getJSONArray("clearPackages"))
                if (b.has("kiosk")) tv.put("kiosk", b.optBoolean("kiosk"))
                audit(u, "tv.settings"); save()
                return json(JSONObject().put("ok", true))
            }
            "POST tv/command" -> {
                val u = auth(r, "tv")
                val command = b.optString("command")
                if (command !in listOf("restart", "reload", "clearGuestData")) bad(if (command == "update") "একক মোডে আপডেট পাঠানো যায় না — নতুন APK সরাসরি ইনস্টল করুন" else "অজানা নির্দেশ")
                val rooms = b.optJSONArray("rooms")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: arr("rooms").objs().map { it.getString("number") }
                if (rooms.isEmpty()) bad("রুম বাছুন")
                val args = JSONObject()
                if (command == "clearGuestData") args.put("packages", db.getJSONObject("tv").getJSONArray("clearPackages"))
                audit(u, "tv.$command", rooms.joinToString(",")); save()
                return json(sendCommand(rooms, command, args))
            }
            "POST tv/apk" -> bad("একক মোডে APK আপলোড হয় না — নতুন APK সরাসরি টিভিতে ইনস্টল করুন")
            "GET reports" -> {
                auth(r, "reports")
                val days = (r.query["days"]?.toIntOrNull() ?: 7).coerceIn(1, 90)
                val since = now() - days * 86_400_000L
                val orders = arr("orders").objs().filter { it.getLong("created_at") >= since && it.getString("status") != "cancelled" }
                val byDay = orders.groupBy { dayKey(it.getLong("created_at")) }.toSortedMap().map { (d, l) ->
                    JSONObject().put("day", d).put("orders", l.size).put("revenue", l.sumOf { it.getInt("total") }) }
                val sinceDay = dayKey(since)
                val off = db.getJSONObject("offline")
                val offline = off.keys().asSequence().filter { it.substringBefore('|') >= sinceDay }
                    .groupBy { it.substringAfter('|') }.map { (room, ks) -> JSONObject().put("room", room).put("minutes", ks.sumOf { off.getInt(it) }) }
                    .sortedByDescending { it.getInt("minutes") }
                val top = HashMap<String, IntArray>()
                for (o in orders) for (it in o.getJSONArray("items").objs()) {
                    val a = top.getOrPut(it.getString("name_bn")) { IntArray(2) }
                    a[0] += it.getInt("qty"); a[1] += it.getInt("qty") * it.getInt("price")
                }
                val topItems = top.entries.sortedByDescending { it.value[0] }.take(10).map { JSONObject().put("name", it.key).put("qty", it.value[0]).put("revenue", it.value[1]) }
                return json(JSONObject().put("days", days).put("byDay", JSONArray(byDay)).put("offline", JSONArray(offline)).put("topItems", JSONArray(topItems)))
            }
            "GET audit" -> { auth(r, "users"); return json(JSONObject().put("log", JSONArray(arr("audit").objs().sortedByDescending { it.getInt("id") }.take(300)))) }
            "GET users" -> {
                auth(r, "users")
                return json(JSONObject().put("users", JSONArray(arr("users").objs().map { JSONObject(it.toString()).apply { remove("pass_hash"); put("active", if (it.optBoolean("active", true)) 1 else 0) } })))
            }
            "POST users" -> {
                val u = auth(r, "users")
                val role = b.optString("role")
                if (role !in ROLE_PERMS) bad("রোল ঠিক নয়")
                val uid = b.optInt("id", 0)
                val pw = b.optString("password")
                if (uid > 0) {
                    val t = arr("users").objs().firstOrNull { it.getInt("id") == uid } ?: bad("ইউজার নেই")
                    val active = b.optBoolean("active", true)
                    if (uid == u.getInt("id") && (role != "manager" || !active)) bad("নিজের ম্যানেজার অনুমতি সরানো যাবে না")
                    t.put("display_name", b.optString("displayName")).put("role", role).put("active", active)
                    if (pw.isNotEmpty()) { if (pw.length < 6) bad("পাসওয়ার্ড কমপক্ষে ৬ অক্ষর"); t.put("pass_hash", hashPassword(pw)) }
                    if (pw.isNotEmpty() || !active) dropSessions(uid)
                    audit(u, "user.update", uid)
                } else {
                    val name = b.optString("username")
                    if (!name.matches(Regex("[a-zA-Z0-9_.-]{3,30}"))) bad("ইউজারনেম ৩–৩০ অক্ষর (a-z, 0-9)")
                    if (pw.length < 6) bad("পাসওয়ার্ড কমপক্ষে ৬ অক্ষর")
                    if (arr("users").objs().any { it.getString("username") == name }) bad("এই ইউজারনেম আগেই আছে")
                    arr("users").put(JSONObject().put("id", nextId("user")).put("username", name).put("display_name", b.optString("displayName"))
                        .put("pass_hash", hashPassword(pw)).put("role", role).put("active", true).put("created_at", now()))
                    audit(u, "user.create", name)
                }
                save()
                return json(JSONObject().put("ok", true))
            }
        }
        throw HttpError(404, "not found")
    }

    private fun dropSessions(uid: Int) {
        val s = db.getJSONObject("sessions")
        s.keys().asSequence().toList().forEach { if (s.getJSONObject(it).getInt("user_id") == uid) s.remove(it) }
    }

    private fun removeWhere(a: JSONArray, pred: (JSONObject) -> Boolean) {
        for (i in a.length() - 1 downTo 0) if (pred(a.getJSONObject(i))) a.remove(i)
    }

    // ------------------------------------------------------------------ crypto

    private fun bytes(n: Int) = ByteArray(n).also { rnd.nextBytes(it) }
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun sha256(s: String) = sha256Bytes(s.toByteArray(Charsets.UTF_8))
    private fun sha256Bytes(b: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(b))

    private fun pbkdf2(pw: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(PBEKeySpec(pw.toCharArray(), salt, 20_000, 256)).encoded

    private fun hashPassword(pw: String): String {
        val salt = bytes(16)
        return "pbkdf2$${hex(salt)}$${hex(pbkdf2(pw, salt))}"
    }

    private fun verifyPassword(pw: String, stored: String): Boolean {
        val p = stored.split('$')
        if (p.size != 3 || p[0] != "pbkdf2") return false
        val salt = p[1].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return MessageDigest.isEqual(hex(pbkdf2(pw, salt)).toByteArray(), p[2].toByteArray())
    }
}
