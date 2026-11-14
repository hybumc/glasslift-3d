const { app, BrowserWindow, shell } = require("electron");
const { once } = require("node:events");
let localServer;

async function createWindow() {
  let url = process.env.SEFA_OKEY_URL;
  if (!url) {
    const remoteUrl = "https://sefa-okey-101.onrender.com";
    try {
      const response = await fetch(`${remoteUrl}/health`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) url = remoteUrl;
    } catch (error) {
      console.warn("Online server unavailable; starting an offline bot table:", error.message);
    }
    if (!url) {
      process.env.PORT = "0";
      process.env.HOST = "127.0.0.1";
      delete process.env.STAFF_PASSWORD_HASH;
      ({ server: localServer } = await import("../server.js"));
      if (!localServer.listening) await once(localServer, "listening");
      url = `http://127.0.0.1:${localServer.address().port}`;
    }
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: "#071d19",
    title: "Sefa Okey 101",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadURL(url);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow().catch((error) => console.error("Could not start Sefa Okey:", error));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow().catch((error) => console.error("Could not start Sefa Okey:", error)); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (localServer) localServer.close(); });
