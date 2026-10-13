# /// script
# requires-python = ">=3.11"
# dependencies = ["marionette-driver==3.7.1"]
# ///
"""Real Firefox checks in an owned disposable profile; run with uv run."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import socket
import tempfile
from threading import Thread
import time
import zipfile

from marionette_driver.addons import Addons
from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parent.parent
ADDON_ID = "tabometer@tabometer.local"


def package(destination):
    # Explicit allowlist: do not package .git, credentials, profiles, or reports.
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ["manifest.json", "options.html", "options.css"]:
            archive.write(ROOT / name, name)
        for path in sorted((ROOT / "src").glob("*.js")):
            archive.write(path, f"src/{path.name}")
        archive.write(ROOT / "tests/firefox/scenarios.js", "integration/scenarios.js")
        archive.writestr("integration/fixture.html", "<!doctype html><title>Tabometer integration fixture</title><p>Local test tab.</p>")


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def chrome(driver, script, args=()):
    with driver.using_context("chrome"):
        return driver.execute_script(script, script_args=args)


def extension_script(driver, body, args=(), timeout=30000):
    result = driver.execute_async_script(
        "const done = arguments[arguments.length - 1];"
        "(async () => {" + body + "})().then(value => done({ok:true,value}),"
        "error => done({ok:false,error:String(error),stack:error.stack}));",
        script_args=args, sandbox=None, script_timeout=timeout,
    )
    if not result["ok"]:
        raise AssertionError(result["error"] + "\n" + result.get("stack", ""))
    return result.get("value")


def wait_for(check, message, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError("Timed out: " + message)


def start_network_monitor(driver):
    # Parent-process observation needs no extra extension permission. Count
    # requests, without retaining their URLs or unrelated Firefox traffic.
    chrome(driver, """
      const addonId = arguments[0];
      const monitor = {count:0, observe(subject) {
        const info = subject.QueryInterface(Ci.nsIChannel).loadInfo;
        if (info.triggeringPrincipal?.addonId === addonId ||
            info.loadingPrincipal?.addonId === addonId) this.count++;
      }};
      window.wrappedJSObject.__tabometerNetwork = monitor;
      Services.obs.addObserver(monitor, 'http-on-modify-request');
    """, [ADDON_ID])


def verify_network_monitor(driver):
    class Ping(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *_args):
            pass

    # A test-only loopback ping proves attribution actually works. Reset its
    # count before exercising production code; never contact a real account.
    with ThreadingHTTPServer(("127.0.0.1", 0), Ping) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            extension_script(driver, "if (await (await fetch(arguments[0])).text() !== 'ok') throw new Error('Monitor self-test failed');",
                             [f"http://127.0.0.1:{server.server_port}/ping"])
            assert chrome(driver, "return window.wrappedJSObject.__tabometerNetwork.count;") == 1, "Network monitor missed extension ping"
            chrome(driver, "window.wrappedJSObject.__tabometerNetwork.count = 0;")
        finally:
            server.shutdown()
            thread.join()


def finish_network_monitor(driver):
    count = chrome(driver, """
      const monitor = window.wrappedJSObject.__tabometerNetwork;
      Services.obs.removeObserver(monitor, 'http-on-modify-request');
      delete window.wrappedJSObject.__tabometerNetwork;
      return monitor.count;
    """)
    assert count == 0, f"Extension initiated {count} unexpected HTTP(S) requests"


def private_window_check(driver):
    baseline = extension_script(driver, "return (await browser.runtime.sendMessage({type:'sample'})).lastSample.total;")
    chrome(driver, "window.wrappedJSObject.__tabometerPrivate = window.OpenBrowserWindow({private:true});")
    try:
        wait_for(lambda: chrome(driver, "return window.wrappedJSObject.__tabometerPrivate.document.readyState === 'complete';"), "private window load")
        extension_script(driver, "await (await import('./integration/scenarios.js')).externalWindowCounts(arguments[0]);", [baseline])
    finally:
        chrome(driver, "window.wrappedJSObject.__tabometerPrivate.close(); delete window.wrappedJSObject.__tabometerPrivate;")


def hidden_tab_check(driver):
    tab = extension_script(driver, "return (await browser.tabs.create({url:browser.runtime.getURL('integration/fixture.html'),active:false})).id;")
    try:
        chrome(driver, "const tab = WebExtensionPolicy.getByID(arguments[0]).extension.tabManager.get(arguments[1]).nativeTab; tab.documentGlobal.gBrowser.hideTab(tab);", [ADDON_ID, tab])
        extension_script(driver, """
          const tab = await browser.tabs.get(arguments[0]);
          if (!tab.hidden) throw new Error('Fixture not hidden');
          const state = await browser.runtime.sendMessage({type:'sample'});
          const updated = await browser.sessions.getTabValue(tab.id,'tabometer.identity.v1');
          if (!state.tabs.some(item => item.uuid === updated.uuid)) throw new Error('Hidden tab excluded');
        """, [tab])
    finally:
        extension_script(driver, "await browser.tabs.remove(arguments[0]);", [tab])


def background_wake_check(driver, capture_history=False):
    # Observe natural suspension, not a debugger-forced termination. Reading
    # backgroundState from the parent does not run code in the event page.
    driver.set_pref("extensions.background.idle.timeout", 100)
    try:
        device_id = extension_script(driver, "return await (await import('./integration/scenarios.js')).prepareWake(arguments[0]);", [capture_history])
        wait_for(lambda: chrome(driver, "return WebExtensionPolicy.getByID(arguments[0]).extension.backgroundState === 'stopped';", [ADDON_ID]), "natural event-page suspension", timeout=15)
        driver.set_pref("extensions.background.idle.timeout", 300000)
        extension_script(driver, "await (await import('./integration/scenarios.js')).wake(arguments[0]);", [device_id])
        assert chrome(driver, "return WebExtensionPolicy.getByID(arguments[0]).extension.backgroundState;", [ADDON_ID]) == "running"
    finally:
        driver.set_pref("extensions.background.idle.timeout", 300000)


def restart_check(driver):
    before = extension_script(driver, "return await (await import('./integration/scenarios.js')).restartSnapshot();")
    driver.restart(in_app=True)
    wait_for(lambda: chrome(driver, "return !!WebExtensionPolicy.getByID(arguments[0]);", [ADDON_ID]), "persistent extension after restart", timeout=30)
    base = chrome(driver, "return WebExtensionPolicy.getByID(arguments[0]).getURL('');", [ADDON_ID])
    # A fresh automation tab avoids overwriting any restored fixture tab.
    handle = driver.open(type="tab")
    driver.switch_to_window(handle["handle"])
    driver.navigate(base + "options.html")
    return extension_script(driver, "return await (await import('./integration/scenarios.js')).verifyRestart(arguments[0]);", [before])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox", default=shutil.which("firefox") or "/Applications/Firefox.app/Contents/MacOS/firefox")
    parser.add_argument("--headed", action="store_true", help="Show the disposable Firefox window")
    parser.add_argument("--restart", action="store_true", help="Require persistent unsigned installation and test real restart (Developer Edition/Nightly)")
    parser.add_argument("--skip-alarm", action="store_true", help="Skip the real one-minute alarm for a quicker, partial run")
    args = parser.parse_args()
    if not Path(args.firefox).is_file():
        parser.error("Firefox not found; pass --firefox /path/to/firefox")

    with tempfile.TemporaryDirectory(prefix="tabometer-firefox-") as temporary:
        directory = Path(temporary)
        extension = directory / "tabometer.xpi"
        package(extension)
        driver = None
        try:
            driver = Marionette(
                bin=str(Path(args.firefox).resolve()), port=free_port(),
                workspace=str(directory),
                app_args=(["-headless"] if not args.headed else []) + ["-remote-allow-system-access"],
                gecko_log=str(directory / "firefox.log"), startup_timeout=30,
                prefs={"browser.startup.page": 3, "browser.sessionstore.warnOnQuit": False,
                       "browser.warnOnQuitShortcut": False, "browser.shell.checkDefaultBrowser": False,
                       "extensions.background.idle.timeout": 100,
                       "xpinstall.signatures.required": False},
            )
            driver.start_session()
            print("Firefox " + driver.session_capabilities["browserVersion"], flush=True)
            start_network_monitor(driver)
            Addons(driver).install(str(extension), temp=not args.restart)
            base = chrome(driver, "return WebExtensionPolicy.getByID(arguments[0]).getURL('');", [ADDON_ID])
            driver.navigate(base + "options.html")
            background_wake_check(driver, capture_history=True)
            print("PASS natural background suspension and message wake, including snapshot history", flush=True)
            # Include installation/wake traffic in the assertion before the
            # self-test resets the counter.
            assert chrome(driver, "return window.wrappedJSObject.__tabometerNetwork.count;") == 0
            verify_network_monitor(driver)
            cases = extension_script(driver, "return Object.keys((await import('./integration/scenarios.js')).cases);")
            for name in cases:
                if name == "real one-minute alarm without synthetic clock":
                    continue
                started = time.monotonic()
                extension_script(driver,
                    "const suite = await import('./integration/scenarios.js');"
                    "await suite.cases[arguments[0]](); return true;", [name], timeout=120000)
                print(f"PASS {name} ({time.monotonic() - started:.1f}s)", flush=True)
            for name, check in [("private-window exclusion", private_window_check),
                                ("hidden tab included without tabHide permission", hidden_tab_check)]:
                started = time.monotonic()
                check(driver)
                print(f"PASS {name} ({time.monotonic() - started:.1f}s)", flush=True)
            if not args.skip_alarm:
                name = "real one-minute alarm without synthetic clock"
                print("Waiting for a real one-minute Firefox alarm…", flush=True)
                extension_script(driver, "await (await import('./integration/scenarios.js')).cases[arguments[0]]();", [name], timeout=120000)
                print("PASS " + name, flush=True)
            else:
                print("SKIP real alarm (--skip-alarm)", flush=True)
            finish_network_monitor(driver)
            print("PASS no extension HTTP(S) traffic during installation and lifecycle checks", flush=True)
            if args.restart:
                activity = restart_check(driver)
                print("PASS real browser restart with persistent extension", flush=True)
                print(f"Restored inactive fixture activity: before={activity['activityBefore']}, after={activity['activityAfter']}", flush=True)
            else:
                print("SKIP browser restart: use --restart with Developer Edition/Nightly", flush=True)
            print("Firefox integration checks completed.", flush=True)
        except BaseException:
            log = directory / "firefox.log"
            if log.exists():
                print("Firefox log (last 15 lines):\n" + "\n".join(log.read_text(errors="replace").splitlines()[-15:]), flush=True)
            raise
        finally:
            if driver and driver.instance:
                driver.cleanup()


if __name__ == "__main__":
    main()
