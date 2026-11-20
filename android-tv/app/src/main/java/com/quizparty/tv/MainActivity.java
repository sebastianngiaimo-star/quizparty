package com.quizparty.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

/**
 * Full-screen TV shell for the QuizParty host screen.
 * - Opens <server>/host in a WebView with autoplay allowed (sound works without a click).
 * - First launch (or Back / Menu button) asks for the server address.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "quizparty";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0d0b24"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    view.loadData("<html><body style='background:#0d0b24;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                        + "<div><h1>Can't reach the server</h1><p>" + serverUrl() + "</p><p>Retrying in 5 seconds… (press Back to change the address)</p></div></body></html>",
                        "text/html", "utf-8");
                    view.postDelayed(new Runnable() { public void run() { load(); } }, 5000);
                }
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        hideSystemUi();

        if (serverUrl().isEmpty()) askServer(); else load();
    }

    private String serverUrl() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString("url", "");
    }

    private void load() {
        String u = serverUrl();
        if (u.isEmpty()) { askServer(); return; }
        web.loadUrl(u.replaceAll("/+$", "") + "/host");
        web.requestFocus();
    }

    private void askServer() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        String cur = serverUrl();
        input.setText(cur.isEmpty() ? "https://" : cur);
        input.setSelection(input.getText().length());
        new AlertDialog.Builder(this)
            .setTitle("QuizParty server address")
            .setMessage("e.g. https://my-quiz.onrender.com or http://192.168.1.20:3000")
            .setView(input)
            .setPositiveButton("Open", (d, w) -> {
                String v = input.getText().toString().trim();
                if (!v.startsWith("http")) v = "http://" + v;
                SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
                e.putString("url", v).apply();
                load();
            })
            .setNegativeButton("Exit", (d, w) -> { if (serverUrl().isEmpty()) finish(); })
            .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_MENU) {
            new AlertDialog.Builder(this)
                .setTitle("QuizParty")
                .setItems(new String[]{"Reload", "Change server address", "Exit app", "Cancel"}, (d, which) -> {
                    if (which == 0) web.reload();
                    else if (which == 1) askServer();
                    else if (which == 2) finish();
                })
                .show();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); hideSystemUi(); }
}
