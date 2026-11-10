/* =========================================================================
   ResInvest ERP — aplikacja na telefon (Android)

   Ten sam program co na komputerze, uruchomiony w systemowym WebView:
     * „Serwer firmy”       — strona programu z serwera ResInvest ERP (wspólne dane, logowanie, SSE),
     * „Bez serwera”        — program z pliku w aplikacji (tryb lokalny, dane w telefonie),
     * „Wersja demonstracyjna” — program demonstracyjny z danymi przykładowymi.
   Aplikacja dodaje tylko to, czego WebView nie ma sam: wybór plików i aparat (skany), dostęp do aparatu
   dla kodów QR, zapis plików w „Pobrane” (PDF, CSV, XLSX, kopie), drukowanie systemowe i adres serwera.
   Logika, silnik i interfejs — wyłącznie w programie HTML (bez kopii w aplikacji).
   ========================================================================= */
package group.resinvest.erp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONObject;

public class MainActivity extends Activity {
    /** Adres wewnętrzny plików programu dołączonych do aplikacji (tryb lokalny i demonstracyjny) — własne źródło danych przeglądarki. */
    static final String LOCAL_HOST = "app.resinvest.local";
    static final String LOCAL_BASE = "https://" + LOCAL_HOST + "/";
    static final String SETUP_URL = "file:///android_asset/setup.html";
    static final int REQ_FILE = 11, REQ_CAMERA_PERM = 12, REQ_STORAGE_PERM = 13;

    private WebView web;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutput;
    private PermissionRequest pendingPermission;
    private WebView printView;                 // zachowany do końca drukowania
    private volatile String allowedOrigin = "";  // źródło, któremu wolno używać mostu RIWNative
    private long lastBack = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#1E4634"));
        w.setNavigationBarColor(Color.parseColor("#1E4634"));
        prefs = getSharedPreferences("riw", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#EEF2EF"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);       // film powitalny jak w przeglądarce na komputerze
        s.setAllowFileAccess(true);                          // tylko ekran ustawień z plików aplikacji
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " ResInvestERP-Android/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.addJavascriptInterface(new Bridge(), "RIWNative");
        web.addJavascriptInterface(new SetupBridge(), "RIWSetup");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mime, length) ->
            downloadUrl(url, URLUtil.guessFileName(url, contentDisposition, mime), false));

        if (state != null) web.restoreState(state);
        else start(null);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    /** Uruchomienie wg zapisanego trybu; bez ustawień — ekran wyboru połączenia. */
    void start(String error) {
        String mode = prefs.getString("mode", ""), url = prefs.getString("serverUrl", "");
        if (error != null || mode.isEmpty() || ("server".equals(mode) && url.isEmpty())) {
            allowedOrigin = "";
            web.loadUrl(SETUP_URL + (error != null ? "?error=" + Uri.encode(error) : ""));
            return;
        }
        if ("server".equals(mode)) { allowedOrigin = origin(url); web.loadUrl(url + "/"); }
        else { allowedOrigin = origin(LOCAL_BASE); web.loadUrl(LOCAL_BASE + ("demo".equals(mode) ? "ResInvest_ERP_Demo.html" : "ResInvest_ERP.html")); }
    }

    /** Ekran wyboru połączenia bez komunikatu o błędzie (menu programu → „Aplikacja — adres serwera”). */
    void openSetup() { allowedOrigin = ""; web.loadUrl(SETUP_URL); }

    static String origin(String url) {
        try { Uri u = Uri.parse(url); return (u.getScheme() + "://" + u.getAuthority()).toLowerCase(Locale.ROOT); } catch (Exception e) { return ""; }
    }
    boolean isApp(String url) { return url != null && !allowedOrigin.isEmpty() && origin(url).equals(allowedOrigin); }

    /* ------------------------------------------------------------------ */
    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            String url = r.getUrl().toString();
            if (url.startsWith(SETUP_URL) || isApp(url)) return false;
            // inne adresy (strony WWW, poczta, telefon) — aplikacje systemowe; program zostaje otwarty
            try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (ActivityNotFoundException e) { toast(getString(R.string.no_app)); }
            return true;
        }
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (!LOCAL_HOST.equals(u.getHost())) return null;
            String path = u.getPath() == null ? "" : u.getPath().replaceFirst("^/+", "");
            if (!path.matches("[A-Za-z0-9_.-]+\\.html")) return notFound();
            try {
                InputStream in = getAssets().open("program/" + path);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-cache");
                return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, in);
            } catch (IOException e) { return notFound(); }
        }
        WebResourceResponse notFound() { return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null); }
        @Override
        public void onPageStarted(WebView v, String url, Bitmap fav) { if (url != null && url.startsWith(SETUP_URL)) allowedOrigin = ""; }
        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame() || r.getUrl().toString().startsWith(SETUP_URL)) return;
            String addr = prefs.getString("serverUrl", "");
            start(getString(R.string.no_server, addr, String.valueOf(e.getDescription())));
        }
    }

    /* ------------------------------------------------------------------ */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            String[] types = p.getAcceptTypes();
            boolean imagesOnly = types != null && types.length > 0;
            for (String t : types == null ? new String[0] : types) if (t != null && !t.isEmpty() && !t.startsWith("image/")) imagesOnly = false;
            Intent pick = p.createIntent();
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            List<Intent> extra = new ArrayList<>();
            if (imagesOnly && cameraAllowed()) {
                Intent cam = cameraIntent();
                if (cam != null) { if (p.isCaptureEnabled()) { startForResult(cam); return true; } extra.add(cam); }
            }
            Intent chooser = Intent.createChooser(pick, getString(R.string.choose_file));
            if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
            startForResult(chooser);
            return true;
        }
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            ui.post(() -> {
                if (!isApp(req.getOrigin().toString())) { req.deny(); return; }
                boolean video = false;
                for (String r : req.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
                if (!video) { req.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); return; }
                pendingPermission = req;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
            });
        }
        @Override public boolean onConsoleMessage(ConsoleMessage m) { return !BuildConfig.DEBUG; }
    }

    boolean cameraAllowed() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return true;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
        return false;                          // przy następnym wyborze aparat będzie już dostępny
    }
    Intent cameraIntent() {
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, "skan_" + System.currentTimeMillis() + ".jpg");
            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= 29) cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ResInvest ERP");
            cameraOutput = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            if (cameraOutput == null) return null;
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return i;
        } catch (Exception e) { cameraOutput = null; return null; }
    }
    void startForResult(Intent i) {
        try { startActivityForResult(i, REQ_FILE); }
        catch (ActivityNotFoundException e) { if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = null; toast(getString(R.string.no_app)); }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || fileCallback == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (cameraOutput != null) out = new Uri[]{cameraOutput};          // zdjęcie z aparatu
        } else if (cameraOutput != null) { try { getContentResolver().delete(cameraOutput, null, null); } catch (Exception ignored) {} }
        cameraOutput = null;
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_CAMERA_PERM && pendingPermission != null) {
            if (ok) pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else pendingPermission.deny();
            pendingPermission = null;
        }
        if (req == REQ_STORAGE_PERM && !ok) toast(getString(R.string.no_storage));
    }

    /* ------------------------------------------------------------------ */
    /** Most dla programu (tylko adres serwera albo pliki programu w aplikacji — inne strony nie mają dostępu). */
    private class Bridge {
        private boolean ok() { String o = allowedOrigin; return !o.isEmpty(); }
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64, boolean open) {
            if (!ok()) return;
            try { byte[] data = Base64.decode(base64, Base64.DEFAULT); ui.post(() -> saveBytes(safeName(name), mime, data, open)); }
            catch (IllegalArgumentException e) { ui.post(() -> toast(getString(R.string.save_failed))); }
        }
        @JavascriptInterface
        public void download(String url, String name, boolean open) { if (ok() && isApp(url)) ui.post(() -> downloadUrl(url, safeName(name), open)); }
        @JavascriptInterface
        public void printHtml(String html, String title) { if (ok()) ui.post(() -> print(html, title)); }
        @JavascriptInterface
        public void settings() { ui.post(() -> openSetup()); }
        @JavascriptInterface
        public String info() { return "{\"app\":\"android\",\"version\":\"" + BuildConfig.VERSION_NAME + "\"}"; }
    }

    /** Most ekranu wyboru połączenia (plik setup.html z aplikacji). */
    private class SetupBridge {
        private boolean onSetup() { return allowedOrigin.isEmpty(); }
        @JavascriptInterface
        public String config() {
            if (!onSetup()) return "{}";
            try { return new JSONObject().put("mode", prefs.getString("mode", "server")).put("serverUrl", prefs.getString("serverUrl", "")).put("version", BuildConfig.VERSION_NAME).toString(); }
            catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface
        public void test(String url) {
            if (!onSetup()) return;
            new Thread(() -> {
                String msg; boolean good = false;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url + "/api/health").openConnection();
                    c.setConnectTimeout(6000); c.setReadTimeout(8000);
                    int code = c.getResponseCode();
                    StringBuilder sb = new StringBuilder();
                    try (InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream()) { if (in != null) { byte[] b = new byte[4096]; int n; while ((n = in.read(b)) > 0 && sb.length() < 20000) sb.append(new String(b, 0, n, "UTF-8")); } }
                    JSONObject j = new JSONObject(sb.toString());
                    if (code == 200 && "resinvest-erp".equals(j.optString("app"))) { good = true; msg = getString(R.string.server_ok, j.optString("version"), j.optString("db")); }
                    else msg = getString(R.string.not_erp);
                } catch (Exception e) { msg = getString(R.string.no_server, url, e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "")); }
                final boolean g = good; final String m = msg;
                ui.post(() -> web.evaluateJavascript("window.riwTestResult(" + g + "," + JSONObject.quote(m) + ")", null));
            }).start();
        }
        @JavascriptInterface
        public void save(String mode, String url) {
            if (!onSetup() || !(mode.equals("server") || mode.equals("local") || mode.equals("demo"))) return;
            if (mode.equals("server") && !(url.startsWith("http://") || url.startsWith("https://"))) return;
            prefs.edit().putString("mode", mode).putString("serverUrl", mode.equals("server") ? url.replaceAll("/+$", "") : prefs.getString("serverUrl", "")).apply();
            ui.post(() -> { web.clearHistory(); start(null); });
        }
    }

    /* ------------------------------------------------------------------ */
    static String safeName(String n) {
        String s = n == null ? "" : n.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return s.isEmpty() ? "plik" : (s.length() > 120 ? s.substring(s.length() - 120) : s);
    }

    /** Zapis w folderze „Pobrane” (Android 10+: MediaStore; starsze: folder publiczny z uprawnieniem zapisu). */
    void saveBytes(String name, String mime, byte[] data, boolean open) {
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ResInvest ERP");
                uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IOException("MediaStore");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) { if (os == null) throw new IOException("stream"); os.write(data); }
            } else {
                if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE_PERM);
                    toast(getString(R.string.retry_after_perm)); return;
                }
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "ResInvest ERP");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
                File f = new File(dir, name);
                try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(data); }
                uri = null; open = false;
            }
            toast(getString(R.string.saved, name));
            if (open && uri != null) openUri(uri, mime);
        } catch (Exception e) { toast(getString(R.string.save_failed)); }
    }
    void openUri(Uri uri, String mime) {
        try { startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
        catch (ActivityNotFoundException e) { toast(getString(R.string.no_app)); }
    }

    /** Pobranie z serwera (ciasteczko sesji) przez systemowy menedżer pobierania → „Pobrane”. */
    void downloadUrl(String url, String name, boolean open) {
        if (!isApp(url) || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String ck = CookieManager.getInstance().getCookie(url);
            if (ck != null) r.addRequestHeader("Cookie", ck);
            r.addRequestHeader("X-RIW", "1");
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "ResInvest ERP/" + name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            toast(getString(R.string.downloading, name));
        } catch (Exception e) { toast(getString(R.string.save_failed)); }
    }

    /** Drukowanie systemowe (drukarka, „Zapisz jako PDF”) dokumentu przygotowanego przez program. */
    void print(String html, String title) {
        final WebView pv = new WebView(this);
        pv.getSettings().setJavaScriptEnabled(false);
        pv.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                String job = (title == null || title.isEmpty() ? "ResInvest ERP" : title);
                pm.print(job, v.createPrintDocumentAdapter(job), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            }
        });
        printView = pv;
        pv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_LONG).show(); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) { web.goBack(); return; }
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) { super.onBackPressed(); return; }
        lastBack = now; Toast.makeText(this, R.string.back_again, Toast.LENGTH_SHORT).show();
    }
    @Override protected void onResume() { super.onResume(); web.onResume(); CookieManager.getInstance().flush(); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
}
